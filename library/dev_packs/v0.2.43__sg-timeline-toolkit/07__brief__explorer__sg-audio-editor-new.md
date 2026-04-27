# 07 — Brief: Build sg-audio-editor v0.1.0 (new tool, toolkit-consuming)

**Pack:** `v0.22.17__pack__sg-toolkit-extraction`
**Brief revision:** rev 1 (Pass 3)
**Brief role:** the implementer task list for a NEW tool — sg-audio-editor v0.1.0 — that consumes the toolkit on day one. This brief proves the toolkit is genuinely generic by being implemented by a fresh Sonnet who has not touched the video editor.
**Audience:** Sonnet implementer (Explorer team) — preferably fresh; does NOT need v0.1.54 video-editor knowledge. Reading the toolkit catalogue (doc 02) and this brief should be sufficient.
**Lifetime:** archive after merge.
**Estimated effort:** 25–40 hours of Sonnet-time across 28 tasks. Smaller than briefs 05 / 06 because the audio editor is a smaller domain than the video editor.

> **Read first, in order:**
> 1. `README.md` — V.1–V.11, A-001 through A-011, V.6 (op categories)
> 2. `01__architecture__sg-toolkit.md` — §3 (the 8 pieces) and §5 (target architecture)
> 3. `02__architecture__component-catalogue.md` — read every section
> 4. `03__guidelines__sg-component-and-ifd.md` — sections A, B, C, F, H, K, M, N
> 5. `04__verification__feature-checklist.md` — your tasks tick §A, §C, §D, §E items
>
> **Optional reading:**
> - Brief 05 — to see how the toolkit was built (informs how it's used)
> - The sandbox tool — open it in browser; the Audio mode shows the integration pattern you'll mirror

---

# §0 — Pre-flight checklist

- [ ] You're on a fresh branch named `claude/build-audio-editor-{session-id}`
- [ ] Brief 05 is merged; toolkit pieces exist
- [ ] You understand state restoration vs op-shaped events (M.11)
- [ ] You understand the 5 op categories
- [ ] You understand that this is a NEW tool — there is NO v0.0.x predecessor
- [ ] Per Q12 lock-in, audio-engine choice is YOURS to make: prefer Web Audio API directly unless you can demonstrate Tone.js gives material benefit. Document the choice in T-3.

If unclear, ASK. Per K.2.

---

# §1 — Domain notes (audio-editor specifics, NOT toolkit concerns)

The audio editor is for editing multi-track audio compositions. Each track holds a sequence of audio clips; each clip references an audio asset (file). Output: render to MP3 / WAV / OGG; play preview in browser.

Domain-specific data fields (host territory, NOT toolkit):
- `Item.assetId` — references an audio asset
- `Item.gain` — playback gain (0–2, default 1)
- `Item.fadeIn` — fade-in duration in seconds
- `Item.fadeOut` — fade-out duration in seconds
- `Item.inPoint`, `Item.outPoint` — trim points within the asset
- `Asset.duration` — audio duration in seconds
- `Asset.sampleRate`, `Asset.channels` — audio metadata

Domain-specific operations:
- Mix and pan
- Fade-in/fade-out adjustment
- Tempo / pitch shift (out of scope for v0.1.0; future minor)
- Render to file (out of scope for v0.1.0; future minor)
- Play preview in browser

The toolkit knows NONE of these. The toolkit knows `Item.{id, start, end, color, label}` per V.4. The host (audio editor) handles everything else.

---

# §2 — Order of work

```
Phase 1: Tool scaffold and audio-engine choice (T-1, T-2, T-3)
   ↓
Phase 2: State container and op handlers (T-4 through T-9)
   ↓
Phase 3: Wire toolkit components (T-10 through T-15)
   ↓
Phase 4: Audio engine integration (T-16 through T-20)
   ↓
Phase 5: Save/load via sg-project-storage (T-21, T-22)
   ↓
Phase 6: Config tab via sg-config + sg-properties-panel (T-23, T-24)
   ↓
Phase 7: Verification and pack delivery (T-25 through T-28)
```

---

# §3 — Phase 1: Tool scaffold

## T-1 — Decide on the version path

**What:** Per D-001 (locked at start of Pass 2), the audio editor lives at `tools/v0/v0.1/v0.1.X/en-gb/sg-audio-editor/` where X is resolved at brief time. Pick X.

**How:** Inspect the existing `tools/v0/v0.1/` directory. Pick the next available patch version that does NOT collide with any existing `sg-*` tool's path (audio editor gets its own X). The most likely choice is the next round number after the highest existing patch — if v0.1.55 is the latest tool, use v0.1.0 (audio editor's own first version, namespaced under its tool dir).

