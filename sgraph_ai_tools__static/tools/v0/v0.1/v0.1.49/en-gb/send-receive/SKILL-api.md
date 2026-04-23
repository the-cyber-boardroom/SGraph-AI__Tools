# Send / Receive — API Capability Spec

**Tool:** sg-send-receive  
**Version:** ui=0.1.49, api=0.1.0  
**Instance ID pattern:** `sg-send-receive:{panelId}` (panelId='root' for standalone pages)  
**Environment:** Browser only (HTTPS or localhost)  
**Registry:** `window.__tool` / `window.__tool_registry.find('sg-send-receive')`

---

## Purpose — Read This First

This is the JS API primitive for the SG/Send send/receive workflow. It answers the question every tool producing output must answer: **"How does the user save and share this?"**

**The answer is always one of:**

```javascript
// Option A — one API call (if send-receive tool is open):
const { token } = await window.__tool.sendFile(myBlob);

// Option B — drop in a component (works on any tool page):
import '/components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.js';
const drop = document.createElement('sg-send-drop');
drop.setAccessToken(localStorage.getItem('sgraph-send-token'));
drop.offerFile(blob, 'recording.webm');
// Listen for sg-send-complete event: { token, transferId, url }

// Option C — drop in the receive component (any tool page):
import '/components/send-receive/v0/v0.1/v0.1.0/sg-send-receive.js';
const el = document.createElement('sg-send-receive');
el.addEventListener('sg-receive-complete', e => console.log(e.detail.filename, e.detail.blob));
await el.receive('brave-apple-0742');
```

No custom upload code. No custom progress bars. No custom token management.

---

## Identity

```
name:        sg-send-receive
slug:        send-receive
category:    vault
status:      live
url-pattern: /en-gb/send-receive/
```

---

## Cryptographic Protocol

All encryption is client-side. The server stores only ciphertext.

```
Token format:   word-word-NNNN  (e.g. brave-apple-0742)
Transfer ID:    SHA-256(token)[0:6 bytes] → 12 hex chars
Key derivation: PBKDF2-SHA-256, salt='sgraph-send-v1', iterations=600,000
Encryption:     AES-256-GCM, random 12-byte IV prepended to ciphertext
Envelope:       SGMETA magic(6B) + metaLen(4B BE) + JSON{filename} + fileBytes
Upload API:     POST /api/transfers/create → upload → complete (or presigned multipart)
Download API:   GET /api/transfers/download/{transferId} → raw ciphertext bytes
```

Anyone with the token can decrypt the file. Treat tokens like passwords.

---

## Methods

### sendFile

```
signature:   sendFile(fileOrBlob, opts?) → Promise<{ token, transferId, url }>
async:       true
params:
  fileOrBlob   File|Blob  required  The file to encrypt and upload
  opts         object     optional
    accessToken  string   Falls back to stored token (localStorage 'sgraph-send-token')
    filename     string   Inferred from File.name if omitted
    sendUrl      string   Auto-detected from hostname if omitted
    onProgress   function ({ percent, stage }) → void callback
returns:
  token       string  Friendly token (word-word-NNNN) — the share credential
  transferId  string  12-char hex derived from token
  url         string  Full URL: {sendUrl}/{transferId}
errors:
  Error('Access token required. Call setAccessToken() first.') if no token
  Error('Transfer create failed: 401') if access token is invalid
  Error('Transfer upload failed: ...')  on upload error
side-effects:
  - Adds entry to localStorage history
  - Re-renders the History panel
  - Dispatches tool:generation:complete on window
```

**The pattern that replaces all custom upload code:**

```javascript
// Before (video recorder had ~100 lines of custom upload code):
const result = await uploadFile(blob, filename, SEND_URL, accessToken, onProgress);
// ...custom UI for progress...
// ...custom UI for token display...
// ...custom localStorage token management...

// After (one line):
const { token } = await window.__tool.sendFile(recordingBlob, { accessToken });
// History, UI, and events handled automatically
```

---

### sendText

```
signature:   sendText(text, opts?) → Promise<{ token, transferId, url }>
async:       true
params:
  text       string   required  Plain text content
  opts       object   optional  Same as sendFile opts. filename defaults to 'message.txt'
returns:     same as sendFile
note:        Wraps text in a Blob('text/plain') then calls sendFile
```

---

### sendFolder

```
signature:   sendFolder(files, opts?) → Promise<{ token, transferId, url }>
async:       true
params:
  files    Array<File | { blob: Blob, filename: string }>  required
  opts     object  optional  Same as sendFile opts. filename defaults to 'folder-{ts}.zip'
note:
  - Files are zipped via JSZip (lazy-loaded from CDN) before encryption
  - A single token is returned for the entire zip
  - Recipient calls receiveFolder(token) to get individual files back
```

```javascript
// Send all generated slides as one zip
const result = await window.__tool.sendFolder([
    new File([slide1Blob], 'slide-1.png'),
    new File([slide2Blob], 'slide-2.png'),
    new File([pdfBlob],    'deck.pdf'),
], { filename: 'presentation.zip' });
// One token covers all files
```

