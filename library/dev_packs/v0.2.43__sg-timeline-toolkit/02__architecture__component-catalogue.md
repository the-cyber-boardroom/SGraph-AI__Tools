# 02 — Component Catalogue

**Pack:** `v0.22.17__pack__sg-toolkit-extraction`
**Doc revision:** rev 1 (Pass 2)
**Doc role:** the heavy spec for every piece of the toolkit. Doc 01 explains WHY each piece exists; this doc is HOW it's built. If you're implementing a brief that touches a piece, you read its catalogue section in full — including the DO-NOT lists, examples, and integration notes.
**Audience:** Sonnet implementers of briefs 05, 06, 07. QA implementer of brief 08 reads §verification-touchpoints in each component.
**Lifetime:** durable. Updates accompany toolkit minor versions.

> **Read first:** README V.1–V.11, doc 01 (architecture spine), doc 03 (coding guidelines).
> **Vocabulary precedence:** if this doc and the README disagree, the README wins. Implementers MUST cross-check before relying on a name in this doc.

---

# §0 — How to read this doc

Each component / module gets its own section structured identically:

1. **Identity** — name, type, path, version, file layout
2. **Purpose** — one paragraph on what it IS (mirrors doc 01 but more concrete)
3. **Public API** — the methods, events, ops, schema fields it exposes
4. **State model** — what the component stores internally and how it gets there
5. **Rendering model** — what the user sees and when
6. **Op model** — what ops it emits, what categories, in what order
7. **Integration patterns** — how a host wires it up, with worked code examples
8. **Edge cases and constraints** — bounds on inputs, error modes, limits
9. **DO NOT** — anti-patterns specific to this component
10. **Verification touchpoints** — the doc 04 checklist items this component covers

If a section seems "obvious" — read it anyway. The audience is Sonnet implementers in fresh sessions with no prior context. What's obvious to a reader of doc 01 is not obvious to someone who arrived here via brief 05.

---

# §1 — `<sg-track-strip>` (Web Component)

## §1.1 — Identity

| Field | Value |
|---|---|
| Tag | `<sg-track-strip>` |
| Type | Web Component, extends `SgComponent` |
| Path | `components/sg-track-strip/v0/v0.1/v0.1.0/` |
| Version | `v0.1.0` |
| Files | `sg-track-strip.html`, `sg-track-strip.css`, `sg-track-strip.js`, `sg-track-strip-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md` |
| LOC budget | 300 hard / 350 soft per file (per F.1); split into helpers if needed |
| Replaces | none — `<sg-timeline>` v0.1.0 stays at its path |

## §1.2 — Purpose

The ruler-and-lanes surface for any timeline-shaped tool. Renders horizontal lanes (tracks), each containing items positioned on a numeric axis (`start`, `end`). Handles drag, drop, trim, split, copy/paste, multi-track-rearrangement, lane mute/lock, lane rename, playhead. Emits op-shaped events for every user action; the host owns state and decides what to do with the ops.

This component is the thickest in the toolkit (most state, most events, most edge cases). Roughly 60% of toolkit catalogue line-count is here. That's appropriate; this is the workhorse.

## §1.3 — Public API

### §1.3.1 — Methods (V.3.1 in README is the source of truth)

```javascript
// State setters — IMPERATIVE, do NOT emit ops (per M.11)
setProject({tracks: Track[]}): void
setTracks(tracks: Track[]): void                  // partial: tracks only
setItems(itemsByTrackId: {[trackId]: Item[]}): void  // partial: items only
setSelectedItem(itemId: string | null): void
setSelectedTrack(trackId: string | null): void
setPlayheadPosition(position: number): void

// View configuration (also imperative, also no ops)
setPxPerSecond(pxPerSecond: number): void         // axis zoom
setViewportRange({start: number, end: number}): void  // scroll/fit
setSnapEnabled(enabled: boolean): void
setSnapResolution(resolution: number): void       // e.g. 0.1 for 100ms grid
setMode(mode: 'select' | 'move-resize' | 'crop'): void  // editor-mode tag

// Computed-property accessors (read-only, return current internal state)
getSelectedItemId(): string | null
getSelectedTrackId(): string | null
getPlayheadPosition(): number
getViewportRange(): {start: number, end: number}
getPxPerSecond(): number
getMode(): string
```

### §1.3.2 — Events (V.2.1 in README is the source of truth)

All events follow the op-shape envelope per V.2:

```javascript
this.dispatchEvent(new CustomEvent(eventName, {
    bubbles: true,
    composed: true,
    detail: {
        op: {
            type:        '<eventName-last-segment>',
            payload:     <type-specific>,
            priorState:  null | <category-specific>,
            reversible:  '<one of V.6 categories>',
            timestamp:   Date.now(),
            source:      '<user-drag|user-button|user-keyboard|user-input>',
        },
    },
}));
```

The full event list with payload shape and category is **V.2.1 in the README**. Do NOT duplicate it here; consult the appendix. This avoids drift when the README updates.

### §1.3.3 — Ops emitted (V.6.6 in README maps existing video-editor mutations to categories)

The `manifest.json` `ops.emits` array MUST declare every op the component emits, per V.9.1. The full list:

```json
"ops": {
    "emits": [
        {"type": "item-added",        "reversible": "snapshot"},
        {"type": "item-moved",        "reversible": "pure"},
        {"type": "item-trimmed",      "reversible": "pure"},
        {"type": "item-deleted",      "reversible": "snapshot"},
        {"type": "item-split",        "reversible": "snapshot"},
        {"type": "item-color",        "reversible": "pure"},
        {"type": "item-copied",       "reversible": "snapshot"},
        {"type": "item-track-changed","reversible": "pure"},
        {"type": "item-selected",     "reversible": "noisy"},
        {"type": "item-paste-requested",  "reversible": "noisy"},
        {"type": "playhead-changed",  "reversible": "noisy"},
        {"type": "track-add-requested",   "reversible": "snapshot"},
        {"type": "track-remove-requested","reversible": "snapshot"},
        {"type": "track-mute",        "reversible": "pure"},
        {"type": "track-lock",        "reversible": "pure"},
        {"type": "track-renamed",     "reversible": "pure"},
        {"type": "track-selected",    "reversible": "noisy"},
        {"type": "undo-requested",    "reversible": "noisy"},
        {"type": "redo-requested",    "reversible": "noisy"},
        {"type": "editor-mode",       "reversible": "pure"}
    ]
}
```

## §1.4 — State model

### §1.4.1 — Internal state (private; reset on every `setProject`)

```javascript
{
    _project:        {tracks: Track[]},   // last value passed to setProject/setTracks
    _selectedItemId:  string | null,
    _selectedTrackId: string | null,
    _playheadPosition: number,            // current playhead in axis units
    _viewportRange:   {start, end},       // visible range
    _pxPerSecond:     number,             // zoom; default 60
    _snapEnabled:     boolean,            // default true
    _snapResolution:  number,             // default 0.1 (100ms)
    _mode:            string,             // 'select' | 'move-resize' | 'crop'
    
    // Drag state — transient, cleared on drag-end:
    _dragState: null | {
        kind:  'item-move' | 'item-trim-start' | 'item-trim-end' | 'item-copy' | 'playhead-scrub' | 'lane-rename',
        itemId?: string,
        trackId?: string,
        startMouseX?: number,
        startValue?: number,                // captured start value for from-state
        previewValue?: number,              // current preview position during drag
    },
    
    // Pasted-buffer (in-memory; doesn't survive reload):
    _pasteBuffer: null | {item: Item, sourceTrackId: string},
}
```

### §1.4.2 — How state arrives

- **Project load.** Host calls `setProject({tracks})` — entire surface re-renders. NO events fire.
- **Item update from undo/redo.** Host calls `setItems({trackId: items})` after an undo applies — the affected track re-renders. NO events fire.
- **User interaction.** Mouse/keyboard handlers update `_dragState` (mid-drag) or call internal `_emit*` methods (on drag-end). The internal `_emit*` methods are the ONLY places that emit op-shaped events.

This separation — imperative setters never emit; only user-handler methods emit — is M.11 from doc 03. Violating it generates op spam.

## §1.5 — Rendering model

### §1.5.1 — Shadow DOM tree

```html
<div class="container">
    <div class="ruler" part="ruler"></div>
    <div class="lanes-container">
        <div class="lane" data-track-id="...">
            <div class="lane-header">
                <button class="track-name">Track 1</button>
                <button class="lane-mute">M</button>
                <button class="lane-lock">L</button>
                <button class="lane-remove">×</button>
            </div>
            <div class="lane-track">
                <div class="item" data-item-id="..." style="left: ...; width: ...;">
                    <span class="item-label">label</span>
                    <button class="item-delete">×</button>
                    <div class="item-trim-handle item-trim-start"></div>
                    <div class="item-trim-handle item-trim-end"></div>
                </div>
            </div>
        </div>
    </div>
    <div class="playhead" part="playhead"></div>
</div>
```

### §1.5.2 — When does the component re-render

The component MUST follow these update rules to avoid the performance bug fixed in v0.1.54 Round 9-K:

| Trigger | What re-renders |
|---|---|
| `setProject({tracks})` | full lane container + ruler |
| `setTracks(tracks)` | full lane container; ruler unchanged unless duration changed |
| `setItems({trackId: items})` | only the matching `.lane-track` element |
| `setPlayheadPosition(position)` | only the playhead position; uses `transform: translateX(...)` not relayout |
| `setPxPerSecond(pps)` | full lane container + ruler |
| Selection change | only adds/removes `.is-selected` class |
| Drag preview (mid-drag) | only the dragged item's `style.left` updates; via `transform` not `left` for performance |

