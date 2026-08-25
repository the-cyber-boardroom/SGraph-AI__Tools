# YouTube Probe — Human Guide

A test harness, not a product. It answers the open questions in the
`v0.2.92 talk-miner` pack **with evidence instead of reasoning**, so you can
decide what to build — or decide not to.

## Why it exists

The pack rests on two guesses:

1. **That auto-generated captions can be downloaded** through the API. If they
   can, the words for your own talks are free and already timestamped. If they
   cannot, that whole route collapses to "only manually-uploaded tracks".
2. **That talk footage defeats the frame metrics we already ship.** They were
   built for screencasts, where the frame *is* the content. A conference
   recording is a moving human with slides as a region.

This project has twice shipped a confident number that a real recording
immediately falsified. Half a day of measuring beats a fortnight of building the
wrong thing.

## Start here — the offline tests

Press **Run the offline tests (A1–A7)**. No token, no network, no clicks. It
records a synthetic talk in the page and takes about a minute.

| | What it asks |
|---|---|
| **A1, A2** | Do the caption parsers work, and do cues group into slide-sized spans? |
| **A3** | *The control.* Does whole-frame detection — what we ship today — find the slide changes on talk footage? |
| **A4** | *The treatment.* Does cropping to the slide region fix it? **Compare the numbers with A3.** |
| **A5** | Can the slide region be found automatically? |
| **A6** | On intercut footage, does the tool detect that no fixed rectangle can work? |
| **A7** | What would a corpus of your talks cost? |

**A3 and A4 are the pair that matters.** If A3 passes, the mask is unnecessary and
that part of the plan can be deleted — a good outcome, cheaply learned.

## The manual tests

### 1 · Get a token

**Fastest (two minutes):** [OAuth Playground](https://developers.google.com/oauthplayground/)
→ tick `youtube.force-ssl` → authorise → exchange for an access token → paste it
into Setup. Valid about an hour.

**Or your own OAuth client (twenty minutes):** a Google Cloud project with the
YouTube Data API enabled, an OAuth *Web application* client, and this page's
origin listed under **Authorised JavaScript origins**. Paste the client id and
press Sign in.

The playground path is there because the question is worth answering *today*.

### 2 · Set two videos

- **One of yours** — used by M3 and M4.
- **One you don't own** — used by M5–M7, to establish what the third-party path
  can and cannot do.

### 3 · Run them

| | What it asks |
|---|---|
| **M1** | Does the token actually carry `force-ssl`? *Run this first — otherwise a 403 in M4 is ambiguous.* |
| **M2** | Can we list your uploads? |
| **M3** | Does your talk have an auto-generated track at all? |
| **M4 ⭐** | **Will the API hand back that track's body?** The question the pack hinges on. |
| **M5** | How does the captions API refuse a video you don't own? |
| **M6** | Can we still get public metadata (title, channel, duration) for it? |
| **M7** | Is the unofficial `timedtext` endpoint really blocked from a browser? |
| **M8 ⭐** | **Can a playing YouTube tab be captured with its audio?** |

### Before M8

Open a YouTube video **in another tab** and press play. Then run M8 and pick
**that tab** — not a window, not a whole screen — and tick **"share tab audio"**.
Only a tab can carry audio, and a missing tick is the usual reason route C looks
broken.

## Reading the results

Four outcomes, and **`info` is a real one**: many of these tests are questions, not
assertions.

| | Meaning |
|---|---|
| ✅ pass | The hypothesis held, with numbers |
| ❌ fail | It did not — often the more useful result |
| ℹ️ info | A fact was recorded; there was no right answer to have |
| ⏸️ blocked | Could not run — no token, no gesture, no support |

Every row shows its **hypothesis** before the verdict, and expanding one shows
what a pass and a fail each *mean for the plan*. A result should change what you
build, not just colour a row.

## The findings report

The **Findings** tab writes it up in prose, leading with the M4 verdict and ending
with **what did not run**. A suite where half the tests were blocked on a missing
token, reported as "3 passed", would be a lie of omission — so blocked tests are
named. Copy it, or download it as markdown or JSON, and attach it to the pack.

## Honest limits

- The synthetic talk carries the traps this project has been caught by — a
  room-tone floor above the old 0.01 threshold, colours that differ in hue rather
  than brightness, and a speaker who moves every frame. It is still not a real
  conference recording, and **A3–A6 cannot stand in for running one**.
- Tab-audio capture is a Chromium strength and weaker elsewhere.
- Use a short-lived playground token, not anything long-lived.
