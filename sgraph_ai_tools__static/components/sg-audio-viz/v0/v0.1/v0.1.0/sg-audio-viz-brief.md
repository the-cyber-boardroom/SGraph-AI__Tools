# sg-audio-viz — Component API Brief

**Version:** v0.1.0  
**Path:** `/components/sg-audio-viz/v0/v0.1/v0.1.0/sg-audio-viz.js`  
**Element:** `<sg-audio-viz>`  
**Extends:** `SgComponent` (shadow DOM, `whenReady()`, auto-cleanup)  
**Dependencies:** Zero — Web Audio API + Canvas 2D only

---

## Purpose

Audio-reactive canvas animation component. Driven entirely by the browser's
Web Audio API. Works with microphone streams, audio/video elements, or recorded
blobs. The canvas can be captured as a `MediaStream`, making it a zero-dependency
drop-in camera-replacement track for `MediaRecorder`.

---

## Attributes

| Attribute        | Type    | Default     | Description                                |
|------------------|---------|-------------|--------------------------------------------|
| `mode`           | string  | `waveform`  | Active visualization (see modes table)     |
| `color-primary`  | CSS hex | `#6366f1`   | Primary stroke / fill color                |
| `color-secondary`| CSS hex | `#a78bfa`   | Secondary / gradient endpoint color        |
| `fft-size`       | number  | `2048`      | Web Audio FFT size (power of 2, 32–32768)  |

---

## Visualization Modes

| Mode             | Audio data  | Description                                   |
|------------------|-------------|-----------------------------------------------|
| `waveform`       | time-domain | Classic oscilloscope line, gradient-colored   |
| `bars`           | frequency   | Vertical equalizer bars rising from floor     |
| `mirror-bars`    | frequency   | Bars mirrored top + bottom around center      |
| `circular-wave`  | time-domain | Waveform bent into a closed ring              |
| `circular-bars`  | frequency   | 128 bars radiating outward from a center disc |
| `blob`           | both        | Organic morphing shape, bass drives size      |

All modes show a subtle pulsing idle ring when no source is connected.

---

## Public Methods

| Method                                   | Returns          | Description                                                        |
|------------------------------------------|------------------|--------------------------------------------------------------------|
| `setSource(source)`                      | `Promise<void>`  | Connect audio source (see source types below)                      |
| `setMode(mode)`                          | `void`           | Switch visualization mode; throws on unknown mode                  |
| `setColors({ primary?, secondary? })`    | `void`           | Update rendering colors                                            |
| `start()`                                | `void`           | Start (or resume) the `requestAnimationFrame` loop                 |
| `stop()`                                 | `void`           | Pause the animation loop; canvas freezes on last frame             |
| `captureStream(fps = 30)`                | `MediaStream`    | Return canvas video stream — use as camera-replacement track       |
| `getAnalyser()`                          | `AnalyserNode\|null` | Raw analyser node for advanced use                             |
| `destroy()`                              | `void`           | Stop + close AudioContext + disconnect ResizeObserver              |

### Source types accepted by `setSource()`

| Type                | Behaviour                                                                            |
|---------------------|--------------------------------------------------------------------------------------|
| `MediaStream`       | Connected without destination — no mic feedback. Good for real-time voice.           |
| `HTMLMediaElement`  | Tapped and passed through to speakers. Good for existing `<audio>`/`<video>` tags.  |
| `Blob`              | Object URL created internally, revoked on `ended`. Good for recorded blobs.         |
| `string` (URL)      | Loaded into an internal `Audio` element and passed through to speakers.              |

---

## Events (composed, bubbling — cross shadow DOM)

| Event                   | Detail            | When                                  |
|-------------------------|-------------------|---------------------------------------|
| `sg-audio-viz:source-set`  | `{ type }`     | Source node connected to analyser     |
| `sg-audio-viz:mode-changed`| `{ mode }`     | `setMode()` called                    |
| `sg-audio-viz:error`       | `{ message }`  | Any pipeline error                    |

---

## CSS Custom Properties (on `:host`)

| Property        | Default | Description              |
|-----------------|---------|--------------------------|
| `--viz-bg`      | `#000`  | Canvas background color  |

---

## Usage Examples

### Real-time microphone (voice reactive)

```js
import '/components/sg-audio-viz/v0/v0.1/v0.1.0/sg-audio-viz.js';

const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const viz    = document.querySelector('sg-audio-viz');

await viz.whenReady();
await viz.setSource(stream);
viz.setMode('circular-bars');
viz.start();
```

### As camera-replacement track in MediaRecorder

```js
// Viz canvas provides the video track; mic provides the audio track
const micStream  = await navigator.mediaDevices.getUserMedia({ audio: true });
const vizStream  = viz.captureStream(30);           // video-only MediaStream

const combined   = new MediaStream([
    ...vizStream.getVideoTracks(),
    ...micStream.getAudioTracks(),
]);

const recorder = new MediaRecorder(combined, { mimeType: 'video/webm' });
recorder.start();
```

### Post-process a recorded blob

```js
await viz.setSource(recordedBlob);     // creates internal Audio element
viz.setMode('blob');
viz.start();
viz.$('audio')?.play();                // or control playback externally
```

### Switch modes at runtime

```js
viz.setMode('waveform');
setTimeout(() => viz.setMode('circular-bars'), 3000);
```

### Custom colors

```js
viz.setColors({ primary: '#f43f5e', secondary: '#fb923c' });

// or via HTML attributes
// <sg-audio-viz mode="blob" color-primary="#f43f5e" color-secondary="#fb923c">
```

---

## Integration with sg-video-recorder

`captureStream()` returns a `MediaStream` with one video track. This can
replace the camera track in `sg-video-recorder` by passing it as the screen/
camera source. The audio track from the microphone is added separately. The
resulting recording contains the animated canvas as the video channel.

---

## Internals

```
AudioContext
  └─ AnalyserNode  (fftSize=2048, smoothing=0.8)
       ├─ getByteFrequencyData()  → Uint8Array[1024]  (frequency bins)
       └─ getByteTimeDomainData() → Uint8Array[2048]  (waveform samples)

ResizeObserver  →  canvas.width/height kept in sync at devicePixelRatio
requestAnimationFrame loop  →  clears canvas → reads analyser → renders mode
canvas.captureStream(fps)  →  live MediaStream video track
```

---

## Exported Symbols

```js
export class SgAudioViz          // the component class
export const AUDIO_VIZ_MODES    // ['waveform','bars','mirror-bars','circular-wave','circular-bars','blob']
export const AUDIO_VIZ_EVENTS   // { SOURCE_SET, MODE_CHANGED, ERROR }
```
