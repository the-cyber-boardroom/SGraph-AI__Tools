# OpenRouter — JS API Spec

**Tool:** OpenRouter Dashboard v0.1.23
**Contract:** `window.__tool` (SgToolApi instance)
**Instance ID:** `openrouter:root`
**API version:** 0.1.0

---

## Access

```javascript
// After tool:ready fires:
const tool = window.__tool;

// Or from registry (multi-instance):
const tool = window.__tool_registry.find('openrouter');
```

---

## Methods

### `connect(params?)`
Validate a user API key against OpenRouter and update shared state.

| Param | Type | Required | Note |
|-------|------|----------|------|
| `params.apiKey` | `string` | No | Defaults to stored key. Sanitised in log (shown as ••••). |

**Returns:** `Promise<{ provider: string, balance: number|null, limit: number|null }>`

**Errors:**
- `'apiKey required'` — no key provided or stored
- `'HTTP 401'` — invalid key
- `'HTTP 429'` — rate limited

**Side effects:**
- Updates `state.userApiKey`, `state.balance`, `state.limit`
- Saves key to `localStorage['or-user-api-key']`
- Dispatches `SGL_LLM.CONNECTED` on `[data-llm-bus]` element (triggers all UI panels)
- Fires `tool:connected` window event

**Skip-if-same-key:** If called with the same key while already connected, re-fetches
stats and returns immediately without a full reconnect cycle.

---

### `disconnect()`
Clear user connection state.

**Returns:** `void`

**Side effects:**
- Clears `state.userApiKey`, `state.userConnected`
- Dispatches `SGL_LLM.DISCONNECTED` on bus (clears all UI panels)
- Fires `tool:disconnected` window event

---

### `getState()`
Return current connection state snapshot.

**Returns:**
```typescript
{
    userConnected:  boolean,
    adminConnected: boolean,
    apiKey:         string,   // always '••••' when set (never the real key)
    balance:        number | null,
    limit:          number | null,
    currency:       'USD'
}
```

---

### `getKeyStats()`
Fetch current key details from OpenRouter.

**Requires:** user connected

**Returns:** `Promise<KeyStatsData>`

```typescript
{
    label:               string,
    usage:               number,   // credits used
    limit:               number | null,
    isFreeTier:          boolean,
    rateLimitRequests:   number,
    rateLimitInterval:   string,   // e.g. '10s'
    // ... additional fields from OpenRouter /api/v1/key
}
```

**Fires:** `tool:key-stats` window event

---

### `getModels(filter?)`
Fetch all available OpenRouter models, optionally filtered.

**Requires:** user connected

| Param | Type | Note |
|-------|------|------|
| `filter.query` | `string` | Case-insensitive substring match on id or name |
| `filter.top` | `number` | Return only the first N results |

**Returns:** `Promise<Model[]>` — array of model objects from `/api/v1/models`

**Fires:** `tool:models-loaded` window event

---

### `getModelDetail(modelId)`
Get detail for a specific model.

**Requires:** user connected

| Param | Type | Note |
|-------|------|------|
| `modelId` | `string` | e.g. `'openai/gpt-4o'` |

**Returns:** `Promise<Model | null>`

**Errors:** `'Model not found: {modelId}'`

---

### `getUsage(params?)`
Fetch usage activity buckets.

**Requires:** user connected

| Param | Type | Note |
|-------|------|------|
| `params.bucketDuration` | `string` | e.g. `'1h'`, `'1d'` |

**Returns:** `Promise<UsageBucket[]>`

---

### `getSpending()`
Fetch credit usage grouped by model.

**Requires:** user connected

**Returns:** `Promise<SpendingEntry[]>`

---

### `getActivity(params?)`
Fetch recent generation history.

**Requires:** user connected

| Param | Type | Default | Note |
|-------|------|---------|------|
| `params.limit` | `number` | API default | Number of results |
| `params.offset` | `number` | `0` | Pagination offset |

**Returns:** `Promise<Generation[]>`

---

### `listKeys()`
List all provisioned API keys.

**Requires:** admin connected (management key)

**Returns:** `Promise<ProvisionedKey[]>`

```typescript
[{
    hash:   string,    // use for deletion
    label:  string,
    usage:  number,
    limit:  number | null,
    // ... additional fields
}]
```

**Errors:** `'Admin not connected — load vault with management key'`

---

### `createKey(params)`
Create a new provisioned API key.

**Requires:** admin connected

| Param | Type | Required | Note |
|-------|------|----------|------|
| `params.name` | `string` | Yes | Human-readable label |
| `params.limit` | `number` | No | Credit spend limit |

**Returns:** `Promise<{ key: string, hash: string, label: string }>`

**Important:** The `key` field contains the raw API key — it is shown only once.
Store it immediately; it cannot be retrieved again.

---

### `deleteKey(hash)`
Delete a provisioned API key by hash.

**Requires:** admin connected

| Param | Type | Note |
|-------|------|------|
| `hash` | `string` | From `listKeys()` or `createKey()` |

**Returns:** `Promise<void>`

**Errors:** `'Admin not connected — load vault with management key'`, `'hash required'`

**Warning:** Irreversible. Any systems using the deleted key will immediately lose access.

---

## Window Events

All events fire on `window`. Listen with `window.addEventListener(name, handler)`.

| Event | When | Detail shape |
|-------|------|-------------|
| `tool:ready` | `activate()` called | `{ instanceId, tool, version }` |
| `tool:connected` | `connect()` resolves | `{ instanceId, provider, balance, limit }` |
| `tool:disconnected` | `disconnect()` called | `{ instanceId }` |
| `tool:key-stats` | `getKeyStats()` resolves | `{ instanceId, data }` |
| `tool:models-loaded` | `getModels()` resolves | `{ instanceId, count }` |

**Internal events** (on `[data-llm-bus]` element, not window):
- `llm:connected` `{ provider: 'openrouter', apiKey }` — triggers UI panels
- `llm:disconnected` — clears UI panels

**Document events** (admin only):
- `or:vault-loaded` — broadcast when vault credentials are loaded
- `or:admin-connected` `{ managementKey }` — triggers admin UI panels
- `or:admin-disconnected` — clears admin state

---

## Meta API

```javascript
window.__tool.meta.getMethods()    // string[] of registered method names
window.__tool.meta.getVersion()    // { api, ui, content }
window.__tool.meta.getManifest()   // Promise<manifest.json object>
window.__tool.meta.getSkills()     // Promise<{ human, browser, api }> (file contents)
window.__tool.meta.health()        // { status, instanceId, methodCount, ... }
window.__tool.meta.getLog()        // execution log (last 500 entries)
```

---

## Known Limitations

- The management key is stored in `localStorage['or-admin-mgmt-key']` for UX
  convenience (pre-existing behaviour from v0.1.22, not changed).
- `getUsage()` and `getSpending()` endpoint availability depends on OpenRouter plan.
- Model list is fetched fresh on each `getModels()` call (no client-side cache in the
  API primitive; the `sg-openrouter-models` UI component has its own 5-min TTL cache).
- `createKey()` — the `key` value in the response is shown only once by the OpenRouter
  API. The API primitive returns it directly; callers must store it immediately.
