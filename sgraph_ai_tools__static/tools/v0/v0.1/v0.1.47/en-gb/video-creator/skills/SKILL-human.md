# Video Creator — User Guide

## What it does
Turns a set of slide images (PNG/JPEG) and narration text into a narrated video (WebM). All processing happens locally in your browser — no uploads, no API keys.

## Step-by-step

### 1. Upload slides
Drag and drop PNG/JPEG files onto the drop zone, or click **+ Add slides**. Slides appear in order in the thumbnail grid. Click any thumbnail to select it and edit its narration.

### 2. Write narration
With a slide selected, type the narration text in the **Narration** panel. Each slide has its own text. Tips:
- Keep sentences short — the TTS engine generates each sentence in parallel, so shorter = faster
- Slide with no narration text will show for 3 seconds of silence

### 3. Load TTS model
Click **Load TTS Model**. This downloads the Kokoro 82M ONNX model (~160 MB on first use, cached afterwards). Progress is shown in the log. Wait for "Model ready."

### 4. Generate audio
Click **Generate Audio** to convert all narrations to speech. Progress is shown per slide in the canvas overlay. The thumbnail grid shows the audio duration for each slide once done.

### 5. Record video
Click **Record Video**. The tool plays each slide with its audio through a canvas + MediaRecorder pipeline and produces a WebM file. Recording happens in real time.

### 6. Download
Once recording is done, click **Download WebM** to save the file.

## Settings
| Setting | Default | Description |
|---------|---------|-------------|
| Voice | af_bella | Kokoro TTS voice. See voice list for all 28 options. |
| Speed | 1.0× | Narration speed multiplier (0.5–2.0) |
| FPS | 30 | Video frame rate (24, 30, or 60) |

## Voice guide
- `af_` = American Female (af_heart, af_bella, af_nova, af_sky…)
- `am_` = American Male (am_adam, am_echo, am_liam…)
- `bf_` = British Female (bf_emma, bf_isabella…)
- `bm_` = British Male (bm_george, bm_lewis…)