---

### receiveFile

```
signature:   receiveFile(token) → Promise<{ filename, blob, objectUrl, token, transferId }>
async:       true
params:
  token   string  required  Friendly token (word-word-NNNN)
returns:
  filename    string  Original filename from SGMETA envelope
  blob        Blob    Decrypted file content
  objectUrl   string  Object URL for direct download (revoke when done!)
  token       string  Echo of input token
  transferId  string  Derived transfer ID
errors:
  Error('Invalid token format. Expected word-word-NNNN')  if malformed
  Error('Server returned 404')  if transfer not found
  Error('Server returned 401')  if access restricted
  Error('Invalid SGMETA — wrong token?')  if decryption fails (wrong token)
  Error('Download failed: ...')  on network error
side-effects:
  - Adds entry to localStorage history
  - Caller MUST revoke objectUrl to avoid memory leaks
```

```javascript
const result = await window.__tool.receiveFile('brave-apple-0742');
// Save to disk
const a = document.createElement('a');
a.href = result.objectUrl;
a.download = result.filename;
a.click();
URL.revokeObjectURL(result.objectUrl);  // important!
```

---

### receiveText

```
signature:   receiveText(token) → Promise<string>
async:       true
params:
  token   string  required
returns:    string — full text content of the file
note:       Calls receiveFile, reads blob.text(), revokes objectUrl
```

---

### receiveFolder

```
signature:   receiveFolder(token) → Promise<{ files: Array<{ filename, blob }>, token, transferId }>
async:       true
params:
  token   string  required
returns:
  files       Array<{ filename: string, blob: Blob }>  Individual files from the zip
  token       string
  transferId  string
note:
  - Calls receiveFile then unzips via JSZip (lazy-loaded from CDN)
  - Directory entries are skipped; only files returned
  - For non-zip tokens, JSZip.loadAsync will throw — call receiveFile instead
```

---

### getHistory

```
signature:   getHistory() → Array
async:       false
returns:     Array of history entries, newest-first (max 50)
  Each entry:
    type        'sent' | 'received'
    token       string     Friendly token
    transferId  string     Derived transfer ID
    url         string?    Full URL (sent only)
    filename    string?    Original filename (when known)
    timestamp   number     Date.now() at time of transfer
```

---

### clearHistory

```
signature:   clearHistory() → void
async:       false
side-effects: Removes localStorage history, re-renders History panel
```

---

### getState

```
signature:   getState() → object
async:       false
returns:
  hasAccessToken  boolean  True if an access token is set
  sendUrl         string   Active SG/Send base URL
  history         Array    Same as getHistory()
```

---

### setToken

```
signature:   setToken(token: string) → void
async:       false
side-effects: Pre-fills the token input in the Receive panel.
              Does NOT trigger a receive — user still clicks Receive.
note:         Useful for directing the user to receive a specific token.
```

---

### setAccessToken

```
signature:   setAccessToken(token: string) → void
async:       false
params:
  token  string  The SG/Send access token (x-sgraph-access-token header value)
side-effects:
  - Saves to localStorage as 'sgraph-send-token'
  - Updates the token input in the Send panel
  - Calls setAccessToken() on all sg-send-drop instances
note:   Call this before sendFile/sendText/sendFolder to avoid the
        'Access token required' error. Only needed once per browser session
        if the token is already in localStorage.
```

---

## Window Events

All events dispatched on `window`. All include `instanceId` in detail.

```
tool:ready
  when:   page load, after api.activate()
  detail: { instanceId, tool, version: { api, ui } }

tool:generation:complete
  when:   sendFile, sendText, or sendFolder succeeds
  detail: { instanceId, token, transferId, url }

tool:generation:error
  when:   any send or receive operation throws
  detail: { instanceId, error: string }
```

---

## Component API — sg-send-drop

Use this component on any tool page to add "share via SG/Send" without importing the reference tool.

```
Path:   /components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.js
Tag:    <sg-send-drop>
Events: sg-send-start, sg-send-progress, sg-send-complete, sg-send-error, sg-send-auth-required

Attributes:
  send-url    string   Override SG/Send base URL
  label       string   Drop zone label text
  auto-upload boolean  Start upload immediately when offerFile() is called
  disabled    boolean  Disable drag-and-drop

Methods:
  setAccessToken(token: string) → void
  offerFile(blob: Blob, filename: string) → void
  offerFiles(files: Array<{ blob, filename }>, zipName?: string) → Promise<void>  (zips first)
  reset() → void

sg-send-complete event detail:
  token       string  Friendly token (word-word-NNNN)
  transferId  string  12-char hex
  url         string  Full browse URL
```

**The pattern for any tool that produces output:**

