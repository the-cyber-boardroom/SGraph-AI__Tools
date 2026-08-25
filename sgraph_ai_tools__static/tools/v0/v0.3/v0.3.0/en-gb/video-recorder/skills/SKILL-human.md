# Video Recorder — User Guide

## What it does
Records video, audio, and/or screen captures directly in your browser — no plugins, no uploads (except when you choose SG/Send). Supports 9 capture modes including audio visualisation and optional PiP compositing.

## Recording modes

| Mode | What it captures |
|------|-----------------|
| Audio only | Microphone only — voice memos, interview audio |
| Camera only | Webcam video, no audio |
| Screen only | Screen/tab/window, no audio |
| Camera + Audio | Standard webcam recording |
| Screen + Audio | Screen recording with narration |
| Camera + Screen | Camera as PiP overlay on screen capture |
| Camera + Screen + Audio | Full presenter mode — PiP + narration |
| Viz + Audio | Audio visualisation canvas (no camera/screen) |
| Screen + Viz + Audio | Visualisation overlaid on screen capture |

## Mode builder

The **Mode Builder** section has three independent columns:

### Screen column
Toggle **Screen** on or off. When on, your browser opens a source picker (window, tab, or full screen) at record time.

### Audio column
Three mutually exclusive options:
- **None** — no audio recorded
- **Mic** — microphone (default). Works in any mode.
- **Tab** — audio from the shared tab/window (screen audio). Only available when **Screen** is on. If you turn Screen off, the selector automatically reverts to Mic.

> **Note:** Tab audio comes from the browser's screen-sharing audio permission. Not all browsers support it, and some OS/browser combinations disable it for certain sources (e.g. macOS system audio requires an extra driver). If the option is greyed out, switch to Screen mode first.

### Visualisation column
Toggle **Viz** on or off. When on, an audio waveform/bar visualisation canvas is rendered instead of (or overlaid on) the camera/screen.

## Step-by-step

### 1. Choose mode
Configure the **Screen**, **Audio**, and **Viz** toggles in the Mode Builder. The resulting mode string (e.g. `camera+screen+audio`) is shown automatically.

### 2. (Optional) Preview
Click **▶ Preview** to start a live camera preview before recording. Not available for screen-only modes (the browser can only open the source picker at record time).

### 3. Start recording
Click **● Start Recording**. Depending on your mode:
- **Camera/audio** — your browser will ask for microphone/camera permission if not already granted.
- **Screen capture** — your browser opens its source picker (window, tab, or screen). You must select a source for recording to begin.
- **Tab audio** — tick the "Share audio" checkbox in the browser's screen picker if you want tab audio to be captured.

### 4. Pause / Resume (optional)
While recording, click **⏸ Pause** to pause all recorders simultaneously. The timer stops. Click **⏸ Resume** (the button turns teal) to continue from where you left off. Paused time is excluded from the final recording duration.

### 5. Watch the live preview
The preview panel shows a live feed while you record. The **LIVE** badge confirms recording is active. The size counter updates in real time.

### 6. Stop recording
Click **■ Stop**. The recording blob appears in a new tab for immediate playback.

### 7. (Optional) Compress
Expand the **Compress** panel to reduce file size before saving. Choose resolution, format (MP4 or WebM), and bitrate. Click **Compress** — the preview updates to the compressed version.

### 8. Save

| Target | How |
|--------|-----|
| **SG/Send** | Encrypts and uploads. You get a shareable token link (e.g. `apple-brave-0742`). Recipient opens `send.sgraph.ai/#token`. |
| **Local Folder** | Saves video + thumbnail + metadata.json to a folder on your device. Requires a modern browser with File System Access API (or triggers separate downloads in others). |
| **SGraph Vault** | Enter vault ID and vault key. Video + metadata committed to your vault. |
| **Download WebM** | Direct download — no encryption, no upload. |

## Tab audio — platform notes

| Browser / OS | Tab audio support |
|---|---|
| Chrome / Edge on Windows | ✓ Full support — "Share audio" checkbox appears in picker |
| Chrome on macOS | ✓ Tab audio works; system audio requires Loopback or similar |
| Firefox | ✗ No tab audio from getDisplayMedia |
| Safari | ✗ No tab audio from getDisplayMedia |

If the browser's picker does not show a "Share audio" option, the Tab audio source will fall back to silence (recording continues without audio).

## Visualisation regeneration

If you switch browser tabs during recording, the visualisation canvas may freeze. After stopping, the recording tab shows a **⚠ Visualisation** warning with a **↺ Regenerate Viz** button. Choose a mode and speed, then click the button to re-render the visualisation from the audio track. At speeds above 1×, the audio is played back faster and the output is viz-only (use the **Audio** download for clean audio).
