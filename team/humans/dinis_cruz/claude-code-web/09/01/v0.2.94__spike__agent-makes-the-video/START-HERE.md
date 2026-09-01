# START HERE — make the video with what already exists

**You are a fresh Claude Code session. This folder is your whole brief. You need
no other context.**

## The mission

**Produce one real, watchable demo video — landscape and vertical — using only
tools that already exist in this repository, driven by browser automation.**

Then write down what was missing.

You are **not** building a tool. There is a separate pack proposing one
(`../v0.2.93__brief__tools-team__demo-reel__*`). **Do not implement it.** Its whole
design rests on guesses about what this is like to actually do, and you are here
to replace those guesses with evidence. If you finish and the conclusion is "the
proposed tool is wrong in these three ways", that is a *better* outcome than a
video.

## Why you, and why this way

Every capability in the pipeline is already built and every one of them exposes a
JavaScript API on `window.__tool`. Nothing here needs a human at a screen:

- text → speech (Kokoro, local, in-browser)
- images + narration → a recorded WebM (canvas + MediaRecorder)
- screenshots and **video clips** via Playwright, headless, no user gesture
- a whole tool platform to point the camera at

So the question this spike answers is not "can it be done" but **"what does it
cost, and where does it break?"**

## Timebox

**One working day.** If you are at the end of it with a rough video and an honest
findings document, that is success. If you are at the end of it with a beautiful
video and no findings, that is a failure — the findings are the deliverable that
changes what gets built next.

## The subject

**"SGit vaults in 90 seconds."** An encrypted, versioned folder that the server
can never read. It is the memo's own example, the material is live and local, and
you can create a real vault yourself as part of the demo.

If that path is blocked (no network, no token), fall back to
**"narrated-review: narrate a screen, get a document"** — which runs entirely on
`localhost` with no credentials at all. Say in your findings which you used.

## Read next, in order

1. **`1__what-exists.md`** — the verified inventory. Exact paths, exact API calls,
   exact versions. Everything in it was checked against the source on 1 Sep 2026.
   Where a manifest and the code disagree, it says so.
2. **`2__the-run.md`** — the recipe, step by step, with the gotchas that will
   otherwise cost you an hour each.
3. **`3__what-to-report.md`** — the findings template. Read it *first*, not last,
   so you are collecting the numbers as you go rather than reconstructing them.

## Deliverables

Into `team/humans/dinis_cruz/claude-code-web/<MM>/<DD>/v0.2.94__spike-result__agent-makes-the-video/`:

| File | What |
|---|---|
| `landscape.webm` | The video. 60–120 seconds. |
| `shorts.webm` | The vertical cut. 30–60 seconds. |
| `reel.json` | Whatever document shape you ended up with — **the most valuable artefact here**, because it is a real one rather than a designed one |
| `FINDINGS.md` | From the template in `3__what-to-report.md` |
| `frames/` | A few stills, so the result can be judged without watching |
| `scripts/` | Whatever you wrote to do it |

Commit to the branch you were given. Do not push to `dev` or `main`.

## The rules that matter

1. **Do not build the proposed tool.** Scripts in `scripts/` are fine — a new
   tool under `tools/` is not. If you find yourself designing a module hierarchy,
   stop and write it in FINDINGS instead.
2. **Measure, do not assume.** This project has twice shipped a constant nobody
   had plotted. If you report "the render drifts", report *how many milliseconds
   over how long*.
3. **Report what you could not do**, with the reason. An honest "the TTS worker
   would not load, here is the error" is worth more than a workaround that hides
   it.
4. **Nothing goes in `team/humans/dinis_cruz/briefs/`** — that folder is
   human-only.
5. **Never commit a vault key, a token, or an API key.**

## The one question to answer above all others

> If I had to make ten of these videos, what would I actually need — and is the
> `demo-reel` design in the neighbouring pack right, or is something simpler or
> different obviously better once you have done it once?

Answer that with evidence, and the day was worth it whatever else happened.
