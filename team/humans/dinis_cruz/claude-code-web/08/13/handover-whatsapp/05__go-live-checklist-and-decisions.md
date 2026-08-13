# 5 — Go-Live Checklist & Decisions

## The decision that blocks everything

> **Migrate the existing "Voice Debrief" number to the Cloud API, or get a
> second number for the API tool and keep Voice Debrief on the app?**

| | Migrate Voice Debrief | Second number for the tool |
|---|---|---|
| App experience on that number | **Gone** (the SIM becomes a code-receiver) | Kept |
| Existing chats | Stay on the phone only (export first) | Untouched |
| Contact continuity | Same number people already message ✅ | A new number to introduce |
| Extra cost | None | A new SIM / number |
| Best when | The tool becomes the primary way this number is used | The team actively lives in the app on this number |

There's a related, independent choice for the **companion/Bridge** lane: whether
to run it at all, and if so, on which expendable number (never the two above).
Bridge mode is optional and additive — it can be added any time.

## Go-live checklist (in order)

Legend: **[you]** = a console/admin step only the account owner can do;
**[us]** = engineering, ready to run.

| # | Step | Who | Notes |
|---|---|---|---|
| A | **Start Meta business verification** (Meta Business settings → Security Centre) | [you] | The long pole — days to weeks. Start this first; nothing else waits on it. |
| B | Deploy the tool so demo mode is usable and reviewable | [us] | No credentials needed to explore it |
| C | Make the number decision above; if migrating, **export the app chats you care about first** (WhatsApp "Export Chat" per conversation, from the phone) | [you] | Export before step E — history does not migrate |
| D | Create a Meta app, add the WhatsApp product → this creates the Business Account (WABA) | [you] | Standard Meta developer setup |
| E | **Register the number on the Cloud API** (a verification code arrives on the SIM) | [you] | ⚠️ This is the moment the phone app disconnects for that number |
| F | Create a system-user access token (minimal scopes); note the phone-number ID, business-account ID, and app secret | [you] | Token + IDs → the tool; app secret → the relay only |
| G | Deploy the relay (~5 min, free tier) and point Meta's webhook at it | [you] + [us] | We provide the template and steps |
| H | Paste credentials into the tool's Accounts panel → Connect | [you] | ~2 minutes |
| I | **Live verification probes** — first real send, first real inbound, media fetch, multi-device token check | [us] | Confirms the code paths against the live API; minutes once F–H are done |
| J | Acceptance walkthrough: message the number from a personal phone → it appears in the tool → reply → voice note → transcript → AI draft → send | [you] + [us] | The point at which it replaces the phone for that number |

**Optional Bridge lane (any time, independent):** obtain an expendable SIM →
run the local bridge → scan the QR with that number → point the tool's Bridge
mode at it. No Meta verification required for this lane.

## Timeline

- **Today:** demo mode reviewable; the number decision can be made; Meta
  verification can be started.
- **Verification:** days to weeks (Meta-controlled) — the only long wait.
- **Once verified:** steps D–J are a single focused sitting.
- **Bridge lane:** possible this week on a spare SIM, entirely in parallel, since
  it needs no Meta process.

## Costs to expect

- Meta business verification: free (time, not money).
- Relay hosting: free tier is sufficient at our scale.
- Cloud API messaging: free "service" conversations; **paid** template
  conversations (small per-conversation fee) — monitor at volume.
- AI (transcription + drafting): our existing pay-as-you-go provider; a few cents
  per voice note / draft.
- Bridge lane: the cost of one expendable SIM.

## What is explicitly NOT in the current build

Template *creation/approval* UI (done in Meta's console for now), catalogs /
payments / interactive flows, group-chat management, bulk/broadcast sending,
unattended auto-reply agents, and a durable encrypted conversation archive.
These are known future items, not gaps in the core flow.
