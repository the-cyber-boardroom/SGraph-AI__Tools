# OpenRouter — Browser / Playwright Guide

**Tool:** OpenRouter Dashboard v0.1.23
**JS API:** `window.__tool` (available after `tool:ready` fires)

## Loading the Page in Playwright

```javascript
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true });
const page    = await browser.newPage();

// Navigate to the tool (adjust base URL for local dev server)
await page.goto('http://localhost:8000/tools/v0/v0.1/v0.1.23/en-gb/openrouter/');

// Wait for window.__tool to be ready
await page.waitForFunction(() => window.__tool?.meta?.health()?.status === 'ready', { timeout: 10_000 });
```

---

## Connecting with an API Key

```javascript
// Connect with a user API key
const result = await page.evaluate(async apiKey => {
    return window.__tool.connect({ apiKey });
}, process.env.OPENROUTER_API_KEY);

console.log(result); // { provider: 'openrouter', balance: ..., limit: ... }
```

---

## Checking Connection State

```javascript
const state = await page.evaluate(() => window.__tool.getState());
console.log(state);
// {
//   userConnected: true,
//   adminConnected: false,
//   apiKey: '••••',          // always masked
//   balance: 4.235,
//   limit: null,
//   currency: 'USD'
// }
```

---

## Key Stats

```javascript
const stats = await page.evaluate(() => window.__tool.getKeyStats());
console.log(stats.label);           // Key name/label
console.log(stats.usage);           // Credits used
console.log(stats.limit);           // Credit limit (null = no limit)
console.log(stats.isFreeTier);      // true/false
console.log(stats.rateLimitRequests);
console.log(stats.rateLimitInterval);
```

---

## Models

```javascript
// Get all models
const allModels = await page.evaluate(() => window.__tool.getModels());
console.log(allModels.length); // ~200+

// Filter by query string
const gptModels = await page.evaluate(() =>
    window.__tool.getModels({ query: 'gpt' })
);

// Get top 5 models
const top5 = await page.evaluate(() =>
    window.__tool.getModels({ top: 5 })
);

// Get detail for a specific model
const detail = await page.evaluate(() =>
    window.__tool.getModelDetail('openai/gpt-4o')
);
console.log(detail.pricing); // { prompt: ..., completion: ... }
```

---

## Usage and Spending

```javascript
// Usage buckets (defaults to hourly)
const usage = await page.evaluate(() => window.__tool.getUsage());

// With a specific bucket duration
const daily = await page.evaluate(() =>
    window.__tool.getUsage({ bucketDuration: '1d' })
);

// Spending by model
const spending = await page.evaluate(() => window.__tool.getSpending());
```

---

## Generation Activity

```javascript
// Recent activity (last 25 by default)
const activity = await page.evaluate(() => window.__tool.getActivity());

// With pagination
const page2 = await page.evaluate(() =>
    window.__tool.getActivity({ limit: 50, offset: 50 })
);
```

---

## Admin: Key Management (requires management key)

```javascript
// Connect admin first
await page.evaluate(async mgmtKey => {
    // The management key is set via the vault or directly
    // For automation, call connect() then trigger admin connect via document event
    document.dispatchEvent(new CustomEvent('or:admin-connected', {
        detail: { managementKey: mgmtKey }
    }));
}, process.env.OPENROUTER_MANAGEMENT_KEY);

// Wait for admin state to update
await page.waitForFunction(() => window.__tool.getState().adminConnected, { timeout: 5_000 });

// List all provisioned keys
const keys = await page.evaluate(() => window.__tool.listKeys());
console.log(keys); // [{ hash, label, usage, limit, ... }]

// Create a new key
const newKey = await page.evaluate(() =>
    window.__tool.createKey({ name: 'playwright-test-key', limit: 1.0 })
);
console.log(newKey.key);  // sk-or-v1-… (shown ONCE — store immediately)
console.log(newKey.hash); // use this for deletion

// Delete the key
await page.evaluate(hash => window.__tool.deleteKey(hash), newKey.hash);
```