Wait — re-read. The tool's version is the audio editor's own version: v0.1.0. That's separate from any other tool's version. Path: `tools/v0/v0.1/v0.1.0/en-gb/sg-audio-editor/`.

If v0.1.0 is taken by another tool's path (e.g. the sandbox), pick the next available — but tools live at the same v0.1.0 patch level alongside other tools (the sandbox also lives at v0.1.0). They're sibling subdirectories, not version conflicts.

Confirmed path: `tools/v0/v0.1/v0.1.0/en-gb/sg-audio-editor/`.

**Done when:** Path picked and matches IFD pattern.

**Checklist refs:** §E.1

---

## T-2 — Scaffold the tool

**What:** Create the directory and core files.

**How:**
1. Directory: `tools/v0/v0.1/v0.1.0/en-gb/sg-audio-editor/`
2. Files: `index.html`, `main.html`, `main.js`, `main.css`, `manifest.json`, `SKILL.md`
3. Tool extends `SgComponent` and registers with `SgToolApi.register('sg-audio-editor', {...})`
4. Manifest declares dependencies on all 8 toolkit pieces with explicit version paths

**Done when:** Tool loads at `/en-gb/sg-audio-editor/v0.1.0/` showing the empty layout.

**Checklist refs:** §E.7

---

## T-3 — Choose and document the audio engine

**What:** Make the audio-engine choice. Document the rationale in a code comment at the top of `main.js`.

**Why:** Per Q12, you have discretion. The architect's guidance: prefer Web Audio API directly unless Tone.js gives material benefit.

**How:**
1. List the audio operations needed for v0.1.0: load file, play, pause, seek, gain, fade, mix multiple tracks, output to speakers.
2. Web Audio API supports all of these. Tone.js wraps Web Audio with higher-level primitives (Tone.Player, Tone.Volume, Tone.Sequence) and adds music-theory helpers (notes, scales, transport-as-musical-time).
3. v0.1.0 doesn't need music-theory helpers (no MIDI, no notes, no metronome). It needs sample-accurate scheduling, gain envelopes, and crossfade. Web Audio API does all of these directly.
4. Decision: **use Web Audio API directly.** Document this with a paragraph noting "Tone.js could be added in a future minor if music-theory features are needed; for now the dependency cost outweighs the convenience benefit for v0.1.0's scope."

**Done when:** Code comment in main.js explains the choice. No npm dependency on Tone.js (or any audio library).

---

# §4 — Phase 2: State container and op handlers

## T-4 — Implement the state container

**What:** A `AudioEditorState` class that holds the project shape: `{tracks: Track[], assets: Asset[]}` with audio-specific fields.

**How:**
1. Project shape:
   ```javascript
   {
       tracks: [
           {id, name, kind: 'audio', muted, locked, items: [
               {id, start, end, assetId, gain, fadeIn, fadeOut, inPoint, outPoint},
               ...
           ]},
           ...
       ],
       assets: [
           {id, name, mimeType, duration, sampleRate, channels},
           ...
       ],
   }
   ```
2. Mutation methods: `addTrack`, `removeTrack`, `addItem`, `removeItem`, `moveItem`, `trimItem`, `splitItem`, `setGain`, `setFade`, `setMute`, `setLock`, `addAsset`, `removeAsset`, etc.
3. `snapshot()` method for sg-history's `onSnapshot` callback — returns a serializable copy of the project shape.
4. Walks: `getTrackItems(trackId)`, `findItem(itemId)`, etc.

**Done when:** State container has tests for all mutations. Snapshot/restore round-trips correctly.

---

## T-5 — Implement op handlers for `pure` ops

**What:** Per V.6.6, the pure-category ops the audio editor will handle:
- `item-moved` (track-strip event)
- `item-trimmed` (track-strip event)
- `item-color` (track-strip event)
- `item-track-changed` (track-strip event)
- `track-mute` (track-strip event)
- `track-lock` (track-strip event)
- `track-renamed` (track-strip event)
- `field-changed` (properties-panel event) — for gain, fadeIn, fadeOut, etc.

**How:** Same pattern as brief 06 §T-12. One handler per op type. Forward uses `payload.toX`; backward uses `payload.fromX`.

**Done when:** All pure ops handled. Sandbox-style undo/redo tested for each.

**Checklist refs:** §C.2.a

