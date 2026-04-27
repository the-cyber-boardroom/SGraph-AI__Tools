# 03 — Coding Guidelines and IFD Discipline

**Pack:** `v0.22.17__pack__sg-toolkit-extraction`
**Doc revision:** rev 2 (Pass 1 update — adds Section M op-driven architecture, Section N documenting undo support, renames previous Section M to Section O)
**Doc role:** the rule-book. Every implementer of every brief in this pack follows these rules.
**Audience:** all implementers (build, refactor, QA). Required reading.
**Lifetime:** durable. This doc outlives the pack and should be promoted to a repo-wide guideline after the pack lands.

> Read first: **`README.md`** (especially the vocabulary appendix V.1–V.11 and the Pass 1 revision history) and **`01__architecture__sg-toolkit.md`** (especially §3.7 sg-history and §5.7 op-based use cases). This doc references both.

---

## How to read this doc

Every rule has the same shape:

```
§ — One-line statement of the rule (MUST / SHOULD / MAY / MUST NOT)
Why — the reason the rule exists, in one paragraph
Example — what compliance looks like
Anti-pattern — what NON-compliance looks like, ideally with a real codebase example
```

`MUST` / `MUST NOT` are non-negotiable. `SHOULD` / `SHOULD NOT` are strong defaults; deviating requires a code-review note explaining why. `MAY` is a permission, not a recommendation.

Format adapted from RFC-2119 because this codebase has a tradition of treating `SKILL_*.md` files and IFD guides like spec docs, and the implementers benefit from a familiar shape.

---

## Section A — Anti-patterns (lead with what NOT to do)

This section comes first because Sonnet implementers in this codebase have historically failed in specific, recurring ways. Each anti-pattern below has a real-world reference. Reading them first calibrates expectations for the rest of the doc.

### A.1 — Don't run `git add -A` when another agent might be working in parallel

**The bug.** During Round-9-I and Round-9-J, two parallel agents committed in interleaved order. The 9-J agent ran `git add -A` while the 9-I agent's CSS changes were unstaged. Result: the 9-I agent's CSS shipped under the 9-J agent's commit `f4b4827`. The reality document still notes the side-effect: *"the parallel Round-9-J agent accidentally swept my Task 4 CSS additions into their f4b4827 commit (they ran git add -A while my work was unstaged) — the visual styling shipped under Round-9-J's name but the matching JS landed in this batch's Round-9-I Task 4 commit."*

**The rule.** When two or more agents are working in the same repo at the same time, every commit MUST be:
1. On a separate branch (`claude/{description}-{session-id}`, per `.claude/CLAUDE.md`)
2. Staged with explicit file paths: `git add path/to/file1 path/to/file2`, NEVER `git add -A` or `git add .`
3. Committed with a message that lists the exact files in the commit body

If the implementer is the only agent active and is certain of it, `git add -A` is permitted. If unsure, default to explicit paths.

### A.2 — Don't preserve old field names when the rename is intentional

**The pattern.** A spec says "rename `clipId` to `itemId` in the new event detail." A Sonnet implementer copies the existing handler and changes only what the spec mentions explicitly:

```js
// WRONG — Sonnet preserved 'selectedClipId' from the old code
this.dispatchEvent(new CustomEvent(SGTS_EVENTS.ITEM_SELECTED, {
    detail: { selectedClipId: this.#selectedItemId },
    //         ^^^^^^^^^^^^^^^ should be 'itemId' per V.2.1
    bubbles: true, composed: true,
}));
```

**The rule.** When this pack specifies a rename, the rename is **complete**. Every reference — variable names, event detail keys, CSS class names, comments, JSDoc, file names if applicable — gets renamed. The point of the rename is to force the reader (and the type-checker, when applicable) to confirm every reference is correct. Half-renames defeat the purpose.

### A.3 — Don't import from a sibling tool's internals

**The pattern.** During the build of brief 05 (toolkit), the implementer needs the snap-abut helper. The video editor already has it at `tools/v0/v0.1/v0.1.54/en-gb/sg-video-editor/ui/state-overlap.js`. Tempting to import.

**The rule.** Toolkit code MUST NOT import from any tool. Tool code MAY import from `core/`, `components/`, `core/sg-tool-api/`, `core/sg-layout/`, `core/sg-toolkit/...`. Tools MAY NOT import from each other.

**Reason.** Tools are downstream consumers. They're free to depend on shared infrastructure but never on each other. If two tools need the same helper, that helper is shared infrastructure and must move into `core/` or `components/`.

For brief 05: the snap-abut helper moves into the toolkit's own math module (`sg-track-strip-math.js` or whichever module the brief specifies). The video editor's `state-overlap.js` becomes a thin wrapper around the toolkit's helper, OR is deleted in favour of consuming the toolkit's helper directly during the v0.1.55 refactor.

### A.4 — Don't fix bugs you find in the code you're refactoring

**The pattern.** While refactoring, the implementer notices a bug. They fix it as part of the refactor. The refactor PR now contains both refactor changes and behaviour changes.

**The rule.** A refactor PR contains ONLY refactor changes. If you find a bug, file it (write a debrief or open an issue). The bug fix lands in a separate PR, ideally before the refactor starts.

**Reason.** This pack's brief 06 (video editor refactor) explicitly preserves behaviour. The QA regression suite (08) gates the refactor. If the refactor includes a bug fix, the regression suite will fail (correctly) because behaviour changed, and the implementer can't tell whether the failure is the intended fix or an unintended drift.

If the bug is severe enough to block the refactor, send it back to Explorer for a v0.1.54.X fix BEFORE the refactor starts.

### A.5 — Don't expand the spec when something looks ambiguous

**The pattern.** A spec says: *"emit `sg-track-strip:item-selected` with detail `{itemId}`."* The implementer thinks: *"surely we should also include `trackId` for convenience."* They add it.

**The rule.** When a spec is incomplete, **stop and ask**. Don't fill the gap with what seems plausible. Either:
1. The spec author intended the omission and you'll surface a real disagreement
2. The spec author overlooked it and you'll get an authoritative answer instead of guessing

The vocabulary appendix in the README is the disambiguation source. If a name or shape isn't there, that's a gap; treat it as a stop-and-ask.

### A.6 — Don't conflate "preserve behaviour" with "preserve code"

**The pattern.** Refactoring `<sg-timeline>` into `<sg-track-strip>`, the implementer copies the private field name `#selected` (which holds the selected clip ID). The new component's selection field becomes `#selected` too, even though the new component's spec says `#selectedItemId`.

**The rule.** Behaviour preservation is **observable behaviour preservation**. The user-visible outcome — selecting a clip, seeing the selection ring, getting an event — is the contract. The internal field names, function names, even the file structure can change. In fact, **they should change** when the spec mandates a rename, per A.2.

### A.7 — Don't assume a function in `composer-schema.js` is a "math helper"

**The pattern.** The toolkit needs `getProjectDuration`. The implementer imports it from `composer-schema.js`. Done?

**No.** `getProjectDuration(project)` calls `getVideoTracks(project)` which filters `project.tracks` by `kind === 'video'`. So the implementer has just imported a video-aware filter into the supposedly-generic toolkit.

