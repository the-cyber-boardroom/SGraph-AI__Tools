# Dev Brief: Public-Vault Embed Components — Tools Project

**Version:** v0.22.17 | **Date:** 26 April 2026
**Target repo:** `the-cyber-boardroom/SGraph-AI__Tools` (repo subdir `sgraph_ai_tools__static/`)
**Target team:** Tools Team
**Priority:** P1
**Anchor document:** `team/comms/briefs/04/26/v0.22.17__brief__vault-backed-workflows.md`
**Related:** `team/comms/briefs/04/26/v0.22.17__dev-brief__cli-surgical-write-commands.md`
**Depends on:** Nothing — purely additive client-side work. No API changes, no CLI changes, no changes to the existing vault editor stack.

---

## 0. Before You Read This Brief

**Stop. If you have not read `02__guidelines__sg-component-and-ifd.md`, read it first.** This brief contains 30+ cross-references like "per A.3", "per K.6", "per H.1" that resolve into that document. Reading the brief first means encountering dozens of dangling references and backtracking.

**Also read first:** `01__brief__vault-backed-workflows.md` — the anchor document. It establishes the vocabulary (vault types, the three patterns, "static file or vault blob") that this brief assumes.

**Read selectively:** `03__architecture__sg-toolkit.md` §1, §2.1, §2.2 — for context on how this codebase thinks about reusable components. The rest of that doc is about a separate refactor.

**See `00__README.md`** for the full reading order, what to clone before writing code, and what to do when you get stuck.

---

## 1. What You're Building

A new **public-vault embed stack** of Web Components, plus three **generic content renderers**, plus one **demo tool**. All of it is purely additive — the existing `components/vault/` session-based editor stack (sg-vault-connect, sg-vault-tree, sg-vault-viewer, sg-vault-file-preview, sg-vault-manager, etc.) is not modified.

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │           SGraph-AI__Tools — New Embed Stack                        │
   │                                                                       │
   │   components/vault-embed/                  ← NEW namespace            │
   │     sg-vault-key/v0/v0.1/v0.1.0/             credential holder       │
   │     sg-vault-fetch/v0/v0.1/v0.1.0/           fetch + decrypt by ID   │
   │     sg-vault-content/v0/v0.1/v0.1.0/         one-line page surface  │
   │     sg-vault-manifest/v0/v0.1/v0.1.0/        slot manifest loader   │
   │     sg-vault-trace/v0/v0.1/v0.1.0/           introspection panel    │
   │                                                                       │
   │   components/content/                      ← NEW namespace (vault-   │
   │     sg-content-markdown/v0/v0.1/v0.1.0/      agnostic renderers)    │
   │     sg-content-image/v0/v0.1/v0.1.0/                                 │
   │     sg-content-json/v0/v0.1/v0.1.0/                                  │
   │                                                                       │
   │   tools/v0/v0.1/v0.1.X/en-gb/vault-embed-demo/   ← NEW tool         │
   │     The integration test, the spec, and the agent skill artefact,    │
   │     all in one. Sibling to the existing vault and vault-browser tools.│
   └─────────────────────────────────────────────────────────────────────┘