---

## T-6 — Implement op handlers for `snapshot` ops

**What:** Per V.6.6:
- `item-added` (track-strip)
- `item-deleted` (track-strip)
- `item-split` (track-strip)
- `item-copied` (track-strip)
- `track-add-requested` (track-strip)
- `track-remove-requested` (track-strip)

**How:** Same pattern as brief 06 §T-13. Forward uses payload; backward uses priorState. For `item-split`, the host implements the inPoint/outPoint math (audio-specific).

```javascript
function splitItem_op(state, op, direction) {
    const {originalItemId, newItemIds, atPosition, trackId} = op.payload;
    if (direction === 'forward') {
        const original = op.priorState.item;
        const splitOffset = atPosition - original.start;
        const left = {
            ...original,
            id: newItemIds[0],
            end: atPosition,
            outPoint: original.inPoint + splitOffset,
            // gain/fadeIn carry over; fadeOut is split (full fadeOut applies to right half only):
            fadeOut: 0,
        };
        const right = {
            ...original,
            id: newItemIds[1],
            start: atPosition,
            inPoint: original.inPoint + splitOffset,
            fadeIn: 0,  // fadeIn carried by left half only
        };
        state.removeItem(originalItemId, trackId);
        state.insertItem(left, trackId, op.priorState.atIndex);
        state.insertItem(right, trackId, op.priorState.atIndex + 1);
    } else {
        state.removeItem(newItemIds[0], trackId);
        state.removeItem(newItemIds[1], trackId);
        state.insertItem(op.priorState.item, trackId, op.priorState.atIndex);
    }
}
```

Note: this code lives in YOUR audio-editor's main.js (or a helper). The toolkit knows nothing about gain/fadeIn/fadeOut/inPoint/outPoint.

**Done when:** All snapshot ops handled. Split/copy/delete/track-remove round-trip with audio-specific fields preserved.

**Checklist refs:** §C.2.b

---

## T-7 — Implement op handlers for `with-side-effects` ops

**What:** `asset-add-requested` (asset-panel) and `asset-remove-requested` (asset-panel).

**How:**
1. `_handleSideEffect(op, direction)` for asset-add: write/delete blob from IDB.
2. `_applyOp(op, direction)` for asset-add: add/remove asset metadata from state.

For asset-add, the host probes audio metadata (duration, sampleRate, channels) when the file is dropped. It uses Web Audio API's `decodeAudioData` to get duration and channel count.

```javascript
async _probeAudioMetadata(file) {
    const audioContext = this._getAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
    };
}
```

**Done when:** Asset upload works. Asset removal works. Undo of either reverses both metadata and blob.

**Checklist refs:** §C.2.c

---

## T-8 — Implement op handlers for `never` and `noisy` ops

**What:** Per V.6.6:
- `noisy`: `item-selected`, `track-selected`, `playhead-changed` (during scrub), `button-clicked` (toolbar), `popover-opened/closed` (toolbar), `asset-drag-started/ended` (asset-panel)
- `never`: any audio-render request that fires off-thread (none in v0.1.0; render is out of scope)

**How:**
1. `noisy`: don't enter undo stack. Default `captureNoisy: false` in createHistory means they're dropped at record-time.
2. `never`: not used in v0.1.0. Skip.

**Done when:** Noisy ops fire without polluting undo stack. Selecting items doesn't add to history.

**Checklist refs:** §C.2.d, §C.2.e

---

## T-9 — Wire host's `onApply`, `onSideEffect`, `onSnapshot` callbacks

**What:** Build the dispatcher in main.js per the standard pattern (doc 02 §9.4).

```javascript
this._history = createHistory({
    eventTarget: this,
    onApply:     (op, dir) => this._applyOp(op, dir),
    onSideEffect: (op, dir) => this._handleSideEffect(op, dir),
    onSnapshot:  () => this._state.snapshot(),
    snapshotEvery: 100,
    captureNoisy: false,
});

_applyOp(op, direction) {
    const handler = OP_HANDLERS[op.type];
    if (!handler) {
        console.warn('[sgae] unknown op type:', op.type);
        return;
    }
    handler(this._state, op, direction);
    this._rerenderAffected(op);
}

_rerenderAffected(op) {
    if (op.payload?.trackId) {
        const items = this._state.getTrackItems(op.payload.trackId);
        this.shadowRoot.querySelector('sg-track-strip').setItems({[op.payload.trackId]: items});
    }
    if (op.payload?.assetId !== undefined || op.type.startsWith('asset-')) {
        this.shadowRoot.querySelector('sg-asset-panel').setAssets(this._state.assets);
    }
    if (this._state.getSelectedItem()) {
        this._renderProperties();
    }
}
```

