# YouTube Editor — Browser / Playwright Skill

Drive every method from automation. The API is live as soon as `tool:ready` fires.

## Bootstrap

```js
await page.waitForFunction(() => window.__tool?.['youtube-editor']);
const tool = await page.evaluateHandle(() => window.__tool['youtube-editor']);
```

## Skip the OAuth popup with a primed token

```js
await page.addInitScript(() => {
    localStorage.setItem('sg-auth-token-youtube-editor', JSON.stringify({
        provider:    'youtube-editor',
        accessToken: 'fake-token-for-test',
        expiresAt:   Date.now() + 3_600_000,
        scope:       'https://www.googleapis.com/auth/youtube',
        savedAt:     Date.now(),
    }));
});
```

`api.connect()` will resolve immediately from cache — no Google call.

## Stub the YouTube endpoints

```js
await page.route('**/youtube/v3/channels?**',      r => r.fulfill({ status: 200, body: JSON.stringify({ items: [{
    id: 'CHAN1', snippet: { title: 'Test Channel' }, statistics: { videoCount:'1', subscriberCount:'0', viewCount:'0' },
    contentDetails: { relatedPlaylists: { uploads: 'UU_FAKE' } },
}]})}));
await page.route('**/youtube/v3/playlistItems?**', r => r.fulfill({ status: 200, body: JSON.stringify({
    items: [{ snippet: { title: 'Vid 1', resourceId: { videoId: 'VID1' } }, contentDetails: { videoId: 'VID1' } }],
    pageInfo: { totalResults: 1 },
})}));
await page.route('**/youtube/v3/videos?id=**',     r => r.fulfill({ status: 200, body: JSON.stringify({
    items: [{ id: 'VID1', snippet: { title: 'Vid 1', categoryId: '22' }, status: { privacyStatus: 'unlisted' } }],
})}));
await page.route('**/youtube/v3/videos?part=**',   r => r.request().method() === 'PUT'
    ? r.fulfill({ status: 200, body: JSON.stringify({ id: 'VID1', snippet: { title: 'Edited' }, status: {} }) })
    : r.continue());
```

## Drive a flow

```js
await page.evaluate(() => window.__tool['youtube-editor'].connect());
const channel = await page.evaluate(() => window.__tool['youtube-editor'].getMyChannel());
const list    = await page.evaluate(() => window.__tool['youtube-editor'].listMyUploads());
const video   = await page.evaluate(() => window.__tool['youtube-editor'].loadVideo({ id: 'VID1' }));
const saved   = await page.evaluate(() =>
    window.__tool['youtube-editor'].updateVideo({ id: 'VID1', patch: { snippet: { title: 'Edited' } } })
);
expect(saved.snippet.title).toBe('Edited');
```

## Upload from a `Buffer`

```js
await page.evaluate(async () => {
    const blob = new Blob([new Uint8Array(1024)], { type: 'video/webm' });
    const file = new File([blob], 'test.webm', { type: 'video/webm' });
    await window.__tool['youtube-editor'].uploadVideo({
        file,
        metadata: { title: 'Test', privacyStatus: 'unlisted' },
    });
});
```

(With both endpoints route-stubbed — see SKILL of `youtube-upload` for the shape.)

## Set a thumbnail / delete

```js
const png = new Blob([new Uint8Array(1024)], { type: 'image/png' });
await page.evaluate(async (file) =>
    window.__tool['youtube-editor'].setThumbnail({ id: 'VID1', blob: file }), png);

await page.evaluate(() => window.__tool['youtube-editor'].deleteVideo({ id: 'VID1' }));
```

## Listen to events

```js
await page.exposeFunction('onYt', (n, d) => console.log(n, d));
await page.evaluate(() => {
    [
        'tool:youtube:connected','tool:youtube:videos-loaded','tool:youtube:video-loaded',
        'tool:youtube:video-saved','tool:youtube:thumbnail-set','tool:youtube:video-deleted',
        'tool:youtube:upload:complete','tool:error',
    ].forEach(n => addEventListener(n, e => window.onYt(n, e.detail)));
});
```

## Health check

```js
const h = await page.evaluate(() => window.__tool['youtube-editor'].health());
expect(h.ok).toBe(true);
```
