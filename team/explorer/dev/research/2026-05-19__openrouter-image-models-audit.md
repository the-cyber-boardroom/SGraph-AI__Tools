# OpenRouter Image-Model Audit for infographic-gen

Date: 2026-05-19
Source-of-truth tool path: `sgraph_ai_tools__static/tools/v0/v0.1/v0.1.37/en-gb/infographic-gen/` (last full implementation)
Latest deployed `index.html`: `sgraph_ai_tools__static/tools/v0/v0.1/v0.1.53/en-gb/infographic-gen/index.html` (re-uses earlier JS via the `sg-infographic-model-picker` component)
Single source of model list (component): `sgraph_ai_tools__static/components/infographic/sg-infographic-model-picker/v0/v0.1/v0.1.0/sg-infographic-model-picker.js`
Request builder (no `modalities` flag — see Section 3 FIX): `sgraph_ai_tools__static/components/llm/sg-llm-request/v0/v0.1/v0.1.2/sg-llm-request.js` (`_buildOpenAIBody`, lines 101-123)

Methodology notes:
- Live OpenRouter catalogue pulled from `https://openrouter.ai/api/v1/models` (424 KB JSON, 2026-05-19). Filter `architecture.output_modalities ∋ "image"` returns only 7 entries — the public JSON omits image-only providers (Sourceful, FLUX, Recraft, Seedream, Grok-Imagine). Each missing slug was confirmed individually via the model card URL (`https://openrouter.ai/{slug}`) and cross-checked against `https://openrouter.ai/collections/image-models` and the docs at `https://openrouter.ai/docs/guides/overview/multimodal/image-generation`.
- A "FOUND" verdict means a 200-response model card with concrete pricing. A "NOT AVAILABLE" verdict means the model card shows the literal message *"The model 'X' is not available"* and routes users to Discord.

## 1. Currently wired models

Code location: `components/infographic/sg-infographic-model-picker/v0/v0.1/v0.1.0/sg-infographic-model-picker.js`, constants `ALL_IMAGE_MODELS`, `ALL_SVG_MODELS`, `TOP_3_MODELS`, `MODEL_METADATA`.

### Image group (`ALL_IMAGE_MODELS`)

| # | Display name (code) | OR slug (code) | Status in code | Real OR status (2026-05-19) |
|---|---|---|---|---|
| 1 | Gemini 3.1 Flash Image | `google/gemini-3.1-flash-image-preview` | TOP_3, default | LIVE — preview, $0.0005/Mtok in, $0.003/Mtok out (image priced via tokens) |
| 2 | Gemini 2.5 Flash Image | `google/gemini-2.5-flash-image` | TOP_3 | LIVE — GA, image $0.0003 ea, prompt $0.0003/Mtok, completion $0.0025/Mtok |
| 3 | Gemini 3 Pro Image | `google/gemini-3-pro-image-preview` | image group | LIVE — preview, image $0.002 ea, prompt $0.002/Mtok |
| 4 | Gemini 2.0 Flash | `google/gemini-2.0-flash-001` | image group (WRONG GROUP) | LIVE but `output_modalities=["text"]` — this is NOT an image-output model |
| 5 | GPT-5 Image Mini | `openai/gpt-5-image-mini` | TOP_3 | LIVE — GA, prompt $0.0025/Mtok, completion $0.002/Mtok |
| 6 | GPT-5 Image | `openai/gpt-5-image` | image group | LIVE — GA, prompt $0.01/Mtok, completion $0.01/Mtok |
| 7 | Riverflow v2 Fast | `sourceful/riverflow-v2-fast` | image group, "~$0.02/img" | LIVE — GA (Feb 2 2026), $0.02 per 1K img, $0.04 per 2K img |
| 8 | Riverflow v2 Fast Preview | `sourceful/riverflow-v2-fast-preview` | image group, **"free"** | LIVE — paid, $0.03/img — code label WRONG |
| 9 | Riverflow v2 Standard Preview | `sourceful/riverflow-v2-standard-preview` | image group, **"free"** | LIVE — paid, $0.035/img — code label WRONG |
| 10 | Riverflow v2 Pro | `sourceful/riverflow-v2-pro` | image group, "~$0.06/img" | LIVE — GA, $0.15/img (1K/2K), $0.33 (4K) — code label WRONG (4×–7× understated) |
| 11 | Riverflow v2 Max Preview | `sourceful/riverflow-v2-max-preview` | image group, **"free"** | LIVE — paid, $0.075/img — code label WRONG |
| 12 | Seedream 4.5 | `bytedance/seedream-4.5` | image group, "~$0.05/img" | **NOT AVAILABLE — wrong slug.** Correct slug is `bytedance-seed/seedream-4.5` (with `-seed`), $0.04/img |
| 13 | FLUX 2 Pro | `black-forest-labs/flux-2-pro` | image group, "~$0.08/img" | **NOT AVAILABLE — wrong slug.** Correct slug is `black-forest-labs/flux.2-pro` (DOT not hyphen), $0.03 first MP + $0.015/MP |
| 14 | FLUX 2 Flex | `black-forest-labs/flux-2-flex` | image group, "~$0.04/img" | **NOT AVAILABLE — wrong slug.** Correct: `black-forest-labs/flux.2-flex`, $0.06/MP in+out |
| 15 | FLUX 2 Klein | `black-forest-labs/flux-2-klein` | image group, "~$0.02/img" | **NOT AVAILABLE — wrong slug.** Correct: `black-forest-labs/flux.2-klein-4b`, $0.014 first MP + $0.001/MP |

