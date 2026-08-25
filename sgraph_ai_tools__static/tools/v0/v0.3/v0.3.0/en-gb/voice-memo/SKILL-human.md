# Voice Memo — Human Skill

Record voice memos and get live transcriptions directly in your browser. All audio stays on your device — nothing is uploaded.

## Quick Start

1. **Setup** — Click "Setup Environment" in the Setup panel. Downloads Whisper WASM models (~113 MB total, cached after first run).
2. **Record** — Once setup completes, click "Start Recording" in the Record panel.
3. **Transcribe** — Live captions appear in the Live Captions panel as each audio segment is processed.
4. **Edit** — The Transcript panel shows a merged, editable version you can copy or save to VFS.

## Panels

| Panel | Purpose |
|-------|---------|
| ⚙️ Setup | WASM health check, model loading |
| 🎙 Record | Start/stop recording, session info |
| 🔐 Vault | LLM connection for Stage 2/3 pipeline |
| 💬 Live Captions | Real-time transcription output |
| 📝 Transcript | Editable merged transcript |
| 🚀 Pipeline | Stage 2 (enhanced) + Stage 3 (brief) |
| 📊 Events | VFS event log |

## Notes

- Segments are saved to IndexedDB VFS under `/voice-memos/{session-id}/`
- Segment duration configurable: 10–60 seconds
- tiny.en model used for real-time captions; base.en for post-stop cleanup pass
