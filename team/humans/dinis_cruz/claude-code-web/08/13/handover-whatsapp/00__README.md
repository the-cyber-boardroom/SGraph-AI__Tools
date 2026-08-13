# WhatsApp Business Tooling — Partner Handover Pack

**Prepared:** August 2026 · **Status:** MVP built, mock/demo-verified; not yet live against a real WhatsApp account
**Audience:** business + technical partner — assumes no prior context on this project

This pack documents everything designed, decided, and built for connecting our
Business WhatsApp number to our tooling. It is self-contained: you do not need
access to our codebase to understand it.

## The one-paragraph version

We want to read, reply to, transcribe, and (with a human in the loop) auto-draft
messages for a Business WhatsApp number — inside a browser tool that fits our
existing platform. We researched exactly what WhatsApp permits, chose the
official Meta Cloud API as the primary route, and built a working MVP (a browser
"desk" tool + two small connector services). One hard constraint shapes
everything: **a WhatsApp number lives in exactly one place — the phone app *or*
the Cloud API, never both, with no history sync between them.** That forces a
two-number strategy, described inside. The MVP runs today in a credential-free
demo mode; going live needs a Meta business-verification step (the long pole)
and one product decision from us.

## How to read this pack

| Doc | Read if you want… |
|---|---|
| `01__executive-summary.md` | the decisions, current state, and what we need to decide — start here |
| `02__what-can-and-cannot-be-done.md` | the honest capability map: the four technical routes and their trade-offs |
| `03__architecture-and-what-was-built.md` | the technical inventory: what exists, how it fits, what's tested |
| `04__security-privacy-and-risk.md` | encryption reality, ban risk, where secrets live, data handling |
| `05__go-live-checklist-and-decisions.md` | the ordered path to production + the decisions that block it |
| `06__product-directions-and-monetization.md` | where this goes commercially |

Everything here is deliberately honest about status: "built and tested" means
against mocks and demo data; **no live WhatsApp message has been sent or
received yet** — that waits on the Meta setup in doc 05.