**The rule.** Before importing from anywhere outside the toolkit, **read the function source** to confirm it has no domain coupling. Sonnet implementers historically trust function names more than function bodies. Don't.

For brief 05: the five "generic-looking" helpers (`snapToFps`, `clipDuration`, `clipTimelineEnd`, `getProjectDuration`, `getVideoTracks`) are inspected in doc 01 §2.2. Three are genuinely generic. One has a video-specific filter. One transitively depends on the filter. The toolkit reimplements all five with renames; it does NOT import any of them.

### A.8 — Don't ship without ticking the verification checklist

**The pattern.** Implementer finishes the brief, all tasks done, tests pass. They mark the work complete.

**The rule.** A task being "done" is not the bar. The bar is "every checklist item the task references is ticked in doc 04." If a checklist item is unticked, work is not complete, even if every task is.

**Reason.** Tasks and checklist items are different. Tasks describe work. Checklist items describe outcomes. Work can complete with the wrong outcome. The verification checklist is the project plan; ticking items is the only way to be done.

---

## Section B — Component construction rules

### B.1 — Web Components MUST extend `SgComponent`

**Why.** The repo has a base class. It handles shadow DOM, resource fetching, lifecycle, error display, tracked event listeners, `whenReady` Promise. Newer components (`<sg-locale-picker>`, `<sg-key-input>`, `<sg-upload-dropzone>`) all extend it. Older components (`<sg-timeline>`, `<sg-preview-canvas>`, `<sg-json-viewer>`) extend raw `HTMLElement` and reimplement the same lifecycle. The toolkit corrects this drift.

**Example.** From `components/locale-picker/v1/v1.0/v1.0.1/sg-locale-picker.js`:

```js
import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js'

class SgLocalePicker extends SgComponent {

    static jsUrl = import.meta.url

    get resourceName() { return 'sg-locale-picker' }

    get sharedCssPaths() {
        return ['/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css']
    }

    onReady() {
        // bind state, render initial UI
    }

    bindElements() {
        this.trigger = this.$('.locale-trigger')
        this.dropdown = this.$('.locale-dropdown')
    }

    setupEventListeners() {
        this.addTrackedListener(this.trigger, 'click', this.onTriggerClick)
    }
}

if (!customElements.get('sg-locale-picker')) {
    customElements.define('sg-locale-picker', SgLocalePicker)
}

export { SgLocalePicker }
```

The pattern: import `SgComponent`, declare `static jsUrl`, override `resourceName` and `sharedCssPaths`, override `onReady` / `bindElements` / `setupEventListeners`. Use `this.$()` / `this.$$()` for shadow-DOM queries. Use `this.addTrackedListener()` for events (auto-cleanup on disconnect).

**Anti-pattern.** From `components/sg-timeline/v0/v0.1/v0.1.0/sg-timeline.js`:

```js
export class SgTimeline extends HTMLElement {     // ← raw HTMLElement
    constructor() {
        super();
        const sr = this.attachShadow({ mode: 'open' });
        sr.innerHTML = `                          // ← inline template, not a sibling .html file
            <link rel="stylesheet" href="${CSS_HREF}">
            <div class="root">
                ...
            </div>
        `;
    }
    connectedCallback() { ... }                   // ← reimplements the lifecycle SgComponent provides
}
```

This works but it's drift. Toolkit components MUST NOT do this.

### B.2 — HTML, CSS, JS MUST be in separate sibling files

**Why.** `SgComponent` fetches `tag-name.html` and `tag-name.css` automatically (per `SgComponentPaths.resolve`). Inlining template HTML in JS string literals defeats syntax highlighting, bloats the JS file, and prevents CSS-only edits without touching JS. The codebase's working components (`<sg-locale-picker>`, `<sg-key-input>`, etc.) all follow the sibling-file pattern.

**Example.** A toolkit component's directory:

```
components/sg-track-strip/v0/v0.1/v0.1.0/
├── sg-track-strip.html      ← template — HTML only, no <style> or <script>
├── sg-track-strip.css       ← styles — :host scoped, custom properties at top
├── sg-track-strip.js        ← class definition, registers customElements, exports
├── sg-track-strip-math.js   ← pure helpers (or separate module path per V.5)
├── events.js                ← frozen event-name constants (SGTS_EVENTS)
├── manifest.json            ← optional component-level manifest (if the component declares its own API)
└── ... helper modules ...
```

**Anti-pattern.** From `<sg-timeline>`:

```js
sr.innerHTML = `
    <link rel="stylesheet" href="${CSS_HREF}">
    <div class="root">
        <div class="surface">
            <div class="ruler"></div>
            <div class="lanes"></div>
            <div class="playhead"></div>
        </div>
    </div>
`;
```

Template lives inside JS. CSS is referenced via `<link>` (better than embedded but still mid-attached). New toolkit components MUST NOT do this.

### B.3 — Helper modules SHOULD be ≤ 300 LOC; component class file SHOULD be ≤ 350 LOC

**Why.** The codebase, by inspection, holds this discipline. The largest file in `<sg-timeline>` is `timeline-track-headers.js` at 225 lines. The largest in sg-video-editor's `ui/` is `ui-shell-layout.js` at 337 lines. The Round-9-I commit notes explicitly: *"each file has a single responsibility, none crosses 200 LOC."* Files larger than 350 lines tend to mix concerns, and concerns hide bugs.

**Example.** When a file approaches 300 LOC, split by responsibility:

```
ui-export-controls.js          (orchestrator, 122 LOC)
ui-export-progress.js          (idle/exporting button, 94 LOC)
ui-export-actions.js           (post-export row, 175 LOC)
```

Three files, three responsibilities, total 391 LOC. If they were one file, it'd be one file with three responsibilities and bugs would hide between them.

**Anti-pattern.** A single `track-strip-everything.js` containing the class, the events, the math helpers, the lane rendering, and the keyboard handling. Don't.

**When to deviate.** A class file MAY exceed 350 LOC if every line is a public-API method declaration with JSDoc — that's surface area, not behaviour. Helper modules SHOULD NOT.

### B.4 — Every component MUST register customElements with a definition guard

**Example.**
```js
if (!customElements.get('sg-track-strip')) {
    customElements.define('sg-track-strip', SgTrackStrip);
}
```

**Why.** A page may load the same component module twice (different cache paths, different versioned imports). Without the guard, `customElements.define` throws `DOMException: 'sg-track-strip' has already been defined`. The codebase already follows this pattern; toolkit components MUST too.

### B.5 — Components MUST emit events using `composed: true, bubbles: true`

**Why.** Shadow DOM blocks event propagation by default. Tools mount components inside `<sg-layout>` which is inside the page. Without `composed: true`, events from a component inside a panel inside a layout don't reach the host's listeners. Without `bubbles: true`, events don't even leave the component's root.

**Example.**
```js
this.dispatchEvent(new CustomEvent(SGTS_EVENTS.ITEM_SELECTED, {
    detail: { itemId: this.#selectedItemId },
    bubbles: true,
    composed: true,
}));
```

`SgComponent.emit(name, detail)` does this for you:
```js
this.emit('item-selected', { itemId: this.#selectedItemId });
```

