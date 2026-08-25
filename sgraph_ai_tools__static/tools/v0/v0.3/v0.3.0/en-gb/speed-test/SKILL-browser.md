# Speed Test — Browser / Playwright Guide

**Tool:** Speed Test v0.1.39
**Audience:** Automation scripts, Playwright tests, browser console

---

## Access `window.__tool`

```javascript
// Wait for tool to be ready
await page.waitForFunction(() => window.__tool?.meta?.health()?.status === 'ready');

// Verify methods
const methods = await page.evaluate(() => window.__tool.meta.getMethods());
// → ['runAll', 'runSim', 'runUpload', 'runDownload', 'cancel',
//    'setMode', 'setTarget', 'setAccessToken', 'setDownloadUrl',
//    'getLastResult', 'getHistory']
```

---

## Sim mode benchmark

```javascript
// Run sim benchmark (no server required)
await page.evaluate(async () => {
    const result = await window.__tool.runSim({ sizeBytes: 4 * 1024 * 1024 });
    console.log('encrypt:', result.encryptLabel, 'decrypt:', result.decryptLabel);
});

// Or trigger the full UI run (uses current probe size)
await page.click('#run-btn');
await page.waitForFunction(() => window.__tool.getLastResult() !== null);
const r = await page.evaluate(() => window.__tool.getLastResult());
```

---

## Live mode (requires server)

```javascript
// Configure and run live upload + download
await page.evaluate(async (token) => {
    window.__tool.setMode('live');
    window.__tool.setTarget('https://send.sgraph.ai');
    window.__tool.setAccessToken(token);
    await window.__tool.runAll();
}, process.env.SG_ACCESS_TOKEN);

const result = await page.evaluate(() => window.__tool.getLastResult());
console.log('upload:',   result.upload?.label);
console.log('download:', result.download?.label);
```

---

## Low-level: runUpload / runDownload

```javascript
// Upload only
const ulResult = await page.evaluate(async (tok) => {
    return await window.__tool.runUpload({
        sendUrl:     'https://send.sgraph.ai',
        accessToken: tok,
        sizeBytes:   2 * 1024 * 1024,
    });
}, process.env.SG_ACCESS_TOKEN);
// ulResult: { type, bps, mbps, label, bytesTotal, durationMs, transferId, token, downloadUrl }

// Download only — pass any direct binary URL
const dlResult = await page.evaluate(async (url) => {
    return await window.__tool.runDownload(url);
}, 'https://example.com/test-payload.bin');
```

---

## History and statistics

```javascript
// Run 3 sim tests to build history
for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__tool.runSim());
    await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
}

const history = await page.evaluate(() => window.__tool.getHistory());
// → [{ ts: 1744567890123, result: SimResult }, ...]

// Manual stats
const encBps = history.map(h => h.result.encryptBps ?? 0).filter(Boolean);
const avg = encBps.reduce((a, b) => a + b, 0) / encBps.length;
console.log('avg encrypt:', (avg / 1_048_576).toFixed(1), 'MB/s');
```

---

## Cancel a running test

```javascript
// Start a test in the background and cancel after 1s
page.evaluate(() => window.__tool.runAll());
await page.waitForTimeout(1000);
await page.evaluate(() => window.__tool.cancel());
```

---

## Events

```javascript
// Listen for tool:ready
page.evaluate(() => {
    window.addEventListener('tool:ready', e => {
        console.log('tool ready, instance:', e.detail.instanceId);
    });
});
```

---

## Health check

```javascript
const health = await page.evaluate(() => window.__tool.meta.health());
// → { status: 'ready', methodCount: 11, version: '0.1.39', instanceId: '...' }
```

---

## Playwright smoke test snippet

```javascript
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page    = await browser.newPage();
    await page.goto('http://localhost:10063/en-gb/speed-test/');
    await page.waitForFunction(() => window.__tool?.meta?.health()?.status === 'ready');

    const health = await page.evaluate(() => window.__tool.meta.health());
    console.assert(health.status === 'ready');
    console.assert(health.methodCount >= 11);

    // Sim benchmark
    const simResult = await page.evaluate(() => window.__tool.runSim({ sizeBytes: 1 * 1024 * 1024 }));
    console.assert(simResult.type === 'sim');
    console.assert(simResult.encryptBps > 0, 'encrypt speed > 0');
    console.assert(simResult.decryptBps > 0, 'decrypt speed > 0');

    console.log('encrypt:', simResult.encryptLabel, 'decrypt:', simResult.decryptLabel);
    await browser.close();
})();
```