**Done when:** Standard pipeline working. Test: drag item, undo, redo. State and visuals match across all three.

**Checklist refs:** §C.6

---

# §5 — Phase 3: Wire toolkit components

## T-10 — Mount and wire `<sg-track-strip>`

**What:** Track strip in the main timeline area. Wire all 20 events from V.2.1 to host handlers.

**How:** Per doc 02 §1.7.2 (standard integration). Loop SGTS_EVENTS.values, attach listener, call `history.record(e.detail.op)`.

**Done when:** Drag, trim, split, delete all work end-to-end.

**Checklist refs:** §B (audio-editor analogue of §B for video) — but since this is a new tool, §B doesn't apply. Use §C.1, §C.4, §C.6 instead.

---

## T-11 — Mount and wire `<sg-toolbar>`

**What:** Top toolbar with Undo, Redo, Split, Copy, Paste, +Track, Zoom-in, Zoom-out, Fit, Snap-toggle.

**How:** Per doc 02 §2.7.1 + §2.7.2. Listen for button-clicked, dispatch by buttonId.

**Done when:** All buttons functional. Shortcuts work.

---

## T-12 — Mount and wire `<sg-asset-panel>`

**What:** Left sidebar showing audio assets. Drag-out to track-strip. File-drop-in for upload.

**How:** Per doc 02 §3.7. setDragMime to `'application/x-sg-asset-audio'` to distinguish from video editor's mime.

**Done when:** Asset upload, drag-to-track, asset removal all work.

---

## T-13 — Mount and wire `<sg-properties-panel>` (for selected item)

**What:** Right rail showing selected item's editable fields:
- Section "TIMING": start (number, readonly), end (number, readonly)
- Section "AUDIO": gain (number, 0–2, step 0.1), fadeIn (number, seconds), fadeOut (number)
- Section "TRIM": inPoint (number), outPoint (number)

**How:** Per doc 02 §4.7.1. On `item-selected`, populate sections; on `field-changed`, update state.

**Done when:** Selection populates panel; editing updates item; undo restores prior value.

---

## T-14 — Mount and wire `<sg-player-transport>`

**What:** Bottom transport bar with play/pause/scrub/time-display.

**How:**
1. Implement `AudioPlayable` adapter that wraps your audio engine (T-16/T-17).
2. Mount transport with no surface slot (audio has no canvas surface — though you may want to slot a waveform display if implementing in T-19).
3. `transport.attachPlayable(audioPlayable)`.

**Done when:** Play/pause/seek work via the audio engine.

---

## T-15 — Verify all 5 components are wired and functional (smoke)

**What:** Smoke test in browser. Walk through: load (or create) project, drag, trim, split, change gain, save, undo, redo.

**Done when:** All operations succeed without console errors.

---

# §6 — Phase 4: Audio engine integration

## T-16 — Implement audio asset loading

**What:** When the user uploads an audio file, decode it via Web Audio API and cache the AudioBuffer.

**How:**
```javascript
async _loadAsset(assetId, blob) {
    const audioContext = this._getAudioContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    this._audioBuffers.set(assetId, audioBuffer);
}
```

Cache lifecycle: on asset removal, `delete _audioBuffers[assetId]`. On project load, decode all assets in parallel.

**Done when:** Uploaded assets are decodable; 5MB MP3 decodes in under 1 second on a mid-tier machine.

---

## T-17 — Implement scheduling and playback

**What:** When the user clicks Play, schedule all visible items via Web Audio API's AudioBufferSourceNode + GainNode chain.

