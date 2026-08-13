# 2 — What Can and Cannot Be Done

This is the honest capability map. WhatsApp offers four ways to reach a number;
each has hard trade-offs set by Meta, not by us.

## The four routes

| | **1. Cloud API** (official) | **2. Companion protocol** (unofficial — what iPad/desktop/web clients speak) | **3. BSP / managed** (Twilio, 360dialog…) | **4. Business App** (status quo) |
|---|---|---|---|---|
| "A client like my iPad"? | No — a different paradigm; the number moves *off* the app to Meta's cloud | **Yes** — links as a companion device via QR; full chat history; app keeps working | No (resold Cloud API) | The app *is* the client |
| End-to-end encryption to the phone | **No** — encryption terminates at Meta's Cloud API | **Yes** (Signal protocol, multi-device) | No | Yes |
| Official / within WhatsApp's Terms | ✅ | ❌ — **real ban risk on the linked number** | ✅ | ✅ |
| Can our software receive messages | Via webhooks → needs a tiny relay service | Via a persistent socket → needs an always-on local process | Via their webhooks | ✋ manual, on the phone |
| Message templates & the 24-hour rule | Yes | No — behaves as a normal client | Yes | n/a |
| Automatable by our tools/agents | ✅ fully | ✅ fully (until the library breaks or the number is banned) | ✅ | ❌ |
| Ongoing infrastructure | One ~150-line stateless relay | A small always-on service holding the session | None of ours | None |
| Cost | Free "service" conversations; paid template conversations | Free | Cloud API fees + reseller margin | Free |

**Our choice:** Route 1 (Cloud API) for the business number; Route 2 (companion)
only ever on a **dedicated, expendable** number; Routes 3 and 4 not pursued
(BSPs add cost/lock-in for little benefit given our tiny relay; the app is the
starting point we're moving beyond).

## What CANNOT be done — regardless of engineering effort

These are Meta's rules; no amount of clever code changes them.

| Wish | Why it's impossible |
|---|---|
| Sync the existing app chats into a tool | The Business App has no API. Only the phone (and its linked companion devices) can read those chats. |
| Run the app and an API tool on the same number | Registration is exclusive — moving a number to the Cloud API disconnects its phone app. |
| Carry chat history across the app→API move | History lives on the phone; Cloud API registration starts empty. No import path exists either way. |
| Keep true end-to-end encryption on the Cloud API | On that route, encryption terminates at Meta's cloud by design — a fact we surface honestly to users. |
| Have a tool reply while nothing is running | Inbound needs *something* listening (a webhook receiver or a live socket). A closed browser tab receives nothing. |

## What CAN be done — today or once set up

| Capability | Status |
|---|---|
| See the full designed experience with zero credentials (demo mode) | Works the moment the tool is deployed |
| After Cloud API setup: send/receive, conversation tabs, delivery/read receipts, 24-hour-window handling, approved templates | Built, mock-verified; needs Meta credentials + the relay |
| Transcribe inbound voice notes → text; AI-drafted replies (human approves) | Built; needs an AI provider key (we bring our own) |
| Operate the desk from several computers | Yes — the credential is not device-locked |
| **On an expendable second number:** link it like an iPad (companion) and see its *real* chats in the same tool, with E2E preserved | Built (needs the local bridge running + a QR scan); accepted-risk lane |
| Preserve app history before migrating a number | Manual: WhatsApp's per-chat "Export Chat" from the phone, then archive |
| Go back to the app later | Possible (de-register from the API, re-verify in the app) — but API-era chats don't follow back either |

## The plain-English summary

- **You cannot merge the two worlds.** One number, one home, no bridge of history.
- **The official route is fully capable** but changes the privacy story (Meta's
  cloud sees message content) and imposes WhatsApp's business-messaging rules
  (24-hour window, approved templates).
- **The "just like my iPad" route is real** but unofficial — safe to use only on
  a number you're willing to lose, never the business-critical one.
- **The two-number strategy gets us both**, cleanly, with the same tool.
