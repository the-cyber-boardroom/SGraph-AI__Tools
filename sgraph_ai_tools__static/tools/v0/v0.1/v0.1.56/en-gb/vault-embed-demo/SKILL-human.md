# SKILL-human — Vault Embed Demo

## What you see

The **Vault Embed Demo** demonstrates the `sg-vault-*` component suite. Every piece of content below the credentials panel was fetched *encrypted* from `send.sgraph.ai`, decrypted entirely in your browser using AES-256-GCM, and rendered by these Web Components. No server-side rendering. No decryption on the server.

## The credentials panel (top-left)

Shows the demo vault's public credentials:
- **Vault ID** — the 8-char vault identifier
- **Read Key** — the base64url-encoded 32-byte AES-GCM key (this is public — the content is intentionally public)
- **API Endpoint** — `https://send.sgraph.ai`

These values appear in the rendered page text, not just the HTML source. You can copy them and use them directly with `sgit` or the API.

## The event trace panel (top-right)

Shows every vault event in chronological order as they fire:
- `🔑 key-ready` — the read key was imported
- `🌐 fetch-started` — network request started
- `✅ fetch-completed` — bytes received (cache HIT or MISS)
- `🔓 decrypt-completed` — AES-GCM decrypt done in Xms
- `📄 content-ready` — plaintext available for rendering

On first load you'll see cache MISS. Reload the page and the same object shows cache HIT.

## The content sections

Three types of decrypted vault content are rendered:
1. **Markdown** — text/markdown blob, rendered as HTML
2. **Image** — binary blob, rendered as `<img>` via Blob URL
3. **JSON** — application/json blob, rendered as formatted `<pre>`

## The manifest demo section

Uses `<sg-vault-manifest>` to load a `home.json` manifest and dynamically swap `[data-vault-slot]` placeholder divs with `<sg-vault-content>` instances.

## Verifying decryption in devtools

1. Open Network tab → filter by `send.sgraph.ai`
2. Inspect a request to `/api/vault/read/...` — the response is ciphertext (random bytes)
3. Inspect the same content in the rendered page — it's plaintext (markdown, JSON, etc.)
4. The decryption happens in `sg-vault-fetch.js` via `crypto.subtle.decrypt`

## The code block

Shows the `sgit` commands that update one of the demo vault objects.
Copy-pasteable. Runnable with `DEMO_VAULT_KEY` set in your env.
