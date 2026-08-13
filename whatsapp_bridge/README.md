# whatsapp_bridge

Local companion-device bridge for **WhatsApp Desk → Bridge mode**. It links a
WhatsApp number the same way your iPad/desktop/web client does (QR scan,
companion device, true end-to-end encryption, recent-history backfill) and
serves those chats to the desk over `localhost` HTTP — so you see and reply
to the number's real conversations inside the tool.

## ⚠️ Read this before using it

- **Your iPhone/iPad WhatsApp apps are NEVER at risk.** They are Meta's own
  official clients. This bridge does not touch them.
- **This bridge uses an UNOFFICIAL library** (Baileys) that speaks WhatsApp's
  companion protocol. That is against WhatsApp's Terms. The **number you link
  here** carries a real, heuristic ban risk — bulk/bot-like *sending* is the
  main trigger; read-heavy, light-reply use is lower risk but never zero.
- **Only ever link an expendable number.** If it's banned you lose that SIM —
  never your personal number, never the business/API number. Nothing
  business-critical may depend on this bridge.
- A banned number is banned everywhere (including its phone app). That's the
  cost, and it's contained to the one throwaway number by design.

The official, ban-free path for the business number is the Cloud API +
`whatsapp_relay/` (Bridge mode is the see-everything, E2E-preserving,
accepted-risk complement — see the brief part 6 §4).

## Run

```bash
cd whatsapp_bridge
export BRIDGE_TOKEN=$(openssl rand -hex 16)     # the desk presents this

# Try it with canned data, no WhatsApp, no risk:
node src/server.js --mock

# Real link (expendable number, in a terminal you can watch):
npm install
node src/server.js                              # scan the printed QR with the phone
```

Binds `127.0.0.1:8787` by default (localhost only — do **not** expose it).
In the desk's Accounts panel → Bridge mode: URL `http://127.0.0.1:8787`,
token = `BRIDGE_TOKEN`.

## Endpoints (all except `/health` require `Bearer $BRIDGE_TOKEN`)

| Route | Behaviour |
|---|---|
| `GET /health` | liveness (open) |
| `GET /status` | `{ linked, qr, me }` — `qr` set until you scan |
| `POST /link` / `POST /unlink` | (re)start / log out the session |
| `GET /chats` | conversations (normalized), most-recent-first |
| `GET /messages?chatId=&limit=` | messages for a chat |
| `GET /pull?since=<cursor>` | events after cursor — the desk's poll (same shape as the Cloud-API relay) |
| `POST /send` `{chatId, body}` | send a text |
| `GET /media?messageId=` | `{ base64, mimeType }` for a voice note / attachment |

Messages are normalized to the **same shape** `core/sg-whatsapp`'s
`parseWebhookPayload` emits, so the desk renders bridge and Cloud-API chats
through the identical components.

## Providers

- **mock** (`--mock`, `src/provider-mock.js`) — canned chats incl. a voice
  note; tested (`npm test`, 10/10). Zero setup, zero risk.
- **baileys** (default, `src/provider-baileys.js`) — the real companion
  provider. **Written to the documented Baileys API but NOT verified in this
  environment** (no install, no phone here). Validate on first real link.

## Tests

```bash
node whatsapp_bridge/tests/handlers.test.mjs    # mock provider, no network — 10/10
```

Handlers are pure (`src/handlers.js`); `src/server.js` is transport only;
`.baileys-auth/` (the persisted session) is git-ignored.