### Text/SVG group (`ALL_SVG_MODELS`)

| # | Display name (code) | OR slug (code) | Real OR status |
|---|---|---|---|
| 16 | Qwen 2.5 72B | `qwen/qwen-2.5-72b-instruct` | LIVE — text only, $0.36/Mtok in, $0.40/Mtok out (cheaper than code label) |
| 17 | Qwen 2.5 7B | `qwen/qwen-2.5-7b-instruct` | LIVE — $0.04/Mtok in, $0.10/Mtok out |
| 18 | Llama 3.3 70B | `meta-llama/llama-3.3-70b-instruct` | LIVE — $0.10/Mtok in, $0.32/Mtok out |
| 19 | Llama 3.1 8B free | `meta-llama/llama-3.1-8b-instruct:free` | **MISSING.** Free tier replaced; `meta-llama/llama-3.3-70b-instruct:free` and `meta-llama/llama-3.2-3b-instruct:free` are the current free Llamas |
| 20 | Mistral Small 3.1 | `mistralai/mistral-small-3.1-24b-instruct` | LIVE — $0.000351/Mtok in (cheap), accepts image input |
| 21 | DeepSeek Chat V3 | `deepseek/deepseek-chat-v3-0324` | LIVE — $0.20/Mtok in, $0.77/Mtok out (newer: `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`, plus free tier) |
| 22 | Claude Haiku 4.5 | `anthropic/claude-haiku-4-5-20251001` | **MISSING — wrong slug.** Correct slug is `anthropic/claude-haiku-4.5` (no date suffix, dotted version), $1/Mtok in, $5/Mtok out |

Total wired: 22 (15 image + 7 text). Of these, 6 will return 404/"not available" on OpenRouter today (the FLUX 2 family, Seedream 4.5, Llama-3.1-8B free, Claude Haiku-4-5-20251001).

## 2. OpenRouter image-model inventory today (2026-05-19)

Source: `openrouter.ai/api/v1/models` + per-card verification + `openrouter.ai/collections/image-models`. Prices as displayed on model cards. Status: G = GA, P = Preview.

