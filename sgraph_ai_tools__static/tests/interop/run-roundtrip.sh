#!/usr/bin/env bash
#
# End-to-end sgit ↔ browser interop, both directions, against a throwaway local
# KV store. No credentials, no network beyond localhost.
#
#   ./run-roundtrip.sh              — install sgit into a temp venv and run
#   SGIT=/path/to/sgit ./run-roundtrip.sh   — use an existing sgit
#
# Exit code is the number of failed directions (0 = both green).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK:-$(mktemp -d)}"
PORT="${KV_PORT:-8899}"
API="http://127.0.0.1:${PORT}"
SGIT_VERSION="${SGIT_VERSION:-0.16.0}"
VAULT_KEY="sgit_private_vault_correct-horse-battery:k8hbjt8x"
STRIP_PREFIX="${STRIP_PREFIX:-1}"

echo "workdir: $WORK"

# ── sgit ─────────────────────────────────────────────────────────────────────
if [[ -n "${SGIT:-}" ]]; then
    PY="$(dirname "$SGIT")/python"
else
    echo "==> installing sgit-ai==${SGIT_VERSION}"
    python3 -m venv "$WORK/venv" || exit 1
    "$WORK/venv/bin/pip" install --quiet "sgit-ai==${SGIT_VERSION}" || exit 1
    SGIT="$WORK/venv/bin/sgit"
    PY="$WORK/venv/bin/python"
fi
echo "==> sgit: $("$SGIT" version 2>&1 | head -1)"

# ── KV store ─────────────────────────────────────────────────────────────────
KV_STORE="$WORK/kv-store" KV_PORT="$PORT" "$PY" "$HERE/kv-server.py" >"$WORK/kv.log" 2>&1 &
KV_PID=$!
trap 'kill $KV_PID 2>/dev/null' EXIT

for _ in $(seq 1 40); do
    curl -sf -o /dev/null "$API/api/vault/list/ping" && break
    sleep 0.25
done
echo "==> KV store up on $API"

FAILURES=0
SGIT_ARGS=(--base-url "$API" --token local-interop-token)

# ── Direction 1: CLI writes, browser reads ───────────────────────────────────
echo
echo "=== CLI → browser ==="
mkdir -p "$WORK/cli-vault/docs"
printf '# Hello from the CLI\n' > "$WORK/cli-vault/readme.md"
printf 'nested file\n'          > "$WORK/cli-vault/docs/notes.md"

(
    cd "$WORK/cli-vault" || exit 1
    "$SGIT" "${SGIT_ARGS[@]}" init --existing --vault-key "$VAULT_KEY" >/dev/null &&
    "$SGIT" "${SGIT_ARGS[@]}" commit -m "interop fixture" >/dev/null &&
    "$SGIT" "${SGIT_ARGS[@]}" push >/dev/null
) || { echo "  sgit init/commit/push failed"; FAILURES=$((FAILURES + 1)); }

echo "  sgit wrote:"
find "$WORK/kv-store/k8hbjt8x" -type f 2>/dev/null | sed "s|$WORK/kv-store/|    |" | sort

API_BASE="$API" VAULT_KEY="$VAULT_KEY" STRIP_PREFIX="$STRIP_PREFIX" \
EXPECTED='{"/readme.md":"# Hello from the CLI\n","/docs/notes.md":"nested file\n"}' \
    node "$HERE/roundtrip-cli-to-browser.mjs" || FAILURES=$((FAILURES + 1))

# ── Direction 2: browser writes, CLI reads ───────────────────────────────────
echo
echo "=== browser → CLI ==="
MINT=$(API_BASE="$API" SIMPLE_TOKEN="amber-lantern-4417" \
       FILES='{"from-browser.md":"# Written in the browser\n","note.txt":"browser round-trip\n"}' \
       node "$HERE/roundtrip-browser-to-cli.mjs")

if [[ -z "$MINT" ]]; then
    echo "  browser mint failed"; FAILURES=$((FAILURES + 1))
else
    CLONE_KEY=$(printf '%s' "$MINT" | "$PY" -c 'import json,sys; print(json.load(sys.stdin)["clone_key"])')
    echo "  browser minted vault, clone key: ${CLONE_KEY:0:16}…"

    "$SGIT" "${SGIT_ARGS[@]}" clone "$CLONE_KEY" "$WORK/cloned" >"$WORK/clone.log" 2>&1 ||
        { echo "  sgit clone failed — see $WORK/clone.log"; FAILURES=$((FAILURES + 1)); }
    grep -q 'single-branch fallback' "$WORK/clone.log" &&
        echo "  note: sgit used its single-branch fallback (browser writes no branch index)"

    for pair in "from-browser.md:# Written in the browser" "note.txt:browser round-trip"; do
        name="${pair%%:*}"; want="${pair#*:}"
        if [[ -f "$WORK/cloned/$name" ]] && [[ "$(cat "$WORK/cloned/$name")" == "$want" ]]; then
            echo "  ✓ $name checked out byte-identical"
        else
            echo "  ✗ $name missing or altered in the clone"; FAILURES=$((FAILURES + 1))
        fi
    done
fi

echo
[[ $FAILURES -eq 0 ]] && echo "interop: both directions green" || echo "interop: $FAILURES failure(s)"
exit $FAILURES