**Anti-pattern:** re-rendering the whole component on every setItems call. The existing `<sg-timeline>` v0.1.0 had this issue at high item counts. The fix: per-track diffing.

### §1.5.3 — Drag preview behaviour

During a drag (mouse held), the dragged element's CSS `transform: translateX(...)` updates on every `mousemove`. NO ops emit. NO state updates. On `mouseup`, the final position is computed (with snap applied if `_snapEnabled`), the op-shaped event emits with `op.payload.fromStart` (captured on `mousedown`) and `op.payload.toStart`.

**The snap value goes in the payload** — `op.payload.snapped: boolean` says whether snap was applied. Telemetry consumers care; undo doesn't.

## §1.6 — Op model — detailed walkthrough

### §1.6.1 — `item-moved` (pure)

Emitted on drag-and-drop release of an item to a new horizontal position (and possibly different track).

```javascript
{
    type: 'item-moved',
    payload: {
        itemId:        string,
        fromTrackId:   string,
        toTrackId:     string,        // may equal fromTrackId
        fromStart:     number,
        toStart:       number,
        snapped:       boolean,       // was snap applied
    },
    priorState: null,                 // pure: inverse derives from payload
    reversible: 'pure',
    timestamp: Date.now(),
    source: 'user-drag',
}
```

**Inverse:** swap `fromX` and `toX` fields. Host's `onApply(op, 'backward')` reads `fromTrackId, fromStart`; forward reads `toTrackId, toStart`.

### §1.6.2 — `item-deleted` (snapshot)

Emitted on click of the × button on an item, or on Backspace/Delete key with item selected.

```javascript
{
    type: 'item-deleted',
    payload: {
        itemId:     string,
        trackId:    string,           // for re-insertion target
    },
    priorState: {
        item: Item,                   // full item record per V.4 schema, including ALL host-specific fields
        atIndex: number,              // ordinal position within the track's items array
    },
    reversible: 'snapshot',
    timestamp: Date.now(),
    source: 'user-button' | 'user-keyboard',
}
```

**Inverse:** host's `onApply(op, 'backward')` calls its state container's `addItem(priorState.item, payload.trackId, priorState.atIndex)`.

The component does NOT know what fields are on the item. It captures whatever `Item` shape `setProject` gave it. This is why `priorState.item` is opaque from the toolkit's perspective.

### §1.6.3 — `item-split` (snapshot, with new IDs in payload)

Emitted on `S` key with an item selected and the playhead positioned within the item's range.

Per Q4 lock-in: ONE op, snapshot-shaped, with new IDs in payload.

```javascript
{
    type: 'item-split',
    payload: {
        originalItemId: string,
        newItemIds:     [string, string],  // [left-half-id, right-half-id]
        atPosition:     number,            // playhead position when split fired
        trackId:        string,
    },
    priorState: {
        item: Item,                        // the un-split item
        atIndex: number,
    },
    reversible: 'snapshot',
    timestamp: Date.now(),
    source: 'user-keyboard',
}
```

**Forward apply (`onApply(op, 'forward')`):** host removes original item, adds two new items with `newItemIds[0]` and `newItemIds[1]`, where the left-half spans `[item.start, atPosition]` and the right-half spans `[atPosition, item.end]`. The two new items inherit ALL fields of the original except `id`, `start`, `end`. Host-specific fields (e.g. `inPoint`/`outPoint` for video) need host-specific split logic — toolkit doesn't know about them, host's `onApply` does.

**Backward apply:** host removes both items by `newItemIds`, restores the original item at `atIndex` from `priorState.item`.

