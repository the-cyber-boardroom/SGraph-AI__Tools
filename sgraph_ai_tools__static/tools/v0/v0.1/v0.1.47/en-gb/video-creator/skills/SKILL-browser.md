# Video Creator — Browser Automation Guide (Playwright)

## Setup
```js
await page.goto('https://tools.sgraph.ai/tools/v0/v0.1/v0.1.47/en-gb/video-creator/');
await page.waitForEvent('tool:ready');  // fires when JS API is live
```

## Full pipeline example
```js
// 1. Load slides
const files = ['slide1.png', 'slide2.png'].map(f => ({ name: f, buffer: fs.readFileSync(f) }));
const result = await page.evaluate(async (slides) => {
  const fileList = slides.map(s => new File([new Uint8Array(s.buffer)], s.name, { type: 'image/png' }));
  return await window.__tool.loadSlides({ files: fileList });
}, files);
console.log(`Loaded ${result.count} slides`);

// 2. Set narrations
await page.evaluate(() => {
  window.__tool.setNarration({ slideIndex: 0, text: 'Welcome to our presentation.' });
  window.__tool.setNarration({ slideIndex: 1, text: 'Thank you for watching.' });
});

// 3. Generate audio (wait for tool:audio:complete)
const audioComplete = page.waitForEvent('tool:audio:complete', { timeout: 300_000 });
await page.evaluate(() => window.__tool.generateAudio({ voice: 'af_bella', speed: 1.0 }));
const audioResult = await audioComplete;
console.log(`Audio durations: ${audioResult.detail.durations}`);

// 4. Record
const recordStop = page.waitForEvent('tool:record:stop', { timeout: 600_000 });
await page.evaluate(() => window.__tool.record({ fps: 30 }));
await recordStop;

// 5. Download (get blob URL from state)
await page.evaluate(() => {
  const { webmBlob } = window.__tool.stopRecording();
  window.__tool.download({ blob: webmBlob, filename: 'output.webm' });
});
```

## API polling
```js
const status = await page.evaluate(() => window.__tool.getStatus());
// Returns: { slideCount, narrationCount, audioDurations, config, status, lastError, hasWebm }
```