`emit` is preferred when the component extends `SgComponent`; raw `dispatchEvent` is used only when finer control is needed.

**Anti-pattern.**
```js
this.dispatchEvent(new CustomEvent(SGTS_EVENTS.ITEM_SELECTED, {
    detail: { itemId: this.#selectedItemId },
}));
// missing bubbles + composed — host won't see this
```

### B.6 — Public methods MUST validate inputs; private methods MAY assume valid inputs

**Why.** Public methods are called from arbitrary host code. Private methods are called only from inside the component. Validating in both is redundant and slows render-hot code paths.

**Example.**
```js
// Public — validates
setPlayheadPosition(position) {
    if (!Number.isFinite(position)) return;
    this.#playhead = position;
    this.#updatePlayhead();
}

// Private — assumes valid
#updatePlayhead() {
    this.#playheadEl.style.left = (96 + this.#playhead * this.#pps) + 'px';
}
```

**Anti-pattern.** Defensively re-validating inside a private method that's only called from public methods that already validated. Wastes cycles in render loops.

---

## Section C — Event-driven architecture

### C.1 — Components MUST NOT call host methods directly; they emit events

**Why.** This is the central rule of the codebase's UI architecture. Components are decoupled from hosts. A component knows nothing about what state container the host uses, what storage backend, what other components the host has mounted. The component's contract is: *"I will emit these events; do whatever you want with them."*

**Example.** `<sg-track-strip>` user drags a clip. Component emits `sg-track-strip:item-moved`. Host's adapter listens, calls `state.moveClipOp(...)`. State emits `change`. Host re-renders by calling `<sg-track-strip>.setProject(newProject)`.

```js
// Inside the component (correct)
this.emit('item-moved', { itemId, fromTrackId, toTrackId, start, snapped });

// Inside the host adapter (correct)
trackStripEl.addEventListener('sg-track-strip:item-moved', (e) => {
    api.moveClip({clipId: e.detail.itemId, timelineStart: e.detail.start, snap: e.detail.snapped});
});
```

**Anti-pattern.** Component reaches into the host:
```js
// WRONG — component imports something from the host
import { state } from '../../tools/sg-video-editor/ui/state.js';

class SgTrackStrip extends SgComponent {
    onItemMoved() {
        state.moveClipOp(...);  // hard coupling, breaks for any non-video host
    }
}
```

### C.2 — Event names MUST live in a frozen exported constant

**Why.** Magic-string event names break at refactor time. The codebase already has the pattern: `SGT_EVENTS = Object.freeze({ ... })` for `<sg-timeline>`, `SGL_EVENTS = Object.freeze({ ... })` for `<sg-layout>`. Toolkit components follow the same.

**Example.** From `events.js` for `<sg-track-strip>`:
```js
export const SGTS_EVENTS = Object.freeze({
    ITEM_ADDED: 'sg-track-strip:item-added',
    ITEM_MOVED: 'sg-track-strip:item-moved',
    ITEM_TRIMMED: 'sg-track-strip:item-trimmed',
    // ... full list per V.2.1 in README
});
```

Consumers import the constant:
```js
import { SGTS_EVENTS } from '/components/sg-track-strip/v0/v0.1/v0.1.0/events.js';

trackStripEl.addEventListener(SGTS_EVENTS.ITEM_MOVED, ...);
```

**Anti-pattern.** Inline strings:
```js
trackStripEl.addEventListener('sg-track-strip:item-moved', ...);  // typo-prone
```

When the event name changes (and they do; v0.1 → v0.2 may rename), the find-and-replace breaks. The constant doesn't.

### C.3 — Event detail shapes MUST match the vocabulary appendix exactly

**Why.** Cross-document consistency. Doc 02 will reference V.2.1 in spec text. Brief 06 will reference V.2.1 in adapter wiring. Both must use the same field names and types. The vocabulary is the source of truth.

**Example.** `sg-track-strip:item-moved` detail (from V.2.1):

```
{itemId: string, fromTrackId: string, toTrackId: string, start: number, snapped: boolean}
```

All five fields required. None nullable. `snapped` is `boolean`, not `boolean | undefined`. If the implementer can't provide a real value for `snapped`, return `false`, not omit.

**Anti-pattern.**
```js
this.emit('item-moved', {
    itemId,
    fromTrackId,
    toTrackId,
    start,
    // snapped omitted because "we don't know yet"
});
```

Causes downstream: `e.detail.snapped` is `undefined`, the adapter's `snap: e.detail.snapped` becomes `snap: undefined`, the state op's `params.snap` is `undefined`, the snap helper ignores it... bug eventually surfaces three layers down with no obvious origin.

### C.4 — Hosts MAY add their own listeners on top of toolkit events; toolkit MUST NOT add listeners on hosts

**Why.** Event flow is **components emit → hosts listen**. The reverse — components listening on hosts — is forbidden because the toolkit doesn't know what the host looks like.

**Anti-pattern.**
```js
// WRONG — inside a toolkit component
class SgTrackStrip extends SgComponent {
    onReady() {
        document.addEventListener('something-from-host', ...);  // toolkit doesn't know what 'document' looks like in the consumer
    }
}
```

Hosts CAN listen on `document` for global events, and CAN listen on the toolkit components for component events. But the toolkit listens only on its own shadow-DOM elements.

---

## Section D — JS API discipline (`SgToolApi`)

### D.1 — Every TOOL (not component) MUST register its API via `SgToolApi`

**Why.** The repo's tools expose a uniform API surface to `window.__tool`. Every tool's API methods are listed in its `manifest.json`. `SKILL__api.md` describes them for browser/agent consumers. This is how Playwright tests, the dev console, other components, and AI agents all interact with tools.

**Note:** This rule applies to TOOLS, not toolkit components. The toolkit's components are plain Web Components — they don't register with `SgToolApi` because they're not tools. They're consumed by tools.

**Example.** From `<sg-video-editor>`'s `api/sg-video-editor-api.js` (illustrative):

```js
import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';

const api = new SgToolApi({
    name:     'sg-video-editor',
    version:  { api: '0.1.0', ui: '0.1.55', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   { human: './skills/SKILL__human.md', browser: './skills/SKILL__browser.md', api: './skills/SKILL__api.md' },
});

api.register('loadAsset',    loadAssetImpl,    { async: true,  events: ['tool:asset:loaded'] });
api.register('addClip',      addClipImpl,      { async: false });
api.register('moveClip',     moveClipImpl,     { async: false });
// ... 40+ methods total

api.activate();
```

The tool's API methods live in `api/api-*.js` files; the registration entry-point is `api/sg-{tool-name}-api.js`. Methods are pure functions taking a single params object.

### D.2 — Manifest `actions` section MUST list every registered method

**Why.** The manifest is the discoverable spec. `manifest.json` `api.actions` is what `SKILL__api.md` is generated from, what the dev panel renders, and what the API explorer surfaces. Drift between registered methods and the manifest leaves methods invisible to consumers.

**Example.** Each method in `manifest.json`:
```json
"actions": {
    "moveClip": {
        "description": "Set timelineStart of a clip; snaps to fps. Throws Error{code:'overlap'} if the new position would overlap another clip on the same track. Pass `snap: true` to auto-snap-abut to the nearest neighbour edge on overlap (used by drag-on-timeline)."
    },
    ...
}
```

