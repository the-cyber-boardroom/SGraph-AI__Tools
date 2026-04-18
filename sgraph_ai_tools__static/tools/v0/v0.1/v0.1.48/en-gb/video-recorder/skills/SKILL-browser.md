# Video Recorder — Browser Automation Guide (Playwright)

## Setup
```js
await page.goto('https://tools.sgraph.ai/tools/v0/v0.1/v0.1.48/en-gb/video-recorder/');
await page.waitForEvent('tool:ready');
```

## Full pipeline (camera+audio mode)
```js
// 1. Set mode
const modeResult = await page.evaluate(() =>
    window.__tool.setMode({ mode: 'camera+audio' })
);
console.log(modeResult); // { mode: 'camera+audio', supported: true }

// 2. Start recording (user gesture required for screen modes — use page.click() instead)
const recordStart = page.waitForEvent('tool:record:start', { timeout: 30_000 });
await page.evaluate(() => window.__tool.startRecording({ format: 'webm' }));
await recordStart;
console.log('Recording started');

// 3. Wait some time, then stop
await page.waitForTimeout(5000);
const stopResult = await page.evaluate(() => window.__tool.stopRecording());
console.log(`Duration: ${stopResult.durationMs}ms, Size: ${stopResult.sizeBytes} bytes`);

// 4. Save to SG/Send
const saveComplete = page.waitForEvent('tool:save:complete', { timeout: 120_000 });
await page.evaluate(() => window.__tool.saveSendFile({ filename: 'test.webm' }));
const saved = await saveComplete;
console.log(`Token: ${saved.detail.token}`);
console.log(`URL: ${saved.detail.url}`);
```

## Screen recording (requires user gesture)
```js
// Click the record button directly — do NOT call startRecording() via evaluate() for screen modes
// as getDisplayMedia() requires a real user gesture
await page.click('#btn-record');
await page.waitForEvent('tool:record:start', { timeout: 30_000 });
// Playwright's browser picker will appear — handle it via page.waitForEvent('popup') if needed
```

## Status polling
```js
const status = await page.evaluate(() => window.__tool.getStatus());
// { status, mode, durationMs, sizeBytes, hasBlob, lastError }

const config = await page.evaluate(() => window.__tool.getConfig());
// { mode, format, fps, videoBitsPerSecond, audioBitsPerSecond, pipOptions }
```

## Config override
```js
await page.evaluate(() => window.__tool.setConfig({
    videoBitsPerSecond: 1_000_000,
    audioBitsPerSecond: 64_000,
}));
```