```

This brief produces the runtime layer of **Pattern 1 — Website Content Updates** described in the anchor document: the browser fetches encrypted blobs from `send.sgraph.ai`, decrypts them client-side using a public `read_key`, and renders them. **The components are generic** — usable on `sgraph.ai`, on third-party sites, on any future tool that needs to render encrypted vault content into a page.

---

## 2. Why a New Stack (Not Reuse the Existing One)

The existing `components/vault/` components are an **editor for vault users**. They need:

- A vault **session** (`core/vault-session`), which holds keys, tree state, push/pull buffers
- A **bus element** in the page (`<div data-vault-bus>`) for cross-component coordination via `vault:connected`, `vault:file-select`, `vault:disconnected` events
- A connect panel (`<sg-vault-connect>`) that prompts for credentials, persists them in `localStorage`, and creates the session
- Coordination between read AND write components (sg-vault-tree, sg-vault-viewer, sg-vault-file-ops)

The new use case is fundamentally different. A page on sgraph.ai (or any other site) wants to:

- Embed one or more vault-rendered blobs **inline in the page**, no UI for browsing
- Use a **public read_key** that's part of the page source — no credential prompt, no session, no localStorage
- Render **read-only** — write capability would be a security regression, not a feature
- Work without a bus element — composable directly into any HTML, no host setup
- Be **embeddable on third-party sites** that have no SG/Send-specific infrastructure

Trying to retrofit the session stack to support this would compromise both: the editor would gain a confusing "no-session mode" and the embed use case would inherit complexity it doesn't need. **Two stacks, one shared core.** The shared core is the existing `core/vault-client/v1/v1.2/v1.2.1/sg-vault-client.js`, which both stacks call into for decryption.

This decision is recorded so it doesn't get relitigated.

---

## 3. What Already Exists (Do Not Reinvent)

A first draft of this brief proposed porting `SGSendCrypto` from the App__Send repo into the Tools repo. **Not needed — better infrastructure already exists in the Tools repo.** Use it.

### `core/vault-client/v1/v1.2/v1.2.1/sg-vault-client.js`
**Already does** key parsing, key derivation, vault opening, file reading, metadata encryption/decryption, tree walking. Public exports:

- `parseVaultKey(token)` — `"passphrase:vaultId"` → `{ passphrase, vaultId }`
- `deriveVaultKeys(passphrase, vaultId)` → `{ readKey, writeKey, refFileId, branchIndexFileId, ... }`
- `readFile(apiBaseUrl, vaultId, fileId, readKey)` — fetches ciphertext, decrypts, returns plaintext bytes
- `computeObjectId(ciphertext)` — SHA-256-based content addressing
- `decryptMetadata`, `encryptMetadata`, `walkTree`, `openVaultTree`, `deriveBranchRefFileId`

The embed stack **calls `readFile()` directly** for the fetch+decrypt primitive. No new crypto code is written.

**Note on the read_key path:** the existing API takes a passphrase and derives the read_key via PBKDF2. For the embed case, the page source contains a derived `read_key` directly (so the passphrase never appears in public manifests). The brief assumes a small additive helper `importReadKey(readKeyBase64Url)` is added to `sg-vault-client.js` in a v1.2.2 patch (one ~10-line function). Specifying that patch is part of Task 0 (see §8).

### `core/markdown/v1/v1.0/v1.0.0/sg-markdown.js`
**Already exists** — pure-JS markdown renderer, no external deps, HTML-escapes input first. The brief uses it directly. No `marked`. No `DOMPurify` (though `<sg-content-markdown>` should still validate that the existing escaping is sufficient for vault-sourced content; see §6.3).

### `components/base/v1/v1.0/v1.0.0/sg-component.js`
The base class. Provides shadow DOM, sibling-file resource loading, `emit()`, `addTrackedListener()`, lifecycle hooks (`onReady`, `bindElements`, `setupEventListeners`), `showError()`, `$()` / `$$()`. Pattern reference: `components/key-input/`, `components/locale-picker/`, `components/sg-recording-size/`.

### `core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js`
The demo tool registers its API methods via `SgToolApi`. SKILL files use the `SKILL-{role}.md` naming (single hyphen) — confirmed against the infographic-generator example in the source.

### `core/sg-layout/v0.1.0/sg-layout.js`
*(Note: flat versioning, not three-level — match it exactly.)* Used by tools that need a multi-panel layout. The demo tool will use it for the "credentials | content | trace" three-pane view.

### Existing pattern references (read at least one before starting)
- **`components/key-input/v1/v1.0/v1.0.0/`** — small `SgComponent`, frozen events, separate sibling files
- **`components/locale-picker/v1/v1.0/v1.0.1/`** — `SgComponent` with shared CSS dependency
- **`components/sg-recording-size/v0/v0.1/v0.1.0/`** — `SgComponent` emitting op-shaped events with byte counts
- **`tools/v0/v0.1/v0.1.55/en-gb/linkedin-publisher/`** — exemplar tool layout (`index.html` + `ui/main.js` + `api/` + `styles/` + `manifest.json`)

---

## 4. Architectural Constraints (Non-Negotiable)

Pulled from `03__guidelines__sg-component-and-ifd.md`. These apply from day one, not retrofitted.

### 4.1 Component construction (B.1–B.6)
- **MUST** extend `SgComponent`. No raw `HTMLElement`. (The existing `components/vault/*` extend raw `HTMLElement` because they predate `SgComponent` adoption — the new stack starts fresh on the documented direction of travel.)
- **MUST** have separate sibling `.html`, `.css`, `.js` files. No inline templates in JS.
- **MUST** use `static jsUrl = import.meta.url` so resource paths resolve correctly.
- **MUST** register with `customElements.define` guarded by `customElements.get` check.
- **MUST** emit events via `this.emit(name, detail)` — composed bubbling.
- **SHOULD** keep helper modules ≤ 300 LOC, class file ≤ 350 LOC.

### 4.2 Event-driven architecture (C.1–C.4)
- **MUST NOT** call host methods directly. Components emit events; hosts listen.
- **MUST** define event names in a frozen exported constant per component (`SGVK_EVENTS = Object.freeze({...})` for sg-vault-key, etc.).
- **MUST** match the event detail shapes in §6 exactly. No optional fields. No extra fields. Unknown values use `null` or `false`, never omit.
- **MUST NOT** add listeners on `document` or `window`. Only on the component's own shadow-DOM elements or on elements explicitly resolved via attribute references (`key-source`, `content-source`).

### 4.3 No data-vault-bus (the bright line vs the editor stack)
- **MUST NOT** depend on `<div data-vault-bus>` or any bus element.
- **MUST NOT** emit or listen for `vault:connected`, `vault:disconnected`, `vault:file-select`, or any event in the existing editor stack's bus vocabulary.
- Coordination between embed components is via `key-source` and `content-source` attributes pointing at element IDs. Each embed component is self-contained and works in isolation.

This is the architectural property that distinguishes the embed stack from the editor stack. Violating it means the new components depend on host setup that defeats the embed use case.

### 4.4 Renderer independence
Renderers (`sg-content-markdown`, `sg-content-image`, `sg-content-json`) live in `components/content/` and **know nothing about vaults**. They receive `{ bytes, contentType, text }` events and render. The renderer-independence property is enforced **architecturally** by the namespace separation: a content renderer that imports from `components/vault-embed/` is a violation visible in `git diff`.

**Acceptance test (AC-2 in §10):** any renderer must work driven by a hand-fired `CustomEvent`, with no vault-embed component on the page, and zero imports from `components/vault-embed/` or `core/vault-*`.

### 4.5 No globals, no browser storage
- **MUST NOT** use `window.SG_VAULT_*` or any global.
- **MUST NOT** use `localStorage`, `sessionStorage`, or `IndexedDB`. (The editor stack uses these for persistence; the embed stack is per-session memory only, deliberately.)
- The browser HTTP cache is fine — that's the network layer, not embed-stack state.

### 4.6 Read-only — no write_key anywhere
- **MUST NOT** accept, store, or transmit a `write_key`.
- A `read-key` only.
- `<sg-vault-manifest>` schema validation **MUST** reject any field named `write_key` at load time with the exact error: *`Manifest validation error: write_key is forbidden in manifests.`*

### 4.7 Op-shaped progress events
Every long-running operation emits `*-started` and `*-completed` events with timing and byte counts in `event.detail`. `<sg-vault-trace>` reconstructs the full pipeline from events alone. Required event shapes are pinned in §6.

### 4.8 IFD discipline (H.1–H.4)
- New components ship at `components/{namespace}/{name}/v0/v0.1/v0.1.0/`. Three-level version nesting.
- Once tagged `v0.1.0`, files are **frozen**. Bug fixes ship at `v0.1.1`. Behaviour changes ship at a new minor.
- The demo tool ships at `tools/v0/v0.1/v0.1.X/en-gb/vault-embed-demo/` where X is the next available minor (currently 56 or higher per `tools/v0/v0.1/`).

---

## 5. Repository Layout

```
SGraph-AI__Tools/sgraph_ai_tools__static/
│
├── core/
│   └── vault-client/v1/v1.2/v1.2.2/         ← NEW patch (additive helper only)
│       ├── sg-vault-client.js               ← copy of v1.2.1 + importReadKey()
│       └── vault-id-utils.js                ← copy of v1.2.1 (unchanged)
│
├── components/
│   ├── vault-embed/                         ← NEW namespace
│   │   ├── sg-vault-key/v0/v0.1/v0.1.0/
│   │   │   ├── sg-vault-key.js
│   │   │   ├── sg-vault-key.html
│   │   │   ├── sg-vault-key.css
│   │   │   ├── events.js                    ← SGVK_EVENTS frozen constants
│   │   │   └── manifest.json
│   │   ├── sg-vault-fetch/v0/v0.1/v0.1.0/
│   │   │   ├── sg-vault-fetch.js
│   │   │   ├── sg-vault-fetch.html
│   │   │   ├── sg-vault-fetch.css
│   │   │   ├── sg-vault-fetch-content-type.js   ← magic-byte sniffing
│   │   │   ├── events.js                    ← SGVF_EVENTS
│   │   │   └── manifest.json
│   │   ├── sg-vault-content/v0/v0.1/v0.1.0/
│   │   ├── sg-vault-manifest/v0/v0.1/v0.1.0/
│   │   └── sg-vault-trace/v0/v0.1/v0.1.0/
│   │
│   └── content/                             ← NEW namespace (vault-agnostic)
│       ├── sg-content-markdown/v0/v0.1/v0.1.0/
│       ├── sg-content-image/v0/v0.1/v0.1.0/
│       └── sg-content-json/v0/v0.1/v0.1.0/
│
└── tools/
    └── v0/v0.1/v0.1.X/en-gb/vault-embed-demo/    ← NEW (X = next available minor)
        ├── manifest.json
        ├── index.html
        ├── styles/
        │   └── vault-embed-demo.css
        ├── ui/
        │   ├── main.js                      ← entry point (matches linkedin-publisher pattern)
        │   ├── ui-shell.js
        │   ├── ui-credentials-panel.js
        │   └── ui-trace-panel.js
        ├── api/
        │   └── vault-embed-demo-api.js      ← SgToolApi registration
        ├── SKILL-human.md                   ← hyphen, not double-underscore
        ├── SKILL-browser.md
        └── SKILL-api.md
```

**Notes on the layout:**
- The new `vault-embed/` and `content/` namespaces sit as siblings to `vault/`, mirroring the `core/vault-client/`, `core/vault-cache/`, `core/vault-session/` sibling pattern.
- The demo tool is a **sibling** of the existing `vault`, `vault-browser`, `vault-pyodide` tools — no nesting, no name collision.
- The patch to `vault-client` is **a new versioned folder** (`v1.2.2/`) per IFD — not an in-place edit of `v1.2.1/`.

---

## 6. The Components — Spec

The vocabulary in this section is **normative**. Names, attributes, event shapes, error strings are pinned. (Per K.6: "Names are pinned in the vocabulary. Don't invent. Don't paraphrase.")

### 6.1 `<sg-vault-key>` — credential holder

**Path:** `components/vault-embed/sg-vault-key/v0/v0.1/v0.1.0/`
**Purpose:** Holds a vault's `read_key`, derives the AES-GCM `CryptoKey` once on `connectedCallback`, makes it available to other components via element-ID reference.

**Attributes:**
| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| `id` | yes | string | Element ID — referenced by other components via `key-source` |
| `vault-id` | yes | string | 4–24 char vault ID (matches `parseVaultKey()` rules in vault-client v1.2.1+) |
| `read-key` | yes | string | base64url-encoded read key (32 bytes) |
| `endpoint` | no | string | API endpoint. Defaults to `https://send.sgraph.ai`. |

**Frozen events (`events.js`):**
```js
export const SGVK_EVENTS = Object.freeze({
    KEY_READY: 'sg-vault-key:key-ready',
    KEY_ERROR: 'sg-vault-key:key-error',
});
```

**Event detail shapes (normative):**
- `sg-vault-key:key-ready` → `{ vaultId: string, cryptoKey: CryptoKey, endpoint: string, derivationMs: number }`
- `sg-vault-key:key-error` → `{ vaultId: string, error: string }`

**Public methods (JSDoc required):**
```js
/**
 * Returns a Promise resolving to the imported CryptoKey.
 * Resolves immediately if already imported, joins the in-flight Promise
 * if import is pending, rejects with the underlying error if import failed.
 * @returns {Promise<CryptoKey>}
 */
