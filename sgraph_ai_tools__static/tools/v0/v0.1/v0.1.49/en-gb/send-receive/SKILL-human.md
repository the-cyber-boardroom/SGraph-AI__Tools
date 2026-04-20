# Send / Receive — Human Guide

**Tool:** Send / Receive  
**URL:** /en-gb/send-receive/  
**Purpose:** Send a file (or folder or text) via SG/Send and receive it with a token. Zero server knowledge required — all encryption happens in your browser.

---

## Quick Start

### Send a file

1. Enter your **SG/Send access token** in the top field of the Send panel and click **Save**
2. **Drop a file** onto the drop zone — or click **Choose File…**
3. The upload starts automatically. Watch the progress bar
4. When complete, your **share token** appears (e.g. `brave-apple-0742`)
5. Copy the token and share it with your recipient

### Receive a file

1. Open the **📥 Receive** tab on the right
2. **Paste the token** you received (format: `word-word-0000`)
3. Click **📥 Receive File**
4. The file downloads and decrypts in your browser
5. Click **⬇ Download** to save it

---

## The Token

Tokens look like: `brave-apple-0742`

- Two words + four digits
- Case sensitive (always lowercase)
- Used to derive the encryption key — the server never sees the key
- Share the token only with your intended recipient

---

## Send Panel

### Access Token

You need an SG/Send access token to upload files. Get one from [send.sgraph.ai](https://send.sgraph.ai).

- Enter it in the **SG/Send Access Token** field
- Click **Save** — it's stored in your browser's localStorage
- You only need to do this once per browser

### Drop Zone

- Drag any file onto the `📤 Drop a file here to share` area
- Or click **Choose File…** to browse
- Upload starts automatically once a file is offered

### After Upload

The token is shown in the drop zone and added to your **📋 History** tab for easy re-use.

---

## Receive Panel

1. Paste the token in the input field — it validates automatically
2. **Receive File** button enables when the token format is valid
3. Progress shows: key derivation → download → decryption → unpack
4. Text files can be **previewed** directly in the browser
5. All files can be **downloaded** via the Download button

---

## History Panel

The **📋 History** tab keeps a local record of all sent and received tokens (last 50).

- **Copy** — copies the token to your clipboard
- **Re-receive** — pre-fills the Receive panel with that token
- **Clear All** — removes all history (tokens are not deleted from SG/Send)

History is stored in localStorage and is private to your browser.

---

## Security Notes

- All encryption/decryption happens **in your browser** — SG/Send stores only encrypted bytes
- The AES-256-GCM key is derived from the token using PBKDF2 (600,000 iterations)
- The server never sees your key or your file content
- Anyone with the token can decrypt the file — treat tokens like passwords
- Files are stored on SG/Send servers; contact the server admin for retention policy

---

## JS API Panel

Click the footer bar at the bottom to open the **JS API panel** with four tabs:

- **📄 Skills** — this guide, Playwright automation guide, and the full API spec
- **⚡ Explorer** — live view of all registered API methods and events
- **> Console** — call any method from the browser
- **📋 Manifest** — tool identity, dependencies, and API schema

The JS API lets other tools (video recorder, infographic generator, PlaybookLM) send files programmatically with a single call — no custom upload code needed.
