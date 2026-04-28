# SKILL-browser — Vault Embed Demo

Selectors and sequences for agentic browser sessions (Playwright, etc.).

## Verify the demo loaded successfully

Wait for at least 3 `content-ready` events in the trace:

```js
// Wait for at least 3 trace entries with content-ready
await page.waitForFunction(() => {
    const entries = document.querySelectorAll('[data-trace-event="content-ready"]');
    return entries.length >= 3;
}, { timeout: 30000 });
```

## Assert credentials are visible in rendered text

```js
const vaultId = await page.locator('#cred-vault-id').textContent();
const readKey = await page.locator('.read-key-value').textContent();
assert(vaultId && vaultId !== 'Loading…', 'vault ID should be visible');
assert(readKey && readKey.includes('this key is public'), 'read key should be visible');
```

## Trigger a reload of one slot

```js
await page.evaluate(() => window.__tools['vault-embed-demo'].loadDemoContent({ slot: 'hero' }));
// Wait for fetch-started to fire again
await page.waitForFunction(() => {
    const entries = document.querySelectorAll('[data-trace-event="fetch-started"]');
    return entries.length >= 4; // hero was 1, image 2, json 3, now 4th
});
```

## Read the trace log

```js
const log = await page.evaluate(() => window.__tools['vault-embed-demo'].getTraceLog({ limit: 20 }));
console.log(log);
```

## Verify cache hit on reload

```js
// First load: MISS
const firstLog = await page.evaluate(() => window.__tools['vault-embed-demo'].getTraceLog());
const firstComplete = firstLog.filter(e => e.event === 'sg-vault-fetch:fetch-completed');
// At least one should be cacheHit: false on first load

await page.evaluate(() => window.__tools['vault-embed-demo'].clearTraceLog());
await page.evaluate(() => window.__tools['vault-embed-demo'].loadDemoContent({ slot: 'hero' }));
await page.waitForFunction(() => {
    const log = window.__tools['vault-embed-demo'].getTraceLog();
    return log.some(e => e.event === 'sg-vault-fetch:fetch-completed');
});
const secondLog = await page.evaluate(() => window.__tools['vault-embed-demo'].getTraceLog());
const secondComplete = secondLog.find(e => e.event === 'sg-vault-fetch:fetch-completed');
// secondComplete.detail.cacheHit should be true (browser cached the immutable blob)
```

## Key selectors

| Selector | Description |
|---|---|
| `#cred-vault-id` | Rendered vault ID text |
| `.read-key-value` | Rendered read key text |
| `#cred-endpoint` | Rendered endpoint text |
| `#main-trace` | The sg-vault-trace element |
| `[data-trace-event]` | Individual trace rows |
| `[data-trace-event="content-ready"]` | Content-ready trace rows |
| `#render-hero` | Markdown renderer |
| `#render-image` | Image renderer |
| `#render-json` | JSON renderer |
