# Video Recorder — User Guide

## What it does
Records video, audio, and/or screen captures directly in your browser — no plugins, no uploads (except when you choose SG/Send). Supports 7 capture modes with optional PiP compositing.

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

## Step-by-step

### 1. Choose mode
Select a recording mode from the **Mode** dropdown. Modes that require camera or screen show as disabled if your browser doesn't support them.

### 2. Start recording
Click **● Start Recording**. If your mode includes:
- **Camera/audio** — your browser will ask for microphone/camera permission
- **Screen capture** — your browser opens its source picker (window, tab, or screen)

### 3. Watch the live preview
The preview panel shows a live feed while you record. The **LIVE** badge confirms recording is active. The size counter updates in real time.

### 4. Stop recording
Click **■ Stop**. The recording blob appears in the preview panel for immediate playback.

### 5. (Optional) Compress
Expand the **Compress** panel to reduce file size before saving. Choose resolution, format (MP4 or WebM), and bitrate. Click **Compress** — the preview updates to the compressed version.

### 6. Save

| Target | How |
|--------|-----|
| **SG/Send** | Encrypts and uploads. You get a shareable token link (e.g. `apple-brave-0742`). Recipient opens `send.sgraph.ai/#token`. |
| **Local Folder** | Saves video + thumbnail + metadata.json to a folder on your device. Requires a modern browser with File System Access API (or triggers separate downloads in others). |
| **SGraph Vault** | Enter vault ID and vault key. Video + metadata committed to your vault. |
| **Download WebM** | Direct download — no encryption, no upload. |