**Anti-pattern.** Adding a method via `api.register('newMethod', ...)` without a corresponding entry in `manifest.json`. Tools whose manifest is out of sync get rejected by the verification checklist (04 §D.4).

### D.3 — Methods that emit events MUST list those events in the registration

**Example.**
```js
api.register('exportMp4', exportMp4Impl, {
    async: true,
    events: ['tool:export:started', 'tool:export:progress', 'tool:export:completed', 'tool:error']
});
```

**Why.** The dev panel shows which events to expect from each method. Consumers (tests, agents) listen for the right events. If an event isn't declared, consumers may miss it.

### D.4 — Sensitive params MUST be sanitised in the log

**Why.** `SgToolApi`'s execution log keeps the last 500 calls. If an API key is logged in plaintext, it's leaked.

**Example.**
```js
api.register('connect', connectImpl, {
    async: true,
    sanitiseParams: p => ({ ...p, apiKey: p.apiKey ? '••••' : null }),
});
```

**Anti-pattern.** Skipping `sanitiseParams` for any method that takes credentials. Audit point: doc 04 §D will check for this.

---

## Section E — Manifest discipline

### E.1 — Tools MUST declare loader phases

**Why.** Loading order matters. CSS must load before JS that uses CSS variables for measurement. Component definitions must load before the tool entry that creates instances. The manifest's `loader` array specifies phase 1 / phase 2 / phase 3 explicitly.

**Example.** From `sg-video-editor`'s manifest:
```json
"loader": [
    { "phase": 1, "type": "css", "path": "/components/tokens/v1/v1.0/v1.0.0/sg-tokens.css" },
    { "phase": 1, "type": "css", "path": "/core/sg-layout/v0.1.0/sg-layout.css" },
    { "phase": 1, "type": "css", "path": "./styles/sg-video-editor.css" },
    { "phase": 2, "type": "js",  "path": "/core/sg-layout/v0.1.0/sg-layout.js" },
    { "phase": 2, "type": "js",  "path": "/components/sg-track-strip/v0/v0.1/v0.1.0/sg-track-strip.js" },
    { "phase": 2, "type": "js",  "path": "/components/sg-toolbar/v0/v0.1/v0.1.0/sg-toolbar.js" },
    // ... etc
    { "phase": 3, "type": "js",  "entry": true, "path": "./api/sg-video-editor-api.js" }
],
```

Phase 1 = all CSS. Phase 2 = all component / module JS. Phase 3 = tool entry (the `SgToolApi` registration). Phases run sequentially; everything in a phase loads in parallel within the phase.

### E.2 — Dependencies MUST be listed under `dependencies.shared` or `dependencies.core`

**Why.** This is how dependencies are discoverable. The dev panel's manifest tab shows them. The website's tool catalogue shows them. The Librarian's reality document audits them. Drift between actual imports and declared dependencies is a quality bug.

**Example.**
```json
"dependencies": {
    "core": [
        { "module": "sg-tool-api", "path": "/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js" },
        { "module": "sg-project-storage", "path": "/core/sg-project-storage/v0/v0.1/v0.1.0/sg-project-storage.js" }
    ],
    "shared": [
        { "module": "sg-component", "path": "/components/base/v1/v1.0/v1.0.0/sg-component.js" },
        { "module": "sg-track-strip", "path": "/components/sg-track-strip/v0/v0.1/v0.1.0/sg-track-strip.js" },
        // ... etc
    ]
}
```

### E.3 — Every TOOL MUST ship `SKILL__human.md`, `SKILL__browser.md`, `SKILL__api.md`

**Why.** This is the codebase's documentation contract. Three audiences, three docs:
- **`SKILL__human.md`** — what a human user does in the UI
- **`SKILL__browser.md`** — what an agentic browser session can do (selectors, click sequences)
- **`SKILL__api.md`** — what a programmatic consumer does via `window.__tool`

