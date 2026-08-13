# whatsapp_relay

The one server-side piece of the WhatsApp Desk tool (brief: `team/humans/dinis_cruz/claude-code-web/08/13/…whatsapp-desk…`, Decision 2): Meta's Cloud API delivers inbound messages **only** by webhook, and a browser tab can't receive webhooks. This ~150-line stateless Cloudflare Worker bridges that gap and nothing more.

```
Meta webhook ──POST /webhook──► verify X-Hub-Signature-256 ──► KV (72 h TTL)
Desk browser ──GET /messages (Bearer)──◄──────────────────────────┘
```

**What it holds:** raw webhook payloads, transiently (KV TTL, default 72 h).
**What it never holds:** your Meta access token, OpenRouter keys, anything long-lived.
**Honesty note:** WhatsApp's E2E encryption terminates at Meta's Cloud API — Meta sends this worker message plaintext. That is inherent to the Cloud API road, not something the relay adds. Ciphertext-at-rest in KV is the planned v0.2 hardening.

## Deploy (Cloudflare)

```bash
cd whatsapp_relay
wrangler kv namespace create RELAY_KV     # → paste the id into wrangler.toml
wrangler secret put META_APP_SECRET       # Meta app → Settings → Basic → App secret
wrangler secret put META_VERIFY_TOKEN     # invent a random string
wrangler secret put RELAY_TOKEN           # invent another; goes in the desk's Accounts panel
wrangler deploy
```

Then in the Meta app (WhatsApp → Configuration → Webhooks):
- Callback URL: `https://<your-worker>.workers.dev/webhook`
- Verify token: the `META_VERIFY_TOKEN` value (Meta will GET the handshake; the worker echoes `hub.challenge`)
- Subscribe to the `messages` field.

In the desk's Accounts panel: relay URL = the worker URL, relay token = `RELAY_TOKEN`.

## Endpoints

| Route | Auth | Behaviour |
|---|---|---|
| `GET /webhook` | Meta's `hub.verify_token` | subscription handshake (echo `hub.challenge`) |
| `POST /webhook` | `X-Hub-Signature-256` HMAC (app secret) | store raw payload → `msg:<padded-ts>:<rand>` with TTL; 401 on bad signature |
| `GET /messages?since=<cursor>` | `Bearer RELAY_TOKEN` | items after cursor (key-ordered = chronological), page cap 100, returns new cursor; CORS `*` |
| `OPTIONS /messages` | — | preflight |

Reserved (not implemented): a `config` KV key written by the desk for the future Tier-2 responder function (brief part 0 §3 — command allowlist, throttles, kill switch), and an outbound-proxy path if the Phase-0 browser-CORS probe against `graph.facebook.com` fails.

## Tests

```bash
node whatsapp_relay/tests/handlers.test.mjs   # 8 checks, no network, mocked KV
```

Handlers live in `src/handlers.js` (pure, testable); `src/worker.js` is routing only.
