# PlaybookLM — Browser / Playwright Automation Guide

**Tool:** PlaybookLM v0.1.39
**URL:** `/v0/v0.1/v0.1.39/en-gb/playbooklm/`

## Prerequisites

```javascript
// Wait for tool:ready before any API calls
await page.waitForFunction(() => !!window.__tool);
```

## Full Pipeline Automation

```javascript
// 1. Connect
await page.evaluate(async () => {
  await window.__tool.connect({ apiKey: 'sk-or-v1-…' });
});

// 2. Load sources (inject text content directly)
await page.evaluate(async () => {
  await window.__tool.loadSources([
    { name: 'report.txt', type: 'text/plain', textContent: 'Q3 revenue increased 42%...' },
    { name: 'strategy.md', type: 'text/markdown', textContent: '# Strategy\n...' },
  ]);
});

// 3. Generate presentation strategy
await page.evaluate(async () => {
  await window.__tool.generatePresentation({});
});

// 4. Generate slide briefs (8 slides)
await page.evaluate(async () => {
  await window.__tool.generateSlideBriefs({ count: 8 });
});

// 5. Generate all slide images
await page.evaluate(async () => {
  await window.__tool.generateAllSlides({});
});

// 6. Export PDF
await page.evaluate(async () => {
  await window.__tool.exportDeck({ format: 'pdf' });
});
```

## State Inspection

```javascript
// Full pipeline state
const state = await page.evaluate(() => window.__tool.getState());
console.log(state.sources.length, 'sources');
console.log(state.slideBriefs.length, 'briefs');
console.log(state.slideResults.filter(r => r.status === 'complete').length, 'complete');

// Quick status
const status = await page.evaluate(() => window.__tool.getPipelineStatus());
// { connected, sourceCount, briefCount, slideCount, stopped }
```

## Editing Briefs Programmatically

```javascript
// Get current briefs
const briefs = await page.evaluate(() => window.__tool.getSlideBriefs());

// Edit a specific brief
await page.evaluate(() => {
  window.__tool.setSlideBrief({ index: 0, brief: { title: 'Executive Summary', prompt: 'A dark slide with a bold headline...' } });
});

// Add a brief
await page.evaluate(() => {
  window.__tool.addSlideBrief({ title: 'Thank You', prompt: 'A closing slide with contact details...' });
});

// Remove the last brief
const count = await page.evaluate(() => window.__tool.getSlideBriefs().length);
await page.evaluate(i => window.__tool.removeSlideBrief(i), count - 1);
```

## Generating Individual Slides

```javascript
// Generate slide at index 2
const result = await page.evaluate(async () => {
  return await window.__tool.generateSlide({ index: 2 });
});
// result: { index: 2, imageSrc: 'data:image/png;base64,...' }
```

## Stopping the Pipeline

```javascript
await page.evaluate(() => window.__tool.stop());
```

## Listening to Events

```javascript
// In page context
window.addEventListener('tool:ready', e => console.log('ready', e.detail));

// Monitor slide completions
window.addEventListener('plm:slide-complete', e => {
  console.log('Slide', e.detail.index, 'done');
});
```

## Waiting for All Slides

```javascript
await page.evaluate(async () => {
  await window.__tool.generateAllSlides({});
  const results = window.__tool.getSlideResults();
  const complete = results.filter(r => r.status === 'complete');
  console.log(complete.length, 'slides complete');
});
```