Toolkit components MAY omit SKILL files (they're consumed by tools, not consumed directly). Tools MUST include all three.

---

## Section F — File-size and shape budgets

### F.1 — JS files SHOULD NOT exceed 300 LOC for helpers, 350 LOC for class files

Stated in B.3 above. Repeated here as a budget. Implementer SHOULD split before crossing the budget, not after.

### F.2 — CSS files SHOULD use `:host` for component scoping; SHOULD NOT use `:root`

**Why.** Components live in shadow DOM. `:root` doesn't apply to shadow DOM. The codebase's `sg-tokens.css` explicitly notes this:

> *"Note: Shadow DOM components receive these via injection, not :root. We use :host-level custom properties so they cascade into component markup."*

**Example.**
```css
/* sg-track-strip.css */
:host {
    --sgts-lane-height: 44px;
    display: block;
    width: 100%;
    height: 100%;
}
```

**Anti-pattern.**
```css
:root {
    --sgts-lane-height: 44px;  /* doesn't apply inside shadow DOM */
}
```

### F.3 — CSS class names SHOULD use BEM-ish nesting matching the component prefix

**Example.**
```css
.sgts-lane         { ... }
.sgts-lane--locked { ... }
.sgts-lane--muted  { ... }
.sgts-lane__row    { ... }
```

**Why.** Predictable. Class names are scoped to shadow DOM so collisions are impossible, but consistency makes searching easier and component CSS is sometimes lifted into design-system docs.

### F.4 — `<style>` blocks inside components MUST NOT exist (see B.2)

CSS lives in the sibling `tag-name.css` file. `SgComponent` loads it automatically.

---

## Section G — Persistence (`sg-project-storage`)

### G.1 — Tools using `sg-project-storage` MUST configure unique storage keys

**Why.** Two tools sharing the default keys overwrite each other's saves. The repo's existing `sgve:*` keys are video-editor-specific; the audio editor needs its own prefix.

**Example.** Configuration when creating storage operations:
```js
import { saveProject, loadProject } from '/core/sg-project-storage/v0/v0.1/v0.1.0/sg-project-storage.js';

const STORAGE_CONFIG = {
    projectKeyPrefix: 'sgve:project:',
    indexKey:         'sgve:projects-index',
    slotKey:          'sgve:autosave:current',
    dbName:           'sgve',
    storeName:        'assets',
};

await saveProject({ project, slug: 'untitled', blobsById, ...STORAGE_CONFIG });
```

Per-tool storage keys for the consumers in this pack:
- `sg-video-editor` v0.1.55: `sgve:*`, IDB `sgve` (matches v0.1.54 exactly so saves migrate transparently — see doc 01 §7.2)
- `sg-audio-editor` v0.1.0: `sgae:*`, IDB `sgae`
- `sg-toolkit-sandbox` v0.1.0: `sgtks:*`, IDB `sgtks`

**Anti-pattern.** Using the module's defaults (`sg-storage:*`, `sg-storage` IDB DB) in production tools. Defaults exist for the sandbox; production tools override.

### G.2 — Saves MUST be idempotent and concurrent-safe-ish (last-write-wins is OK)

**Why.** Browser saves don't have transactions. Two tabs saving the same project simultaneously will produce one winner. The codebase accepts this — last-write-wins is documented behaviour.

**The rule.** Save logic MUST be safe to call repeatedly with the same input. It MUST NOT corrupt state if interrupted (e.g. tab closed mid-save). The Round-9-K `markSaved(savedJson)` fix specifically addressed this — the dirty-baseline must match what hit storage, not what was in memory at the start of the save.

### G.3 — Asset blobs MUST go to IndexedDB; project JSON MUST go to localStorage

**Why.** localStorage caps at ~5-10MB depending on browser. A single 4K video clip exceeds it. IndexedDB has no practical cap for blob storage. Round-9-J established the split: project metadata small and inspectable in localStorage, blobs out-of-band in IDB.

### G.4 — Orphan-pruning MUST be conservative

**Why.** When a project is deleted, the union of *all remaining saved projects + autosave + live in-memory project* references some blobs. ONLY blobs not referenced by any of those should be pruned. The Round-9-J code does this via `pruneOrphanedAssets(usedIds)`. The toolkit's `sg-project-storage` does the same.

**Anti-pattern.** Pruning blobs referenced only by the just-deleted project, ignoring other saved projects that might also reference them. Causes data loss.

---

## Section H — IFD discipline

### H.1 — Released versions are FROZEN; never edit in place

**Why.** This is the central IFD rule. From `library/development/ifd/v1.2.1__ifd__intro-and-how-to-use.md`:

> *"v0.1.3 CAN depend on v0.1.2, v0.1.1, v0.1.0 [but] CANNOT copy entire files just to change one method"*

Once `v0.1.X` is tagged, its files don't change. Bug fixes ship in `v0.1.(X+1)` as surgical overrides per `library/development/ifd/v1.3.0__ifd__surgical-overrides-version-stamped-filenames.md`. Behaviour changes ship in `v0.1.(X+1)` as a full minor version. Major refactors ship in `v0.(N+1).0` consolidating the proven changes.

**Example.** This pack:
- `<sg-timeline>` v0.1.0 stays at its path. Frozen.
- `<sg-track-strip>` v0.1.0 ships at a new path. Independent.
- `sg-video-editor` v0.1.54 stays at its path. Frozen.
- `sg-video-editor` v0.1.55 ships at a new path. New folder, new version, depends on the new toolkit.

**Anti-pattern.** Editing `tools/v0/v0.1/v0.1.54/en-gb/sg-video-editor/ui/ui-shell.js` to use the new toolkit. WRONG. v0.1.54 is frozen. Changes go in v0.1.55, in a new folder.

### H.2 — Version paths MUST follow `vN/vN.M/vN.M.P/` nesting

**Why.** The codebase already does this. `tools/v0/v0.1/v0.1.54/en-gb/`. Components: `components/sg-timeline/v0/v0.1/v0.1.0/`. Core: `core/sg-tool-api/v0/v0.1/v0.1.0/`. Three levels of nesting; the leaf folder is the patch version.

**Example.** New toolkit components:
```
components/sg-track-strip/v0/v0.1/v0.1.0/
components/sg-toolbar/v0/v0.1/v0.1.0/
components/sg-asset-panel/v0/v0.1/v0.1.0/
```

**Anti-pattern.** Flatter paths (`components/sg-track-strip/v0.1.0/`). Deviates from the codebase convention; tooling that expects three-level nesting (CDN cache strategies, the manifest loader) breaks.

### H.3 — A new minor version (`v0.1.X` → `v0.1.Y`) of a tool MUST be a NEW folder

**Why.** IFD's "new minor = new folder" rule. The new folder may contain only changed files (surgical override pattern) plus a manifest pointing to base files in the previous minor's folder. Or it may contain the full set of files (for substantial refactors like brief 06).

**For brief 06 (the video editor refactor):** Substantial refactor. New folder. New full file set. v0.1.55 does NOT depend on v0.1.54 files; it has its own complete copy.

### H.4 — A new major version (`v0.1.X` → `v0.2.0`) is a CONSOLIDATION, not a new feature

**Why.** From the IFD doc: *"v0.2.0 → Consolidation (proven features only)."* Major versions roll up minor-version surgical overrides into self-contained codebases.

**Out of scope for this pack.** None of this pack's deliverables ship as `v0.2.0`. The toolkit's components ship as `v0.1.0` (new). The video editor refactor is a minor (`v0.1.55`).

### H.5 — `sgraph_ai_app_send/version` MUST NEVER be touched

**Why.** Per `.claude/CLAUDE.md`: *"NEVER touch `sgraph_ai_app_send/version` — it is owned exclusively by the CI pipeline."*

Note: that's the SG/Send rule. The Tools repo has its own `version` file; same rule applies. CI increments after tests pass. Manual setting creates collisions.

### H.6 — Branch names MUST follow `claude/{description}-{session-id}`

**Why.** Per `.claude/CLAUDE.md`. Lets the human attribute changes to specific sessions, lets the merge bot route review requests, prevents collisions between parallel sessions.

**Example.**
```
claude/sg-toolkit-track-strip-build-Ab3xK
claude/sg-video-editor-v0.1.55-refactor-Pq9mZ
```

---

## Section I — Testing discipline

### I.1 — Tests MUST run without mocks and without patches

**Why.** Inherited from SG/Send's testing discipline (`.claude/CLAUDE.md` Stack table: *"Testing: pytest, in-memory stack, No mocks, no patches"*). The Tools repo follows the same — full stack runs in the browser test page in <100ms; no `jest.mock`, no `sinon.stub`, no monkey-patching.

**Example.** Test pages live at `sgraph_ai_tools__static/tests/{component}/v0.1.0.test.html` — full HTML pages that load the real component from real paths and exercise it.

**Why no mocks.** Mocks drift. A mock that lies about the component's behaviour leaves a passing test even after the real behaviour breaks. In-memory in-browser tests catch real regressions.

### I.2 — Tests SHOULD be Playwright-runnable

**Why.** Playwright lets the same test page run headless in CI and interactively for humans. The codebase already has Playwright wiring for `<sg-tool-api-explorer>` smoke tests.

### I.3 — Every public method on a Web Component SHOULD have at least one test

**Why.** Public methods are contract. Untested public methods are theoretical contract.

### I.4 — Tests MUST pass before the implementer marks a task done

**Why.** The verification checklist (04) is the project plan; checklist items reference tests. A task is not done unless its referenced checklist items are ticked, and items referencing tests can only be ticked when the test passes.

---

## Section J — Documentation discipline

### J.1 — Every tool's manifest MUST link to its three SKILL files

Per E.3.

### J.2 — Every component MUST have JSDoc on its public methods

**Why.** JSDoc drives `SKILL__api.md` generation, drives the dev panel's method docs, drives IDE intellisense. The codebase already follows this.

**Example.**
```js
/**
 * Set the project to render. Triggers a full re-render. Cheap (<1ms for typical projects).
 * @param {Project} project The project to render. See V.4 in pack README for the schema.
 * @returns {void}
 */
setProject(project) { ... }
```

### J.3 — Reality document MUST be updated after merge

**Why.** Per `.claude/CLAUDE.md`: *"Update the reality document when you change code."* The Librarian (or the merging agent) updates `team/explorer/librarian/reality/v0.1.0__what-exists-today.md` with new components, new tools, new versions. Pack 06's debrief is the source.

**This pack's reality update:** AFTER all four briefs (05, 06, 07, 08) merge, the Librarian writes a paragraph for each new component and the two new tool versions. The pack-author does NOT update reality directly during the pack.

### J.4 — Debriefs MUST link with relative paths that work in GitHub UI

**Why.** Per `.claude/CLAUDE.md`'s exhaustive table for relative-link depth from debriefs (`team/humans/dinis_cruz/debriefs/MM/DD/`). The most common mistake is linking to `team/roles/` with 3 levels (`../../../roles/...`), which resolves to `team/humans/dinis_cruz/roles/...` and 404s. Correct is 5 levels.

This pack lives in `team/humans/dinis_cruz/claude-code-web/04/27/v0.22.17__pack__sg-toolkit-extraction/`, which is also 5 directories deep. Relative-link rules from the master CLAUDE.md apply identically.

---

## Section K — Sonnet-implementer-specific rules

### K.1 — One task = one acceptance check = one commit

**Why.** Sonnet performs better against numbered task lists with clear, falsifiable acceptance criteria than against large work items. Decomposing a brief into 30 tasks of 30 minutes each yields better outcomes than 5 tasks of 3 hours each.

**Example.** A task in brief 05 looks like:

```
### Task 12 — Lane rendering: clip rectangles render with correct background colour priority

**Acceptance:** Sandbox tool's "Video" mode renders 3 clips on track 1 with colours in
the priority order `clip.color → track.color → palette[trackIndex % 6]`. Verified by:
- Clip 1 has clip.color set → renders with that exact colour
- Clip 2 has track.color set, no clip.color → renders with track.color
- Clip 3 has neither → renders with palette[0] (indigo)

**Tests:** sandbox-tests/lane-render.test.html assertion 4-6.

**Files modified:** components/sg-track-strip/v0/v0.1/v0.1.0/lane-render.js (new file)

**Checklist items satisfied:** 04 §A.7, 04 §C.1.video.colour-priority

**Estimated time:** 30 minutes.
```

The implementer reads this, executes the task, runs the test, ticks 04 §A.7 and §C.1.video.colour-priority, commits with the message body listing this task and the files, and moves on.

### K.2 — On ambiguity, STOP and ask

**Why.** A.5 above. The cost of stopping to ask is one round-trip. The cost of guessing wrong and discovering it three tasks later is a rollback.

**Example.** The brief says "render clips with the appropriate colour." Ambiguous — does "appropriate" mean clip.color, track.color, or palette? The implementer stops, asks, gets the answer (priority is `clip.color → track.color → palette` per Round-9-I), and proceeds. Doesn't guess.

### K.3 — Every commit MUST list the files it changes in the body

**Why.** Helps the reviewer (human or agent) verify the commit matches the task. Helps `git log` searches find specific files quickly.

**Example commit message:**
```
feat(sg-track-strip): lane rendering with colour priority (Task 12)

Files:
- components/sg-track-strip/v0/v0.1/v0.1.0/lane-render.js (new)
- components/sg-track-strip/v0/v0.1/v0.1.0/sg-track-strip.css (additions)

Acceptance: 04 §A.7 + 04 §C.1.video.colour-priority ticked.
```

### K.4 — `DO NOT` is as authoritative as `DO`

**Why.** Each brief in this pack will have a `DO NOT` section. Sonnet implementers historically read `DO` as instructions and `DO NOT` as suggestions. The vocabulary in this pack treats them identically — both are constraints, equally binding.

### K.5 — When in doubt, prefer the smaller, safer change

**Why.** Sonnet has a tendency to expand scope when uncertain ("might as well also fix this related thing"). For this pack, that's the wrong instinct. Smaller scope, more changes per commit, more verification points. Each task should be the smallest unit that makes the verification checklist tickable.

### K.6 — Before starting any task, READ the relevant section of the vocabulary appendix

**Why.** Names are pinned in the vocabulary. Don't invent. Don't paraphrase. Don't translate. If the vocabulary says `start`, the variable is `start`, the JSON field is `start`, the parameter is `start`, the JSDoc says `start`.

---

## Section L — Process and parallelism

### L.1 — Briefs that depend on each other MUST execute in order

Per the README's execution-order section. Brief 08 before 06. Brief 05 before 06 and 07. Brief 06 and 07 can be parallel after 05 lands.

### L.2 — Two agents working on different briefs at the same time MUST be on different branches

Per A.1.

### L.3 — Cross-brief disagreements are resolved against the vocabulary appendix; if not resolved there, escalated to the human

**Why.** The vocabulary is the cross-cutting source of truth. Disagreements that the vocabulary doesn't settle are genuine architectural questions; the implementer doesn't get to settle them. They escalate.

### L.4 — Daily progress SHOULD include checklist tick deltas

**Why.** "I finished 4 tasks" is hard to verify. "I ticked items A.7, B.3, C.1.video.colour-priority, D.4" is verifiable against the checklist.

### L.5 — Reviewers SHOULD verify checklist ticks, not just code

**Why.** A code review that says "the diff looks right" misses cases where the diff doesn't actually achieve the checklist outcome. A review that says "checklist item B.3 says X; the diff shows Y; this isn't B.3" catches drift.

---

## Section M — Op-driven architecture

This section is at the same priority as Section B (component construction) and Section C (event-driven). It is the third pillar of the toolkit's design. **Read it carefully — most Sonnet drift in op-driven systems happens when implementers treat ops as "events with extra fields" rather than as the primitive they are.**

### M.1 — Every state-changing event MUST carry an op-shape envelope

**Why.** Per architectural decision A-010. Op-shaped events make events durable, replayable, attributable, and inspectable. Hosts can route them to `sg-history`, log them for telemetry, persist them in saves, replay them in tests. Bare events (just after-state) lose the before-state and the reversibility category, which means hosts have to reconstruct that information at the wrong layer.

**Example.**
```js
// Inside <sg-track-strip>.onItemMove (correct, op-shaped):
this.emit('item-moved', {
    op: {
        type:       'item-moved',
        payload:    {itemId, fromTrackId, toTrackId, fromStart, toStart, snapped},
        priorState: null,             // pure op — the inverse is derivable from payload
        reversible: 'pure',
        timestamp:  Date.now(),
        source:     'user-drag',
    },
});
```

**Anti-pattern.**
```js
// Bare event (NOT op-shaped) — the host can't undo this without reconstructing prior state itself:
this.emit('item-moved', {
    itemId,
    toTrackId,
    toStart,
});
```

The bare-event version forces every host to wrap it back into op shape. The op-shaped version means hosts wire op-shaped events directly to `sg-history.record(e.detail.op)` with no intermediate translation.

### M.2 — Pure ops MUST carry both from-state and to-state in the payload

**Why.** Pure ops are reversed by swapping fields. If the payload has only the to-state, undo can't reconstruct the from-state from anywhere else. The redundancy is intentional.

**Example.**
```js
{type: 'track-renamed', payload: {trackId, fromName: 'Track 1', toName: 'Voiceover'}, reversible: 'pure'}
```

**Anti-pattern.**
```js
{type: 'track-renamed', payload: {trackId, name: 'Voiceover'}, reversible: 'pure'}
//                                          ^^^^^^^^^^^^^^^^^^ where's the prior name?
```

### M.3 — Snapshot ops MUST carry full prior state needed to reverse

**Why.** Snapshot ops describe destructive structural changes — delete, split, remove-track. The prior state is the only way to restore. Carrying a partial snapshot ("just the id") forces the host to look up the rest, which means undo is no longer a pure replay of the op.

**Example.**
```js
{
    type: 'item-deleted',
    payload: {itemId: 'clip-7'},
    priorState: {
        id: 'clip-7',
        start: 12.5,
        end: 17.0,
        color: '#4ECDC4',
        label: 'voiceover-take-3.mp4',
        // every host-specific field needed to reconstruct
        assetId: 'asset-42',
        inPoint: 0.0,
        outPoint: 4.5,
    },
    reversible: 'snapshot',
}
```

The host's `onApply(op, 'backward')` for a snapshot op uses `priorState` directly — `state.addItem(op.priorState, op.payload.trackId)`.

### M.4 — With-side-effects ops MUST list the side effects explicitly

**Why.** sg-history calls the host's `onSideEffect(op, direction)` BEFORE applying the state change. The host needs to know which side effects to roll back, by name, so it can route to the right rollback code.

**Example.**
```js
{
    type: 'asset-removed',
    payload: {assetId: 'asset-42'},
    priorState: {id: 'asset-42', name: 'voiceover.mp4', mimeType: 'video/mp4'},
    sideEffects: ['blob-may-orphan'],
    reversible: 'with-side-effects',
}
```

The host's `onSideEffect(op, 'backward')` reads `op.sideEffects`, sees `'blob-may-orphan'`, and re-references the blob (or restores it from a deferred-prune queue, host's call).

