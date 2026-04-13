# Speed Test — Human Guide

**Tool:** Speed Test v0.1.39
**URL:** `/en-gb/speed-test/`

## What This Tool Does

Measures how fast your browser can encrypt, upload, download, and decrypt data.
Use it to:

- Diagnose connection speed before uploading or downloading a large file
- Benchmark your browser's AES-256-GCM crypto performance (no network required)
- Share results: "your connection can upload 1 GB in ~X minutes"
- Provide a QA and monitoring baseline

---

## Two Modes

### Sim (offline, default)

No server required. Measures **client-side crypto throughput**:

- **Encrypt**: how fast AES-256-GCM can encrypt your probe payload
- **Decrypt**: how fast AES-256-GCM can decrypt it back

This gives you the upper bound — no upload or download can be faster than
the client can encrypt or decrypt the data.

### Live (server)

Measures real **network throughput** against a live SG/Send endpoint:

- **Upload**: encrypts a test payload and uploads it using chunked multipart
- **Download**: fetches a URL using HTTP Range requests

For live mode you need:
- **TARGET URL** — your SG/Send server (default: `https://send.sgraph.ai`)
- **ACCESS TOKEN** — required for uploads. Download-only testing does not need a token.
- **DOWNLOAD URL** — any direct binary URL to test download speed.
  After an upload test, the transfer URL is pasted automatically.

---

## Quick Start

### Sim test (no credentials)

1. Keep Mode set to **⚙ Sim (offline)** (default).
2. Choose a probe size — 4 MB is a good balance of accuracy vs. speed.
3. Click **Run Test**.
4. Read the Encrypt and Decrypt speed in MB/s.

### Live upload test

1. Switch to **🌐 Live (server)**.
2. Set the **TARGET URL** to your SG/Send instance.
3. Paste your **ACCESS TOKEN**.
4. Click **Run Test** — the upload speed appears, and the Transfer URL is auto-filled in the Download URL field.

### Live download-only test

1. Switch to **🌐 Live (server)**.
2. Paste any direct binary URL in the **DOWNLOAD URL** field.
3. Leave the ACCESS TOKEN blank (upload will be skipped).
4. Click **Run Test**.

---

## Reading the Results

| Metric | Meaning |
|--------|---------|
| Speed (MB/s) | Bytes per second — how fast data moves |
| Mbps | Megabits per second — the standard ISP unit (1 MB/s ≈ 8 Mbps) |
| Progress bar | Blue = running, green = done, red = error |
| Status row | Bytes transferred, duration, chunk count |

**Rule of thumb:** at 10 MB/s, a 1 GB file transfers in ~100 seconds.

---

## History

The last 10 runs appear in the History panel with timestamps. When you have
two or more same-mode results, statistics (min / avg / max) appear below the run list.

---

## Developer Panel

Click the footer bar (`⚡ Speed Test`) to open the developer panel:

| Tab | Content |
|-----|---------|
| ⚡ Explorer | Live health, method list, event stream |
| > Console  | Call any registered method interactively |
| 📋 Manifest | Full tool manifest and API spec |
| 📄 Skills  | This guide, browser guide, API spec |
