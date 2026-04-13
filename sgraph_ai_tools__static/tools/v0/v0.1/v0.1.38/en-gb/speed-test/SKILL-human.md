# Speed Test — Human Guide

**Tool:** Speed Test v0.1.38
**URL:** `/en-gb/speed-test/`

## What This Tool Does

Measures upload and download speed between your browser and the configured
SG/Send server. Use it to:

- Diagnose connection speed before uploading or downloading a large file
- Share results ("is my connection fast enough for this?")
- Provide a baseline for QA and monitoring systems

---

## Quick Start

1. Set the **TARGET** URL (default: `https://send.sgraph.ai`).
2. Choose a **SIZE** — larger probes give more accurate results but take longer.
3. Click **Run Test**.
4. Wait for both the download and upload bars to complete.

The tool runs a download test first (fetches a probe payload from the server),
then an upload test (sends a random payload to the server).

---

## Reading the Results

| Metric | Meaning |
|--------|---------|
| Speed (MB/s) | Bytes per second — how fast data moves |
| Mbps | Megabits per second — the standard ISP unit |
| Progress bar | Blue = running, green = done, red = error |
| Status row | Bytes transferred and duration |

**Rule of thumb:**
- 1 MB/s ≈ 8 Mbps (same speed, different units)
- A 1 GB file at 10 MB/s takes about 1 min 40 s

---

## Sharing Results

Once both tests finish, the **Share results** section appears.

1. Click **Generate** — a pre-formatted text block appears.
2. Click **Copy** to copy to clipboard.
3. Paste anywhere (chat, email, issue tracker).

---

## Tips

- Run the test **two or three times** and take the average — results vary with server load.
- If you get an error, check that the TARGET URL is reachable and that
  `/api/speed-test/download` and `/api/speed-test/upload` endpoints exist on the server.
- On mobile, close background apps before testing to avoid contention.
- A result of `—` means no data was received (likely a network or CORS error).