| Provider | Model | OR slug | Modalities (in → out) | Price | Status | Notes |
|---|---|---|---|---|---|---|
| Google | Nano Banana (2.5 Flash Image) | `google/gemini-2.5-flash-image` | image+text → image+text | image $0.0003, prompt $0.0003/Mtok, completion $0.0025/Mtok | G | Cheapest reliable Gemini image |
| Google | Nano Banana 2 (3.1 Flash Image Preview) | `google/gemini-3.1-flash-image-preview` | image+text → image+text | prompt $0.0005/Mtok, completion $0.003/Mtok | P | SOTA image+edit per OR docs |
| Google | Nano Banana Pro (3 Pro Image Preview) | `google/gemini-3-pro-image-preview` | image+text → image+text | image $0.002, prompt $0.002/Mtok, completion $0.012/Mtok | P | Heaviest Gemini image, best for complex compositions |
| OpenAI | GPT-5 Image Mini | `openai/gpt-5-image-mini` | text+image+file → image+text | prompt $0.0025/Mtok, completion $0.002/Mtok | G | Good cost/quality balance, file input |
| OpenAI | GPT-5 Image | `openai/gpt-5-image` | image+text+file → image+text | prompt $0.01/Mtok, completion $0.01/Mtok | G | Higher-quality OpenAI image |
| OpenAI | GPT-5.4 Image 2 | `openai/gpt-5.4-image-2` | image+text+file → image+text | prompt $0.008/Mtok, completion $0.015/Mtok | G | NEW (newer than GPT-5 Image), combines reasoning + image |
| Black Forest Labs | FLUX.2 Pro | `black-forest-labs/flux.2-pro` | text+image → image | $0.03 first MP + $0.015/MP, input $0.015/MP | G | Released 2025-11-25 |
| Black Forest Labs | FLUX.2 Flex | `black-forest-labs/flux.2-flex` | text+image → image | $0.06/MP both sides | G | Multi-reference editing |
| Black Forest Labs | FLUX.2 Max | `black-forest-labs/flux.2-max` | text+image → image | $0.07 first MP + $0.03/MP, input $0.03/MP | G | Top-tier BFL, released 2025-12-16 |
| Black Forest Labs | FLUX.2 Klein 4B | `black-forest-labs/flux.2-klein-4b` | text → image | $0.014 first MP + $0.001/MP | G | Cheapest BFL, released 2026-01-14 |
| Sourceful | Riverflow V2 Fast | `sourceful/riverflow-v2-fast` | text+image → image | $0.02/img (1K), $0.04/img (2K) | G | Released 2026-02-02 |
| Sourceful | Riverflow V2 Pro | `sourceful/riverflow-v2-pro` | text+image → image | $0.15/img (1K-2K), $0.33/img (4K) | G | Best-text-rendering image model on OR |
| Sourceful | Riverflow V2 Standard Preview | `sourceful/riverflow-v2-standard-preview` | text+image → image | $0.035/img | P | |
| Sourceful | Riverflow V2 Fast Preview | `sourceful/riverflow-v2-fast-preview` | text+image → image | $0.03/img | P | |
| Sourceful | Riverflow V2 Max Preview | `sourceful/riverflow-v2-max-preview` | text+image → image | $0.075/img | P | |
| ByteDance | Seedream 4.5 | `bytedance-seed/seedream-4.5` | text+image → image | $0.04/img flat | G | Released 2025-12-23, strong portrait + small-text |
| Recraft | Recraft v3 | `recraft/recraft-v3` | text+image → image | $0.04/img | G | Released 2026-05-07, style/palette/text-placement controls, ~1K resolution |
| xAI | Grok Imagine (Image Quality) | `x-ai/grok-imagine-image-quality` | text+image → image | from $0.05/img | G | Released 2026-05-18, photorealistic 1K/2K, multilingual text rendering, identity preservation |
| Router | Auto Router | `openrouter/auto` | * → image+text | variable | G | Not recommended for infographics — non-deterministic |

Total real image-output models on OpenRouter: **18** (19 if you count the router). All FLUX slugs use **`flux.2-…` with a dot, not `flux-2-…`**. The ByteDance provider prefix is **`bytedance-seed/`, not `bytedance/`**.

Explicitly checked and **not available** (cards return "model is not available"): `black-forest-labs/flux-2-pro`, `black-forest-labs/flux-2-flex`, `black-forest-labs/flux-2-klein`, `bytedance/seedream-4.5`. None of Stability AI's SD3.5, Ideogram, DALL·E 3, or Imagen 4 are on OpenRouter as of 2026-05-19. Anthropic still has no image-output model (text/vision-input only).

## 3. Recommendations

All file references below are absolute paths into `sgraph_ai_tools__static/`.

### FIX (highest priority — these break the current tool)

Touch one symbol unless stated otherwise: `MODEL_METADATA` + `ALL_IMAGE_MODELS` (or `ALL_SVG_MODELS`) in `components/infographic/sg-infographic-model-picker/v0/v0.1/v0.1.0/sg-infographic-model-picker.js`.

