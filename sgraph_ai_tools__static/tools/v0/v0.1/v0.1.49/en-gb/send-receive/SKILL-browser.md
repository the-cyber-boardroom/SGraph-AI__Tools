# Send / Receive — Browser / Playwright Automation Guide

**Tool:** sg-send-receive  
**Registry:** `window.__tool` / `window.__tool_registry.find('sg-send-receive')`  
**Environment:** Browser only (HTTPS or localhost). Access token required for send.

---

## Setup

```javascript
// Navigate to the tool
await page.goto('https://dev.tools.sgraph.ai/en-gb/send-receive/');

// Wait for JS API to be ready
await page.waitForFunction(() => window.__tool?.meta?.health?.().status === 'ok');
```

---

## Check API is live

```javascript
const health = await page.evaluate(() => window.__tool.meta.health());
// { status: 'ok', name: 'sg-send-receive', methods: [...], version: {...} }

const methods = await page.evaluate(() => window.__tool.meta.getMethods());
// ['sendFile', 'sendText', 'sendFolder', 'receiveFile', 'receiveText', 'receiveFolder',
//  'getHistory', 'clearHistory', 'getState', 'setToken', 'setAccessToken']
```

---

## Send a File

```javascript
// Step 1: set the access token
await page.evaluate(token => window.__tool.setAccessToken(token), process.env.SG_SEND_TOKEN);

// Step 2: create a File object and send it
const result = await page.evaluate(async () => {
    const content = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const file    = new File([content], 'hello.txt', { type: 'text/plain' });
    return window.__tool.sendFile(file);
});
// result: { token: 'brave-apple-0742', transferId: '1a2b3c4d5e6f', url: 'https://send.sgraph.ai/...' }

console.log('Share token:', result.token);
```

---

## Send Text

```javascript
const result = await page.evaluate(async () => {
    await window.__tool.setAccessToken(process.env.SG_SEND_TOKEN);
    return window.__tool.sendText('Hello, world!', { filename: 'message.txt' });
});
// { token, transferId, url }
```

---

## Send a Folder (multiple files)

```javascript
const result = await page.evaluate(async () => {
    const files = [
        new File(['# README'], 'README.md'),
        new File(['console.log("hi")'], 'index.js'),
    ];
    return window.__tool.sendFolder(files, { filename: 'project.zip' });
});
// Zips the files and uploads as a single token
```

---

## Receive a File

```javascript
const received = await page.evaluate(async (token) => {
    const result = await window.__tool.receiveFile(token);
    // result: { filename, blob, objectUrl, token, transferId }
    const text = await result.blob.text();
    URL.revokeObjectURL(result.objectUrl);
    return { filename: result.filename, text };
}, 'brave-apple-0742');

console.log(received.filename, received.text);
```

---

## Receive Text

```javascript
const text = await page.evaluate(token => window.__tool.receiveText(token), 'brave-apple-0742');
// Returns the full text content as a string
```

---

## Receive a Folder

```javascript
const { files } = await page.evaluate(async (token) => {
    const result = await window.__tool.receiveFolder(token);
    // result: { files: [{ filename, blob }], token, transferId }
    const fileList = [];
    for (const f of result.files) {
        const text = await f.blob.text();
        fileList.push({ filename: f.filename, text });
    }
    return { files: fileList };
}, 'brave-apple-0742');
```

---

## Round-Trip Test

```javascript
const token_env = process.env.SG_SEND_TOKEN;

// Send
const { token } = await page.evaluate(async (accessToken) => {
    await window.__tool.setAccessToken(accessToken);
    return window.__tool.sendText('round-trip test content', { filename: 'test.txt' });
}, token_env);

// Receive on same page (real use case: different browser/device)
const text = await page.evaluate(t => window.__tool.receiveText(t), token);
assert(text === 'round-trip test content');
```

---

## History

```javascript
// Get all transfer history
const history = await page.evaluate(() => window.__tool.getHistory());
// [{ type: 'sent'|'received', token, transferId, url?, filename?, timestamp }]

// Clear it
await page.evaluate(() => window.__tool.clearHistory());
```

---

## getState

