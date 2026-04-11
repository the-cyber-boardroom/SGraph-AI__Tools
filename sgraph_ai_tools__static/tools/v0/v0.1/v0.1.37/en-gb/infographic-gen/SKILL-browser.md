# Infographic Generator — Browser Automation Guide

**Tool:** Infographic Generator v0.1.37
**API object:** `window.__tool` (set after page load)
**Registry:** `window.__tool_registry` (for multi-instance pages)

This guide covers driving the Infographic Generator programmatically from the browser
console, Playwright tests, or any script that can evaluate JavaScript on the page.

---

## API Overview

After the page loads, `window.__tool` is a live `SgToolApi` instance:

```js
window.__tool            // SgToolApi instance
window.__tool.meta       // { getManifest, getMethods, getSkills, getVersion, health, getLog }
window.SGA_TOOL          // frozen event name constants
```

For pages with multiple instances (fractal sg-layout):
```js
window.__tool_registry.find('infographic-generator')    // first instance
window.__tool_registry.findAll('infographic-generator') // all instances
window.__tool_registry.findById('infographic-generator:root') // by exact ID
```

---

## Connect

```js
// Connect with an API key (fires tool:connected on success)
await window.__tool.connect({ apiKey: 'sk-or-v1-...' });
// → { model: 'google/gemini-2.0-flash-exp:free', provider: 'openrouter' }

// Connect and switch model at the same time
await window.__tool.connect({ apiKey: 'sk-or-v1-...', model: 'openai/gpt-4o' });

// Skip-if-same-key: if apiKey+model unchanged, resolves immediately with no network call
await window.__tool.connect({ apiKey: 'sk-or-v1-...' }); // instant second call
```

---

## System Prompt Control

```js
// Override the system prompt before generating (new in v0.1.37)
window.__tool.setSystemPrompt(
    'You are a professional infographic designer. ' +
    'Use only dark backgrounds with teal and white text. ' +
    'Always output SVG with a 16:9 aspect ratio.'
);
window.__tool.getSystemPrompt();
// → 'You are a professional infographic designer. ...'

// Reset to mode default
window.__tool.setSystemPrompt('');
```

This eliminates the need to embed override instructions inside the user prompt.
The system prompt is set once and applies to all subsequent `generate()` calls.

---

## Generate

```js
// Generate with current prompt + model
const result = await window.__tool.generate();

// Generate with a specific prompt
const result = await window.__tool.generate({
    prompt: 'A timeline of major AI breakthroughs from 2017 to 2025'
});

// Generate with a specific model
const result = await window.__tool.generate({
    prompt: 'Executive summary of Q3 results: revenue up 12%, costs down 8%',
    model: 'google/gemini-2.0-flash-exp:free'
});

// Headless (no UI tab created — events and Promise still resolve)
const result = await window.__tool.generate({
    prompt: 'A simple 3-step process',
    renderUI: false
});

// result shape:
// {
//   instanceId:  'infographic-generator:root',
//   callId:      'f3a2b1c0-...',   // UUID — unique per generate() call
//   generationId: 'gen_abc123',    // OpenRouter generation ID (or null for some models)
//   model:        'google/gemini-2.0-flash-exp:free',
//   duration:     11.4,            // seconds
//   imageSrc:     'data:image/png;base64,...'  // or https: URL, or null for SVG models
// }
```

### Concurrent Generation

`callId` is a `crypto.randomUUID()` generated per `generate()` call, threaded through
all window events. Concurrent calls are independent — no FIFO ordering required:

```js
// Fire two generations concurrently — both resolve correctly
const [r1, r2] = await Promise.all([
    window.__tool.generate({ prompt: 'A mind map of ML', model: 'openai/gpt-4o' }),
    window.__tool.generate({ prompt: 'A timeline of AI', model: 'google/gemini-2.0-flash-exp:free' }),
]);
```

---

## Generation Log (Audit Trail)

```js
// Get the full request/response history for this session (new in v0.1.37)
// Ring buffer — newest first, max 50 entries
const log = window.__tool.getGenerations();

// Get the last N entries
const last3 = window.__tool.getGenerations(3);

// Each record contains:
const rec = log[0];
rec.callId;                          // UUID matching generate() Promise and window events
rec.timestamp;                       // Date.now() at request dispatch
rec.model;                           // Model used
rec.prompt;                          // Text prompt
rec.request.messages;                // Exact multimodal array sent to sg-llm-request
rec.request.model;                   // Model ID in request
rec.response.content;                // Full LLM response text/SVG
rec.response.promptTokens;           // Input token count
rec.response.completionTokens;       // Output token count
rec.response.latencyMs;              // Network + model latency
rec.response.finishReason;           // 'stop' | 'length' | etc.
rec.imageSrc;                        // Rendered image URL (or null)
rec.duration;                        // Wall-clock seconds
rec.status;                          // 'complete' | 'error' | 'cancelled'

// Inspect multimodal request (e.g. when an image was attached):
rec.request.messages[0];
// { role: 'user', content: [
//     { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } },
//     { type: 'text', text: 'Create an infographic in this style...' }
// ]}
```

---

## Access the Image

```js
const result = await window.__tool.generate({ prompt: 'A mind map of machine learning' });

if (result.imageSrc) {
    // data: URL — can be embedded directly
    const img = new Image();
    img.src = result.imageSrc;
    document.body.appendChild(img);

    // Or download it
    const a = document.createElement('a');
    a.href = result.imageSrc;
    a.download = 'infographic.png';
    a.click();
}
```