- `black-forest-labs/flux-2-pro` → rename to **`black-forest-labs/flux.2-pro`** (dot, not hyphen). Update label cost to "$0.03 first MP + $0.015/MP". Source: `https://openrouter.ai/black-forest-labs/flux.2-pro`.
- `black-forest-labs/flux-2-flex` → rename to **`black-forest-labs/flux.2-flex`**. Update cost to "$0.06/MP". Source: `https://openrouter.ai/black-forest-labs/flux.2-flex`.
- `black-forest-labs/flux-2-klein` → rename to **`black-forest-labs/flux.2-klein-4b`** (also adds `-4b` suffix). Update cost to "$0.014 + $0.001/MP". Source: `https://openrouter.ai/black-forest-labs/flux.2-klein-4b`.
- `bytedance/seedream-4.5` → rename to **`bytedance-seed/seedream-4.5`**. Cost is $0.04/img flat (code says ~$0.05). Source: `https://openrouter.ai/bytedance-seed/seedream-4.5`.
- `anthropic/claude-haiku-4-5-20251001` → rename to **`anthropic/claude-haiku-4.5`**. Update cost to "$1/$5 per Mtok". Source: `https://openrouter.ai/anthropic/claude-haiku-4.5`.
- `meta-llama/llama-3.1-8b-instruct:free` → replace with **`meta-llama/llama-3.3-70b-instruct:free`** (the free tier of the 70B is the current OR freebie; preserves intent of "free SVG model"). Source: `jq '.data[] | select(.id == "meta-llama/llama-3.3-70b-instruct:free")' /tmp/or-models.json`.
- `google/gemini-2.0-flash-001` is in `ALL_IMAGE_MODELS` but `output_modalities=["text"]` — it cannot return images, so when picked from the "Image Models" group it always hits the "No image returned" branch in `tools/v0/v0.1/v0.1.37/en-gb/infographic-gen/send.js:144`. **Move it to `ALL_SVG_MODELS`** (its text+vision-in→text capability fits the SVG/markdown use case). Or drop entirely; the newer Gemini 2.5/3.x models supersede it.
- **Missing `modalities` request parameter.** `components/llm/sg-llm-request/v0/v0.1/v0.1.2/sg-llm-request.js` `_buildOpenAIBody` (lines 101-123) never sets `modalities`. The OpenRouter image-gen docs (`https://openrouter.ai/docs/guides/overview/multimodal/image-generation`) state: *"Models that output both text and images (e.g., Gemini): use `modalities: ['image', 'text']`. Models that only output images (e.g., Sourceful, Flux): use `modalities: ['image']`."* OpenRouter currently tolerates omission for Gemini (so the tool appears to work for the default model), but FLUX/Sourceful/Seedream calls will silently degrade or fail. Fix by:
  1. Importing `isImageModel` (and a new `isImageOnlyModel`) helper into the request builder OR passing `modalities` through the `SGL_LLM.SEND` detail from `tools/.../infographic-gen/send.js`.
  2. In `_buildOpenAIBody`, when caller signals image output, add `modalities: ['image', 'text']` for Gemini/GPT-Image and `modalities: ['image']` for Sourceful/FLUX/Recraft/Seedream/Grok-Imagine.
- Riverflow preview pricing labels: all three say `cost: 'free'` in `MODEL_METADATA` (lines 86, 87, 89). They are paid: $0.03, $0.035, $0.075/img respectively. Either update the labels or remove the previews from the picker (see RETIRE below).

### ADD (real OR-available models worth wiring)

Add to `ALL_IMAGE_MODELS` and `MODEL_METADATA` in the same picker file.

- **`openai/gpt-5.4-image-2`** — newest OpenAI image model on OR, reasoning + image, $0.008/$0.015 per Mtok. Worth listing alongside `gpt-5-image` and probably replacing it in TOP_3 for OpenAI representation. Good for infographics with text-heavy compositions.
- **`black-forest-labs/flux.2-max`** — BFL's top-tier model, $0.07 + $0.03/MP, GA since 2025-12-16. The "premium FLUX" slot is missing from the picker. Good for editorial-quality infographics.
- **`bytedance-seed/seedream-4.5`** — flat $0.04/img, strong on small-text rendering and portraits — a sweet spot for poster-style infographics. (This effectively replaces the broken `bytedance/seedream-4.5` entry.)
- **`recraft/recraft-v3`** — $0.04/img, native style/palette/text-placement controls, the only model in this list explicitly tuned for vector/graphic-design aesthetics. **Strong fit for infographics** — recommend promoting to TOP_3 once smoke-tested.
- **`x-ai/grok-imagine-image-quality`** — released 2026-05-18 (yesterday), photorealistic + multilingual text, identity preservation. Worth adding behind a "new" badge. From $0.05/img.

### RETIRE