```javascript
const state = await page.evaluate(() => window.__tool.getState());
// {
//   hasAccessToken: true,       // whether an access token is set
//   sendUrl: 'https://send.sgraph.ai',
//   history: [...]
// }
```

---

## Using from Another Tool's Page (same browser session)

If another tool needs to send a file, the cleanest approach is to use the `<sg-send-drop>` component directly (no page navigation needed):

```javascript
// Any page: import sg-send-drop and use it
import '/components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.js';

const drop = document.createElement('sg-send-drop');
document.body.appendChild(drop);
drop.setAccessToken(localStorage.getItem('sgraph-send-token'));
drop.offerFile(myBlob, 'recording.webm');

drop.addEventListener('sg-send-complete', (e) => {
    console.log('Token:', e.detail.token);  // 'brave-apple-0742'
    console.log('URL:',   e.detail.url);
});
```

---

## Using the Component API (sg-send-receive)

```javascript
import '/components/send-receive/v0/v0.1/v0.1.0/sg-send-receive.js';

const el = document.createElement('sg-send-receive');
document.body.appendChild(el);

el.addEventListener('sg-receive-complete', (e) => {
    const { filename, blob, objectUrl } = e.detail;
    // Download or process the file
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
});

// Pre-fill token and trigger receive
await el.receive('brave-apple-0742');
```

---

## Full Playwright Smoke Test

```javascript
import { test, expect } from '@playwright/test';

const TOOL_URL  = 'https://dev.tools.sgraph.ai/en-gb/send-receive/';
const API_TOKEN = process.env.SG_SEND_TOKEN ?? '';

test('window.__tool is live', async ({ page }) => {
    await page.goto(TOOL_URL);
    await page.waitForFunction(() => !!window.__tool?.meta);
    const health = await page.evaluate(() => window.__tool.meta.health());
    expect(health.status).toBe('ok');
});

test('all 11 methods present', async ({ page }) => {
    await page.goto(TOOL_URL);
    await page.waitForFunction(() => !!window.__tool?.meta);
    const methods = await page.evaluate(() => window.__tool.meta.getMethods());
    const required = ['sendFile','sendText','sendFolder','receiveFile','receiveText',
                      'receiveFolder','getHistory','clearHistory','getState','setToken','setAccessToken'];
    for (const m of required) expect(methods).toContain(m);
});

test('getState returns expected shape', async ({ page }) => {
    await page.goto(TOOL_URL);
    await page.waitForFunction(() => !!window.__tool?.meta);
    const state = await page.evaluate(() => window.__tool.getState());
    expect(typeof state.hasAccessToken).toBe('boolean');
    expect(typeof state.sendUrl).toBe('string');
    expect(Array.isArray(state.history)).toBe(true);
});

test('manifest has api section', async ({ page }) => {
    await page.goto(TOOL_URL);
    await page.waitForFunction(() => !!window.__tool?.meta);
    const manifest = await page.evaluate(() => window.__tool.meta.getManifest());
    expect(manifest.api?.version).toBeTruthy();
    expect(manifest.api?.actions?.sendFile).toBeTruthy();
    expect(manifest.api?.actions?.receiveFile).toBeTruthy();
});

test('all 3 skill files accessible', async ({ page }) => {
    await page.goto(TOOL_URL);
    await page.waitForFunction(() => !!window.__tool?.meta);
    const skills = await page.evaluate(() => window.__tool.meta.getSkills());
    expect(skills).toHaveProperty('human');
    expect(skills).toHaveProperty('browser');
    expect(skills).toHaveProperty('api');
});

test.skip(!'SG_SEND_TOKEN' in process.env, 'send round-trip (requires access token)', async ({ page }) => {
    await page.goto(TOOL_URL);
    await page.waitForFunction(() => !!window.__tool?.meta);
    await page.evaluate(t => window.__tool.setAccessToken(t), API_TOKEN);

    const { token } = await page.evaluate(() =>
        window.__tool.sendText('Playwright round-trip', { filename: 'pw-test.txt' })
    );
    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);

    const text = await page.evaluate(t => window.__tool.receiveText(t), token);
    expect(text).toBe('Playwright round-trip');
});
```
