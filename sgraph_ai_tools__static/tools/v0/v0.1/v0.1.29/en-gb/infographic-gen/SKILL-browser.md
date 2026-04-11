# Infographic Generator — Browser Automation Guide

**Tool:** Infographic Generator v0.1.29
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
```

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

// result shape:
// {
//   instanceId:  'infographic-generator:root',
//   generationId: 'gen_abc123',   // OpenRouter generation ID (or null for some models)
//   model:        'google/gemini-2.0-flash-exp:free',
//   duration:     11.4,           // seconds
//   imageSrc:     'data:image/png;base64,...'  // or https: URL, or null for SVG models
// }
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
//     document:          null              // or { name, type } in document mode
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

// All events carry { instanceId, ... } in detail
// complete also carries { generationId, model, duration, imageSrc }
```

---

## Meta / Discovery

```js
window.__tool.meta.health();
// → { status: 'ready', instanceId: 'infographic-generator:root',
//     methodCount: 9, methods: ['connect','generate',...] }

window.__tool.meta.getMethods();
// → ['connect', 'generate', 'getState', 'setPrompt', 'getPrompt',
//    'setModel', 'getModel', 'setTemplate', 'stop']

window.__tool.meta.getVersion();
// → { api: '0.1.0', ui: '0.1.29', content: '0.1.0' }

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

    // Generate
    const result = await page.evaluate(async () => {
        return await window.__tool.generate({
            prompt: 'A simple 3-step process flow: Plan → Build → Ship',
            model:  'google/gemini-2.0-flash-exp:free',
        });
    });

    console.log('Generation complete:');
    console.log('  model:    ', result.model);
    console.log('  duration: ', result.duration + 's');
    console.log('  imageSrc: ', result.imageSrc ? result.imageSrc.substring(0, 60) + '...' : 'null');

    // Assert
    if (!result.imageSrc) throw new Error('Expected an image src but got null');
    console.log('✓ Test passed');

    await browser.close();
})();
```

---

## Known Limitations

- **FIFO concurrent queue:** calling `generate()` twice before the first completes will
  resolve both promises in arrival order. For parallel generation, listen to
  `tool:generation:complete` events directly rather than awaiting multiple `generate()` calls.
- **imageSrc is null for SVG/text models:** some models return SVG markup as text rather than
  an image URL. In this case `imageSrc` is null and the SVG appears in the result tab.
- **connect() re-validates on every call:** even if already connected, each `connect()` call
  hits the OpenRouter API. This is intentional for key rotation scenarios.
