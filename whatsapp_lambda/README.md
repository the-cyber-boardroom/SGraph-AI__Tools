# whatsapp_lambda — ping/pong MVP (milestone 1)

An AWS Lambda that receives WhatsApp Cloud API webhooks and replies **`pong 🏓`**
to any message that says **`ping`**.

Its only job is to prove the end-to-end path — phone → Meta → Lambda → Graph API →
phone — with the smallest possible surface, so that when the real responder lands
there is no ambiguity about which link in the chain is broken.

**Zero dependencies.** No AWS SDK, no npm packages, no `node_modules`, no
`package.json`. The only import from outside the folder is `node:crypto`, and
`fetch` is the one built into the Node 18+ runtime. `deploy.sh` needs nothing but
the `aws` CLI and `zip`.

Full design context, milestones M0–M4, and the secrets/IAM model:
`team/humans/dinis_cruz/claude-code-web/08/13/v0.2.86__plan__whatsapp-lambda-responder.md`

---

## Layout

```
whatsapp_lambda/
  src/
    handlers.mjs           pure logic — routing, signature check, dedupe, pong text
    send.mjs               Graph API text sender (~30 lines)
    index.mjs              Lambda entry point: env → deps → handlers. Transport only.
  tests/
    handlers.test.mjs      17 tests. No AWS, no network, no deps.
    local-server.mjs       runs the handler over node:http for local dev
    sign-and-post.mjs      POSTs a correctly-signed fake webhook at any URL
  deploy.sh                create-or-update the function + Function URL
  README.md                this file
```

Everything outside `index.mjs` is dependency-injected — config, clock, sender,
dedupe store, logger — which is why the tests need neither AWS nor a network.

---

## Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/webhook` (or `/`) | Meta's subscription handshake — echoes `hub.challenge` when `hub.verify_token` matches |
| `POST` | `/webhook` (or `/`) | Inbound webhook: verify signature → dedupe → reply to pings |
| `GET` | `/health` | Liveness + whether the four secrets are present. Echoes no secret values. |

`/` is routed alongside `/webhook` so a Function URL configured without a path
still works.

### Status codes

| Condition | Status |
|---|---|
| Handshake, correct verify token | `200` + the challenge, verbatim |
| Handshake, wrong verify token | `403` |
| `X-Hub-Signature-256` missing or wrong | `401`, nothing sent |
| Valid signature, malformed JSON | `400` |
| Valid webhook (whatever it contains) | `200` `{"ok":true,"sent":n,"duplicates":n,"failed":n}` |
| Valid webhook, but the Graph send failed | still `200`, `failed:1`, logged as `send-failed` |
| Unhandled exception | still `200` `{"ok":false}`, logged as `unhandled-error` |

A non-200 makes Meta redeliver, which multiplies a send failure rather than
fixing it. So once the signature is valid, the answer is 200 and problems go to
the logs.

---

## Local dev loop (no AWS, no Meta account)

Two shells. Nothing to install.

**Shell 1 — run the handler:**

```bash
cd whatsapp_lambda
META_APP_SECRET=app-secret META_VERIFY_TOKEN=verify-me \
  node tests/local-server.mjs          # → http://127.0.0.1:8788
```

Without `META_ACCESS_TOKEN` it uses a stub sender that prints the reply instead
of calling Meta, so the whole signature → dedupe → reply path is exercisable with
no Meta account at all. Set `META_ACCESS_TOKEN` + `META_PHONE_NUMBER_ID` and it
sends for real. The local server always sets `isBase64Encoded: true`, so it
exercises the same raw-body path a Function URL can take.

**Shell 2 — drive it:**

```bash
# handshake
curl -s 'http://127.0.0.1:8788/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=CHALLENGE-42'
# → CHALLENGE-42

# health
curl -s http://127.0.0.1:8788/health
# → {"ok":true,"service":"whatsapp-ping-pong","configured":false,"cold":false}

# a correctly-signed ping
META_APP_SECRET=app-secret node tests/sign-and-post.mjs \
  http://127.0.0.1:8788/webhook 447700900001 ping
# → 200 {"ok":true,"sent":1,"duplicates":0,"failed":0}

# the same message id again — Meta's retry
META_APP_SECRET=app-secret node tests/sign-and-post.mjs \
  http://127.0.0.1:8788/webhook 447700900001 ping --id wamid.fixed
# → 200 {"ok":true,"sent":0,"duplicates":1,"failed":0}
```

`sign-and-post.mjs` works unchanged against a deployed Function URL — same
signing, so it proves the live wiring too.

**Unit tests:**

```bash
node whatsapp_lambda/tests/handlers.test.mjs
# → 17 passed, 0 failed
```