**Why new IDs are in payload, not priorState.** Forward apply needs to *assign* the IDs (so they're stable across replay); backward apply needs to *find* the items by ID (so it can delete them). Both need them. Payload is symmetric; priorState describes only the un-split state.

### §1.6.4 — `track-remove-requested` (snapshot)

Emitted on click of × button on a lane header.

```javascript
{
    type: 'track-remove-requested',
    payload: {
        trackId:   string,
    },
    priorState: {
        track:     Track,             // full Track record per V.4
        items:     Item[],            // all items that were on the track
        atIndex:   number,            // ordinal position in tracks array
    },
    reversible: 'snapshot',
    timestamp: Date.now(),
    source: 'user-button',
}
```

**Memory cost:** if the track had 100 items, this op carries 100 items. If hosts care about memory, they coalesce track-remove with item-removes upstream — but for this v0.1.0, the snapshot-the-whole-track approach is correct because partial undo (restore track-frame but lose items) would be confusing UX.

### §1.6.5 — Noisy ops (selection, scrub, paste-request)

These do NOT enter the undo stack by default (per M.6). They ARE emitted because hosts may want them for replay/observation.

```javascript
// item-selected
{
    type: 'item-selected',
    payload: {itemId: string | null, priorItemId: string | null},
    priorState: null,
    reversible: 'noisy',
    timestamp: Date.now(),
    source: 'user-button',
}

// playhead-changed (during scrub; emitted on every position change, can be high-frequency)
{
    type: 'playhead-changed',
    payload: {fromPosition: number, toPosition: number},
    priorState: null,
    reversible: 'noisy',
    timestamp: Date.now(),
    source: 'user-drag',
}
```

**Performance note for noisy events:** because `playhead-changed` can fire 60+ times/second during a scrub, the host SHOULD debounce or coalesce them if it's logging. sg-history v0.1.0 drops them by default so they don't accumulate. If a host enables `captureNoisy: true`, expect log size to grow rapidly.

## §1.7 — Integration patterns

### §1.7.1 — Minimum integration (no undo)

```javascript
// In the host tool's entry:
const trackStrip = document.querySelector('sg-track-strip');
trackStrip.setProject({tracks: this._state.tracks});

// Listen for any user action and update state:
trackStrip.addEventListener('sg-track-strip:item-moved', (e) => {
    const {itemId, toTrackId, toStart} = e.detail.op.payload;
    this._state.moveItem(itemId, toTrackId, toStart);
    trackStrip.setItems({[toTrackId]: this._state.getTrackItems(toTrackId)});
});
```

This works. It's also missing undo, replay, persistence, telemetry — every op feature. Useful for prototypes only.

### §1.7.2 — Standard integration (with sg-history)

```javascript
// In the host tool's entry:
const trackStrip = document.querySelector('sg-track-strip');
trackStrip.setProject({tracks: this._state.tracks});

const history = createHistory({
    eventTarget: trackStrip,
    onApply: (op, direction) => this._applyOp(op, direction),
});

// Generic op-event listener:
const eventTypes = SGTS_EVENTS.values;       // all 20 event names
eventTypes.forEach(name => {
    trackStrip.addEventListener(name, (e) => {
        history.record(e.detail.op);          // sg-history routes by category
    });
});

// _applyOp dispatches by op.type:
_applyOp(op, direction) {
    const handler = OP_HANDLERS[op.type];      // one function per op type
    handler(this._state, op, direction);
    // After state changes, re-render the affected portion:
    if (op.payload.trackId) {
        trackStrip.setItems({[op.payload.trackId]: this._state.getTrackItems(op.payload.trackId)});
    }
}
```

The host has ~20 op-handler functions, one per op-type. Each is small (10–30 lines). Cleaner than the existing video-editor's mutation pipeline because every handler has a forward-direction case and a backward-direction case in one place.

### §1.7.3 — Full integration (sg-history + telemetry + persistence)

```javascript
// In the host tool's entry:
const trackStrip = document.querySelector('sg-track-strip');
const history    = createHistory({
    eventTarget: trackStrip,
    onApply: (op, direction) => this._applyOp(op, direction),
    onSideEffect: async (op, direction) => this._handleSideEffects(op, direction),
    onSnapshot: () => this._snapshotState(),
});

// Telemetry — log every op (including noisy ones the host wants):
trackStrip.addEventListener('*', (e) => {
    if (e.detail?.op) telemetry.recordOp(e.detail.op);
});

// On save: include op log in the envelope:
async save() {
    await saveProject({
        project:  this._state.getProject(),
        ui:       this._captureUiState(),
        ops:      history.getOps(),
        slug:     this._slug,
    });
}
```

## §1.8 — Edge cases and constraints

### §1.8.1 — Numeric axis bounds

- `start` and `end` are non-negative numbers (toolkit assumes; if hosts pass negatives, the toolkit clamps to 0 for rendering only — the underlying value in state is preserved).
- `start <= end` is REQUIRED. If `start > end`, the toolkit logs a warning to console and renders the item with `width: var(--sgts-min-item-width)` (default 2px) at the `start` position.
- Items with `end - start < (1 / pxPerSecond)` (sub-pixel duration) render at the minimum width. NO error.

### §1.8.2 — Item count

- Designed for ≤ 1,000 items per track without performance degradation.
- 10,000 items per track: works but slow on low-end devices. Hosts SHOULD virtualize via `setItems` paging if approaching this.
- > 100,000 items: not supported in v0.1.0.

### §1.8.3 — Track count

- Designed for ≤ 50 tracks visible at once.
- More tracks: works but the lane-container scrolls. No virtualization; out of scope for v0.1.0.

### §1.8.4 — Drag during data refresh

If `setItems(...)` is called mid-drag (e.g. autosave triggered a re-fetch), the drag MUST continue based on the original drag start state. The component caches `_dragState.startValue` and uses it through to drag-end. The ONLY way a drag aborts mid-flight is if the user releases the mouse outside the window (in which case `mouseleave` triggers cancellation).

### §1.8.5 — Locked tracks

- Lane lock (`track.locked = true`) prevents items on that track from being dragged, trimmed, or deleted.
- Lock toggle itself emits `track-lock` op (pure).
- Locked-track items show with `opacity: 0.6` and `cursor: not-allowed`.

### §1.8.6 — Muted tracks

- `track.muted = true` is purely informational from the toolkit's perspective. Visually: lane label gets a "muted" class. No interaction restrictions.
- Mute toggle emits `track-mute` op (pure).
- Hosts that want to silence audio render to muted tracks read `track.muted` and apply at their layer.

## §1.9 — DO NOT

### §1.9.1 — Do NOT emit ops from imperative setters

`setProject(...)`, `setItems(...)`, `setSelectedItem(...)` etc. do NOT emit ops. M.11 from doc 03. This is the most common Sonnet drift pattern and would break undo/replay.

### §1.9.2 — Do NOT mutate the `Item` or `Track` objects passed by the host

Toolkit consumes the project shape; host owns it. If the toolkit needs to track derived state (e.g. selection), it stores it in private fields. Mutating `tracks[0].items[0].start` from inside the toolkit is a bug — the host's state container won't see the mutation, and the next `setProject` will overwrite it.

### §1.9.3 — Do NOT depend on knowing what's in `Item.<host-specific>` fields

If you find yourself writing `if (item.assetId) { ... }` or `if (item.kind === 'video') { ... }` inside the toolkit, STOP. That's leakage. The toolkit knows `id`, `start`, `end`, `color`, `label`. Everything else is opaque.

### §1.9.4 — Do NOT add a new event without updating V.2.1 in the README

Events are vocabulary. Adding `sg-track-strip:something-new` requires:
1. Updating `sg-track-strip-events.js` to export the new constant
2. Updating V.2.1 in the README with the event spec
3. Updating `manifest.json`'s `ops.emits` if the event is op-shaped
4. Updating SKILL__api.md
5. Updating doc 04 verification checklist if the event needs coverage

### §1.9.5 — Do NOT emit ops with undefined `priorState` for snapshot ops

`priorState: null` for pure ops. `priorState: {...}` for snapshot ops. `priorState: undefined` is a bug. Per M.7.

### §1.9.6 — Do NOT call `sg-history` from inside the component

Components emit ops; hosts route them. M.8 from doc 03. The component must not import `sg-history` at all.

### §1.9.7 — Do NOT ignore `kind` field in tracks; pass it through

The toolkit doesn't *use* `track.kind` for filtering or behaviour. It DOES pass it through to events (e.g. `track-add-requested` payload includes a `kind?` if the host requested it). Don't strip it. Don't transform it. The host owns its meaning.

## §1.10 — Verification touchpoints (doc 04)

This component covers the following items in the verification checklist:

- §A.1 — sandbox mode "Video" works
- §A.2 — sandbox mode "Audio" works
- §A.3 — sandbox mode "Gantt" works
- §A.4 — sandbox mode "Log" works (point-in-time items)
- §A.5 — sandbox mode "Animation" works
- §A.6 — fuzz mode survives 1000 items
- §A.7 — no `assetId` / `inPoint` / `outPoint` strings in toolkit source
- §B.1–B.20 — all behaviour-preservation items for sg-video-editor (each maps to one or more events)
- §C.1 — multi-track-rearrangement: drag item from Track 1 to Track 3
- §C.2 — undo restores prior state for every op category
- §D.5 — manifest declares every op type in V.2.1

---

# §2 — `<sg-toolbar>` (Web Component)

## §2.1 — Identity

| Field | Value |
|---|---|
| Tag | `<sg-toolbar>` |
| Type | Web Component, extends `SgComponent` |
| Path | `components/sg-toolbar/v0/v0.1/v0.1.0/` |
| Version | `v0.1.0` |
| Files | `sg-toolbar.html`, `sg-toolbar.css`, `sg-toolbar.js`, `sg-toolbar-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md` |
| LOC budget | 200 hard / 250 soft (per F.1; smaller than track-strip) |

## §2.2 — Purpose

A registered-button toolbar. Hosts call `addButton(spec)` to add buttons; the component renders them in declaration order with consistent styling, keyboard shortcuts, and tooltip support. Supports button groups (separator lines), popovers (button-anchored floating panels), and active-state toggling.

Per Q6 lock-in: imperative-only registration. No declarative `<sg-toolbar-button>` element. Hosts that want declarative wrap it themselves.

## §2.3 — Public API

### §2.3.1 — Methods (V.3.2)

```javascript
addButton({
    id:           string,                   // unique within toolbar
    label:        string,                   // visible text or aria-label if icon-only
    icon?:        string,                   // optional icon name (host-defined)
    tooltip?:     string,                   // default: label
    group?:       string,                   // groups buttons with same id; separator between groups
    active?:      boolean,                  // default false; toggle state
    disabled?:    boolean,                  // default false
    popoverId?:   string,                   // if set, click opens the registered popover
    shortcut?:    string,                   // e.g. 'Cmd+Z'; component handles keydown
    order?:       number,                   // explicit ordering within group; default = registration order
}): void

removeButton(id: string): void
setButtonActive(id: string, active: boolean): void
setButtonDisabled(id: string, disabled: boolean): void
setButtonLabel(id: string, label: string): void
setButtonTooltip(id: string, tooltip: string): void

addSeparator(group?: string): void          // explicit visual separator

addPopover({
    id:                 string,
    anchorButtonId:     string,             // button that opens this popover
    contentEl:          HTMLElement,        // host-supplied content element
    placement?:         'below'|'above'|'right'|'left',  // default 'below'
    closeOnDocumentClick?: boolean,         // default true
    closeOnEscape?:     boolean,            // default true
}): void

removePopover(id: string): void
openPopover(id: string): void
closePopover(id: string): void

isPopoverOpen(id: string): boolean
getRegisteredButtonIds(): string[]
```

### §2.3.2 — Events (V.2.2)

```javascript
'sg-toolbar:button-clicked'  // payload: {buttonId, groupId?}, reversible: 'noisy'
'sg-toolbar:popover-opened'  // payload: {popoverId}, reversible: 'noisy'
'sg-toolbar:popover-closed'  // payload: {popoverId, reason: 'select'|'dismiss'|'blur'}, reversible: 'noisy'
```

All toolbar events are noisy — they trigger downstream actions (which emit their own ops) but the click itself isn't a state change.

### §2.3.3 — Manifest `ops.emits`

```json
{"ops": {"emits": [
    {"type": "button-clicked",  "reversible": "noisy"},
    {"type": "popover-opened",  "reversible": "noisy"},
    {"type": "popover-closed",  "reversible": "noisy"}
]}}
```

## §2.4 — State model

```javascript
{
    _buttons: Map<string, ButtonSpec>,      // insertion-ordered
    _separators: Set<string>,               // group IDs that have explicit separators after them
    _popovers: Map<string, PopoverSpec>,
    _openPopoverId: string | null,          // at most one popover open at a time
}
```

### §2.4.1 — Registration timing

Hosts register buttons in their own `connectedCallback` AFTER `customElements.whenDefined('sg-toolbar')` resolves. Registering before this throws an error.

Pattern:
```javascript
connectedCallback() {
    super.connectedCallback();
    customElements.whenDefined('sg-toolbar').then(() => {
        const tb = this.shadowRoot.querySelector('sg-toolbar');
        tb.addButton({id: 'undo', label: 'Undo', shortcut: 'Cmd+Z'});
        tb.addButton({id: 'redo', label: 'Redo', shortcut: 'Cmd+Shift+Z'});
        tb.addSeparator();
        tb.addButton({id: 'split', label: 'Split', shortcut: 'S'});
    });
}
```

### §2.4.2 — Multi-instance safety

Multiple `<sg-toolbar>` instances on the same page are independent. Buttons registered on one don't appear on another. Keyboard shortcuts ARE scoped to the toolbar's containing tool — see §2.6.

## §2.5 — Rendering model

### §2.5.1 — Shadow DOM

```html
<div class="toolbar" part="toolbar" role="toolbar">
    <button class="toolbar-button" data-button-id="..." part="button">
        <span class="button-icon" hidden></span>
        <span class="button-label">Undo</span>
    </button>
    <div class="separator" data-group-id="..."></div>
    ...
    <div class="popover" data-popover-id="..." hidden>
        <slot name="popover-content"></slot>
    </div>
</div>
```

### §2.5.2 — Active state

Buttons with `active: true` get class `.is-active` on their button element. CSS variable `--sgtb-active-bg` (default: `var(--sg-color-teal-soft)`) controls the visual.

### §2.5.3 — Disabled state

Buttons with `disabled: true` get attribute `disabled`. Click handler short-circuits — no event fires. Visual via `:disabled` selector.

### §2.5.4 — Popover positioning

The toolbar uses CSS anchored positioning where supported, with a JS fallback. The popover's anchor is the button identified by `anchorButtonId`.

## §2.6 — Keyboard shortcuts

Per V.3.2, the toolbar accepts `shortcut` strings on registered buttons. The component listens for `keydown` on `document` (NOT just on its shadow root, because shortcuts must work even when the toolbar isn't focused).

**Shortcut format.** `'Cmd+Z'`, `'Cmd+Shift+Z'`, `'S'`, `'Space'`, `'ArrowLeft'`. Modifier keys: `Cmd` (maps to Meta on Mac, Ctrl on Win/Linux), `Ctrl` (always Ctrl), `Shift`, `Alt`.

**Conflict resolution.** If two buttons register the same shortcut, the second registration logs a warning to console and the first wins.

**Scope.** Shortcuts fire if and only if:
1. The active element is NOT an input/textarea/contenteditable.
2. The active element IS within the toolbar's containing root (i.e. the tool's shadow root tree).

The component finds its containing root via `getRootNode()` walks up the shadow DOM chain.

**Anti-pattern.** Tools that have multiple toolbars and want non-conflicting shortcuts should use distinct shortcut prefixes (e.g. `'Cmd+1'`, `'Cmd+2'`). The toolkit doesn't auto-namespace.

## §2.7 — Integration patterns

### §2.7.1 — Wiring undo/redo to sg-history

```javascript
// In the host tool's entry:
const toolbar = this.shadowRoot.querySelector('sg-toolbar');
const history = createHistory({...});

toolbar.addButton({id: 'undo', label: 'Undo', shortcut: 'Cmd+Z'});
toolbar.addButton({id: 'redo', label: 'Redo', shortcut: 'Cmd+Shift+Z'});

toolbar.addEventListener('sg-toolbar:button-clicked', (e) => {
    const {buttonId} = e.detail.op.payload;
    if (buttonId === 'undo') history.undo();
    if (buttonId === 'redo') history.redo();
});

// React to history bounds changing:
history.getEventTarget().addEventListener('sg-history:bounds-changed', (e) => {
    const {canUndo, canRedo} = e.detail.op.payload;
    toolbar.setButtonDisabled('undo', !canUndo);
    toolbar.setButtonDisabled('redo', !canRedo);
});
```

### §2.7.2 — Popover for color picker

```javascript
const colorPickerEl = document.createElement('sg-color-picker');  // host-supplied
toolbar.addButton({id: 'color', label: 'Color', popoverId: 'color-popover'});
toolbar.addPopover({
    id: 'color-popover',
    anchorButtonId: 'color',
    contentEl: colorPickerEl,
});

colorPickerEl.addEventListener('color-selected', (e) => {
    // host applies color, emits the appropriate item-color op via sg-track-strip
    toolbar.closePopover('color-popover');
});
```

## §2.8 — Edge cases and constraints

- Maximum buttons: ~50 in v0.1.0. Beyond this the toolbar overflows; no scroll handling. Hosts SHOULD use button groups + popover-style overflow if approaching.
- Maximum popovers open: 1. Opening a second auto-closes the first.
- Maximum separators: unbounded.
- Shortcut conflicts with browser shortcuts (Cmd+W, Cmd+T, Cmd+R) are NOT intercepted.

## §2.9 — DO NOT

- Do NOT register buttons before `customElements.whenDefined('sg-toolbar')` resolves
- Do NOT use the same `id` for two buttons (fails silently; the second registration overwrites the first)
- Do NOT bind shortcuts to keys without testing on Windows AND Mac (`Cmd` resolves differently)
- Do NOT emit ops directly from inside the toolbar — buttons emit `button-clicked` (noisy); the host's button handler is what emits the actual state-change op via the relevant component

## §2.10 — Verification touchpoints

- §A.7 (no host-specific button IDs in toolkit code)
- §B.5–B.7 (toolbar buttons in sg-video-editor v0.1.55 wire correctly)
- §C.3 (registration order matches render order)

---

# §3 — `<sg-asset-panel>` (Web Component)

## §3.1 — Identity

| Field | Value |
|---|---|
| Tag | `<sg-asset-panel>` |
| Type | Web Component, extends `SgComponent` |
| Path | `components/sg-asset-panel/v0/v0.1/v0.1.0/` |
| Version | `v0.1.0` |
| Files | `sg-asset-panel.html`, `sg-asset-panel.css`, `sg-asset-panel.js`, `sg-asset-panel-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md` |
| LOC budget | 200 hard / 250 soft |

## §3.2 — Purpose

A scrollable list of host-defined assets. Each asset shows a host-provided label (typically filename) plus optional thumbnail/icon. Supports drag-out (to drop on track-strip), file-drop-in (uploads), select, and delete.

The component knows nothing about what an asset IS. It knows: id, name, optional thumbnail URL, optional missing-flag. Everything else (mimeType, blob, dimensions, duration, etc.) is host territory.

## §3.3 — Public API

### §3.3.1 — Methods (V.3.3)

```javascript
setAssets(assets: Asset[]): void          // imperative — no ops
setSelectedAsset(assetId: string | null): void
setDragMime(mime: string): void           // host-supplied; e.g. 'application/x-sg-asset'
setMissingAssets(assetIds: string[]): void  // shows missing-blob badge
setEmptyMessage(message: string): void   // default 'No assets yet.'
```

### §3.3.2 — Events (V.2.3)

All op-shaped per V.2.

```javascript
'sg-asset-panel:asset-add-requested'   // {file, suggestedAssetId}, with-side-effects
'sg-asset-panel:asset-remove-requested' // {assetId}, with-side-effects
'sg-asset-panel:asset-drag-started'    // {assetId, mime}, noisy
'sg-asset-panel:asset-drag-ended'      // {assetId, accepted}, noisy
'sg-asset-panel:asset-selected'        // {assetId, priorAssetId}, noisy
```

### §3.3.3 — Manifest `ops.emits`

```json
{"ops": {"emits": [
    {"type": "asset-add-requested",    "reversible": "with-side-effects"},
    {"type": "asset-remove-requested", "reversible": "with-side-effects"},
    {"type": "asset-drag-started",     "reversible": "noisy"},
    {"type": "asset-drag-ended",       "reversible": "noisy"},
    {"type": "asset-selected",         "reversible": "noisy"}
]}}
```

## §3.4 — State model

```javascript
{
    _assets: Asset[],                       // last value passed to setAssets
    _selectedAssetId: string | null,
    _dragMime: string,                      // default 'application/x-sg-asset'
    _missingAssetIds: Set<string>,
    _emptyMessage: string,
    
    _dragState: null | {
        assetId: string,
        startedAt: number,
    },
}
```

## §3.5 — Rendering model

```html
<div class="panel" part="panel">
    <div class="dropzone" part="dropzone">
        <div class="dropzone-message">Drop video or image files here or</div>
        <button class="choose-files">Choose files</button>
    </div>
    <ul class="asset-list">
        <li class="asset-row" data-asset-id="..." draggable="true">
            <img class="asset-thumb" src="...">
            <span class="asset-name">voiceover.mp4</span>
            <span class="asset-missing-badge" hidden>missing</span>
            <button class="asset-remove">×</button>
        </li>
    </ul>
    <div class="empty-message" hidden>No assets yet.</div>
</div>
```

## §3.6 — Drag-out behaviour

When a user drags an asset row, the component sets `dataTransfer` MIME to `_dragMime` and the data to `assetId`. Drop targets (typically `<sg-track-strip>`) read this and act accordingly.

The component does NOT know what happens when the drop succeeds — it just emits `asset-drag-ended` with `accepted: <true|false>` based on `dataTransfer.dropEffect`.

## §3.7 — Drag-in (file drop) behaviour

When a file is dropped onto the dropzone (or the panel itself), the component:
1. Calls `crypto.randomUUID()` to suggest an asset ID
2. Emits `asset-add-requested` with the File object and the suggested ID
3. Does NOT update internal state — the host is responsible for calling `setAssets(updated)` after the upload completes

This means the asset doesn't appear in the panel until the host completes the upload-and-register flow. Which is correct — premature display would be lying.

**The host's flow:**
```javascript
panel.addEventListener('sg-asset-panel:asset-add-requested', async (e) => {
    const {file, suggestedAssetId} = e.detail.op.payload;
    
    // 1. Allocate the side effect (write blob to IDB):
    await this._assetStorage.writeBlob(suggestedAssetId, file);
    
    // 2. Update host state with the new asset record:
    this._state.addAsset({
        id: suggestedAssetId,
        name: file.name,
        mimeType: file.type,
        // host-specific fields:
        dimensions: await this._probeDimensions(file),
    });
    
    // 3. Re-render:
    panel.setAssets(this._state.assets);
    
    // 4. Op-event was already routed to sg-history; sg-history's onSideEffect
    //    will be called on undo and roll back the IDB blob.
});
```

## §3.8 — Edge cases

- **Many assets:** the asset list is virtualizable but v0.1.0 doesn't virtualize. Up to ~500 assets at acceptable performance.
- **Asset without thumbnail:** falls back to a generic icon based on host-provided `kind` field (toolkit doesn't define this).
- **Missing blob:** asset still shows in the list, but with `missing` badge. Host calls `setMissingAssets([...])` after `loadProject` returns missing IDs.

## §3.9 — DO NOT

- Do NOT decode the File object inside the component (no `URL.createObjectURL`, no FileReader). The host owns blob handling.
- Do NOT emit `asset-add-requested` from `setAssets(...)` — that's state restoration (M.11).
- Do NOT assume the host's drag-MIME is the toolkit default. Hosts override via `setDragMime`.

## §3.10 — Verification touchpoints

- §B.8–B.10 (asset upload, asset removal, asset listing in v0.1.55)
- §C.4 (cross-tool drag-drop: drag from sg-asset-panel to sg-track-strip)

---

# §4 — `<sg-properties-panel>` (Web Component)

## §4.1 — Identity

| Field | Value |
|---|---|
| Tag | `<sg-properties-panel>` |
| Type | Web Component, extends `SgComponent` |
| Path | `components/sg-properties-panel/v0/v0.1/v0.1.0/` |
| Version | `v0.1.0` |
| Files | `sg-properties-panel.html`, `sg-properties-panel.css`, `sg-properties-panel.js`, `sg-properties-panel-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md` |
| LOC budget | 250 hard / 300 soft |

## §4.2 — Purpose

A sectioned key-value editor. Hosts call `addSection({id, title, fields})` to add sections; each section contains an array of typed fields (text, number, select, color, checkbox, button). Used for property panels (per-item / per-track), config panels (via `sg-config`'s `toFields()`), and any other "edit this thing" UI.

This is the most-reused component in the toolkit. Three of the five right-rail tabs in v0.1.54's video editor (Properties, Config, possibly Perf) ARE instances of this in v0.1.55.

## §4.3 — Public API

### §4.3.1 — Methods (V.3.4)

```javascript
addSection({
    id:          string,
    title:       string,                    // displayed as section header
    fields:      Field[],
    description?: string,                   // small text under title
    collapsible?: boolean,                  // default false
    collapsed?:   boolean,                  // default false; only meaningful if collapsible
    order?:      number,                    // display order; default = registration order
}): void

removeSection(id: string): void
setSectionFields(id: string, fields: Field[]): void
setFieldValue(sectionId: string, fieldId: string, value: any): void
setSectionVisible(id: string, visible: boolean): void
setSectionCollapsed(id: string, collapsed: boolean): void
clearAllSections(): void

getSectionIds(): string[]
getFieldValue(sectionId: string, fieldId: string): any
```

### §4.3.2 — Field types (V.4 expanded)

```javascript
Field = {
    id:           string,
    type:         'text' | 'number' | 'select' | 'color' | 'checkbox' | 'button',
    label:        string,
    value:        any,                      // see per-type below
    description?: string,                   // small text under label
    readonly?:    boolean,
    disabled?:    boolean,
    
    // type: 'select' specific:
    options?:    Array<{value: any, label: string}>,
    
    // type: 'number' specific:
    min?:         number,
    max?:         number,
    step?:        number,
    unit?:        string,                   // displayed after the input, e.g. 'px', 's'
    
    // type: 'text' specific:
    placeholder?: string,
    multiline?:   boolean,                  // textarea vs input
    
    // type: 'color' specific:
    showAlpha?:   boolean,                  // default false
    
    // type: 'button' specific:
    buttonStyle?: 'primary' | 'secondary' | 'danger',  // default 'secondary'
}
```

### §4.3.3 — Events (V.2.4)

```javascript
'sg-properties-panel:field-changed'   // {sectionId, fieldId, fromValue, toValue}, pure
'sg-properties-panel:section-action'  // {sectionId, actionId}, noisy
'sg-properties-panel:section-toggled' // {sectionId, fromCollapsed, toCollapsed}, noisy
```

Per Q3b lock-in: Field type `'button'` does NOT emit `field-changed`. It emits `section-action` with `actionId === fieldId`.

### §4.3.4 — Manifest `ops.emits`

```json
{"ops": {"emits": [
    {"type": "field-changed",    "reversible": "pure"},
    {"type": "section-action",   "reversible": "noisy"},
    {"type": "section-toggled",  "reversible": "noisy"}
]}}
```

## §4.4 — State model

```javascript
{
    _sections: Map<string, SectionSpec>,    // insertion-ordered
    _focusedField: {sectionId: string, fieldId: string} | null,
}
```

Field values are stored on the SectionSpec, not duplicated in component state. The current value of `tracks[0].name` field is `_sections.get('item-properties').fields.find(f => f.id === 'name').value` — which is updated when `setFieldValue` is called.

## §4.5 — Rendering model

```html
<div class="panel" part="panel">
    <section class="section" data-section-id="...">
        <header class="section-header">
            <h3 class="section-title">CONFIG</h3>
            <button class="section-toggle" hidden>▼</button>
        </header>
        <div class="section-description" hidden></div>
        <div class="section-fields">
            <div class="field" data-field-id="...">
                <label class="field-label">Autosave</label>
                <input type="checkbox" class="field-input">
                <p class="field-description">Debounced autosave to localStorage / IDB after mutations.</p>
            </div>
            ...
        </div>
    </section>
    <section class="section" data-section-id="...">
        ...
    </section>
</div>
```

## §4.6 — Field-change semantics

When a field's input changes (input committed via blur, Enter, or value change for instant types like checkboxes):

1. Component captures `fromValue` (previous value)
2. Updates `_sections.get(sectionId).fields.find(...).value = newValue`
3. Emits `field-changed` op with `payload: {sectionId, fieldId, fromValue, toValue}`
4. Re-renders only the field affected (not the whole section)

**Per Q3a lock-in:** `fromValue` and `toValue` MAY be nested objects. The host is responsible for ensuring they're JSON-serialisable.

**Idempotency on undo.** When `onApply(op, 'backward')` calls `setFieldValue(sectionId, fieldId, fromValue)`, the component MUST NOT re-emit `field-changed`. M.11 — imperative state restoration.

## §4.7 — Integration patterns

### §4.7.1 — Properties panel for selected item (sg-video-editor v0.1.55 pattern)

```javascript
const props = this.shadowRoot.querySelector('sg-properties-panel#properties');

trackStrip.addEventListener('sg-track-strip:item-selected', (e) => {
    const {itemId} = e.detail.op.payload;
    const item = this._state.findItem(itemId);
    
    if (!item) {
        props.clearAllSections();
        return;
    }
    
    props.clearAllSections();
    props.addSection({
        id: 'transform',
        title: 'TRANSFORM',
        fields: [
            {id: 'x',     type: 'number', label: 'X', value: item.transform?.x ?? 0, unit: 'px'},
            {id: 'y',     type: 'number', label: 'Y', value: item.transform?.y ?? 0, unit: 'px'},
            {id: 'scale', type: 'number', label: 'Scale', value: item.transform?.scale ?? 1, step: 0.1},
        ],
    });
});

props.addEventListener('sg-properties-panel:field-changed', (e) => {
    const {sectionId, fieldId, fromValue, toValue} = e.detail.op.payload;
    if (sectionId === 'transform') {
        // host maps to its domain: e.g. updates _state.findItem(selectedId).transform[fieldId]
        // sg-history records the op (already routed via the standard pipeline)
    }
});
```

### §4.7.2 — Config panel via sg-config (v0.1.55 pattern)

```javascript
const props = this.shadowRoot.querySelector('sg-properties-panel#config');
const config = createConfig({
    namespace: 'sgve',
    schema: {
        'preview-composer': {type: 'boolean', default: false, label: 'Preview / Composer', description: 'Rebuild composer on every state change. Disable first when diagnosing memory issues.'},
        'timeline-renders': {type: 'boolean', default: true,  label: 'Timeline renders'},
        'autosave':         {type: 'boolean', default: false, label: 'Autosave'},
        'memory-probe':     {type: 'boolean', default: false, label: 'Memory probe', debug: true},
        'log-level':        {type: 'select',  default: 'verbose', label: 'Log level',
                             options: [{value: 'silent', label: 'silent'}, {value: 'verbose', label: 'verbose'}]},
    },
});

props.addSection({id: 'config', title: 'CONFIG',
    fields: config.toFields({includeDebug: false}),
});

props.addEventListener('sg-properties-panel:field-changed', (e) => {
    const {sectionId, fieldId, toValue} = e.detail.op.payload;
    if (sectionId === 'config') {
        config.set(fieldId, toValue);
    }
});
```

## §4.8 — Edge cases

- Field with `readonly: true`: input is disabled but visible. Edit attempt does nothing.
- Field with `type: 'number'` and `min/max`: HTML5 validation, but values outside bounds are still emitted (host can clamp/reject). Toolkit doesn't enforce.
- Field with `type: 'button'`: rendered as button, on click emits `section-action` with `actionId === fieldId`.
- Nested objects as `value`: rendered as JSON via `<sg-json-viewer>` (if available) or as collapsed JSON text. Editing nested objects requires the host to wrap them in custom field types — out of scope for v0.1.0.

## §4.9 — DO NOT

- Do NOT include unsanitized HTML in `label` or `description`. The component renders these as text content, but a Sonnet implementer might be tempted to use innerHTML. Don't.
- Do NOT call `setFieldValue` from inside a `field-changed` event handler — infinite loop (the imperative call is fine on its own; the loop arises if you echo the event).
- Do NOT mutate the `Field` object passed to `addSection` after registration. Use `setFieldValue` to update.

## §4.10 — Verification touchpoints

- §B.11–B.13 (properties panel in v0.1.55)
- §B.14 (config panel in v0.1.55, replacing the bespoke Config tab)
- §C.5 (selecting an item updates properties)
- §D.1 (sg-config integration verified)

---

# §5 — `<sg-player-transport>` (Web Component)

## §5.1 — Identity

| Field | Value |
|---|---|
| Tag | `<sg-player-transport>` |
| Type | Web Component, extends `SgComponent` |
| Path | `components/sg-player-transport/v0/v0.1/v0.1.0/` |
| Version | `v0.1.0` |
| Files | `sg-player-transport.html`, `sg-player-transport.css`, `sg-player-transport.js`, `sg-player-transport-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md` |
| LOC budget | 200 hard / 250 soft |

## §5.2 — Purpose

The transport bar (play, pause, prev, next, scrubber, time display) plus a slot for the host's actual playback surface (video canvas, audio waveform, animation viewport, etc.). Decouples "playback controls" from "what's being played."

The transport controls a `Playable` interface — anything that can play, pause, seek, and report its own position/duration/state. The toolkit doesn't know about audio or video; it knows about Playables.

## §5.3 — Public API

### §5.3.1 — `Playable` interface (the host implements this)

```javascript
Playable = {
    play(): void
    pause(): void
    seek(position: number): void
    refresh(): void                       // host re-fetches/re-renders content
    getCurrentPosition(): number
    getDuration(): number
    
    // Dispatches on its own host element (not on the playable itself):
    //   'sg-playable:position-changed' detail: {position}
    //   'sg-playable:state-changed'    detail: {state: 'playing'|'paused'|'ended'}
    //   'sg-playable:duration-changed' detail: {duration}
}
```

### §5.3.2 — Methods (V.3.5)

```javascript
attachPlayable(playable: Playable): void
detachPlayable(): void
setPosition(position: number): void
setDuration(duration: number): void
setEnabled(enabled: boolean): void
setSurfaceSlot(element: HTMLElement): void  // host-supplied playback surface
```

### §5.3.3 — Events (V.2.5)

All noisy.

```javascript
'sg-player-transport:play-requested'      // {}, noisy
'sg-player-transport:pause-requested'     // {}, noisy
'sg-player-transport:seek-requested'      // {fromPosition, toPosition}, noisy
'sg-player-transport:refresh-requested'   // {}, noisy
'sg-player-transport:position-changed'    // {fromPosition, toPosition}, noisy (re-broadcast from playable)
'sg-player-transport:state-changed'       // {fromState, toState}, noisy (re-broadcast from playable)
```

### §5.3.4 — Manifest `ops.emits`

All noisy. Transport ops aren't part of project state; they're playback control.

## §5.4 — State model

```javascript
{
    _playable: Playable | null,
    _position: number,
    _duration: number,
    _state: 'playing' | 'paused' | 'ended',
    _enabled: boolean,
}
```

## §5.5 — Rendering model

```html
<div class="transport" part="transport">
    <div class="surface-slot">
        <slot name="surface"></slot>            <!-- host-supplied playback surface -->
    </div>
    <div class="controls" part="controls">
        <button class="btn-prev">⏮</button>
        <button class="btn-play-pause">▶</button>
        <button class="btn-next">⏭</button>
        <button class="btn-refresh">↻</button>
        <span class="time-display">00:00 / 00:00</span>
        <input type="range" class="scrubber" min="0" max="100" value="0">
    </div>
</div>
```

## §5.6 — Time formatting

The component uses MM:SS for durations under 1 hour, HH:MM:SS otherwise. Configurable via `--sgpt-time-format` future addition (out of scope for v0.1.0).

## §5.7 — Integration with sg-video-editor v0.1.55

The host implements a `Playable` wrapper around the existing video composer:

```javascript
class VideoComposerPlayable {
    constructor(composer, hostEl) {
        this._composer = composer;
        this._hostEl = hostEl;
    }
    play()    { this._composer.play(); }
    pause()   { this._composer.pause(); }
    seek(p)   { this._composer.seekTo(p); }
    refresh() { this._composer.rebuild(); }
    getCurrentPosition() { return this._composer.currentTime; }
    getDuration()        { return this._composer.totalDuration; }
}

const playable = new VideoComposerPlayable(this._composer, this);
this.shadowRoot.querySelector('sg-player-transport').attachPlayable(playable);
```

## §5.8 — DO NOT

- Do NOT make the transport know about video, audio, or any specific media type. It's a Playable.
- Do NOT emit ops on `position-changed` from the playable that aren't `noisy` — playback position is not project state.

## §5.9 — Verification touchpoints

- §B.15–B.17 (playback controls in v0.1.55)
- §A.5 (animation mode in sandbox uses a custom Playable, validates the abstraction)

---

# §6 — `sg-project-storage` (JS module)

## §6.1 — Identity

| Field | Value |
|---|---|
| Name | `sg-project-storage` |
| Type | JS module (no Web Component) |
| Path | `core/sg-project-storage/v0/v0.1/v0.1.0/` |
| Version | `v0.1.0` |
| Files | `sg-project-storage.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md` |
| LOC budget | 600 hard / 700 soft (it's bigger because it covers IDB + localStorage + autosave + race-fixes) |

## §6.2 — Purpose

The save / load / autosave / IDB-blob-storage layer. Generalised from sg-video-editor v0.1.54's combined `state-storage.js` + `state-asset-storage.js` + Round 9-K race-fixes (~600 LOC). All exports are async, host-configurable, and defensive against the autosave-during-clean-save race.

## §6.3 — Public API (V.3.6)

```javascript
saveProject(opts: {
    project:           any,                // host's domain project shape
    slug:              string,             // unique save id
    ui?:               any,                // host-defined UI state
    ops?:              Op[],               // optional: ops since last save
    blobsById?:        Record<string, Blob>,  // map of asset id → blob to persist
    indexKey?:         string,             // localStorage key for the saves index
    projectKeyPrefix?: string,             // prefix for the per-project key
    dbName?:           string,             // IDB database name
    storeName?:        string,             // IDB object-store name
}): Promise<{slug, savedAt, json}>

loadProject(opts: {
    slug:              string,
    indexKey?:         string,
    projectKeyPrefix?: string,
    dbName?:           string,
    storeName?:        string,
}): Promise<{
    project:           any,
    ui:                any | undefined,
    ops:               Op[] | undefined,
    blobsById:         Record<string, Blob>,
    missingBlobIds:    string[],
}>

listSavedProjects(opts: {indexKey?}): Promise<Array<{slug, name, savedAt, byteSize}>>

deleteSavedProject(opts: {
    slug, indexKey?, projectKeyPrefix?, dbName?, storeName?, pruneBlobs?: boolean,
}): Promise<{deleted: boolean, prunedBlobIds: string[]}>

autosave(opts: {
    project, ui?, ops?, blobsById?, slotKey?, dbName?, storeName?,
}): Promise<{savedAt, json}>

getAutosave(opts: {slotKey?}): Promise<{savedAt, project, ui, ops} | null>
discardAutosave(opts: {slotKey?}): Promise<void>
isAutosaveNewer(opts: {savedAt, indexKey?}): Promise<{newer: boolean}>
hydrateBlobs(opts: {assetIds, dbName?, storeName?}): Promise<{blobsById, missingIds}>
pruneOrphanBlobs(opts: {referencedIds, dbName?, storeName?}): Promise<{prunedIds}>
computeStorageUsage(opts?: {
    dbName?, storeName?, indexKey?, projectKeyPrefix?,
}): Promise<{
    totalBytes:           number,
    blobBytes:            number,
    blobCount:            number,
    projectJsonBytes:     number,
    autosaveJsonBytes:    number,
    quotaBytes?:          number,           // navigator.storage.estimate().quota if available
    usagePercent?:        number,           // totalBytes / quotaBytes; for warning thresholds
}>

hashProject(project: any): string         // stable hash for change detection
```

## §6.4 — Save envelope shape

The serialised JSON written to localStorage has this shape:

```json
{
    "schemaVersion": 1,
    "slug":          "my-project",
    "name":          "My Project",
    "savedAt":       1714248000000,
    "project":       { /* host's project shape */ },
    "ui":            { /* host-defined; absent if not saved */ },
    "ops":           [ /* op log; absent if not saved */ ],
    "assetIdRefs":   ["asset-1", "asset-2"]    // asset IDs referenced by this project; for orphan pruning
}
```

The `assetIdRefs` array is computed by `saveProject` from the project shape — it walks the project looking for `assetId` fields. This is the ONE place the toolkit assumes a specific host field name. **This is a deliberate compromise** for compatibility with sg-video-editor v0.1.54's existing structure. Hosts that don't use `assetId` can supply their own `assetIdRefs` via an option (future minor; not in v0.1.0).

## §6.5 — IndexedDB schema

```
Database: <dbName> (default: 'sg-storage')
  ObjectStore: <storeName> (default: 'assets')
    keyPath: 'id'
    Records: {
        id: string,
        blob: Blob,
        mimeType: string,
        savedAt: number,
        byteSize: number,
    }
```

The toolkit creates the database and store on first call to any IDB-touching method. Migration strategy for v0.1.X version bumps: out of scope for v0.1.0 (we're starting fresh; sg-video-editor v0.1.55 keeps the v0.1.54 schema by passing the same `dbName` and `storeName`).

## §6.6 — Autosave race fixes (preserved from Round 9-K)

The autosave logic must handle three race conditions that cost the existing v0.1.54 multiple debugging sessions:

1. **filename-race:** user renames the project, autosave fires before the rename completes, autosave writes to the OLD slug. Fix: autosave uses a snapshot of the slug captured when the autosave timer started, NOT the current slug at write time. Future renames invalidate the in-flight autosave.
2. **beforeunload-after-clean-save:** user saves manually (clean state), then closes the tab; autosave fires on `beforeunload` and writes a save that's identical to or behind the manual save. Fix: `autosave` checks the manual-save's hash via `hashProject` and short-circuits if identical.
3. **autosave-overwrites-newer-manual:** autosave writes after a newer manual save (timing window of ~50ms in slow scripts). Fix: `autosave` checks the index timestamp and refuses to write if a newer save exists.

These fixes are preserved verbatim from sg-video-editor v0.1.54's implementation. The Sonnet implementer of brief 05 reads `state-storage.js` and `state-asset-storage.js` from v0.1.54 in detail and replicates the logic — these are subtle race conditions that should NOT be re-derived.

## §6.7 — Storage warnings

`computeStorageUsage()` returns `usagePercent` if `navigator.storage.estimate()` is available. Hosts surface warnings at:

- **70% (warning):** Display a non-blocking notice in the Config tab: "Storage 70% full. Consider exporting and clearing old saves."
- **90% (urgent):** Display a blocking modal: "Storage 90% full. Some saves may fail. Clear old saves now."

The toolkit does NOT impose these thresholds; it provides the data, the host (or `sg-config`'s schema) wires the UX.

## §6.8 — DO NOT

- Do NOT call `JSON.stringify(blobsById)` — Blobs don't survive serialization.
- Do NOT assume `localStorage` and IDB are available; both can fail in private browsing modes. Wrap calls in try/catch and surface meaningful errors via the returned Promise.
- Do NOT call `saveProject` and `autosave` concurrently for the same project. The Round 9-K race-fixes assume serialisation; concurrent calls bypass them.
- Do NOT modify the `assetIdRefs` walking logic without a specific reason; sg-video-editor v0.1.55 depends on it.

## §6.9 — Verification touchpoints

- §B.18 (saved-project-load round-trip)
- §B.19 (autosave preserves work after crash)
- §B.20 (orphan-blob pruning)
- §D.6 (storage usage shown to user)

---

# §7 — `sg-history` (JS module)

## §7.1 — Identity

| Field | Value |
|---|---|
| Name | `sg-history` |
| Type | JS module (no Web Component) |
| Path | `core/sg-history/v0/v0.1/v0.1.0/` |
| Version | `v0.1.0` |
| Files | `sg-history.js`, `sg-history-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md` |
| LOC budget | 500 hard / 600 soft |

## §7.2 — Purpose

The op-based undo/redo bookkeeper. Replaces sg-video-editor v0.1.54's snapshot-stack `state-history.js` with op-shaped, category-aware, side-effect-aware history.

Per A-011 (out of scope): no tree-undo, no sgit-vault storage, no git-named API. v0.1.0 ships flat-stack semantics over a DAG-shaped internal data structure designed to support future tree-undo without API changes.

## §7.3 — Public API (V.3.7)

```javascript
createHistory(opts?: {
    eventTarget?:    EventTarget,         // default: new EventTarget()
    maxOps?:         number,              // default 10000
    maxBytes?:       number,              // default 25_000_000 (25 MB)
    snapshotEvery?:  number,              // default 100
    captureNoisy?:   boolean,             // default false
    onSideEffect?:   (op, direction) => Promise<void>,
    onSnapshot?:     () => any,
    onApply?:        (op, direction: 'forward'|'backward') => void,
}): History

History = {
    record(op: Op): void
    undo(): {applied: Op | null}
    redo(): {applied: Op | null}
    canUndo(): boolean
    canRedo(): boolean
    getOps(): Op[]
    getOpAt(index: number): Op | null
    getPosition(): number
    goTo(position: number): {appliedOps: Op[]}
    replayOps(ops: Op[]): void
    clear(): {discardedCount: number}
    getStorageUsage(): {opCount, byteSize, snapshotCount}
    getEventTarget(): EventTarget
}
```

## §7.4 — Internal data structure

The op log is stored as a DAG node array, but in v0.1.0 every node has at most one parent (forming a linked list). The structure permits future expansion to true DAG (tree-undo) without API changes.

```javascript
{
    _ops:           Op[],             // insertion-ordered
    _position:      number,           // current head index; 0 = no ops applied
    _snapshots:     Map<number, any>, // key: op index; value: result of onSnapshot()
    _opCount:       number,
    _byteSize:      number,
    _config:        HistoryConfig,
    _eventTarget:   EventTarget,
}
```

## §7.5 — Op recording flow

```
record(op):
    1. If op.reversible === 'noisy' AND !config.captureNoisy: return (silent drop)
    2. Validate op (M.1 — has type, payload, reversible; per category rules in M.2-M.6)
    3. Trim redo tail: ops at indices > _position are discarded; emit 'sg-history:branched' if any
    4. Auto-assign op.id if missing (Q2 lock-in)
    5. Append op to _ops; increment _opCount; update _byteSize
    6. If _opCount % snapshotEvery === 0: capture snapshot via onSnapshot()
    7. _position = _ops.length
    8. If _byteSize > maxBytes OR _opCount > maxOps: prune oldest non-snapshot-anchored ops
    9. Dispatch 'sg-history:op-recorded' on _eventTarget
   10. Dispatch 'sg-history:bounds-changed' on _eventTarget
```

## §7.6 — Undo flow

```
undo():
    1. If _position === 0: return {applied: null}
    2. op = _ops[_position - 1]
    3. If op.reversible === 'never': skip past it (decrement _position; recurse)
    4. If op.reversible === 'with-side-effects': await onSideEffect(op, 'backward')
    5. Call onApply(op, 'backward')
    6. _position -= 1
    7. Dispatch 'sg-history:undone' on _eventTarget
    8. Dispatch 'sg-history:bounds-changed'
    9. Return {applied: op}
```

## §7.7 — goTo flow (jump to specific position)

```
goTo(targetPosition):
    1. If targetPosition === _position: return {appliedOps: []}
    2. If targetPosition < _position: undo from _position to targetPosition (replay backward)
    3. If targetPosition > _position: redo from _position to targetPosition (replay forward)
    4. Dispatch 'sg-history:position-changed'
```

For long backward jumps, sg-history may use the nearest snapshot (`onSnapshot` output) as a starting point and replay forward — but v0.1.0 doesn't implement this optimization. v0.1.0 always walks op-by-op. Optimization is a future minor.

## §7.8 — replayOps (load from save)

```
replayOps(ops):
    1. clear()
    2. For each op in ops:
        a. Call onApply(op, 'forward')
        b. _ops.push(op); _position += 1
    3. Dispatch 'sg-history:replay-completed'
```

Per Q8 lock-in: replay does NOT re-emit toolkit events. Only `onApply` is called; UI listeners aren't re-fired.

## §7.9 — Pruning policy (when budget exceeded)

When `_byteSize > maxBytes` OR `_opCount > maxOps`:

1. Identify snapshot-anchored ops (those at indices that are multiples of `snapshotEvery`).
2. Identify the oldest non-snapshot-anchored op.
3. If pruning that op would NOT cross a snapshot anchor: prune it.
4. If pruning that op WOULD cross a snapshot anchor: discard the snapshot anchor too (since the prior op is gone, the snapshot is unreachable).
5. Repeat until under budget.

Pruned ops are silently dropped. The op log is **lossy at the budget edge**. Hosts that need lossless history persist via the `ops` slot of `sg-project-storage` and replay on load.

## §7.10 — DO NOT

- Do NOT call `onApply` or `onSideEffect` synchronously from `record()` — those are for undo/redo, not for the initial forward apply (the host has already applied the change before calling `record`).
- Do NOT modify `op` after passing it to `record()` — the op is captured by reference; mutating it changes history.
- Do NOT use timestamps for ordering — use the position counter (per Q10 lock-in).
- Do NOT skip `onSideEffect` calls for `with-side-effects` ops; that's the entire point of the category.

## §7.11 — Verification touchpoints

- §C.6 (5 op categories all undo correctly)
- §C.7 (replayOps doesn't re-emit events)
- §D.7 (op log size stays bounded)

---

# §8 — `sg-config` (JS module)

## §8.1 — Identity

| Field | Value |
|---|---|
| Name | `sg-config` |
| Type | JS module (no Web Component) |
| Path | `core/sg-config/v0/v0.1/v0.1.0/` |
| Version | `v0.1.0` |
| Files | `sg-config.js`, `sg-config-events.js`, `manifest.json`, `SKILL.md`, `SKILL__api.md` |
| LOC budget | 250 hard / 300 soft |

## §8.2 — Purpose

The per-tool configuration component. Schema-declared key-value store with persistence (localStorage), defaults, URL-parameter overrides, and a `<sg-properties-panel>` integration helper.

Per Q9 follow-up lock-in: in this pack, 8th piece. Replaces bespoke per-tool config code with shared infrastructure.

## §8.3 — Public API (V.3.8)

See README V.3.8 for the full method signatures. Key methods:

```javascript
createConfig(opts) → Config

config.get(key)           → any
config.set(key, value)    → void
config.reset(key?)        → void
config.getAll()           → object
config.toFields(opts?)    → Field[]    // for sg-properties-panel
config.setDebugMode(on)   → void
config.onChange(cb)       → unsubscribe
config.exportSnapshot()   → object
config.importSnapshot(s)  → void
```

## §8.4 — URL parameter overrides

When `urlOverrides: true` (default), the module reads `URLSearchParams` on creation. Any param matching `config.<key>=<value>` becomes the active value for that key for the session, overriding the stored value.

```
?config.log-level=silent          → log-level becomes 'silent'
?config.autosave=false            → autosave becomes false
?config.memory-probe=true         → memory-probe becomes true (overrides debug:true visibility)
```

URL overrides are session-scoped: closing the tab loses them. They're useful for support ("can you reproduce with `?config.log-level=verbose`?") and automation (CI runs with deterministic config).

## §8.5 — Persistence

Each `set()` call writes the full config snapshot to localStorage under `<storageKey>` (default `<namespace>:config`). The snapshot shape:

```json
{
    "schemaVersion": 1,
    "values": {
        "preview-composer": false,
        "timeline-renders": true,
        "autosave": false,
        ...
    }
}
```

On `createConfig()`, the module reads the existing snapshot, applies defaults for any missing keys, then applies URL overrides on top.

Schema migrations (when adding/removing/renaming fields between v0.1.X versions): v0.1.0 doesn't support migrations. Renamed fields lose their values. Hosts that need migrations roll their own via `importSnapshot/exportSnapshot`.

## §8.6 — Op-shaped change events (M.12 from doc 03)

Every `set()` call emits `sg-config:changed` op-shaped:

```javascript
{
    type: 'sg-config:changed',
    payload: {
        namespace, key, fromValue, toValue, source: 'user' | 'url-override' | 'reset',
    },
    priorState: null,                      // pure
    reversible: 'pure',
    timestamp: Date.now(),
    source: 'user-input',
}
```

The host wires this to `<sg-properties-panel>:field-changed` (the panel's event already has the shape needed to drive `config.set`); sg-history records it as a pure op; undo flips it back.

## §8.7 — Integration with `<sg-properties-panel>`

```javascript
const config = createConfig({namespace: 'sgve', schema: {...}});
const props  = this.shadowRoot.querySelector('sg-properties-panel#config');

props.addSection({
    id: 'config',
    title: 'CONFIG',
    fields: config.toFields(),
});

props.addEventListener('sg-properties-panel:field-changed', (e) => {
    const {sectionId, fieldId, toValue} = e.detail.op.payload;
    if (sectionId === 'config') {
        config.set(fieldId, toValue);  // emits sg-config:changed; persists
    }
});

config.onChange((key, newValue) => {
    // React to non-UI changes (e.g. URL override on load):
    if (key === 'log-level') logger.setLevel(newValue);
});
```

## §8.8 — Debug mode

Fields with `debug: true` are NOT included in `toFields()` by default. To expose them, the host calls `config.setDebugMode(true)` (typically wired to a hidden Cmd+Shift+D shortcut or a URL param like `?config.debug=on`).

When debug mode toggles, the host should re-call `props.setSectionFields('config', config.toFields({includeDebug: true}))` to refresh the rendered fields.

## §8.9 — DO NOT

- Do NOT use sg-config for user-account preferences (those are server-side; sg-config is per-browser-tool-localStorage).
- Do NOT register schemas with overlapping namespaces; each tool has exactly one.
- Do NOT bypass `set()` and write to localStorage directly; `set()` emits the change event AND triggers `onChange` callbacks.

## §8.10 — Verification touchpoints

- §B.14 (config panel in v0.1.55 replaces bespoke config tab)
- §D.1 (sg-config integration)
- §D.2 (URL overrides work)
- §D.3 (config changes are op-shaped and undoable)

---

# §9 — Cross-component integration patterns

This section captures the wiring patterns that span multiple toolkit pieces. These are the "second derivatives" of the catalogue — none of them belong to a single piece, but every host implements them.

## §9.1 — The minimal toolkit-consuming tool (skeleton)

```javascript
// In tool's entry JS:

import { SgComponent } from '/components/base/v1/v1.0/v1.0.0/sg-component.js';
import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import * as storage from '/core/sg-project-storage/v0/v0.1/v0.1.0/sg-project-storage.js';
import { createHistory } from '/core/sg-history/v0/v0.1/v0.1.0/sg-history.js';
import { createConfig }  from '/core/sg-config/v0/v0.1/v0.1.0/sg-config.js';
import { SGTS_EVENTS } from '/components/sg-track-strip/v0/v0.1/v0.1.0/sg-track-strip-events.js';
// ... and so on

class SgMyToolElement extends SgComponent {
    onReady() {
        // 1. Initialise state container
        this._state = new MyToolState();
        
        // 2. Initialise config (sg-config)
        this._config = createConfig({
            namespace: 'sgmt',
            schema:    MY_CONFIG_SCHEMA,
        });
        
        // 3. Initialise history (sg-history)
        this._history = createHistory({
            eventTarget: this,
            onApply:     (op, dir) => this._applyOp(op, dir),
            onSideEffect: (op, dir) => this._handleSideEffect(op, dir),
            onSnapshot:  () => this._state.snapshot(),
        });
        
        // 4. Wire toolbar (sg-toolbar)
        const tb = this.shadowRoot.querySelector('sg-toolbar');
        tb.addButton({id: 'undo', label: 'Undo', shortcut: 'Cmd+Z'});
        tb.addButton({id: 'redo', label: 'Redo', shortcut: 'Cmd+Shift+Z'});
        tb.addEventListener('sg-toolbar:button-clicked', (e) => this._onToolbarClick(e));
        
        // 5. Wire track-strip (sg-track-strip)
        const ts = this.shadowRoot.querySelector('sg-track-strip');
        ts.setProject(this._state.getProject());
        SGTS_EVENTS.values.forEach(name => {
            ts.addEventListener(name, (e) => this._history.record(e.detail.op));
        });
        
        // 6. Wire properties (sg-properties-panel)
        const props = this.shadowRoot.querySelector('sg-properties-panel#properties');
        // ... per §4.7 ...
        
        // 7. Wire config (sg-config + sg-properties-panel)
        // ... per §8.7 ...
        
        // 8. Register tool API
        SgToolApi.register('sg-my-tool', { /* methods */ });
    }
    
    _applyOp(op, direction) { /* dispatcher: one handler per op.type */ }
    _handleSideEffect(op, direction) { /* host-specific rollback */ }
    _onToolbarClick(e) { /* dispatcher: undo/redo */ }
}
```

## §9.2 — Save flow (full envelope)

```javascript
async save() {
    await storage.saveProject({
        project:    this._state.getProject(),
        ui:         this._captureUiState(),
        ops:        this._history.getOps(),
        slug:       this._slug,
        blobsById:  this._state.getDirtyBlobs(),
        indexKey:   'sgmt:projects-index',
        projectKeyPrefix: 'sgmt:project:',
        dbName:     'sgmt-storage',
        storeName:  'assets',
    });
}

_captureUiState() {
    return {
        layout: this.shadowRoot.querySelector('sg-layout').getLayoutState?.(),
        zoom:   this.shadowRoot.querySelector('sg-track-strip').getPxPerSecond(),
        selectedItemId: this.shadowRoot.querySelector('sg-track-strip').getSelectedItemId(),
    };
}
```

## §9.3 — Load flow (full envelope)

```javascript
async load(slug) {
    const {project, ui, ops, blobsById, missingBlobIds} = await storage.loadProject({
        slug,
        indexKey: 'sgmt:projects-index',
        projectKeyPrefix: 'sgmt:project:',
        dbName: 'sgmt-storage',
        storeName: 'assets',
    });
    
    // Restore state
    this._state.setProject(project);
    this._state.setBlobs(blobsById);
    
    // Restore UI
    this._restoreUiState(ui);
    
    // Restore ops (history)
    if (ops) this._history.replayOps(ops);
    
    // Mark missing assets
    if (missingBlobIds.length) {
        this.shadowRoot.querySelector('sg-asset-panel').setMissingAssets(missingBlobIds);
    }
    
    // Re-render via setProject — NO ops fire
    this.shadowRoot.querySelector('sg-track-strip').setProject(this._state.getProject());
    this.shadowRoot.querySelector('sg-asset-panel').setAssets(this._state.assets);
}

_restoreUiState(ui) {
    if (!ui) return;
    if (ui.layout) this.shadowRoot.querySelector('sg-layout').setLayoutState?.(ui.layout);
    if (ui.zoom)   this.shadowRoot.querySelector('sg-track-strip').setPxPerSecond(ui.zoom);
    if (ui.selectedItemId) this.shadowRoot.querySelector('sg-track-strip').setSelectedItem(ui.selectedItemId);
}
```

## §9.4 — Op pipeline (the standard pattern)

The op pipeline is uniform across every toolkit-consuming tool:

```
[user interaction]
    → component dispatches op-shaped event
    → host listener catches event
    → host calls history.record(op)
    → history routes by category:
        - pure:       record only
        - snapshot:   record only
        - with-side-effects: record only (side-effect handlers fire on undo, not on record)
        - never:      record only (won't undo)
        - noisy:      drop (or record if captureNoisy)
    → host's onApply was already called externally (the user's action was applied to state already)

[user clicks Undo]
    → toolbar emits 'button-clicked' (noisy)
    → host's button handler calls history.undo()
    → history finds op at _position - 1
    → if with-side-effects: await onSideEffect(op, 'backward')
    → host's onApply(op, 'backward') is called
    → host's onApply mutates state to reverse the op
    → host re-renders affected components via setProject/setItems/setAssets etc.
    → NO new ops are emitted (per M.11)
```

## §9.5 — Crucial pattern: applying op forward at record time

The host applies the user's intent BEFORE calling `history.record()`. The standard pattern:

```javascript
// User dragged item; component emits 'item-moved':
ts.addEventListener('sg-track-strip:item-moved', (e) => {
    const op = e.detail.op;
    
    // 1. Apply forward IMMEDIATELY (host already has the new state from drag-end visuals)
    this._state.moveItem(op.payload.itemId, op.payload.toTrackId, op.payload.toStart);
    
    // 2. Record the op (history doesn't apply forward; the state is already current)
    this._history.record(op);
    
    // 3. (Optionally) re-render via setItems — but the component already shows the new state from the drag
});
```

This is why `onApply` is called only on undo/redo, never on `record()`. The host has already applied the change.

---

# §10 — Versioning and forward compatibility

All eight pieces ship at v0.1.0 in this pack. Future minor versions (v0.1.1, v0.1.2, ...) follow IFD with surgical overrides per `library/development/ifd/v1.3.0__ifd__surgical-overrides-version-stamped-filenames.md`.

Changes that are PERMITTED in a minor version (per N.6 from doc 03):
- Adding new methods, new events, new ops
- Adding optional fields to schemas, payloads, options
- Relaxing op categories (`snapshot` → `pure`, etc.)
- Adding categories like `noisy → captureable`

Changes that REQUIRE a major version bump (v0.2.0):
- Removing or renaming methods, events, ops
- Changing op shape
- Tightening op categories
- Removing optional fields
- Changing schema field semantics

---

# §11 — Where to read next

If you've finished this catalogue:

- **Brief 05 (toolkit + sandbox build):** read doc 04 (verification checklist) §A and §C, then brief 05 itself
- **Brief 06 (sg-video-editor refactor):** read doc 04 §B (behaviour preservation), V.6.6 in README (op category mapping), then brief 06
- **Brief 07 (sg-audio-editor):** read doc 04 §C, then brief 07
- **Brief 08 (QA regression):** read doc 04 §B, then brief 08

End of doc 02. Pass 2 part 1 of 2.