---

## State Inspection

```js
window.__tool.getState();
// → {
//     mode:              'text',           // 'text' | 'document'
//     prompt:            'A timeline...',
//     model:             'openai/gpt-4o',
//     connected:         true,
//     activeGenerations: 0,
//     systemPrompt:      'You are a professional infographic designer...',
//     document:          null,             // or { name, type } in document mode
//     image:             null             // or { name } when 📎 image attached in text mode
//   }
```

---

## Set Prompt and Templates

```js
// Set prompt directly
window.__tool.setPrompt('A comparison of React, Vue, and Svelte');
window.__tool.getPrompt(); // → 'A comparison of React, Vue, and Svelte'

// Load a built-in template by id or label
window.__tool.setTemplate('timeline');      // by id
window.__tool.setTemplate('Mind Map');      // by label (case-insensitive)
// → returns the prompt string

// Available template ids:
// executive | architecture | timeline | comparison | process | stats | mindmap
```

---

## Model Control

```js
window.__tool.getModel();             // → 'google/gemini-2.0-flash-exp:free'
window.__tool.setModel('openai/gpt-4o');
```

---

## Stop / Cancel

```js
// Cancel all active generations
window.__tool.stop();
```

---

## Listen to Events

```js
// Set up listeners before generating
window.addEventListener('tool:ready',                e => console.log('ready',     e.detail));
window.addEventListener('tool:connected',            e => console.log('connected', e.detail));
window.addEventListener('tool:generation:started',   e => console.log('started',   e.detail));
window.addEventListener('tool:generation:complete',  e => console.log('complete',  e.detail));
window.addEventListener('tool:generation:error',     e => console.log('error',     e.detail));
window.addEventListener('tool:generation:cancelled', e => console.log('cancelled', e.detail));

// All events carry { instanceId, callId, ... } in detail
// complete also carries { generationId, model, duration, imageSrc }
```

---

## Meta / Discovery

```js
window.__tool.meta.health();
// → { status: 'ready', instanceId: 'infographic-generator:root',
//     methodCount: 12, methods: ['connect','generate',...] }

window.__tool.meta.getMethods();
// → ['connect', 'generate', 'getState', 'getGenerations',
//    'setSystemPrompt', 'getSystemPrompt',
//    'setPrompt', 'getPrompt', 'setModel', 'getModel', 'setTemplate', 'stop']

window.__tool.meta.getVersion();
// → { api: '0.1.0', ui: '0.1.37', content: '0.1.0' }

await window.__tool.meta.getManifest();
// → full manifest.json object including api.actions schema

window.__tool.meta.getLog();
// → array of last 500 method call records with params, result, duration

await window.__tool.meta.getSkills();
// → { human: '# Infographic Generator...', browser: '...', api: '...' }
```

---

## Full Playwright Example

```js
// playwright-test.js
const { chromium } = require('playwright');

const PAGE_URL  = 'http://localhost:10063/en-gb/infographic-gen/';
const API_KEY   = process.env.OPENROUTER_API_KEY;

(async () => {
    const browser = await chromium.launch();
    const page    = await browser.newPage();
    await page.goto(PAGE_URL);

    // Wait for window.__tool to be ready
    await page.waitForFunction(() => window.__tool?.meta.health().status === 'ready');

    // Connect
    const conn = await page.evaluate(async (key) => {
        return await window.__tool.connect({ apiKey: key });
    }, API_KEY);
    console.log('Connected:', conn);

    // Set a custom system prompt
    await page.evaluate(() => {
        window.__tool.setSystemPrompt(
            'You are a professional infographic designer. ' +
            'Use a dark background, teal accent colour, and output SVG.'
        );
    });

    // Generate
    const result = await page.evaluate(async () => {
        return await window.__tool.generate({
            prompt: 'A simple 3-step process flow: Plan → Build → Ship',
            model:  'google/gemini-2.0-flash-exp:free',
        });
    });

    console.log('Generation complete:');
    console.log('  callId:   ', result.callId);
    console.log('  model:    ', result.model);
    console.log('  duration: ', result.duration + 's');
    console.log('  imageSrc: ', result.imageSrc ? result.imageSrc.substring(0, 60) + '...' : 'null');

    // Inspect the full request/response log
    const log = await page.evaluate(() => window.__tool.getGenerations(1));
    console.log('Prompt tokens:', log[0].response?.promptTokens);
    console.log('Finish reason:', log[0].response?.finishReason);

    // Assert
    if (!result.imageSrc) throw new Error('Expected an image src but got null');
    console.log('✓ Test passed');

    await browser.close();
})();
```

---

## Known Limitations

- **imageSrc is null for SVG/text models:** some models return SVG markup as text rather than
  an image URL. In this case `imageSrc` is null and the SVG appears in the result tab.
- **Image attachment is UI-only:** the 📎 button loads an image into memory; there is no
  `setImage()` API method. If attached, the image is included automatically in the next
  `generate()` call. Use `getState().image` to confirm attachment status.
  `getGenerations()` records the exact multimodal messages array (including image_url parts).
- **connect() skip-if-same-key:** if apiKey and model are unchanged from the last successful
  connect, resolves immediately without hitting OpenRouter. Pass a new key or model to re-validate.
- **Generation log is session-only:** `getGenerations()` is an in-memory ring buffer (max 50).
  It does not persist across page reloads.
