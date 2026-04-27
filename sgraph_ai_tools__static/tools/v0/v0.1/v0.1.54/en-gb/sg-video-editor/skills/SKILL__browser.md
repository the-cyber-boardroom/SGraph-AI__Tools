# SG Video Editor — Browser / Playwright Skill

Drive the editor through the DOM. Useful when you need to simulate user gestures (drag-drop, scrubbing) rather than call the JS API directly.

## Bootstrap

The tool exposes itself as `window.__tool` once `tool:ready` fires (single instance per page). The DOM root is `#sg-video-editor-root`.

```js
await page.waitForFunction(() => window.__tool);
const rootHandle = await page.$('#sg-video-editor-root');
```

## DOM entry points

| Selector | What it is |
|---|---|
| `#sg-video-editor-root` | Tool host container; everything mounts inside it |
| `.sgve-side` | Asset panel (left) — contains rows draggable onto the timeline |
| `sg-preview-canvas` | Web Component holding the `<canvas>` + transport bar |
| `sg-timeline` | Web Component holding ruler, lane, clips, playhead |
| `[data-slot="export"]` | Export button slot |

`document.querySelector('sg-timeline')` and `document.querySelector('sg-preview-canvas')` work anywhere on the page (no shadow DOM piercing needed for these references — public methods live on the host element).

## Custom events emitted

All events bubble and compose; listen on `window`, `document`, or any ancestor.

| Event | Source | `detail` |
|---|---|---|
| `tool:ready` | `SgToolApi.activate()` | `{ instanceId, tool, version }` |
| `tool:error` | any pipeline error | `{ step, message }` |
| `sg-timeline:clip-added` | drop on timeline | `{ trackId, assetId, timelineStart }` |
| `sg-timeline:clip-moved` | drag clip body | `{ clipId, timelineStart }` |
| `sg-timeline:clip-trimmed` | drag clip edge | `{ clipId, inPoint, outPoint }` |
| `sg-timeline:clip-selected` | click clip | `{ clipId }` |
| `sg-timeline:playhead-changed` | scrub ruler | `{ time }` |
| `composer:playhead-changed` | composer tick (on canvas) | `{ time }` |
| `composer:ended` | composer reaches end (on canvas) | `{}` |

The two `composer:*` events are dispatched on the inner `<canvas>` element, not `window`. To listen:

```js
document.querySelector('sg-preview-canvas').getCanvas()
    .addEventListener('composer:playhead-changed', e => console.log(e.detail.time));
```

## Drag-and-drop contract

Dragging an asset onto the timeline uses MIME type `application/x-sg-asset`.

- **Source** (asset panel rows) sets:

  ```js
  e.dataTransfer.setData('application/x-sg-asset', assetId);
  e.dataTransfer.effectAllowed = 'copy';
  ```

- **Target** (`<sg-timeline>` lane) accepts drops where `dataTransfer.types` includes `application/x-sg-asset`, reads the asset id with `getData()`, and emits `sg-timeline:clip-added`.

To synthesise a drop in Playwright, dispatch `dragstart` → `dragover` → `drop` events on the lane element with a `DataTransfer` that has the MIME pre-set. File drops onto the asset panel work via the standard `dataTransfer.files` route.

## Programmatic control via DOM

The two Web Components expose public methods on their host elements.

```js
const timeline = document.querySelector('sg-timeline');
timeline.setProject(project);          // composer-shaped flat project
timeline.setPlayheadTime(2.5);         // seconds
timeline.setSelectedClip('c_abcd1234'); // or null
timeline.setPixelsPerSecond(120);      // zoom, default 60

const preview = document.querySelector('sg-preview-canvas');
preview.getCanvas();                   // → HTMLCanvasElement
preview.attachComposer(composerHandle); // wires transport + listeners
preview.detachComposer();
```

The shell wires these for you — manual calls are only needed when scripting outside the normal user flow.

## Reading state

```js
const wrapped = window.__tool.getProject();
// { schemaVersion, project, assets, tracks, operations }
```

The asset registry (Blob refs keyed by `assetId`) is intentionally **not** exposed on the project JSON because Blobs are not serialisable. Re-load source files via `loadAsset()` to repopulate after a `setProject()` round-trip.

## Health check

```js
const ok = !!(window.__tool && document.querySelector('sg-timeline')
                            && document.querySelector('sg-preview-canvas'));
```

Listen for `tool:error` to surface any pipeline failure.