### M.5 — Never ops MUST be recorded; sg-history skips past them on undo

**Why.** Audit trail. The op happened in the world; the user (or an agent reviewing later, or a debugger) may need to see it. Just because we can't reverse it doesn't mean we shouldn't record it.

**v0.1.0 behaviour:** `undo()` walking past a `never` op advances the position pointer through it without applying anything. The op stays in the log; the position just moves.

**Example.** Recorded but irreversible:
```js
{
    type: 'mp4-exported',
    payload: {filename: 'project-final.mp4', byteSize: 18453221, durationSec: 45.2},
    priorState: null,
    reversible: 'never',
    timestamp: Date.now(),
    source: 'user-button',
}
```

### M.6 — Noisy ops are dropped from the undo stack by default

**Why.** Selection clicks, hover events, playhead scrubs are gestures, not changes. Recording them in the undo stack means Ctrl+Z walks back through every selection click before reaching a real change. Bad UX. Default behaviour: don't record.

**Hosts opt in** with `historyConfig.captureNoisy: true` if they want a complete event log for replay/observation. Even then, sg-history flags them as skip-on-undo so undo passes over them.

**Example.** A noisy op (silently dropped by sg-history default):
```js
{type: 'item-selected', payload: {itemId: 'clip-7', priorItemId: null}, reversible: 'noisy'}
```