---

## Listening to Window Events

```javascript
// Listen for connection event before calling connect()
await page.evaluate(() => {
    window.__toolConnected = false;
    window.addEventListener('tool:connected', () => { window.__toolConnected = true; }, { once: true });
});

await page.evaluate(apiKey => window.__tool.connect({ apiKey }), process.env.OPENROUTER_API_KEY);

await page.waitForFunction(() => window.__toolConnected, { timeout: 10_000 });
```

---

## Full Copy-Paste Smoke Test

```javascript
const { chromium } = require('playwright');

(async () => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
    const BASE = process.env.BASE_URL || 'http://localhost:8000';

    const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
    const page    = await browser.newPage();

    await page.goto(`${BASE}/tools/v0/v0.1/v0.1.23/en-gb/openrouter/`);
    await page.waitForFunction(() => window.__tool?.meta?.health()?.status === 'ready', { timeout: 10_000 });
    console.log('[1] window.__tool ready ✓');

    // Verify expected methods
    const methods = await page.evaluate(() => window.__tool.meta.getMethods());
    const required = ['connect','disconnect','getState','getKeyStats','getModels',
                      'getModelDetail','getUsage','getSpending','getActivity',
                      'listKeys','createKey','deleteKey'];
    const missing = required.filter(m => !methods.includes(m));
    if (missing.length) throw new Error(`Missing methods: ${missing.join(', ')}`);
    console.log('[2] all methods present ✓');

    // Verify manifest
    const manifest = await page.evaluate(() => window.__tool.meta.getManifest());
    if (!manifest?.api?.actions) throw new Error('manifest.api.actions missing');
    console.log('[3] manifest loaded ✓');

    // Verify SKILL files
    const skills = await page.evaluate(() => window.__tool.meta.getSkills());
    if (!skills?.human || !skills?.browser || !skills?.api) throw new Error('SKILL files incomplete');
    console.log('[4] SKILL files loaded ✓');

    // Initial state (no key)
    const state0 = await page.evaluate(() => window.__tool.getState());
    if (typeof state0.userConnected !== 'boolean') throw new Error('getState() shape wrong');
    console.log('[5] getState() shape ✓');

    if (!apiKey) { console.log('OPENROUTER_API_KEY not set — skipping live tests'); await browser.close(); return; }

    // Connect
    const conn = await page.evaluate(k => window.__tool.connect({ apiKey: k }), apiKey);
    if (conn.provider !== 'openrouter') throw new Error('connect() wrong provider');
    console.log('[6] connect() ✓', conn);

    // Key stats
    const stats = await page.evaluate(() => window.__tool.getKeyStats());
    if (typeof stats.usage === 'undefined') throw new Error('getKeyStats() missing usage');
    console.log('[7] getKeyStats() ✓');

    // Models
    const models = await page.evaluate(() => window.__tool.getModels({ top: 5 }));
    if (!Array.isArray(models) || models.length === 0) throw new Error('getModels() empty');
    console.log('[8] getModels() ✓', models.length, 'models');

    if (mgmtKey) {
        await page.evaluate(k => {
            document.dispatchEvent(new CustomEvent('or:admin-connected', { detail: { managementKey: k } }));
        }, mgmtKey);
        await page.waitForFunction(() => window.__tool.getState().adminConnected, { timeout: 5_000 });
        const keys = await page.evaluate(() => window.__tool.listKeys());
        console.log('[9] listKeys() ✓', keys.length, 'keys');
    }

    console.log('\nAll tests passed.');
    await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
```

---

## Notes

- `connect()` validates the key against OpenRouter `/api/v1/key` — a real network call.
- The management key is NOT exposed via `getState()` — only the masked user `apiKey`.
- Skip-if-same-key: calling `connect()` twice with the same key re-validates and returns
  fresh stats without a full reconnect cycle.
- All API methods require `connect()` to have been called first.
- Admin methods (`listKeys`, `createKey`, `deleteKey`) require the management key
  to have been loaded (via vault or `or:admin-connected` event).
