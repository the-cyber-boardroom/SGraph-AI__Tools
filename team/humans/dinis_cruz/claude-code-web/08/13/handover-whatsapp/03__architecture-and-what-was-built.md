# 3 — Architecture & What Was Built

## Design philosophy

Our platform is browser-first: tools are static web pages that run entirely on
the user's device, hold their own keys, and call external APIs directly — no
application backend to run or trust. WhatsApp forces exactly two small
exceptions, and we kept them as minimal and stateless as possible.

## Why any server exists at all

A browser tab **cannot** do two specific things, so each gets a tiny dedicated
service:

| Thing the browser can't do | Why | Our minimal service |
|---|---|---|
| **Receive an inbound message on the Cloud API** | Meta only *pushes* messages via webhooks to a public HTTPS URL. A browser tab has no address to be pushed to. | **The relay** — a ~150-line stateless worker that catches webhooks and lets the browser pull them. Holds no long-lived secrets. |
| **Open the companion socket (the "iPad" link)** | The companion protocol is a raw encrypted socket to WhatsApp's servers, which only accept connections claiming the `web.whatsapp.com` origin. A browser is forced to send its real origin and is refused — and the link must stay alive continuously. | **The bridge** — a small local service (runs on your machine) that *is* the WhatsApp client; the browser is just its UI over localhost. |

Everything else — the entire interface, transcription, AI drafting, all keys and
logic — stays in the browser.

## The pieces (all built)

```
┌──────────────────────── your browser (tools.sgraph.ai) ────────────────────────┐
│  WhatsApp Desk  — the tool                                                       │
│   • Conversations list + per-chat tabs                                           │
│   • 24-hour-window awareness, receipts, media                                    │
│   • Voice-note → transcript, AI-drafted replies (human sends)                    │
│   • Accounts panel: choose Cloud API mode or Bridge mode                         │
└───────────────┬───────────────────────────────────────────────┬────────────────┘
                │ Cloud API mode                                 │ Bridge mode
                ▼                                                ▼
   send  ─► graph.facebook.com (Meta)              ┌─ whatsapp_bridge (local Node) ─┐
   inbound ◄─ the RELAY  ◄─ Meta webhooks          │  links a number like an iPad;   │
             (stateless worker)                    │  serves its real chats to the   │
                                                   │  browser over localhost         │
                                                   └─────────────────────────────────┘
```

### a. Core engine — `sg-whatsapp` (a shared library module)
Pure, dependency-injected logic used by everything else and fully unit-tested
(mocked network): the Cloud API client (send text / template / media, media
up- and download, mark-as-read, list templates), the webhook→normalized-message
translator, the 24-hour-window maths, a relay client and a bridge client (both
with the same "pull new messages" shape so the tool doesn't care which is
active), and typed error handling. **12/12 automated checks pass.**

### b. The relay — `whatsapp_relay` (Cloud API inbound)
A ~150-line stateless Cloudflare Worker: verifies Meta's subscription handshake,
cryptographically verifies each webhook's signature, stores the raw payload
briefly (72-hour auto-expiry), and serves it to the authenticated browser. It
never holds our Meta access token or any AI key. **8/8 automated checks pass.**
Deploy is ~5 minutes; it runs on a free tier.

### c. The bridge — `whatsapp_bridge` (companion / "iPad" mode)
A small local Node service that links a number as a companion device and serves
its chats to the desk over localhost. Two interchangeable back-ends: a **mock**
provider (canned data — tested, and run over real HTTP to confirm) and a **real**
provider built on the open-source Baileys library (written to its documented
API, but **not yet verified against a live WhatsApp account** — that happens on
first real link). **Mock: 10/10 automated checks pass.**

### d. Reusable chat components
Three self-contained UI building blocks — a message thread (bubbles, receipt
ticks, media, inline transcripts), a composer (with a template-only mode for
when the 24-hour window has closed), and a conversation list. Deliberately
generic, so they can power other chat surfaces later, not just WhatsApp.

### e. The tool — **WhatsApp Desk**
Ties it together: pick Cloud API or Bridge mode in the Accounts panel; converse
in tabs; transcribe voice notes; draft with AI (a human always sends). It exposes
a clean programmatic interface (24 documented actions) so it can also be driven
by automation/agents, and ships a **credential-free demo mode** to explore the
whole experience with no setup. **22/22 automated interface + demo-flow checks
pass in a real browser.**

## Two connection modes, side by side

| | **Cloud API mode** | **Bridge mode** |
|---|---|---|
| Number | The business/API number | A separate, expendable number |
| Official | ✅ | ❌ (unofficial) |
| Encryption | Terminates at Meta's cloud; relay briefly sees plaintext | Preserved end-to-end; terminates in *your* local bridge |
| 24-hour window / templates | Enforced | None (behaves as a normal client) |
| Needs a hosted piece | The relay (tiny, cloud) | The bridge (local, on your machine) |
| Sees existing chat history | No (starts empty) | Yes (recent backfill at link, like a fresh iPad) |
| Ban risk | None | Real — on that expendable number only |

## Verification status — stated plainly

- **Automated tests pass** across the engine, the relay, the bridge (mock), and
  the tool's interface + demo flow.
- **No live WhatsApp traffic has run.** Everything touching a real account —
  sending a real message, receiving a real webhook, linking a real companion —
  is pending the setup in doc 05. The code paths are written against the
  published API specs; first live use is where they get confirmed.
