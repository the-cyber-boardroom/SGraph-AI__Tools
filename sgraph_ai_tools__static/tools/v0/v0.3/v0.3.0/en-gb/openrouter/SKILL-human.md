# OpenRouter — Human Guide

**Tool:** OpenRouter Dashboard v0.1.23
**URL:** `/en-gb/openrouter/`

## What This Tool Does

The OpenRouter Dashboard lets you manage your OpenRouter account directly from
the browser. It connects to your OpenRouter credentials — optionally loading them
from your SG Vault — and provides panels for:

- **Key Stats** — current balance, rate limit, usage, free-tier status
- **Models** — browse all available models with specs and pricing
- **Model Detail** — full detail for any model
- **Usage** — activity buckets over time
- **Spending** — credit usage grouped by model
- **Generation** — inspect a specific generation by ID
- **Activity** — recent generation history
- **Key Manager** — create and delete provisioned API keys (requires management key)
- **Logs** — upload and analyse a CSV export from OpenRouter

---

## Quick Start

### Option A — Direct API key entry

1. You will see a **Connect** tab in the User section (left panel, top row).
2. Type your OpenRouter API key (`sk-or-v1-…`) and click **Connect**.
3. Once connected, the Key Stats, Usage, Models panels will load automatically.

### Option B — Load from Vault

1. Paste your vault key (`passphrase:vaultid`) in the **VAULT KEY** field at the top.
2. Set the API URL if different from `https://send.sgraph.ai`.
3. Click **Load from Vault**.
4. The tool reads `openrouter/user/config.json` and `openrouter/admin/config.json`
   from your vault and fills the connection forms automatically.

**Expected vault file formats:**

`openrouter/user/config.json`
```json
{ "apiKey": "sk-or-v1-…" }
```

`openrouter/admin/config.json`
```json
{ "managementKey": "sk-or-v1-mgmt-…" }
```

---

## Layout Overview

The dashboard has two main sections side by side:

### User section (left, 60%)

| Panel | What it shows |
|-------|--------------|
| **Connect** | User API key entry and vault status |
| **Key Stats** | Balance, rate limit, usage, free-tier badge |
| **Usage** | Request/token buckets over time |
| **Models** | Searchable list of all OpenRouter models with cost/context |
| **Model Detail** | Full spec for a selected model (pricing, limits, providers) |

### Admin section (right, 40%) — requires management key

| Panel | What it shows |
|-------|--------------|
| **Connect** | Management key entry and vault status |
| **Keys** | List provisioned API keys, create new, delete existing |
| **Generation** | Look up a specific generation by ID |
| **Activity** | Recent generation history |
| **Spending** | Credit usage grouped by model, with totals |
| **Logs** | Upload a CSV log export and analyse it |

---

## Bottom Developer Panel

Below the main dashboard is a three-tab developer panel:

| Tab | Content |
|-----|---------|
| **⚡ Explorer** | Live debug view — health status, method list, event stream, execution log |
| **> Console** | Interactive method caller — select a method, fill params, call it, see results |
| **📋 Manifest** | Tool manifest, full API spec, and SKILL files |

---

## Common Workflows

### Check your balance

1. Connect with your API key (Connect tab in User section).
2. Click the **Key Stats** tab — balance and rate limit appear immediately.

### Search for a model

1. Connect with your API key.
2. Click the **Models** tab.
3. Use the search box to filter by name or ID.
4. Click a model row to see full detail in **Model Detail**.

### Create a provisioned key for a teammate

1. Load your vault key with admin credentials, or enter the management key manually in
   the Admin → Connect tab.
2. Click the **Keys** tab.
3. Fill in a name and optional spend limit, then click **Create**.
4. Copy the new key immediately — it is only shown once.

### Delete a provisioned key

1. Connect with admin credentials (as above).
2. In the **Keys** tab, find the key by name or hash.
3. Click **Delete** — this is irreversible.

### Analyse spending

1. Connect with your API key.
2. Click **Spending** — credit usage is shown per model with totals.

---

## Tips

- Credential fields are not saved to localStorage for the management key. Use the vault
  to avoid re-entering it each session.
- The **user** API key IS saved to localStorage (`or-user-api-key`) so it persists
  across page reloads.
- The **Logs** tab accepts a CSV export from your OpenRouter dashboard
  (Settings → Usage → Export).
- The ⚡ Explorer panel's **Events** tab streams all `tool:*` window events in real time —
  useful for debugging automation scripts.