**How:**
```javascript
_play() {
    const audioContext = this._getAudioContext();
    const startTime = audioContext.currentTime + 0.05;  // 50ms lead-in for clean start
    
    this._activeSources = [];
    
    for (const track of this._state.getTracks()) {
        if (track.muted) continue;
        const trackGain = audioContext.createGain();
        trackGain.gain.value = 1.0;  // future: per-track gain
        trackGain.connect(audioContext.destination);
        
        for (const item of track.items) {
            const buffer = this._audioBuffers.get(item.assetId);
            if (!buffer) continue;
            
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            
            const gainNode = audioContext.createGain();
            gainNode.gain.value = item.gain ?? 1;
            
            // Apply fade-in:
            if (item.fadeIn > 0) {
                gainNode.gain.setValueAtTime(0, startTime + item.start);
                gainNode.gain.linearRampToValueAtTime(item.gain ?? 1, startTime + item.start + item.fadeIn);
            }
            // Apply fade-out:
            if (item.fadeOut > 0) {
                gainNode.gain.setValueAtTime(item.gain ?? 1, startTime + item.end - item.fadeOut);
                gainNode.gain.linearRampToValueAtTime(0, startTime + item.end);
            }
            
            source.connect(gainNode).connect(trackGain);
            
            const offsetIntoBuffer = item.inPoint ?? 0;
            const itemDuration = item.end - item.start;
            source.start(startTime + item.start, offsetIntoBuffer, itemDuration);
            
            this._activeSources.push(source);
        }
    }
    
    this._playStartTime = startTime;
    this._playState = 'playing';
}

_pause() {
    for (const source of this._activeSources) source.stop();
    this._activeSources = [];
    this._playState = 'paused';
}
```

**Done when:** Play schedules all visible items. Pause stops cleanly. Resume from current position works.

---

## T-18 — Implement seek

**What:** When user scrubs the playhead, stop current playback and restart from the new position.

**How:** `seek(position)` calls `_pause()` then re-schedules with `startTime + (item.start - newPosition)`.

**Done when:** Scrubbing works smoothly. Released scrub plays from the new position.

---

## T-19 — (Optional) Implement waveform display

**What:** A custom element rendered into the `<sg-player-transport>` surface slot, showing the waveforms of currently visible tracks.

**Why:** Optional but nice. Audio editors traditionally show waveforms; users find it useful.

**How:** Out of scope for v0.1.0 if time-constrained. Document as a future v0.1.1 feature in code comments.

**Done when:** Either: implemented, or: documented as deferred. No half-implementations.

---

## T-20 — Wire AudioPlayable to sg-player-transport

**What:** AudioPlayable is the Playable interface implementation. Wraps the audio-engine methods.

**How:**
```javascript
class AudioPlayable extends EventTarget {
    constructor(host) {
        super();
        this._host = host;
        this._position = 0;
        this._state = 'paused';
        // Use requestAnimationFrame to update position during playback:
        this._tickInterval = null;
    }
    play() {
        this._host._play();
        this._state = 'playing';
        this._tick();
        this.dispatchEvent(new CustomEvent('sg-playable:state-changed', {detail: {state: 'playing'}}));
    }
    pause() {
        this._host._pause();
        this._state = 'paused';
        cancelAnimationFrame(this._tickHandle);
        this.dispatchEvent(new CustomEvent('sg-playable:state-changed', {detail: {state: 'paused'}}));
    }
    seek(p) {
        this._host._seek(p);
        this._position = p;
    }
    refresh() { /* re-fetch / re-decode if needed */ }
    getCurrentPosition() { return this._position; }
    getDuration() { return this._host._state.getDuration(); }
    
    _tick() {
        // ... update _position based on audioContext.currentTime
        // ... dispatch 'sg-playable:position-changed'
        if (this._state === 'playing') this._tickHandle = requestAnimationFrame(() => this._tick());
    }
}
```

**Done when:** transport.attachPlayable(audioPlayable) wires up. Play/pause/seek/scrub all functional.

---

# §7 — Phase 5: Save/load via sg-project-storage

## T-21 — Wire saveProject / loadProject

**What:** Save/load buttons in the toolbar. Save dialog shows existing slugs. Load dialog hydrates blobs and decodes them.

**How:** Per doc 02 §9.2 and §9.3. Use `projectKeyPrefix: 'sgae:project:'`, `dbName: 'sgae-storage'`, `storeName: 'assets'`.

After load:
1. Call `_state.setProject(loaded.project)`
2. For each asset blob, decode via `_loadAsset(assetId, blob)`
3. Restore UI state (zoom, scroll, selection)
4. Restore op log via `_history.replayOps(loaded.ops)` if present

**Done when:** Save → reload → load → state identical. Audio playback works on the loaded project.

**Checklist refs:** (Audio-editor analogue of §B.18) — use §C.12.

---

## T-22 — Wire autosave

**What:** Autosave fires on a debounced timer (e.g. 5 seconds after the last mutation).

**How:** Per doc 02 §6.6. Use `autosave({...})` with the same shape as saveProject.

**Done when:** Autosave fires after 5s of inactivity following a mutation. Re-opening offers the autosave for recovery.

---

# §8 — Phase 6: Config tab via sg-config + sg-properties-panel

