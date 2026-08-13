# 4 — Security, Privacy & Risk

The honest version, because a partner should be able to make an informed call.

## 1. Encryption — where messages are readable, by mode

| | Cloud API mode | Bridge mode |
|---|---|---|
| Who can read message content | You, the sender, **and Meta's cloud** (encryption terminates there) — plus our relay holds the payload transiently in transit | You and the sender only — end-to-end encryption is preserved and terminates inside *your own* local bridge |
| Verdict | Standard for business messaging; be aware "only you and me" is no longer literally true | More private than the app-to-app default is not — it's *equal* to it, kept on your machine |

The tool says this to users plainly rather than hiding behind WhatsApp's default
"end-to-end encrypted" banner. If a customer asks "who sees this?", the honest
answer differs by mode, and we surface it.

## 2. Account-ban risk — scoped precisely

**Your personal iPhone/iPad WhatsApp apps are never at risk.** They are Meta's
own official clients; normal use cannot get them banned. Nothing we built
touches them.

The ban risk applies to **one thing only**: a number linked to the *unofficial*
companion library (Bridge mode).

- It's the **number** at risk, not our devices or the tool.
- It's **behaviour-driven** — bulk or bot-like *sending* is the trigger.
  Read-heavy, light-reply use is lower risk; it is never zero.
- It is **not** "banned overnight for connecting." Connecting a companion is
  normal; abusive sending patterns are what Meta's heuristics flag.
- **Mitigation is structural:** only ever link an *expendable* number. If it's
  banned you lose that SIM — never the business/API number, never a personal one.
  Nothing business-critical may depend on the bridge number. This is a rule, and
  the tool/UI is labelled to enforce it in practice.

The **Cloud API route has no ban risk** — it is the sanctioned path. Bridge mode
is the accepted-risk complement, deliberately walled off to a throwaway number.

## 3. Where secrets live

Design principle: credentials stay in the browser (or on your own machine); our
platform never holds them.

| Secret | Where it lives | Notes |
|---|---|---|
| Meta Cloud API access token | The user's browser (local storage) | A bearer credential; not device-locked, so the desk works from multiple machines. Recommend a dedicated, minimal-scope "system user" token. |
| Meta app secret | **Only** in the relay's config | Used solely to verify webhook signatures; never reaches the browser |
| Relay access token | Browser + relay | Gates the browser's pull of stored messages |
| AI provider (OpenRouter) key | The user's browser | For transcription + drafting; the same key our other tools use |
| Companion session keys (Bridge) | **Only** on your local machine, in the bridge | Never leaves your device; this is what makes Bridge mode's E2E claim true |

No WhatsApp token, AI key, or session key is ever stored on our servers or sent
to us.

## 4. Data handling

- **In the browser:** conversation state is in-memory for the session. (A durable,
  encrypted archive is a planned future addition, not in the MVP — so today,
  closing the tool loses in-session history beyond what the relay still holds.)
- **The relay:** stores raw inbound payloads with a 72-hour auto-expiry, purely
  so the browser can catch up on what arrived while it was closed. Nothing
  permanent. A future hardening encrypts even these at rest so the relay only
  ever sees ciphertext.
- **The bridge:** holds the companion session and recent messages in the local
  process/disk you run it on — your infrastructure, your control.
- **AI provider:** voice-note audio is sent to the AI provider only when a user
  clicks Transcribe; conversation text is sent only when a user clicks Draft.
  Nothing is sent proactively.

## 5. Consent & safety posture

- **AI never sends.** It only ever *drafts* into the composer; a human (or an
  explicitly-authorised automation step) performs the send. There is no
  fire-and-forget auto-reply in the MVP.
- **The 24-hour rule is enforced client-side** in Cloud API mode: the tool blocks
  an out-of-window free-text send *before* it reaches Meta, and switches to
  approved templates — avoiding both errors and accidental policy breaches.
- **Unattended/automatic replies** (e.g. "message the number, get your voice memo
  transcribed back") are a deliberately *separate*, future component — off by
  default, with an allow-list and a kill switch — not something the desk does
  silently.

## 6. Compliance notes for a partner to weigh

- Cloud API template messages outside the 24-hour window can open **billed
  conversations** — a real, if small, cost line to monitor at scale.
- Business messaging may bring **data-protection obligations** (what you store,
  for how long, lawful basis) depending on jurisdiction and use — worth a proper
  review before customer-facing volume.
- Bridge mode's Terms-of-Service position is unambiguous: it *is* against
  WhatsApp's terms. We use it knowingly, contained to an expendable number, for
  visibility/experimentation — never as a customer-facing production dependency.