### M.7 — `priorState` is null for pure and never ops; always present for snapshot and with-side-effects ops

**Why.** Pure ops derive their inverse from payload alone. Never ops can't be reversed at all so prior state is moot. Snapshot and with-side-effects ops need prior state to reverse. The `priorState` field is therefore predictable based on the category — and missing-when-required is a bug.

| Category | `priorState` |
|---|---|
| `pure` | `null` |
| `snapshot` | always present (host-shape) |
| `with-side-effects` | always present (host-shape) plus `sideEffects` array |
| `never` | `null` |
| `noisy` | `null` (or omitted; ops are dropped anyway) |

**Anti-pattern.** Setting `priorState: null` for a snapshot op and discovering at undo time that the host has nothing to restore. Caught by V.6 verification items in checklist 04.

### M.8 — Components emit op-shaped events; the HOST routes them to sg-history

**Why.** Per Section C.1: components emit, hosts listen. The toolkit components do NOT call `sg-history.record()` directly. They emit `sg-track-strip:item-moved` (with op-shaped detail), the host's adapter listens, the host's adapter calls `history.record(e.detail.op)`. Same flow as every other event-driven coupling in this codebase.

**Why this matters.** The host might NOT use sg-history. Maybe the host has its own history component (custom, integrated with a vault, whatever). Maybe the host is a read-only viewer with no undo. The components don't care; they emit ops; hosts decide what to do.

**Anti-pattern.**
```js
// WRONG — inside a toolkit component
import { createHistory } from '/core/sg-history/...';

class SgTrackStrip extends SgComponent {
    onReady() {
        this._history = createHistory();    // toolkit does NOT own history
    }
    
    onItemMove(...) {
        this._history.record({...});         // bypassing the event flow
    }
}
```

The toolkit component must emit, not record. sg-history is wired up by the host.

### M.9 — `source` field MUST distinguish user, agent, and replay

**Why.** Op telemetry is most useful when "did the user do this or did an agent do this" is answerable. The `source` field is a host-defined opaque string; common values:

- `'user-drag'`, `'user-button'`, `'user-keyboard'`, `'user-input'` — the user did it
- `'agent'` — an LLM/agent operating via the tool's API
- `'replay'` — sg-history is replaying a saved op log
- `'sandbox-fuzz'` — the sandbox tool's fuzzer
- Tool-specific values are fine

**Anti-pattern.** Omitting source. `source: undefined` makes the op untraceable.

### M.10 — Op-shaped events MUST round-trip through JSON.stringify/parse

**Why.** Ops are serialised into save files (`ops` slot in `sg-project-storage`) and into sgit vaults (future). Anything in an op's payload or priorState that doesn't serialise to JSON breaks save/load.

Forbidden in op fields: `Date` objects (use `Date.now()` numbers), `Set`/`Map` (use plain objects/arrays), Functions, DOM elements, Blobs (use a separate `assetId` reference), circular references.

**Anti-pattern.**
```js
{type: 'item-added', payload: {item, addedAt: new Date()}, ...}    // Date doesn't survive serialize/parse cleanly
{type: 'asset-uploaded', payload: {assetId, blob}, ...}             // Blob doesn't serialize
```

---

## Section N — Documenting undo support

Each toolkit component (and each tool that emits its own ops) declares its op support in two places: (1) JSDoc comments in the component class, (2) a new `ops.emits` section in the manifest. Both are required.

### N.1 — `manifest.json` MUST declare every op the component emits

**Why.** Per V.9.1 in the README. The manifest's `ops` section is parallel to `actions` and `events`. It's machine-readable, drives `SKILL__api.md` op tables, drives the dev panel's op explorer.

**Example.** From `<sg-track-strip>`'s manifest.json:
```json
{
    "name": "sg-track-strip",
    "version": "0.1.0",
    "type": "component",
    "actions": { ... },
    "events":  { ... },
    "ops": {
        "emits": [
            {"type": "item-added",       "reversible": "snapshot"},
            {"type": "item-moved",       "reversible": "pure"},
            {"type": "item-trimmed",     "reversible": "pure"},
            {"type": "item-deleted",     "reversible": "snapshot"},
            ...
        ]
    }
}
```