## T-23 — Define audio-editor config schema

**What:** A schema with fields for audio-specific config:
- `master-gain` (number, default 1.0)
- `autosave` (boolean, default true)
- `log-level` (select: silent, warn, info, verbose)
- `cache-decoded-audio` (boolean, default true, debug)
- `audio-context-sample-rate` (number, debug, readonly — shows browser default)

**Done when:** Schema declared. createConfig instantiated with namespace `sgae`.

---

## T-24 — Wire config tab

**What:** Right rail's Config tab uses `<sg-properties-panel>` populated from the schema.

**How:** Per doc 02 §4.7.2 (the standard pattern).

**Done when:** Config changes persist. URL overrides work.

**Checklist refs:** §C.8, §C.9, §C.10

---

# §9 — Phase 7: Verification and pack delivery

## T-25 — Verify §A items (genericness)

**What:** Run the §A scripts. Confirm no host-specific terms in toolkit code (the toolkit you're using, not your code).

**How:**
```bash
bash scripts/check-no-host-leakage.sh
```

This script scans toolkit components/modules for `assetId`, `gain`, `fadeIn`, etc. — terms YOU use in your audio editor but the toolkit MUST NOT use.

**Done when:** Script passes. (If it fails, the leakage is in the toolkit, which means brief 05 didn't catch it; file a bug against brief 05's owner.)

**Checklist refs:** §A.7, §A.10

---

## T-26 — Verify §C items (capability matrix)

**What:** Walk through §C.1, §C.4, §C.5, §C.6, §C.8, §C.9, §C.10. Each is a manual or scripted test.

**Done when:** All ticked.

---

## T-27 — Verify §D and §E items

**What:**
- §D.1, §D.2 — manifests valid; ops match code
- §D.3 — files under LOC budget
- §D.4 — components extend SgComponent (not applicable to your tool, but to your tool's main.js — verify it's `class SgAudioEditorElement extends SgComponent { ... }`)
- §D.5 — three sibling files for components (your tool follows the pattern: main.html, main.css, main.js)
- §D.7 — your audio editor handles 200 items per track at acceptable performance
- §D.8, §D.9, §D.10 — accessibility (keyboard nav, ARIA, contrast)
- §E.1 — version path correct
- §E.5 — branch named correctly
- §E.6 — commits reference brief tasks and checklist items
- §E.7 — manifest deps point to specific versions
- §E.9 — SKILL.md exists for the tool
- §E.10 — reality doc updated

**Done when:** All applicable items ticked.

---

## T-28 — Architect review and merge

**What:** Notify architect. Architect runs validation scripts, walks through user flows, checks IFD discipline.

**Done when:** Architect signs off. Branch is at the tagged commit.

**Checklist refs:** §H.8

---

# §10 — Common Sonnet drift patterns specific to building a new tool

1. **Feature creep.** v0.1.0 is small: edit, save, play. Don't add render-to-MP3, pitch shift, or MIDI. Future minors.
2. **Extending the toolkit.** If you need a feature the toolkit doesn't have (e.g. a separate volume meter component), STOP. File a request. Don't extend the toolkit silently.
3. **Adding host fields to V.4 schema.** The V.4 schema is `{id, start, end, color?, label?, locked?, muted?, kind?}`. You add audio-specific fields (gain, fadeIn, etc.) on YOUR Item objects; they pass through the toolkit opaquely. Do NOT update V.4.
4. **Treating noisy events as ops.** Selection events, scrub events should NOT enter the undo stack. Default `captureNoisy: false`.
5. **Mixing audio engine state with project state.** AudioContext, AudioBufferSourceNode, etc. are NOT project state. They're transient resources. Don't try to undo them.
6. **Forgetting to release resources.** Old AudioBufferSourceNodes, decoded AudioBuffers — clean up. Memory leaks compound.
7. **Skipping the audio probe.** When uploading, decode and check duration/channels/sampleRate BEFORE marking the asset usable. Bad files surface here, not at play-time.

---

# §11 — Definition of done for this brief

All 28 tasks ticked.

When done:
- Branch named `claude/build-audio-editor-{session-id}` is at a tagged commit
- Tool exists at `tools/v0/v0.1/v0.1.0/en-gb/sg-audio-editor/`
- Tool consumes all 8 toolkit pieces; no toolkit features re-implemented
- All §C, §D, §E items applicable to the tool tick
- Architect signs off

End of brief 07. ~28 tasks. Estimated 25–40 hours of Sonnet-time.
