# WhatsApp Desk — JS API Spec

Tool name `whatsapp-desk` · API 0.1.0 · `window.__tool` after `tool:ready`.
All calls return Promises (SgToolApi). **Drafts never send; `sendText` /
`sendTemplate` are the only sending actions** (brief Decision 5). Demo mode
(`loadDemo`) keeps every send local.

## Actions (22)

| Action | Params | Returns / notes |
|---|---|---|
| `setCreds` | `{ token?, phoneNumberId?, wabaId?, relayUrl?, relayToken? }` | persists (localStorage); secrets masked in logs |
| `connect` | — | validates live (`GET` phone number) → `{ displayNumber, verifiedName, relay }`; arms the 10s visible-tab poll when relay configured |
| `disconnect` | — | `{ ok }` — clears state, keeps stored creds |
| `setOpenRouterKey` | `{ apiKey }` | shared `sg-openrouter-mgmt-key` |
| `syncInbound` | — | one relay pull → `{ newMessages, receipts }` |
| `listConversations` | — | rows `{ id, name, snippet, unread?, chip }` (chip = window state) |
| `openConversation` | `{ conversationId }` | focuses/creates the chat tab |
| `getMessages` | `{ conversationId, limit? }` | `{ messages, windowOpen, windowExpiresAt }` |
| `markRead` | `{ messageId, conversationId }` | blue ticks + clears unread |
| `sendText` | `{ conversationId\|to, body }` | typed `window-expired` client-side BEFORE any API call |
| `sendTemplate` | `{ to\|conversationId, name, lang?, components? }` | works outside the window; may open a billed conversation |
| `sendMedia` | `{ conversationId\|to, file\|mediaId, type?, caption? }` | uploads then sends |
| `listTemplates` | — | approved templates `[{ name, lang, label }]` |
| `transcribeVoiceNote` | `{ messageId, model? }` | fetch media → core/sg-transcribe → `{ text, costUsd }`; cached per message |
| `draftReply` | `{ conversationId, guidance?, model? }` | `{ draft, model, costUsd }` — fills the composer, **never sends**; default model `anthropic/claude-sonnet-4-6` |
| `listDraftModels` | — | curated draft models |
| `getCostSummary` | — | `{ transcriptionUsd, draftUsd, totalUsd }` |
| `downloadMedia` | `{ messageId }` | browser-native save |
| `loadDemo` | — | credential-free demo state; sends become local records |
| `getStatus` / `health` | — | connection, relay, demo flag, unread, masked creds, costs |

## Events (`wa:*`, frozen in core/sg-whatsapp)

`wa:connected` · `wa:disconnected` · `wa:sync {newMessages}` ·
`wa:message:in {conversationId,messageId,type}` · `wa:message:out` ·
`wa:receipt {messageId,status}` · `wa:window:changed {conversationId,open}` ·
`wa:transcript:complete {messageId,costUsd}` · `wa:draft:ready` · `wa:error`.

## Storage keys

`sg-whatsapp-token` · `sg-whatsapp-phone-id` · `sg-whatsapp-waba-id` ·
`sg-whatsapp-relay-url` · `sg-whatsapp-relay-token` ·
`sg-openrouter-mgmt-key` (shared).

## Error codes

`auth-invalid` · `window-expired` · `recipient-invalid` ·
`template-unapproved` · `rate-limited` · `media-error` ·
`relay-unreachable` · `relay-auth` · `key-missing` (+ LLM family) · `wa-error`.

## Agent run (supervised triage)

```js
await new Promise(r => addEventListener('tool:ready', r, { once: true }));
const t = window.__tool;
await t.connect();
await t.syncInbound();
for (const conv of await t.listConversations()) {
  if (!conv.unread) continue;
  const { messages } = await t.getMessages({ conversationId: conv.id });
  const last = messages.at(-1);
  if (last.type === 'audio' && !last.transcript) {
    const { text } = await t.transcribeVoiceNote({ messageId: last.id });
    console.log(conv.name, 'voice note:', text);
  }
  const { draft } = await t.draftReply({ conversationId: conv.id,
      guidance: 'friendly, short' });
  // Explicit consent step — the draft is NOT sent until this call:
  await t.sendText({ conversationId: conv.id, body: draft });
}
```