- All five `sourceful/riverflow-v2-*-preview` slugs — they are paid (so the "free" label is misleading), they are previews of the GA Pro/Fast models already in the list, and their pricing overlaps the Fast/Pro tier. Keep only `sourceful/riverflow-v2-fast` (cheap GA) and `sourceful/riverflow-v2-pro` (premium GA). Net: drop 3 entries from `ALL_IMAGE_MODELS` and 3 from `MODEL_METADATA`.
- `google/gemini-2.0-flash-001` — supplanted by `google/gemini-2.5-flash-image` (image output) and `google/gemini-2.5-flash-lite` family (text). If kept anywhere it belongs in `ALL_SVG_MODELS`; the cleanest fix is just to drop it.
- `qwen/qwen-2.5-7b-instruct` — superseded by the `qwen3.6-*` family (e.g. `qwen/qwen3.6-flash` at $0.0001875/$0.001125 per Mtok). Either retire or replace.
- `deepseek/deepseek-chat-v3-0324` — `deepseek/deepseek-v4-flash` ($0.000112/$0.000224 per Mtok) is ~10× cheaper and newer. Worth swapping (and a free-tier sibling `deepseek/deepseek-v4-flash:free` exists if you want a free SVG generator that's better than the broken `llama-3.1-8b:free`).

### Top 3 reshuffle (proposed `TOP_3_MODELS`)

Current top 3: `gemini-3.1-flash-image-preview` (Google preview), `gemini-2.5-flash-image` (Google GA), `gpt-5-image-mini` (OpenAI). All three still valid. Suggestion once the FIX patch lands:

1. `google/gemini-3.1-flash-image-preview` — keep as default (best Gemini, cheap on tokens).
2. `recraft/recraft-v3` — promote: it's the only model genuinely designed for graphic/poster aesthetics, which is what infographic-gen is for.
3. `openai/gpt-5.4-image-2` — replace the older `gpt-5-image-mini` for OpenAI representation; reasoning + image is the better fit for "turn this paragraph into an infographic" prompts.

## 4. Open questions / things I couldn't verify

- **OpenRouter docs URL drift.** The path `https://openrouter.ai/docs/features/multimodal/image-generation` (cited in the task prompt) returned a 404 from WebFetch. The current path is `https://openrouter.ai/docs/guides/overview/multimodal/image-generation` — used in the report above. Worth a search-and-replace anywhere the old URL appears in repo docs.
- **`modalities` enforcement.** OpenRouter docs say the parameter is required for image-output, but in practice the tool's Gemini calls appear to succeed without it (otherwise no infographic has ever generated). I could not test from this audit whether OR silently injects `modalities` for known image slugs, or whether the Gemini family is a documented exception. The recommendation in FIX is to set it explicitly — that's strictly safer either way.
- **Token-vs-image pricing for Gemini/GPT image models.** The `MODEL_METADATA` labels say "per image" (e.g. "~$0.10/img"), but OpenRouter actually meters these as token-priced (image generation tokens). The displayed numbers are rough conversions and will drift; consider showing the underlying token rate or a price-per-output-token instead.
- **Deployed slug at `dev.tools.sgraph.ai`.** I could only verify the source tree. `tools/v0/v0.1/v0.1.53/en-gb/infographic-gen/index.html` is the latest version-folder containing an infographic-gen page, but it only ships `index.html` and references a relative `infographic-gen.js` not present in that folder — so the deployed asset must be served via a CDN-versioned URL not visible from the repo. The model list still comes from the shared `components/infographic/sg-infographic-model-picker/v0/v0.1/v0.1.0/` component, so the audit's conclusions hold regardless.
- **xAI Grok image model name.** The OR docs page calls it just "x-ai/grok-imagine" in passing while the model card uses `x-ai/grok-imagine-image-quality`. There may be sibling variants (`grok-imagine-image-fast`?) — could not confirm a full Grok-Imagine family list from the JSON (image-only models are hidden there).
- **Sourceful and FLUX are NOT in `/api/v1/models` JSON output.** Either OR filters image-only-output models out of the default JSON, or there's a flag to include them. I could not find the flag; verification was done one-card-at-a-time. If automated catalogue sync is ever added to the model picker, this gotcha needs handling.
- **`deepseek-chat-v3-0324` provenance.** The `-0324` date-pinned slug still works today but DeepSeek's pattern is to retire date-pinned snapshots quietly; the unversioned `deepseek/deepseek-chat-v3` may be safer for the picker.
