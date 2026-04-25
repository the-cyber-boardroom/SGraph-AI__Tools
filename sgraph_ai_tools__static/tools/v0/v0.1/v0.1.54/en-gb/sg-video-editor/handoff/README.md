# sg-video-editor — Handoff

This directory is reserved for cross-tool handoff helpers that bridge `sg-video-editor` with sibling tools in the SGraph platform. Phase 4 will introduce two-way handoffs: **Video Recorder → Editor** (open recordings directly into the timeline) and **Editor → YouTube Editor** / **Editor → SG Send** (publish an exported MP4 to YouTube or share via SG Send).

The pattern mirrors the existing `tools/.../youtube-editor/handoff/` module, which uses `window.opener.__sgYtHandoff` to pre-fill state on boot. A symmetric helper is planned here once the receiver contracts stabilise.

**Phase 1: empty.** No handoff code ships in v0.1.54. Consumers wishing to seed the editor should call `window.__tool.loadAsset({ file })` followed by `window.__tool.addClip({ trackId: 't-video-1', assetId })` directly.
