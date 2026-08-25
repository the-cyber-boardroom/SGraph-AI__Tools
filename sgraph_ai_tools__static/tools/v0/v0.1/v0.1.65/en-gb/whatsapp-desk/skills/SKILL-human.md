# WhatsApp Desk — Human Guide

**URL:** `/en-gb/whatsapp-desk/` · **Version:** 0.1.0 (alpha, **mock/demo-verified only** — live Meta probes pending)

Inbox + composer for the "Voice Debrief" Business WhatsApp number on the
official Meta Cloud API. Conversations open as tabs; the composer knows
WhatsApp's 24-hour rule; voice notes become transcripts; AI drafts replies —
and **nothing ever sends without your click**.

## Try it with zero setup

Click **🧪 Load demo conversations** on the Start tab: two conversations
(one inside the 24h window, one template-only), a voice note to transcribe
(needs only your OpenRouter key), drafts, the whole surface. Demo sends are
recorded locally — the network is never touched.

## Going live (one-time, after Meta verification)

1. Meta Business Manager: verified business → app + WABA → register the
   number on the Cloud API. ⚠️ **The number then leaves the phone app** —
   chats don't migrate; app and API are mutually exclusive.
2. Mint a system-user token (`whatsapp_business_messaging` +
   `whatsapp_business_management`), note the phone-number ID + WABA ID →
   paste in **Accounts** → Connect.
3. Inbound: deploy the relay (`whatsapp_relay/README.md`, ~5 minutes on
   Cloudflare), paste its URL + token in Accounts. Outbound works without it.
4. OpenRouter key (shared with Audio Transcribe / Video Publisher) for
   transcription + drafts.

## Bridge mode — see an app number's chats (like an iPad)

A second way to connect, in Accounts: **Bridge mode** links a number as a
*companion device* (QR scan, same as your iPad) via the local
`whatsapp_bridge` service — so you see and reply to that number's real
existing chats inside the desk, with end-to-end encryption preserved (it
terminates in your local bridge, not Meta's cloud), and no 24-hour-window
restriction (it behaves as a normal client).

**Safety, plainly:** your iPhone/iPad WhatsApp apps are *never* at risk —
they're Meta's official clients. Bridge mode uses an unofficial library, so
the **number you link there** carries a real ban risk (bulk/bot-like sending
is the trigger). **Only link an expendable number** — never your personal or
the business/API number. Full guide: `whatsapp_bridge/README.md`. Try it
risk-free first with the bridge's `--mock` mode.

## The 24-hour rule, made visible (Cloud API mode only)

Free-form messages are only allowed within 24h of the customer's last
message. Each conversation shows a chip — `⏱ window open · ~6h left` or
`📋 template-only` — and the composer switches automatically: outside the
window the text box locks and you pick an approved template instead. The
tool refuses out-of-window sends *before* they hit the API.

## Who gets to see what (honesty section)

- WhatsApp's end-to-end encryption **terminates at Meta's Cloud API** — on
  this road, "only you and me" becomes "you, me, and Meta's cloud".
- The relay transiently holds inbound message payloads (72h max) so your
  browser can pull them. It never holds your Meta token or OpenRouter key.
- Your tokens live in this browser's localStorage (paste them on another
  machine and the desk works there too).
- Voice-note audio goes to OpenRouter only when you click Transcribe;
  drafts send the conversation text to OpenRouter only when you click Draft.

## Caveats

- History = this session + the relay's 72h retention; a vault-backed
  archive is planned (v0.2).
- Template sends outside the window can open billed Meta conversations.
- Automatic/unattended replies are deliberately absent (that's the planned
  Tier-2 responder, off by default, separate from this page).