**Anti-pattern.** Adding a new op (say, `item-pinned`) by emitting it from the component but forgetting to update the manifest. The dev panel won't show it; replay tools won't recognise it; verification (04 §D.4) will fail.

### N.2 — JSDoc on the emit call MUST state the category

**Why.** When reading the code, the category should be visible without cross-referencing the manifest.

**Example.**
```js
/**
 * Emit on user item-move. Op category: 'pure' — both from-state and to-state in payload.
 * Detail: {op: Op}, op.payload: {itemId, fromTrackId, toTrackId, fromStart, toStart, snapped}.
 */
this.emit('item-moved', {
    op: {
        type:       'item-moved',
        payload:    { ... },
        priorState: null,
        reversible: 'pure',
        timestamp:  Date.now(),
        source:     'user-drag',
    },
});
```

### N.3 — Tools MAY override or extend a component's op declarations in their own manifest

**Why.** A tool that wraps a component event and adds tool-specific fields (e.g. wrapping `item-moved` to also include the resolved asset name) needs to redeclare the op with the new shape. The tool's manifest takes precedence over the component's for downstream consumers.

**Example.** `sg-video-editor`'s manifest may redeclare `item-moved` with the augmented detail.

### N.4 — A tool's `SKILL__api.md` MUST include an "Ops emitted" table

**Why.** Agents reading `SKILL__api.md` to operate the tool need to know which ops fire. The `manifest.json`'s `ops.emits` section is the data; `SKILL__api.md` is the prose summary. Some op-shaped events are visible only via observation; the table makes them discoverable.

**Example.** A section in `SKILL__api.md`:

```markdown
## Ops emitted

This tool emits the following ops on user actions and agent-initiated mutations.
Op category determines undo behaviour — see V.6 in pack vocabulary.

| Op type | Category | Triggered by |
|---|---|---|
| `item-moved` | `pure` | drag-drop on timeline; `moveClip(...)` API call |
| `item-deleted` | `snapshot` | × button on timeline; `removeClip(...)` API call |
| `mp4-exported` | `never` | export-button completion; `exportMp4(...)` completion |
| ... | ... | ... |
```

### N.5 — Hosts MUST register an `onApply` and (if needed) an `onSideEffect` handler with sg-history

**Why.** sg-history is the bookkeeper. The host owns state mutation. The host registers handlers when creating the history instance:

```js
const history = createHistory({
    eventTarget: rootEl,
    onApply: (op, direction) => {
        // direction is 'forward' (redo or initial) or 'backward' (undo)
        if (direction === 'forward') {
            applyOpForward(state, op);
        } else {
            applyOpBackward(state, op);
        }
    },
    onSideEffect: async (op, direction) => {
        // host-specific rollback for 'with-side-effects' ops
        if (op.sideEffects?.includes('blob-may-orphan')) {
            await handleBlobOrphan(op, direction);
        }
    },
    onSnapshot: () => structuredClone(state.getProject()),
});
```

### N.6 — Components MAY change category for their ops in v0.1.X minor versions ONLY by additions or relaxations

**Why.** Cross-version compatibility. If a component changes `'pure'` → `'snapshot'`, every consumer's `onApply(op, 'backward')` for that op type breaks. If a component changes `'snapshot'` → `'pure'`, the consumer's old snapshot-restore code stops being needed but doesn't break.

**Permitted in minor version (v0.1.0 → v0.1.1):**
- Adding a new op type (consumers can ignore it)
- Relaxing category: `'snapshot'` → `'pure'` (consumer needs less from the op, not more)
- Relaxing category: `'with-side-effects'` → `'snapshot'` (consumer drops side-effect handler, doesn't add)
- Adding optional fields to payload (consumers ignore unknown fields)
- Adding categories: `'noisy'` → recorded by default in the new minor (consumer just sees more op records)

**Forbidden in minor version (must wait for next major):**
- Tightening category: `'pure'` → `'snapshot'` (consumer would have to grow new code)
- Tightening category: `'snapshot'` → `'with-side-effects'` (consumer would need new side-effect handlers)
- Removing fields from payload
- Renaming op types

**For this pack:** v0.1.0 establishes the categories per V.6. Future minor versions follow the rules above. Major versions (v0.2.0) can do anything.

---

## Section O — Where these guidelines apply

These guidelines apply to:

- All briefs in this pack (05, 06, 07, 08)
- All toolkit components (the seven listed in V.1)
- All tools in the Tools repo built after this pack (going forward)
- All future packs that touch the toolkit or its consumers

These guidelines do NOT retroactively apply to:

- Existing tools (`<sg-timeline>`, `<sg-preview-canvas>`, `<sg-json-viewer>` and their hosts) — they predate the rules. Per the IFD reference-decay framing, they stay frozen at their paths; no retroactive upgrade is required or planned.
- Anything in `team/humans/dinis_cruz/briefs/` (human-authored, different audience)
- The SG/Send repo (those are the SG/Send rules)

If a future pack proposes a guideline change, that pack updates this doc and all its consumers.

---

## Appendix — Quick reference

For implementers in a hurry, the rules that matter most:

1. **Extend `SgComponent`** — never raw `HTMLElement` (B.1)
2. **Three sibling files** — `tag.html`, `tag.css`, `tag.js` (B.2)
3. **`SGTS_EVENTS` etc.** — frozen exported constants, no inline strings (C.2)
4. **Match V.2 vocabulary exactly** — event names, detail shapes (C.3)
5. **Components emit, hosts listen** — never the reverse (C.1)
6. **Op-shaped events** — every state-changing event has a `{op: {type, payload, priorState, reversible, timestamp, source}}` envelope (M.1)
7. **Pure ops carry from-AND-to in payload** — never just to-state (M.2)
8. **Snapshot ops carry full priorState** — never partial (M.3)
9. **One of 5 categories** — `pure / snapshot / with-side-effects / never / noisy` (V.6, M.1–M.6)
10. **Components emit ops; hosts route to sg-history** — components NEVER call sg-history directly (M.8)
11. **Manifest declares `ops.emits`** — every op type with its category (N.1)
12. **300/350 LOC budget** — split before you cross it (B.3, F.1)
13. **`:host` not `:root`** — shadow DOM scoping (F.2)
14. **Tools register with `SgToolApi`; components don't** (D.1)
15. **Manifest's `actions` MUST list every method** (D.2)
16. **Tools use unique storage keys; toolkit uses defaults only in sandbox** (G.1)
17. **No edits in frozen versions; new minor = new folder** (H.1, H.3)
18. **Branch per session: `claude/{description}-{session-id}`** (H.6)
19. **Explicit `git add` paths; no `git add -A`** (A.1)
20. **One task = one acceptance check = one commit** (K.1)
21. **On ambiguity, ASK** (K.2, A.5)
22. **`DO NOT` is binding** (K.4)
23. **Tick the checklist before claiming done** (A.8, K.1)

End of doc 03 (rev 2). Pass 1 revision complete.
