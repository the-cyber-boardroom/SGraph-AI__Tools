#!/usr/bin/env bash
# Deploy the WhatsApp ping/pong Lambda with nothing but the aws CLI + zip.
# Idempotent: safe to re-run to ship a code or config change.
#
#   META_APP_SECRET=… META_VERIFY_TOKEN=… META_ACCESS_TOKEN=… \
#   META_PHONE_NUMBER_ID=… ./deploy.sh
#
# Optional: FUNCTION_NAME (default whatsapp-ping-pong), AWS_REGION (eu-west-2),
#           LAMBDA_ROLE_ARN (else a minimal role is created for you).

set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-whatsapp-ping-pong}"
REGION="${AWS_REGION:-eu-west-2}"
RUNTIME="nodejs22.x"
HERE="$(cd "$(dirname "$0")" && pwd)"
ZIP="${HERE}/function.zip"

for var in META_APP_SECRET META_VERIFY_TOKEN META_ACCESS_TOKEN META_PHONE_NUMBER_ID; do
    if [ -z "${!var:-}" ]; then echo "Missing required env var: $var" >&2; exit 1; fi
done

echo "==> Packaging (src/ contents at the zip root, so the handler is index.handler)"
rm -f "$ZIP"
( cd "${HERE}/src" && zip -qr "$ZIP" . )

# ── Execution role ───────────────────────────────────────────────────────────
if [ -z "${LAMBDA_ROLE_ARN:-}" ]; then
    ROLE_NAME="${FUNCTION_NAME}-role"
    if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
        echo "==> Creating execution role ${ROLE_NAME} (logs only — no other AWS access)"
        aws iam create-role --role-name "$ROLE_NAME" \
            --assume-role-policy-document '{
                "Version":"2012-10-17",
                "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
            }' >/dev/null
        aws iam attach-role-policy --role-name "$ROLE_NAME" \
            --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
        echo "    waiting for IAM propagation…"
        sleep 12
    fi
    LAMBDA_ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)"
fi
echo "    role: ${LAMBDA_ROLE_ARN}"

ENV_VARS="Variables={META_APP_SECRET=${META_APP_SECRET},META_VERIFY_TOKEN=${META_VERIFY_TOKEN},META_ACCESS_TOKEN=${META_ACCESS_TOKEN},META_PHONE_NUMBER_ID=${META_PHONE_NUMBER_ID}${PONG_TEXT:+,PONG_TEXT=${PONG_TEXT}}}"

# ── Function ─────────────────────────────────────────────────────────────────
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "==> Updating code"
    aws lambda update-function-code --function-name "$FUNCTION_NAME" --region "$REGION" \
        --zip-file "fileb://${ZIP}" >/dev/null
    aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
    echo "==> Updating configuration"
    aws lambda update-function-configuration --function-name "$FUNCTION_NAME" --region "$REGION" \
        --environment "$ENV_VARS" --timeout 15 --memory-size 256 >/dev/null
else
    echo "==> Creating function ${FUNCTION_NAME} in ${REGION}"
    aws lambda create-function --function-name "$FUNCTION_NAME" --region "$REGION" \
        --runtime "$RUNTIME" --role "$LAMBDA_ROLE_ARN" --handler index.handler \
        --zip-file "fileb://${ZIP}" --timeout 15 --memory-size 256 \
        --environment "$ENV_VARS" >/dev/null
fi
aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"

# ── Public Function URL (we do our own signature verification) ───────────────
if ! aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "==> Creating Function URL"
    aws lambda create-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" \
        --auth-type NONE >/dev/null
    aws lambda add-permission --function-name "$FUNCTION_NAME" --region "$REGION" \
        --statement-id FunctionURLAllowPublicAccess --action lambda:InvokeFunctionUrl \
        --principal '*' --function-url-auth-type NONE >/dev/null
fi

URL="$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" --region "$REGION" --query FunctionUrl --output text)"
URL="${URL%/}"
rm -f "$ZIP"

cat <<EOF

✅ Deployed.

   Webhook URL   : ${URL}/webhook
   Verify token  : (the META_VERIFY_TOKEN you passed)
   Health check  : curl ${URL}/health
   Logs          : aws logs tail /aws/lambda/${FUNCTION_NAME} --follow --region ${REGION}

Next: Meta app → WhatsApp → Configuration → Webhooks → paste the callback URL
and verify token, then subscribe to the "messages" field. Then send "ping".
EOF