async getKey()

/**
 * Returns the configured endpoint URL.
 * @returns {string}
 */
getEndpoint()
```

**Lifecycle:**
1. `onReady()` reads attributes.
2. Calls `importReadKey(readKey)` (the v1.2.2 patch on `core/vault-client`).
3. On success: caches `CryptoKey` on the instance, emits `key-ready`.
4. On failure: emits `key-error`, calls `showError()`.

**Visual:** Empty shadow root (renders nothing). The element's purpose is logical, not visual.

**File budget:** `sg-vault-key.js` ≤ 100 LOC.

---

### 6.2 `<sg-vault-fetch>` — fetch + decrypt

**Path:** `components/vault-embed/sg-vault-fetch/v0/v0.1/v0.1.0/`
**Purpose:** Fetches one encrypted blob by ID from the configured endpoint, decrypts it via the existing `readFile()` primitive, emits the plaintext.

**Attributes:**
| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| `key-source` | yes | string | ID of an `<sg-vault-key>` element on the page |
| `object-id` | yes | string | `obj-cas-imm-*` ID (the content-addressed blob ID) |
| `auto` | no | bool-attr | When present, fetches on `onReady`. When absent, waits for `.fetch()`. Default: present. |

**Frozen events (`events.js`):**
```js
export const SGVF_EVENTS = Object.freeze({
    FETCH_STARTED:     'sg-vault-fetch:fetch-started',
    FETCH_COMPLETED:   'sg-vault-fetch:fetch-completed',
    DECRYPT_STARTED:   'sg-vault-fetch:decrypt-started',
    DECRYPT_COMPLETED: 'sg-vault-fetch:decrypt-completed',
    CONTENT_READY:     'sg-vault-fetch:content-ready',
    FETCH_ERROR:       'sg-vault-fetch:fetch-error',
});
```

**Event detail shapes (normative):**
- `fetch-started` → `{ vaultId: string, objectId: string, url: string }`
- `fetch-completed` → `{ vaultId: string, objectId: string, bytesReceived: number, fetchMs: number, cacheHit: boolean }`
- `decrypt-started` → `{ objectId: string, ciphertextBytes: number }`
- `decrypt-completed` → `{ objectId: string, plaintextBytes: number, decryptMs: number }`
- `content-ready` → `{ objectId: string, bytes: ArrayBuffer, contentType: string, text: string|null }`
- `fetch-error` → `{ stage: 'fetch'|'decrypt'|'no-key', objectId: string, error: string }`

**Implementation note:** the fetch+decrypt primitive is the existing `readFile()` from `core/vault-client/v1/v1.2/v1.2.1/sg-vault-client.js` (or v1.2.2 if the patch lifts it). The component is a thin wrapper that emits the progress events around the call.

**Content-type sniffing** (separate module `sg-vault-fetch-content-type.js`, ≤ 100 LOC):
- Magic bytes for: PNG (`89 50 4E 47`), JPEG (`FF D8 FF`), GIF (`47 49 46 38`), WebP (`52 49 46 46 ... 57 45 42 50`)
- Leading `{` or `[` after UTF-8 decode → `application/json`
- Leading `<` after UTF-8 decode → `text/html`
- Otherwise UTF-8 valid → `text/plain`
- Otherwise → `application/octet-stream`

The `text` field is the UTF-8 string when applicable, `null` otherwise.

**Public methods (JSDoc required):**
```js
/**
 * Triggers a fetch+decrypt cycle. Used when auto attribute is absent.
 * @returns {Promise<void>}
 */
async fetch()

/**
 * Returns the last successfully decrypted result, or null if none yet.
 * @returns {{ bytes: ArrayBuffer, contentType: string, text: string|null }|null}
 */
getCurrentContent()
```

**Lifecycle:**
1. `onReady()` resolves the `key-source` element via `document.getElementById`.
2. If the source's key isn't ready yet, listens for `SGVK_EVENTS.KEY_READY` once.
3. Once key available (and `auto` present), invokes `readFile()` with `apiBaseUrl`, `vaultId`, `objectId`, `cryptoKey`.
4. Emits `fetch-started` before, `fetch-completed` after the network portion (timing measured around the underlying `fetch()` call inside `readFile`, or via a wrapping timer).
5. Emits `decrypt-started` / `decrypt-completed` around the AES-GCM decrypt.
6. Sniffs content type, emits `content-ready`.

**Caching:** None at the component level. Browser HTTP cache handles this — `obj-cas-imm-*` objects are content-addressed and immutable, so `Cache-Control: max-age=31536000, immutable` is safe and the API will set it.

**Error handling:** Decrypt failures surface in `showError()` as `"Content unavailable"` — not the raw error. The full error is available via `fetch-error` event for `<sg-vault-trace>`.

**Visual:** Empty shadow root.

**File budget:** `sg-vault-fetch.js` ≤ 200 LOC; sniffer ≤ 100 LOC.

---

### 6.3 `<sg-content-markdown>` — markdown renderer (vault-agnostic)

**Path:** `components/content/sg-content-markdown/v0/v0.1/v0.1.0/`
**Purpose:** Receives `content-ready` events, renders the `text` field as HTML using `core/markdown`.

**Attributes:**
| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| `content-source` | yes | string | ID of an element that emits `*:content-ready` events with `event.detail.text` |

**Frozen events:** None emitted. (This is a sink.)

**Lifecycle:**
1. `onReady()` resolves `content-source` element.
2. Listens for any event matching `*:content-ready` (or specifically `sg-vault-fetch:content-ready` — the renderer treats this as "an event with `detail.text`").
3. On event: passes `event.detail.text` to `renderMarkdown()` from `core/markdown/v1/v1.0/v1.0.0/sg-markdown.js`.
4. Renders into shadow root.

**Sanitization:** `core/markdown/sg-markdown.js` already HTML-escapes input before processing. **The implementer must verify** the existing escaping is sufficient for vault-sourced content (i.e., resists XSS via crafted markdown). If gaps are found, file a bug separately — do NOT add a parallel sanitizer in this component (that would diverge from `vault-file-preview`'s usage).

**Renderer independence test (AC-2):** the component must work with `<sg-content-markdown content-source="x">` plus a hand-fired `CustomEvent('demo:content-ready', { detail: { text: '# hi' } })` dispatched to an element with `id="x"`, with no vault-embed component on the page.

**Imports (architecturally enforced):**
- `import { SgComponent }` from base
- `import { renderMarkdown }` from `core/markdown`
- **NOTHING** from `components/vault-embed/`
- **NOTHING** from `core/vault-*`

(If you find yourself wanting a vault import, the renderer is too coupled. Stop and surface in OQ-X.)

**File budget:** `sg-content-markdown.js` ≤ 100 LOC.

---

### 6.4 `<sg-content-image>` — image renderer (vault-agnostic)

**Path:** `components/content/sg-content-image/v0/v0.1/v0.1.0/`
**Attributes:** `content-source` (required).

**Lifecycle:**
1. On `content-ready`: creates `Blob` from `event.detail.bytes` with `type: event.detail.contentType`, creates a Blob URL via `URL.createObjectURL`, sets `<img src>`.
2. On `disconnectedCallback`: revokes the Blob URL via `URL.revokeObjectURL`. (Critical — leaks otherwise.)

**Acceptance:** AC-6 in §10.
**File budget:** ≤ 80 LOC.

---

### 6.5 `<sg-content-json>` — JSON renderer (vault-agnostic)

**Path:** `components/content/sg-content-json/v0/v0.1/v0.1.0/`

**Attributes:**
| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| `content-source` | yes | string | ID of an element emitting `*:content-ready` |
| `mode` | no | enum | `"render"` (default) or `"emit"` |

**Frozen events:**
```js
export const SGCJ_EVENTS = Object.freeze({
    JSON_PARSED: 'sg-content-json:json-parsed',
});
```

**Modes:**
- `mode="render"` (default): `JSON.parse(text)` → `JSON.stringify(parsed, null, 2)` → `<pre>` block in shadow root.
- `mode="emit"`: parses, emits `JSON_PARSED` with `{ objectId, data }`, renders nothing. Enables chaining.

**File budget:** ≤ 80 LOC.

---

### 6.6 `<sg-vault-content>` — convenience wrapper

**Path:** `components/vault-embed/sg-vault-content/v0/v0.1/v0.1.0/`
**Purpose:** One-line page surface. Internally composes `<sg-vault-key>`, `<sg-vault-fetch>`, and a renderer from `components/content/`.

**Attributes:**
| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| `vault-id` | yes | string | Vault ID |
| `read-key` | yes | string | base64url read key |
| `object-id` | yes | string | `obj-cas-imm-*` ID |
| `render` | yes | enum | `markdown` \| `image` \| `json` |
| `endpoint` | no | string | API endpoint override |
| `inspect` | no | bool-attr | If present, automatically renders an `<sg-vault-trace>` next to the content |

**Lifecycle:** `onReady()` generates internal element IDs (`__sgvc-key-{n}`, `__sgvc-fetch-{n}`), inserts the wrapped components into shadow root, wires `key-source` and `content-source` between them.

**Frozen events:** None emitted directly. The wrapped components' events bubble through composed boundaries — callers can listen at the wrapper level.

**Most page authors use this surface, not the primitives directly:**
```html
<sg-vault-content
    vault-id="abc12345"
    read-key="J3kRP7QyL..."
    object-id="obj-cas-imm-xyz999..."
    render="markdown">
</sg-vault-content>
```

**File budget:** ≤ 150 LOC.

---

### 6.7 `<sg-vault-manifest>` — slot manifest loader

**Path:** `components/vault-embed/sg-vault-manifest/v0/v0.1/v0.1.0/`
**Purpose:** Loads a manifest JSON file, validates it, emits one event per slot.

**Attributes:**
| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| `src` | yes | string | URL of the manifest JSON |
| `vault-id` | yes | string | Vault ID — fallback if not in manifest |
| `read-key` | yes | string | base64url read key — fallback if not in manifest |

**Manifest schema (v1):**
```json
{
    "version": "1.0",
    "slots": {
        "hero":      { "object_id": "obj-cas-imm-...", "render": "markdown" },
        "use-cases": { "object_id": "obj-cas-imm-...", "render": "json" },
        "team-photo":{ "object_id": "obj-cas-imm-...", "render": "image" }
    }
}
```

**Schema validation (mandatory):**
- `version` must be `"1.0"`. Other values → fail.
- `slots` must be an object. Each slot has `object_id` (matches `/^obj-cas-imm-/`) and `render` (one of: `markdown`, `image`, `json`).
- **Manifest must NOT contain `write_key` anywhere** (recursive check). On detection, fail with the exact error: `"Manifest validation error: write_key is forbidden in manifests."`
- Unknown slot fields → console warning, not error (forward compat).

**Frozen events:**
```js
export const SGVM_EVENTS = Object.freeze({
    MANIFEST_LOADED: 'sg-vault-manifest:manifest-loaded',
    MANIFEST_ERROR:  'sg-vault-manifest:manifest-error',
    SLOT_READY:      'sg-vault-manifest:slot-ready',
});
```

**Event detail shapes:**
- `manifest-loaded` → `{ src: string, slotCount: number }`
- `manifest-error` → `{ src: string, error: string }`
- `slot-ready` → `{ slotName: string, objectId: string, render: string, vaultId: string, readKey: string }`

**Slot-mounting pattern** (the demo tool implements the bootstrap; not part of the component itself):
```html
<sg-vault-manifest src="/manifests/home.json"
                   vault-id="abc12345"
                   read-key="J3kRP7..."
                   id="page-manifest"></sg-vault-manifest>

<div data-vault-slot="hero"></div>
<div data-vault-slot="use-cases"></div>
```

A small bootstrap script in the demo tool's `ui/main.js` (~30 LOC) listens for `slot-ready`, finds `[data-vault-slot="${slotName}"]`, replaces it with `<sg-vault-content>`. Whether to extract this into an `<sg-manifest-mount>` component is OQ-2 in §11.

**File budget:** `sg-vault-manifest.js` ≤ 200 LOC.

---

### 6.8 `<sg-vault-trace>` — introspection panel

**Path:** `components/vault-embed/sg-vault-trace/v0/v0.1/v0.1.0/`
**Purpose:** Listens to all vault-embed events and renders an introspection panel. **Built first** — drives the event spec.

**Attributes:**
| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| `target` | no | string | Element ID to scope to (default: `document` level) |
| `format` | no | enum | `compact` (default) or `detailed` |

**Frozen events emitted:** None. (Pure sink.)

**Behaviour:** Listens for events from §6.1, §6.2, and §6.7 (any event whose name starts with `sg-vault-`). Renders rows like:

```
🔑 sg-vault-key:key-ready
   vault_id:    abc12345
   endpoint:    https://send.sgraph.ai
   derivation:  1.4ms

🌐 sg-vault-fetch:fetch-started
   url:         https://send.sgraph.ai/api/vault/read/abc12345/obj-cas-imm-xyz...

🌐 sg-vault-fetch:fetch-completed
   bytes:       2,847 (cache: HIT)
   time:        12ms

🔓 sg-vault-fetch:decrypt-completed
   plaintext:   2,815 bytes
   decrypt:     0.3ms
   contentType: text/markdown

📄 sg-vault-fetch:content-ready
   objectId:    obj-cas-imm-xyz999...
   text:        "# Welcome to SG/Send..."
```

**This component is the suite's conformance test.** AC-1 in §10 is the binding criterion.

**File budget:** `sg-vault-trace.js` ≤ 250 LOC.

---

## 7. The Demo Tool — `vault-embed-demo`

**Path:** `tools/v0/v0.1/v0.1.X/en-gb/vault-embed-demo/` (X = next available minor, currently 56+)
**URL after deploy:** `https://tools.sgraph.ai/en-gb/vault-embed-demo/`
**Locales:** `en-gb` only for v0.1.0. Other locales follow if the tool gets adopted.

### 7.1 Why this is a Tool (not a webpage)

It has a `manifest.json`, a `SgToolApi` registration, three `SKILL-{role}.md` files. It exercises every component in this brief against a real vault, with introspection visible. It is **the integration test, the spec, the documentation, and the agent skill artefact, all in one** — the `linkedin-publisher` tool's structure is the closest exemplar already in the repo.

### 7.2 What the tool does

Rendered on first load:

1. **Header:** "SG/Send Public Vault Components — Live Demo. Every byte you see below was fetched encrypted from `send.sgraph.ai`, decrypted in your browser using the public read_key shown to your right, and rendered by these components."

2. **A credentials panel**, visible in the rendered page text (not just in HTML source):
   ```
   Vault ID:  abc12345
   Read Key:  J3kRP7QyL... (this key is public — content is public)
   API:       https://send.sgraph.ai
   ```

3. **A `<sg-vault-trace>` panel** at the top, scoped to `document`, showing every event in chronological order.

4. **At least three `<sg-vault-content>` instances** with `inspect`:
   - Markdown blob (intro prose)
   - Image blob (small PNG, e.g. SG logo)
   - JSON blob in `mode="render"` (build metadata)

5. **A "Manifest demo" section** with `<sg-vault-manifest>` driving three `[data-vault-slot]` placeholders from a `home.json` served from the demo vault itself.

6. **A code block showing the sgit commands** an agent runs to update one of the demo vault objects. Copy-pasteable, real, runnable.

7. **A "View source" link** to the GitHub source of the tool.

### 7.3 Tool API methods (registered via `SgToolApi`, per D.1)

| Method | Purpose |
|--------|---------|
| `getDemoVaultInfo()` | Returns `{ vaultId, readKey, endpoint, objectIds }` |
| `loadDemoContent({ slot })` | Triggers a re-fetch of one slot — useful for cache testing |
| `getTraceLog({ limit })` | Returns the last N events from the trace panel as structured data |
| `clearTraceLog()` | Empties the trace panel |
| `setEndpoint({ endpoint })` | Switches between `dev.send.sgraph.ai` and `send.sgraph.ai` for testing |

Every method has an entry in `manifest.json` `api.actions` per D.2. Methods emitting events declare them per D.3.

### 7.4 SKILL files (mandatory per E.3)

- **`SKILL-human.md`** — what a human visitor sees and can do. "Read the rendered content. Inspect the trace panel. Open devtools to verify the network requests. Click 'view source' to see the HTML."
- **`SKILL-browser.md`** — selectors and click sequences for an agentic browser session. "To verify the demo loads, wait for `[data-trace-event='content-ready']` to appear ≥3 times, then assert `.demo-credentials .read-key-value` is non-empty."
- **`SKILL-api.md`** — programmatic API. "Call `window.__tools['vault-embed-demo'].loadDemoContent({slot: 'hero'})`; a fresh fetch+decrypt cycle runs, `tool:vault-embed-demo:content-loaded` fires."

### 7.5 Demo vault setup

A separate setup script (`scripts/setup-demo-vault.sh`, in this brief's PR) creates and populates the demo vault on `send.sgraph.ai`:

```bash
sgit init demo-vault --vault-key "$DEMO_VAULT_KEY"
echo "# Welcome to the SG/Send live demo..." | \
    sgit write content/intro.md ./demo-vault
sgit write content/sg-send-logo.png ./demo-vault < assets/sg-send-logo.png
echo '{"build":"v0.22.17","components":8}' | \
    sgit write content/build-info.json ./demo-vault
sgit write manifests/home.json ./demo-vault < /tmp/home.json
sgit push ./demo-vault
sgit derive-keys "$DEMO_VAULT_KEY"
# → outputs read_key — embed in the demo tool's index.html
```

Demo vault credentials live in a separate ops repo or GitHub Actions secret, not in `SGraph-AI__Tools`. AppSec sign-off required for the custody decision (OQ-3).

---

## 8. Build Order

```
   ┌───────────────────────────────────────┐
   │ 0. core/vault-client v1.2.2 patch     │ AppSec sign-off (one-page review).
   │    Adds importReadKey(readKeyB64Url)  │ Mechanical addition. ~10 LOC.
   │    helper. Copy of v1.2.1 + new fn.   │ All other v1.2.1 exports unchanged.
   └────────────────────┬──────────────────┘
                        │
   ┌────────────────────▼──────────────────┐
   │ 1. <sg-vault-trace>                   │ Built first. Initially listens to
   │                                       │ hand-fired CustomEvents to validate
   │                                       │ rendering. Drives event spec.
   └────────────────────┬──────────────────┘
                        │
   ┌────────────────────▼──────────────────┐
   │ 2. <sg-vault-key>                     │ Simplest real component.
   │                                       │ Uses importReadKey from §0.
   └────────────────────┬──────────────────┘
                        │
   ┌────────────────────▼──────────────────┐
   │ 3. <sg-vault-fetch>                   │ Real fetch+decrypt via existing
   │                                       │ readFile(). AC gate: known dev
   │                                       │ vault decrypts to known plaintext.
   └────────────────────┬──────────────────┘
                        │
   ┌────────────────────▼──────────────────┐
   │ 4. <sg-content-markdown>              │ First renderer. AC gate: works
   │                                       │ with hand-fired CustomEvents,
   │                                       │ no vault-embed on the page.
   └────────────────────┬──────────────────┘
                        │
   ┌────────────────────▼──────────────────┐
   │ 5. <sg-vault-content>                 │ Wraps 2+3+4. The one-line surface.
   └────────────────────┬──────────────────┘
                        │
   ┌────────────────────▼──────────────────┐
   │ 6. <sg-content-image>, <sg-content-json>   Parallel.
   └────────────────────┬──────────────────┘
                        │
   ┌────────────────────▼──────────────────┐
   │ 7. <sg-vault-manifest>                │ Last component. Depends on others.
   └────────────────────┬──────────────────┘
                        │
   ┌────────────────────▼──────────────────┐
   │ 8. vault-embed-demo tool              │ The integration test.
   │    + setup-demo-vault.sh              │ Demo vault provisioned.
   │    + 3 SKILL-{role}.md files          │
   │    + SgToolApi registration           │
   └───────────────────────────────────────┘
```

**Reasoning for trace-first:** if components ship first and trace last, the trace exposes events that components forgot to emit, requiring revisits. Trace-first means components are born conforming.

**Reasoning for the v1.2.2 patch first:** without `importReadKey()` in `core/vault-client`, every component would have a TODO comment about where it's importing from. Better to do the patch first as one PR, get AppSec sign-off, then build on stable foundations.

---

## 9. Tasks (Sonnet-Decomposable)

Per K.1: one task = one acceptance check = one commit. Sample task shape:

```
### Task 0.1 — Add importReadKey() to core/vault-client v1.2.2

**Acceptance:** core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js
exists. It is a copy of v1.2.1 plus one new exported function:

    export async function importReadKey(readKeyBase64Url) {
        // Decodes base64url → 32 bytes → AES-GCM CryptoKey
        // Mirrors the read_key half of deriveVaultKeys() exactly.
    }

A test page at tests/vault-client/v1.2.2.test.html imports the module,
calls importReadKey() with a known base64url string, decrypts a known
ciphertext via crypto.subtle.decrypt with the resulting CryptoKey to
a known plaintext.

**Files modified:**
- core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js (new — copy of v1.2.1 + new fn)
- core/vault-client/v1/v1.2/v1.2.2/vault-id-utils.js (new — copy of v1.2.1, unchanged)
- core/vault-client/v1/v1.2/v1.2.2/manifest.json (new)
- tests/vault-client/v1.2.2.test.html (new)

**Checklist items satisfied:** §10 (no per-component AC for the patch — see §8).

**Estimated time:** 60 minutes (mostly verifying the patch preserves v1.2.1 behaviour).
```

The implementer turns each component's spec in §6 into 5–8 such tasks. Per K.2: stop and ask if anything is ambiguous.

---

## 10. Acceptance Criteria

### Per-component (apply to every component in §6)
- **AC-A:** Extends `SgComponent`. Uses `static jsUrl = import.meta.url`.
- **AC-B:** Has separate sibling `.html`, `.css`, `.js` files. No `<style>` in JS, no inline templates.
- **AC-C:** All event listeners use `addTrackedListener`.
- **AC-D:** All custom events use `this.emit()` (composed bubbling) and event names come from a frozen `Object.freeze({...})` constant in `events.js`.
- **AC-E:** Errors render via inherited `showError()`, never as raw exceptions in the page.
- **AC-F:** No `localStorage`, `sessionStorage`, `IndexedDB`, or module-level globals.
- **AC-G:** Class file ≤ 350 LOC; helper modules ≤ 300 LOC each.
- **AC-H:** Public methods have JSDoc per J.2.
- **AC-I:** Test page at `tests/{namespace}/{component-name}/v0.1.0.test.html` exists and passes.

### Suite-level
- **AC-1:** `<sg-vault-trace>` reconstructs the full pipeline from events alone. The implementer can read the spec for any other component using only the trace output and the events frozen in §6.
- **AC-2 (renderer independence):** Each renderer in `components/content/` works with hand-fired `CustomEvent`s, with no vault-embed component on the page, and has zero imports from `components/vault-embed/` or `core/vault-*` (verify via `grep`).
- **AC-3:** Two `<sg-vault-key>` elements with different vault IDs on the same page do not interfere. Components with different `key-source` values resolve correctly.
- **AC-4:** A manifest containing `write_key` anywhere is rejected at load time with the exact error message: *`Manifest validation error: write_key is forbidden in manifests.`*
- **AC-5:** Decrypt failures surface as `"Content unavailable"` in `showError()`. Full error available only via `fetch-error` event.
- **AC-6:** Image renderer revokes Blob URLs on `disconnectedCallback` (verified by leak test: 100 mount/unmount cycles).
- **AC-7:** No vault-embed component depends on `<div data-vault-bus>` or any `vault:*` event from the existing editor stack. Verify by mounting any vault-embed component into an empty page (no bus div) and confirming it works.

### Tool-level (`vault-embed-demo`)
- **AC-D1:** Renders successfully on first load with cold caches (no errors, all three slot types render).
- **AC-D2:** All credential values (`vault_id`, `read_key`, endpoint) are visible in the rendered page text — not just in HTML source.
- **AC-D3:** The trace panel shows at least one cache miss (first load) and at least one cache hit (after second `loadDemoContent` for the same slot).
- **AC-D4:** Works in current Firefox, Chrome, and Safari.
- **AC-D5:** All three `SKILL-{role}.md` files exist and accurately describe the tool's behaviour as shipped.
- **AC-D6:** Manifest's `api.actions` lists every method registered via `SgToolApi.register`.

---

## 11. Open Questions

| # | Question | Resolution path |
|---|----------|-----------------|
| OQ-1 | Should `importReadKey()` live in `core/vault-client v1.2.2` (as this brief assumes) or in a new `core/vault-embed-client/v0/v0.1/v0.1.0/`? | Architect call. Recommendation: stay in `vault-client` as a v1.2.2 patch — it's a 10-line additive function, nothing about it is embed-specific. The split would create more maintenance surface for no clear gain. AppSec sign-off on the patch either way. |
| OQ-2 | Should the slot-mount bootstrap (the `[data-vault-slot]` → `<sg-vault-content>` swap) be extracted into a `<sg-manifest-mount>` component in v0.1.1? | Decide after demo tool ships. If multiple sites need it, extract; otherwise leave inline in `vault-embed-demo/ui/main.js`. |
| OQ-3 | Where do the demo vault's keys live? | AppSec call. Recommendation: separate ops repo with limited access, not in `SGraph-AI__Tools`, not as a GitHub Actions secret on this repo. |
| OQ-4 | Should `<sg-vault-trace>` allow the user to copy the trace as text (for bug reports)? | UX nicety. Add in v0.1.0 if time permits, otherwise v0.1.1. |
| OQ-5 | Should the embed stack support `read-key-from-passphrase` mode for vaults whose public token is `{passphrase}:{vault_id}`? | Defer. The read-key-direct mode covers the immediate use case. Adding the passphrase mode later via an additional `<sg-vault-key passphrase="..." vault-id="...">` attribute is non-breaking. |
| OQ-6 | Is `sg-content-html` in scope for v0.1.0 or deferred? | Recommendation: defer. Sandboxed HTML rendering needs its own AppSec review (script blocking, CSP, iframe vs shadow DOM). Re-evaluate when a real use case appears. |
| OQ-7 | Is `sg-content-video` in scope for v0.1.0 or deferred? | Recommendation: defer. Video has size and autoplay UX considerations that warrant their own brief. |
| OQ-8 | Should `<sg-content-markdown>` re-verify or harden the existing `core/markdown` HTML-escaping for vault-sourced content? | Implementer reviews `core/markdown/sg-markdown.js` against vault threat model in Task 4.1. If gaps found, file as a separate bug against `core/markdown` — DO NOT add a parallel sanitizer in the renderer. |

---

## 12. What's Out of Scope

- **Write capability.** No component accepts a `write_key`. Writes happen via `sgit` only — see the CLI brief.
- **Authenticated vaults.** The embed stack assumes read-only access to public-content vaults. Private vaults requiring user-supplied credentials are an editor-stack concern, not embed-stack.
- **Modifications to the existing `components/vault/*` editor stack.** Out of scope. Those components are independent and remain unchanged.
- **HTML and video renderers** (per OQ-6, OQ-7).
- **The structure_key encryption split** described in `team/roles/architect/reviews/04/26/v0.22.17__architect-review__structure-key-encryption-split.md`. Deferred.
- **Performance budgets.** First version: correct, not optimised.
- **The sgraph.ai integration.** When `sgraph.ai` consumes these components, that's a separate brief for the website team.

---

## 13. DO NOT (per K.4)

- **DO NOT** put any of these components in the website repo (`SGraph-AI__App__Send`). They live in `SGraph-AI__Tools`.
- **DO NOT** modify any existing `components/vault/*` component. Out of scope.
- **DO NOT** import anything in `components/content/*` from `components/vault-embed/*` or from `core/vault-*`. The renderer-independence is namespace-enforced.
- **DO NOT** depend on `<div data-vault-bus>` or any `vault:*` event from the existing editor stack.
- **DO NOT** import from any tool. Per A.3: tools may import from `core/`, `components/`, but not from each other.
- **DO NOT** extend raw `HTMLElement`. Per B.1: extend `SgComponent`.
- **DO NOT** inline templates in JS. Per B.2: separate sibling `.html` and `.css` files.
- **DO NOT** invent event names or detail shapes. Per K.6: names are pinned in §6.
- **DO NOT** add features outside §6. Per K.5: smaller, safer change. New features go in v0.1.1+.
- **DO NOT** accept, store, or transmit any `write_key`. Read-only suite.
- **DO NOT** edit `core/vault-client/v1/v1.2/v1.2.1/` in place. Per H.1: released versions are frozen. The patch lives at v1.2.2.
- **DO NOT** touch `version` at the repo root. Per H.5: CI owns it.
- **DO NOT** run `git add -A` if another agent is working in the repo. Per A.1: explicit file paths only.

---

## 14. Reference Material

- **Anchor architecture:** `team/comms/briefs/04/26/v0.22.17__brief__vault-backed-workflows.md`
- **CLI brief (the writer side):** `team/comms/briefs/04/26/v0.22.17__dev-brief__cli-surgical-write-commands.md`
- **Toolkit pack guidelines:** `03__guidelines__sg-component-and-ifd.md`
- **Toolkit pack architecture:** `01__architecture__sg-toolkit.md`
- **Existing crypto (use, don't reinvent):** `core/vault-client/v1/v1.2/v1.2.1/sg-vault-client.js`
- **Existing markdown renderer (use directly):** `core/markdown/v1/v1.0/v1.0.0/sg-markdown.js`
- **`SgComponent` base:** `components/base/v1/v1.0/v1.0.0/sg-component.js`
- **Pattern reference (small `SgComponent`):** `components/key-input/v1/v1.0/v1.0.0/sg-key-input.js`
- **Pattern reference (existing tool layout):** `tools/v0/v0.1/v0.1.55/en-gb/linkedin-publisher/`
- **Pattern reference (the editor stack — for understanding what NOT to copy):** `components/vault/sg-vault-connect/v0/v0.1/v0.1.3/sg-vault-connect.js`

---

*Explorer Team — Architect*
*Dev brief for Tools team — public-vault embed components*
*Version: v0.22.17 | Date: 26 April 2026*