They cover: handshake ok/403, bad signature → 401, signature over a **base64**
body, ping → exactly one pong to the right number, short-id + latency in the
reply, duplicate suppression, non-ping → no reply, ping variants vs `pinging`,
statuses-only payloads, malformed JSON → 400, send-failure-still-200, **message
bodies never reaching the logs**, `/health` without secrets, unknown path → 404,
and seen-set eviction.

---

## Deploy

```bash
cd whatsapp_lambda
META_APP_SECRET=…        \
META_VERIFY_TOKEN=…      \
META_ACCESS_TOKEN=…      \
META_PHONE_NUMBER_ID=…   \
  ./deploy.sh
```

Idempotent — re-run it to ship a code or config change. Optional overrides:
`FUNCTION_NAME` (default `whatsapp-ping-pong`), `AWS_REGION` (default
`eu-west-2`), `LAMBDA_ROLE_ARN` (otherwise a minimal logs-only role is created),
`PONG_TEXT` (a fixed reply instead of the diagnostics one).

It zips the **contents** of `src/` at the zip root, so the handler is
`index.handler`; creates or updates the function; and creates a Function URL with
`--auth-type NONE`. Public is correct here: Meta cannot sign AWS SigV4, so the
authentication is the HMAC we verify ourselves on every request.

The script prints the webhook URL, a health-check command, and a `logs tail`
command when it finishes.

### Environment variables

| Variable | Used for |
|---|---|
| `META_APP_SECRET` | verifying `X-Hub-Signature-256` |
| `META_VERIFY_TOKEN` | the subscription handshake (any string you choose) |
| `META_ACCESS_TOKEN` | sending via the Graph API |
| `META_PHONE_NUMBER_ID` | sending via the Graph API |
| `PONG_TEXT` | optional fixed reply; default is the diagnostics text |

Plain Lambda env vars are deliberate for the MVP. SSM SecureString (or Secrets
Manager) with cold-start caching is milestone 2 — see the plan doc. A missing
variable **warns** at cold start rather than failing, so a half-configured
deployment still answers `/health` and the handshake, and tells you what's
missing.

### Meta configuration

1. Meta app → **WhatsApp → Configuration → Webhooks → Edit**
2. **Callback URL**: `https://<function-url>/webhook`
3. **Verify token**: the `META_VERIFY_TOKEN` you deployed with
4. **Verify and save** — Meta immediately `GET`s the URL; it must echo the challenge
5. Subscribe to the **`messages`** field
6. Send `ping` from a phone to the business number

---

## Acceptance test (M1)

| # | Do this | Expect |
|---|---|---|
| 1 | `curl <url>/health` | `{"ok":true,…,"configured":true}` |
| 2 | Save the webhook in the Meta console | Meta reports the callback verified |
| 3 | WhatsApp `ping` → the business number | `pong 🏓 (msg …abcd · 87ms)` back within ~2s |
| 4 | Send `ping` again | a second pong, new id, no duplicates |
| 5 | Send `hello` | no reply; logs show `pings:0` |
| 6 | `sign-and-post.mjs … --id wamid.fixed` twice | `sent:1` then `sent:0, duplicates:1` |
| 7 | Same POST with a tampered signature | `401`, nothing sent |
| 8 | `aws logs tail /aws/lambda/whatsapp-ping-pong --follow` | structured JSON lines, **no message bodies** |

The first invocation after a deploy reports `· cold start` in the pong — a free
read on cold-start latency, which is the other thing this milestone is meant to
measure.

---

## Logging

One JSON object per line, never a message body:

```json
{"t":"2026-08-13T09:12:44.031Z","event":"pong-sent","id":"abcd","ms":87}
{"t":"2026-08-13T09:12:44.033Z","event":"webhook","messages":1,"statuses":0,"pings":1,"sent":1,"duplicates":0,"failed":0}
```

Events: `webhook`, `pong-sent`, `duplicate-skipped`, `send-failed`,
`signature-rejected`, `bad-json`, `config-incomplete`, `unhandled-error`.
Message ids are truncated to their last four characters — enough to correlate a
retry, not enough to be an identifier. A test asserts that a message body never
reaches the logs.

---

## Known limits (deliberate, for this milestone)

- **Dedupe is in-memory.** The seen-set is module scope, so it survives warm
  invocations and covers Meta's retry window in practice — but a container
  recycle or a second concurrent container can let one duplicate through.
  DynamoDB with a TTL is the fix (milestone 2).
- **Secrets are plain env vars.** Fine for a ping/pong; SSM SecureString is
  milestone 2.
- **Synchronous send.** The Graph call happens before the 200. At this size
  that's simpler and fast enough; the fast-200 + SQS split is milestone 3, when
  the responder starts doing real work (LLM calls) behind the webhook.
- **`ping` only.** Every other message is counted and ignored.