```javascript
// In the tool's JS (e.g. video-recorder, infographic-gen, playbooklm):
import '/components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.js';

// Add to UI once
const drop = document.createElement('sg-send-drop');
drop.setAttribute('label', 'Share via SG/Send');
drop.setAccessToken(localStorage.getItem('sgraph-send-token'));
someExportPanel.appendChild(drop);

// After generating the output (e.g. recording stopped):
drop.offerFile(recordingBlob, 'recording.webm');
// User sees: file info + "Share via SG/Send" button → progress → token

drop.addEventListener('sg-send-complete', (e) => {
    console.log('Token:', e.detail.token);
    // Optionally store in your tool's state
});
```

This is the pattern that would have replaced ~100 lines in the video recorder.

---

## Component API — sg-send-receive

Use this component on any tool page to receive files without the reference tool.

```
Path:   /components/send-receive/v0/v0.1/v0.1.0/sg-send-receive.js
Tag:    <sg-send-receive>
Events: sg-receive-start, sg-receive-progress, sg-receive-complete, sg-receive-error

Attributes:
  send-url    string  Override SG/Send base URL
  token       string  Pre-fill the token input
  placeholder string  Input placeholder text

Methods:
  receive(token?: string) → Promise<{ filename, blob, objectUrl, token, transferId }>
  setToken(token: string) → void  (pre-fills without triggering receive)
  reset() → void

sg-receive-complete event detail:
  filename    string  Original filename
  blob        Blob    Decrypted file content
  objectUrl   string  Object URL (revoke when done)
  token       string  The token used
  transferId  string  Derived transfer ID
```

---

## Integration Patterns

### Pattern 1: Export panel in any tool

```javascript
// Tool produces a Blob (video, PDF, zip, etc.)
// Just drop in sg-send-drop and call offerFile — done.

import '/components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.js';

function buildExportPanel(container, state) {
    container.innerHTML = `
        <h3>Export</h3>
        <button id="btn-download">⬇ Download</button>
        <sg-send-drop label="📤 Share via SG/Send" id="send-drop"></sg-send-drop>
    `;
    const drop = container.querySelector('#send-drop');
    drop.setAccessToken(localStorage.getItem('sgraph-send-token'));

    container.querySelector('#btn-download').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(state.outputBlob);
        a.download = state.filename;
        a.click();
    });

    // Call this when output is ready:
    return {
        offerOutput: (blob, filename) => drop.offerFile(blob, filename),
    };
}
```

### Pattern 2: Programmatic send (no UI needed)

```javascript
// For background/automated sends (e.g. auto-share on completion)
import { uploadFile } from '/core/send-crypto/v1/v1.0/v1.0.0/sg-send-upload.js';

const { token } = await uploadFile(
    blob,
    filename,
    'https://send.sgraph.ai',
    localStorage.getItem('sgraph-send-token'),
    ({ percent, stage }) => console.log(percent, stage)
);
```

### Pattern 3: Token pre-fill from another tool

```javascript
// Tool A sends a file and wants Tool B to receive it automatically
const { token } = await window.__tool.sendFile(myBlob);
// Open the receive tool in a new tab and pre-fill
window.open(`/en-gb/send-receive/#receive=${token}`, '_blank');
// (URL hash receive= would need tool support — currently only setToken() API)
```

---

## Known Limitations

```
download-endpoint-assumption:
  The receive path uses GET /api/transfers/download/{transferId}.
  If the SG/Send server uses a different download endpoint (e.g. presigned S3 URL),
  the sg-send-receive component will return a 404 and the receive will fail.
  In that case: update the fetch URL in sg-send-receive.js#startReceive().

access-token-for-send:
  Sending always requires an access token (x-sgraph-access-token header).
  Receiving does not require an access token — only the token.
  Tokens are available from send.sgraph.ai after account creation.

folder-receive-format:
  receiveFolder assumes the token is for a zip file.
  If you sendFile(blob) with a .zip name, receiveFolder will still work.
  If you sendFile(blob) with a non-zip name, receiveFolder will throw from JSZip.

jszip-lazy-load:
  sendFolder and receiveFolder lazy-load JSZip from the CDN.
  First call takes ~100ms for network fetch; subsequent calls use the cached module.

objectUrl-lifecycle:
  receiveFile and receiveFolder return Blob object URLs.
  You MUST call URL.revokeObjectURL(result.objectUrl) when done
  to prevent memory leaks. receiveText does this automatically.

single-instance:
  window.__tool points to the single instance on the send-receive tool page.
  For multi-panel pages, use window.__tool_registry.find('sg-send-receive').
```

---

## Dependencies

```
core:
  sg-layout      /core/sg-layout/v0.1.0/sg-layout.js
  sg-tool-api    /core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js
  sg-send-crypto /core/send-crypto/v1/v1.0/v1.0.0/sg-send-crypto.js
  sg-send-upload /core/send-crypto/v1/v1.0/v1.0.0/sg-send-upload.js

components:
  sg-send-drop         /components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.js
  sg-send-receive      /components/send-receive/v0/v0.1/v0.1.0/sg-send-receive.js
  sg-tool-api-explorer /components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/
  sg-tool-api-console  /components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/
  sg-tool-api-manifest /components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/

shared:
  sg-site-header /components/site-header/v1/v1.0/v1.0.1/sg-site-header.js
```
