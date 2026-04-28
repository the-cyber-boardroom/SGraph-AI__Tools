# SKILL-api — Vault Embed Demo

Programmatic API via `window.__tools['vault-embed-demo']`.

## getDemoVaultInfo()

Returns the demo vault's public credentials.

```js
const info = window.__tools['vault-embed-demo'].getDemoVaultInfo();
// Returns: { vaultId, readKey, endpoint, objectIds: { hero, image, json } }
```

## loadDemoContent({ slot })

Re-triggers a fetch+decrypt cycle for one named slot.
Useful for cache testing — call twice to observe MISS then HIT.

```js
await window.__tools['vault-embed-demo'].loadDemoContent({ slot: 'hero' });
// 'hero' | 'image' | 'json'
```

Fires these events on completion:
- `sg-vault-fetch:fetch-started`
- `sg-vault-fetch:fetch-completed` (with `cacheHit: boolean`)
- `sg-vault-fetch:decrypt-completed`
- `sg-vault-fetch:content-ready`

## getTraceLog({ limit? })

Returns recorded vault events as structured data.

```js
const events = window.__tools['vault-embed-demo'].getTraceLog({ limit: 10 });
// Returns: Array<{ event: string, detail: object, ts: number }>
```

## clearTraceLog()

Empties the trace panel.

```js
window.__tools['vault-embed-demo'].clearTraceLog();
```

## setEndpoint({ endpoint })

Switch between `send.sgraph.ai` and `dev.send.sgraph.ai` for testing.

```js
window.__tools['vault-embed-demo'].setEndpoint({ endpoint: 'https://dev.send.sgraph.ai' });
```

## Ops emitted

| Op / Event type | Triggered by |
|---|---|
| `sg-vault-key:key-ready` | Component connectedCallback (key import) |
| `sg-vault-fetch:fetch-started` | `loadDemoContent()` or auto-fetch on load |
| `sg-vault-fetch:fetch-completed` | Network response received |
| `sg-vault-fetch:decrypt-started` | After fetch-completed |
| `sg-vault-fetch:decrypt-completed` | AES-GCM decrypt done |
| `sg-vault-fetch:content-ready` | Full pipeline complete |
| `sg-vault-fetch:fetch-error` | Any failure in fetch or decrypt |
| `sg-vault-manifest:manifest-loaded` | Manifest fetched and validated |
| `sg-vault-manifest:slot-ready` | One per slot in the manifest |
