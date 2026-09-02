# Two modes for making a demo reel: a session skill, and a page in the browser

*Written 2 Sep 2026 after three rounds of the agent-makes-the-video spike, in answer to the voice memo asking for both modes and for a proof of concept on screenshots from the browser. Everything marked **exists** was run in this spike; everything marked **PROPOSED** does not exist yet.*

## The two modes, side by side

| | Mode A: session skill (this spike) | Mode B: a page in the browser |
|---|---|---|
| Where the agent runs | A Claude Code session with a container, Playwright and the repo | Inside a page on tools.sgraph.ai or a vault app, with an LLM through OpenRouter |
| Who writes `reel.json` | The agent, from the pages it has read | An LLM call from the page, or a human editing a form, or a `reel.json` dropped in from Mode A |
| Screenshots | Playwright, headless, with DOM-injected annotations. **exists** | Three options, measured below: tab capture with one click per scene; the sg-page-recorder extension; the SG/Playwright service. Or the user supplies them |
| Narration | Kokoro in the browser at $0, or OpenRouter `gpt-audio` at about $0.08 per minute of speech. **exists**, both | The same two, from the same `sg-tts` seam; OpenRouter is the sensible default because the page already pays for the LLM |
| Render | `video-creator` v0.1.72 through its JS API, real time. **exists** | The same tool, in the same page. **exists** |
| Publish | Not from here: this session has no YouTube credentials. The file is handed to the requester | `youtube-upload` from the browser with the user's own OAuth. **exists** |
| Cost per 2-minute reel | API $0.00 (Kokoro) or about $0.16 (OpenRouter voice); container minutes; the session's own tokens, not metered | LLM for the script (a few cents on a cheap model), voice about $0.16, no compute to speak of |
| What it is good at | Unattended, repeatable, tens of reels, evidence collected as it goes | A person who wants to edit the slides, re-record one line, and press publish |

They are not rivals. The natural pipeline is **A writes, B mints**: the session drafts `reel.json`, shoots the stills and annotates them, and hands over a folder (zip, or an SG/Send vault); the browser page opens the folder, lets the person edit narration and captions, re-narrates only what changed, records, and uploads. Mode A already produces exactly that folder: `reel.json` + `images/` + `images-shorts/` + `clips/`.

## The screenshot question, answered with a proof of concept

`poc/capture-poc.html` loads a URL in an iframe and tries the three things a page can do to capture it. Run headless by `poc/poc-test.mjs` against a cross-origin page (sgit.ai/vault) and a same-origin one (a tools.sgraph.ai page):

| Route | Cross-origin (any website) | Same-origin (our own tools and vault apps) |
|---|---|---|
| 1. Read the iframe's DOM and draw it | **No.** `contentDocument` is `null` | Readable, but drawing it through an SVG `foreignObject` tainted the canvas and `toDataURL()` refused. A library such as html2canvas does better, still without web fonts and cross-origin images |
| 2. Ask the browser for the tab's pixels (`getDisplayMedia`, `preferCurrentTab`) | **Yes.** 1280×720 of exactly what was on screen, iframe content included (`poc/getDisplayMedia-captured-cross-origin-iframe.png`) | Yes, the same |
| 3. Screenshot from outside the page | The sg-page-recorder extension (`chrome.tabs.captureVisibleTab`, one click on the icon per shot) **exists**. The SG/Playwright service (`POST /sequence/execute` with `navigate`, `evaluate`, `screenshot` steps) **exists** and is a remote copy of what this spike's scripts do | Same |

So the honest answer to "do I need to give you the screenshots?" is: **no, if one click per scene is acceptable**. Route 2 needs a user gesture and a permission prompt every capture, which is a tolerable rhythm for ten scenes and a bad one for a hundred. The annotation trick still works in the browser for same-origin targets (inject the spotlight into our own page or vault app, then capture), and for cross-origin ones the spotlight can be drawn on the capture afterwards from a rect the user drags, because the page cannot see inside the iframe to resolve an element.

For unattended runs from the browser the only route with no clicks is 3, the SG/Playwright service, and it takes the same `reel.json` shot spec this spike uses (`url`, `scrollTo`, element targets), because its step verbs are the Playwright ones.

## What Mode B needs that does not exist yet

All **PROPOSED**, in the order they would be built:

1. **A reel page** (`tools/…/demo-reel/`, or a vault app): open a folder, show the scene list as the side-by-side document already does (`storyboard.html` is most of this UI), edit narration and captions, mark a scene for re-shoot.
2. **A capture panel** with the three routes above as buttons, the same-origin annotation injector, and a drag-a-rect fallback for cross-origin captures.
3. **A narrate step** that only re-generates changed scenes, keyed by a hash of (text, voice, provider). Neither `sg-tts` nor the OpenRouter module caches; this is the second-biggest cost after the render.
4. **The compositor and the closing slide moved into `video-creator`** (`setConfig({ header, captionBand })` and `setSlideImage({slideIndex, file})`), so the page does not carry the spike's pre-compositor.
5. **Publish** through `youtube-upload`, which is already there.

Items 1 and 2 are the narrated-review architecture the original plan pointed at: a capture is a screenshot plus the words about it, and this page is the same shape with an aspect ratio and a render at the end. `narrated-review`'s `insertPair()` is the API a capture panel would call.

## What the session skill needs to be a skill

**PROPOSED**: a `SKILL.md` with the run order that is already at the bottom of `FINDINGS.md`, the two environment findings that cost the most time (Chromium cannot do TLS through the agent proxy, so bridge egress through Node; do not fulfil large bodies through the DevTools protocol), the `reel.json` shape with `scrollTo` and element targets, and the rule that the same agent writes and shoots. The scripts in `scripts/` are the skill's body as they stand; they would move under `.claude/skills/demo-reel/` with paths made relative.

## Cost, measured

- Kokoro: $0.00, at about two times the audio length in CPU time with two workers.
- OpenRouter `openai/gpt-audio`, voice `onyx`: $0.0096 for 7.25 s of speech, so about $0.08 per minute of narration; generation runs at about three times real time. The transcript came back verbatim for that sentence; the render log records every scene where it did not.
- The agent's own tokens for writing the script and driving the run are the cost neither mode shows on its closing slide, and Mode B is the one where they become a line item the user pays directly.
