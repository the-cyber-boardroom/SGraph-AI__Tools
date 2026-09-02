# Build plan: from the spike to a demo-reel tool

*2 Sep 2026. One page that gathers what the spike proved, what exists, and what to build, in order. The reasoning behind each line is in `FINDINGS.md` (four rounds of numbers), `TWO-MODES.md` (session skill versus browser page) and the original proposal in the demo-reel pack (`v0.2.93__brief__tools-team__demo-reel__1..5`, on the `claude/narrated-review-tool-arch-nuaib9` branch). This page is the plan; those are the evidence.*

## What exists today (code-verified, this branch)

| Piece | Where | State |
|---|---|---|
| Slides + narration → WebM, with `paintEveryFrame` and `captionBar` flags | `video-creator` v0.1.72 (IFD delta on v0.1.47) | shipped in this branch |
| Kokoro TTS in the browser | `core/sg-tts` v0.1.0 | shipped |
| OpenRouter TTS (`openai/gpt-audio`) | `core/sg-tts-openrouter` v0.1.0 | shipped |
| A provider shim with `sg-tts`'s interface over the OpenRouter module | `scripts/sg-tts-shim-openrouter.js` | spike script |
| Reel script, capture with element-targeted annotations, per-format viewports, clips | `reel.json`, `scripts/01-capture.mjs`, `scripts/annotate.mjs` | spike scripts |
| Slide compositor: header, picture crop, caption band, title and closing slides | `scripts/slides.mjs` | spike script |
| Render driver: TTS timing, closing-slide swap, download, remux, cost lookup | `scripts/02-render.mjs` | spike script |
| Storyboard page and PDF | `scripts/04-doc.mjs` | spike script |
| Egress bridge and large-file cache for the Claude Code container | `scripts/browser.mjs`, `scripts/cache-server.mjs` | spike scripts, container-specific |
| Screenshot from a page: `getDisplayMedia` tab capture works, iframe DOM does not | `poc/` | proof of concept |
| A skill that runs all of the above | `library/skills/make-a-demo-reel/SKILL.md` | shipped in this branch |
| Remote Playwright over HTTP | SG/Playwright service (`use-sg-playwright` skill) | shipped, not used in the spike |
| Publish | `youtube-upload`, `video-publisher` | shipped, not used in the spike |

Everything below is **PROPOSED — does not exist yet.**

## Phase 1 — move the spike's compositor into `video-creator` (about 2 days)

1. `setConfig({ header: {title, date, author}, captionBand: true })` and a `caption` + `narration` per slide in `setNarration`, drawn by `_drawSlide` the way `slides.mjs` draws them now. Retire the filename bar.
2. `setSlideImage({ slideIndex, file })` without resetting audio, so a closing slide can be replaced after TTS. Replaces the event-reference trick.
3. `setConfig({ tts: 'kokoro' | 'openrouter', voice, apiKey })` choosing the provider at the `sg-tts` seam; the shim becomes `core/sg-tts-provider` with one `generateAudio` contract.
4. Cache generated audio by hash of (text, voice, provider) in memory and `sg-vfs`. Second render of a reel costs the record time only.
5. Reality document, SKILL files and the manifest's `actions` list updated (the manifest has said `actions: []` since v0.1.47).

Done test: the spike's `02-render.mjs` shrinks to loading images and calling the API; `slides.mjs` is deleted.

## Phase 2 — the reel page, in the browser (about 3 days)

6. `tools/…/demo-reel/`: open a reel folder (zip or SG/Send vault: `reel.json` + `images/` + `clips/`), show it as the storyboard already does (`reel.html` is the layout), edit narration and captions, reorder, mark scenes for re-shoot.
7. A capture panel with the three routes from the POC: `getDisplayMedia` tab capture (one click per scene), the sg-page-recorder extension, and the SG/Playwright service for unattended runs; the same-origin annotation injector for our own pages and vault apps; a drag-a-rect spotlight for cross-origin captures.
8. Narrate only changed scenes (Phase 1's cache), render both formats, publish through `youtube-upload`.
9. Everything as `SgToolApi` actions so the page is drivable headless: `openReel`, `setScene`, `capture`, `narrate`, `render`, `publish`.

Done test: a person opens a reel produced by the session skill, changes one narration line, re-renders in under the record time plus a few seconds, and uploads.

## Phase 3 — the session skill as a first-class skill (about 1 day)

10. Move `scripts/` under `library/skills/make-a-demo-reel/scripts/` with relative paths; keep the container-specific bridge behind a probe so the skill runs unchanged on a machine where Chromium can reach the internet.
11. A `reel.json` validator (`validate()` from the pack's API surface): wrong word budget, a caption equal to its narration, an intro that repeats scene one, an annotation that did not resolve.
12. Hand-off format: the skill writes the folder Phase 2's page opens; a `sgit push` at the end when a vault key is provided.

Done test: a fresh session given a URL and a sentence of intent produces both cuts, the storyboard and the findings numbers without a human at a screen.

## Decisions carried from the pack, with the spike's verdict

- Annotations as data: yes, as element targets first and rects second.
- Two aspect ratios: shoot at two viewports; do not crop.
- Caption track: yes, the single most valuable primitive.
- Multi-shot scenes: not needed; drop until a script asks.
- Reel document as the API: yes; add `scrollTo`, element targets, per-format annotations, a pronunciation map.
- Import from narrated-review: keep the mapping written down; build last.
- Measure pacing first: yes, and measure frames per second, which found the real bug.
- Clips: cheap to shoot; playback inside the render is Phase 2 or later.

## What is deliberately not in the plan

- A new annotation renderer. The browser is the renderer.
- A YouTube upload from the Claude Code session. The session has no credentials; the browser mode has the user's.
- Hiding the agent's own token cost. The closing slide says it is not metered; Phase 2 can show it when the page pays for the LLM itself.
