# 6 — Product Directions & Monetization

The MVP is a supervised "desk." The interesting commercial upside is in what it
composes into next.

## Three kinds of interaction (they are different products)

| | **Programmatic** | **Dynamic** | **Automatic** |
|---|---|---|---|
| Shape | A command in → a deterministic result out | A conversation with a human/AI in the loop | Reactive rules, no intelligence |
| Examples | "transcribe" + voice note → transcript back; a document → a summary or an infographic | support desk with AI-drafted replies; "discuss this document with me" | greeting / out-of-office; routing; a daily digest |
| Consent model | A pre-declared per-command allow-list — safe to run unattended | A human approves each send | A pre-declared rule set + kill switch |
| Monetizes cleanly? | **Yes** — deterministic, meterable per command | Indirect (a productivity tool) | Indirect |

The MVP is the **dynamic-supervised** desk. The **programmatic** lane is the most
commercially attractive next step, because each command has a known cost and a
simple consent model.

## How much server, by ambition ("the tiers")

| Tier | What it does | Infra |
|---|---|---|
| 0 | Send-only, pure browser | None |
| 1 | The desk: see + reply while a tab is open (**the MVP**) | The tiny relay (or the local bridge) |
| 2 | An always-on "**responder**": runs programmatic + automatic commands 24/7 | One small always-on service beside the relay |
| 3 | A fully autonomous conversational agent | More, and only after Tier-2 guardrails prove out |

The MVP (Tier 1) was deliberately built with the **seams for Tier 2 already in
place**, so the responder is an addition, not a rebuild.

## Candidate workflows (★ = strong early bets)

- ★ **Voice memo → transcript reply.** Message the number a voice note, get the
  text back. The transcription engine already exists in our platform; this is
  the flagship "Voice Debrief" product.
- ★ **Document / article → summary or infographic reply.** We already have an
  AI infographic generator; wiring it to WhatsApp is a natural extension.
- ★ **Support desk with AI-drafted replies.** The MVP itself, sold as a seat.
- **Send a video → get a published link back.** We built a one-flow
  record-to-YouTube publisher; the same pipeline could run over WhatsApp.
- **Chat → encrypted archive link; scheduled digests; "summarise this thread."**

## Monetization shapes

- **Metered command credits.** Each programmatic command has a real cost (AI +
  small margin). Our platform already has the spend-cap / usage-metering
  machinery to support pay-per-use or credit packs.
- **The responder as a hosted per-seat product** — "your WhatsApp number, with
  skills," where each customer's number gains the command menu.
- **Vertical template packs** — pre-approved message templates + workflows for a
  specific industry.

The recurring theme: the **programmatic command lane is the monetizable one**,
because it's deterministic, meterable, and its consent model is simple. The
supervised desk (the MVP) is the credibility-builder and the human-in-the-loop
surface that de-risks everything above it.

## What to weigh as a partner

- The **official Cloud API** underpins any *product* offering (bulk, reliability,
  templates, no ban risk). Bridge mode is for internal visibility/experiments,
  not a customer-facing dependency.
- The near-term cost of going live is an administrative Meta process, not
  engineering.
- The reuse story is strong: transcription, AI drafting, infographic generation,
  video publishing, spend-metering — all already exist in our platform and
  compose into WhatsApp workflows rather than needing to be built from scratch.
