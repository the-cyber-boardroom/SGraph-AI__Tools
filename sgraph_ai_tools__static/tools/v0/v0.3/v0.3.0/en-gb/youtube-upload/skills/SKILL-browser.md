# YouTube Upload — Browser / Playwright Skill

Drive the tool from automated tests via the global JS API. The API is live as soon as `tool:ready` fires on `window`.

## Bootstrap

```js
// Wait for the API
await page.waitForFunction(() => window.__tool?.['youtube-upload']);
const tool = await page.evaluateHandle(() => window.__tool['youtube-upload']);
```

## Pre-fill an OAuth client ID without UI typing

```js
await page.evaluate(cid => window.__tool['youtube-upload'].setClientId({ clientId: cid }), CLIENT_ID);
```

## Inject a fake token (skip the OAuth popup in tests)

You cannot programmatically dismiss Google's OAuth popup. For tests, prime the token cache before the page loads:

```js
await page.addInitScript(() => {
    localStorage.setItem('sg-auth-token-youtube-upload', JSON.stringify({
        provider:    'youtube-upload',
        accessToken: 'fake-token-for-test',
        expiresAt:   Date.now() + 3600_000,
        scope:       'https://www.googleapis.com/auth/youtube.upload',
        savedAt:     Date.now(),
    }));
});
```

The component will pick the cached token up on `connectedCallback` — `connect()` then resolves immediately from cache.

## Set a file from a `Buffer`

```js
await page.evaluate(async () => {
    const blob = new Blob([new Uint8Array(1024)], { type: 'video/webm' });
    const file = new File([blob], 'test.webm', { type: 'video/webm' });
    window.__tool['youtube-upload'].setFile({ file });
});
```

## Drive an upload (against a stub server)

In integration tests, intercept the YouTube endpoints and return canned responses:

```js
await page.route('**/upload/youtube/v3/videos**', route => {
    if (route.request().method() === 'POST') {
        return route.fulfill({
            status: 200,
            headers: { Location: 'https://upload.example/session/123' },
            body: '',
        });
    }
    return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id:      'fake-video-id',
            snippet: { title: 'Test' },
            status:  { privacyStatus: 'unlisted' },
        }),
    });
});

await page.route('https://upload.example/session/**', route =>
    route.fulfill({ status: 200, body: JSON.stringify({ id: 'fake-video-id' }) })
);
```

Then trigger:

```js
const result = await page.evaluate(() =>
    window.__tool['youtube-upload'].uploadVideo({ title: 'Test', privacyStatus: 'unlisted' })
);
expect(result.id).toBe('fake-video-id');
```

## Health check

```js
const h = await page.evaluate(() => window.__tool['youtube-upload'].health());
expect(h.ok).toBe(true);
```

## Listen for events

```js
await page.exposeFunction('onYtEvent', (name, detail) => console.log(name, detail));
await page.evaluate(() => {
    const names = ['tool:youtube:connected','tool:youtube:upload:start',
                   'tool:youtube:upload:progress','tool:youtube:upload:complete','tool:error'];
    names.forEach(n => window.addEventListener(n, e => window.onYtEvent(n, e.detail)));
});
```
