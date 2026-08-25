/**
 * PlaybookLM — pipeline step execution.
 *
 * v0.1.6 changes:
 *  - optimizeSlide() called after every image generation; distBlob + liBlob +
 *    sizes stored in SlideVersion.
 *  - Background vault saves after step 2, step 3, and each slide generation.
 *    state.incrementPending() if vault not connected or save fails.
 *  - _exportPDF: uses distBlob (JPEG 1200px q82) instead of PNG data URLs —
 *    107-slide deck drops from ~116 MB to ~14.8 MB.
 *  - buildArchiveBlob: includes v{n}-dist.jpg and v{n}-li.jpg per version,
 *    PDF built from dist blobs.
 *
 * @module pipeline-steps
 * @version 0.1.6
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';
import { optimizeSlide } from './slide-optimizer.js';
import * as vaultOps from './vault-ops.js';

export const DEFAULT_TEXT_MODEL  = 'anthropic/claude-sonnet-4-6';
export const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_INFOGRAPHIC_SYSTEM_PROMPT = `You are an expert visual communicator and presentation designer.
Create visually striking, clear, and professional slide images.
Use a dark background (#0a0a1a) with teal accents (#4ECDC4), white headlines, and clear hierarchy.
Each slide should have a strong visual composition with one key idea per slide.`;

// ── Cost calculation ──────────────────────────────────────────────────────────

const MODEL_PRICING = {
  'anthropic/claude-opus-4-6':           { input: 15.00, output: 75.00 },
  'anthropic/claude-opus-4-5':           { input: 15.00, output: 75.00 },
  'anthropic/claude-sonnet-4-6':         { input:  3.00, output: 15.00 },
  'anthropic/claude-sonnet-4-5':         { input:  3.00, output: 15.00 },
  'anthropic/claude-haiku-4.5':          { input:  0.80, output:  4.00 },
  'anthropic/claude-haiku-4-5-20251001': { input:  0.80, output:  4.00 },
  'google/gemini-2.5-flash':             { input:  0.15, output:  0.60 },
  'google/gemini-2.5-pro':               { input:  1.25, output: 10.00 },
  'openai/gpt-4o':                       { input:  2.50, output: 10.00 },
  'openai/gpt-4o-mini':                  { input:  0.15, output:  0.60 },
};

const IMAGE_FLAT_COST = {
  'google/gemini-3.1-flash-image-preview': 0.04,
  'google/gemini-2.0-flash-exp:image':     0.04,
};

/** @param {string} model @param {{prompt_tokens?:number, completion_tokens?:number}} usage */
function _calcTextCost(model, usage) {
  const p = MODEL_PRICING[model] || { input: 0, output: 0 };
  return ((usage.prompt_tokens || 0) * p.input + (usage.completion_tokens || 0) * p.output) / 1_000_000;
}

/** @param {string} model @param {object} [rawResponse] */
function _calcImageCost(model, rawResponse) {
  const usage = rawResponse?.usage;
  if (usage?.prompt_tokens || usage?.completion_tokens) return _calcTextCost(model, usage);
  return IMAGE_FLAT_COST[model] ?? 0.04;
}

// ── LLM call logging ──────────────────────────────────────────────────────────

function _callId() { return Math.random().toString(36).slice(2, 9); }

function _logLLM(detail) {
  try { document.dispatchEvent(new CustomEvent('plm:llm-log', { detail })); } catch (_) {}
}

function _safeJson(obj) {
  return JSON.stringify(obj, (_k, v) => {
    if (typeof v === 'string' && v.startsWith('data:') && v.length > 200)
      return `${v.slice(0, 100)}...[${v.length} chars total]`;
    return v;
  }, 2);
}

// ── Text LLM ──────────────────────────────────────────────────────────────────

/**
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {string} userPrompt
 * @param {string} systemPrompt
 * @returns {Promise<string>}
 */
export async function _callTextLLM(state, userPrompt, systemPrompt) {
  const controller = new AbortController();
  state.addAbortController(controller);

  const id = _callId();
  const startTs = Date.now();
  const requestBody = {
    model:    state.textModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  };

  _logLLM({ id, type: 'text', phase: 'start', model: state.textModel, ts: startTs,
    systemPrompt, userPromptPreview: userPrompt.slice(0, 400), requestJson: _safeJson(requestBody) });

  try {
    const res = await fetch(OPENROUTER_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${state.apiKey}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  location.origin,
        'X-Title':       'PlaybookLM - tools.sgraph.ai',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      const err = new Error(`LLM error ${res.status}: ${errText}`);
      _logLLM({ id, type: 'text', phase: 'error', model: state.textModel, ts: Date.now(), error: err.message });
      throw err;
    }

    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      const err = new Error('Empty response from LLM');
      _logLLM({ id, type: 'text', phase: 'error', model: state.textModel, ts: Date.now(),
        error: err.message, responseJson: _safeJson(data) });
      throw err;
    }

    const cost = data.usage ? _calcTextCost(state.textModel, data.usage) : 0;
    if (data.usage) state.recordCost(cost);

    _logLLM({ id, type: 'text', phase: 'done', model: state.textModel, ts: Date.now(),
      latencyMs: Date.now() - startTs, usage: data.usage, cost, generationId: data.id,
      rawResponse: data, responsePreview: content.slice(0, 500) });

    return content;
  } finally {
    state.removeAbortController(controller);
  }
}

// ── Image LLM ─────────────────────────────────────────────────────────────────

/**
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<{imageSrc: string, cost: number, latencyMs: number}>}
 */
export function _callImageLLM(state, systemPrompt, userPrompt) {
  const { apiKey, imageModel } = state;
  const id = _callId();
  const startTs = Date.now();

  _logLLM({ id, type: 'image', phase: 'start', model: imageModel, ts: startTs,
    systemPrompt, userPromptPreview: userPrompt.slice(0, 400) });

  return new Promise((resolve, reject) => {
    const miniBus = document.createElement('div');
    miniBus.setAttribute('data-llm-bus', '');
    document.body.appendChild(miniBus);
    miniBus.appendChild(document.createElement('sg-llm-request'));

    miniBus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
      detail: { provider: 'openrouter', model: imageModel, apiKey, baseUrl: '' },
    }));

    const cleanup = () => { setTimeout(() => miniBus.remove(), 0); };

    miniBus.addEventListener(SGL_LLM.REQUEST_COMPLETE, ev => {
      cleanup();
      const latencyMs = Date.now() - startTs;
      _logLLM({ id, type: 'image', phase: 'response-raw', model: imageModel, ts: Date.now(),
        latencyMs, generationId: ev.detail?.rawResponse?.id, rawDetail: ev.detail,
        detailJson: _safeJson(ev.detail) });

      const src  = _extractImageSrc(ev.detail);
      const cost = _calcImageCost(imageModel, ev.detail?.rawResponse);

      if (src) {
        state.recordCost(cost);
        _logLLM({ id, type: 'image', phase: 'done', model: imageModel, ts: Date.now(),
          cost, latencyMs, hasImage: true });
        resolve({ imageSrc: src, cost, latencyMs });
      } else {
        _logLLM({ id, type: 'image', phase: 'error', model: imageModel, ts: Date.now(),
          error: 'No image src extracted' });
        reject(new Error('No image returned from LLM'));
      }
    }, { once: true });

    miniBus.addEventListener(SGL_LLM.REQUEST_ERROR, ev => {
      cleanup();
      const errMsg = ev.detail?.error || 'Image generation failed';
      _logLLM({ id, type: 'image', phase: 'error', model: imageModel, ts: Date.now(),
        error: errMsg, detailJson: _safeJson(ev.detail) });
      reject(new Error(errMsg));
    }, { once: true });

    miniBus.addEventListener(SGL_LLM.REQUEST_CANCEL, () => {
      cleanup();
      _logLLM({ id, type: 'image', phase: 'error', model: imageModel, ts: Date.now(), error: 'Cancelled' });
      reject(new Error('Image generation cancelled'));
    }, { once: true });

    miniBus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
      detail: { messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ], model: imageModel },
      bubbles: false,
    }));
  });
}

/**
 * @param {object} detail
 * @returns {string|null}
 */
export function _extractImageSrc(detail) {
  if (detail?.images?.length) {
    for (const img of detail.images) {
      if (img?.image_url?.url) return img.image_url.url;
      if (img?.url)            return img.url;
    }
  }
  const rawContent = detail?.rawResponse?.choices?.[0]?.message?.content;
  if (rawContent) {
    if (typeof rawContent === 'string' && rawContent.startsWith('data:')) return rawContent;
    if (Array.isArray(rawContent)) {
      for (const c of rawContent) {
        if (c?.type === 'image_url' && c.image_url?.url) return c.image_url.url;
        if (c?.inline_data?.data) return `data:${c.inline_data.mime_type};base64,${c.inline_data.data}`;
      }
    }
  }
  const streamContent = detail?.content;
  if (streamContent) {
    if (typeof streamContent === 'string' && streamContent.startsWith('data:')) return streamContent;
    if (Array.isArray(streamContent)) {
      for (const c of streamContent) {
        if (c?.type === 'image_url' && c.image_url?.url) return c.image_url.url;
      }
    }
  }
  return null;
}

// ── Step 2: Generate Presentation ─────────────────────────────────────────────

/**
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{model?: string}} [params]
 * @returns {Promise<string>}
 */
export async function generatePresentation(state, params = {}) {
  if (params.model) state.textModel = params.model;

  const sources = state.getSources();
  if (!sources.length) throw new Error('No sources loaded — call loadSources() first');

  const sourceText = sources.map((s, i) =>
    `--- Source ${i + 1}: ${s.name} ---\n${s.textContent}`
  ).join('\n\n');

  const systemPrompt = `You are a presentation strategist. Analyse the provided sources and create a concise presentation document that defines:
1. The core theme and key message
2. The target audience and tone
3. The main narrative arc (3–5 key points)
4. Recommended visual style and branding
5. Any data, statistics, or quotes to highlight

Output clear, structured prose (not bullet points). This document will be used to generate slide briefs.`;

  const result = await _callTextLLM(state, `Create a presentation document from these sources:\n\n${sourceText}`, systemPrompt);
  state.setPresentation(result);

  // Background vault save
  if (state.vaultConnected && state.vaultDeckId) {
    _bgSave(async () => {
      await vaultOps.saveSources(state.vault, state.vaultDeckId, state, {});
      await vaultOps.savePresentation(state.vault, state.vaultDeckId, state, {});
    }, state);
  } else {
    state.incrementPending();
  }

  return result;
}

// ── Step 3: Generate Slide Briefs ─────────────────────────────────────────────

/**
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{count?: number, model?: string}} [params]
 * @returns {Promise<Array<{title: string, prompt: string}>>}
 */
export async function generateSlideBriefs(state, params = {}) {
  const { count = 8 } = params;
  if (params.model) state.textModel = params.model;

  const presentation = state.getPresentation();
  if (!presentation) throw new Error('No presentation document — call generatePresentation() first');

  const systemPrompt = `You are a slide designer. Given a presentation document, generate a JSON array of slide briefs.
Each brief has:
  - "title": short slide title (3–6 words)
  - "prompt": detailed visual prompt for an image AI (2–4 sentences describing what to draw, layout, colours, icons, text to show)

Return ONLY a valid JSON array, no markdown fences, no extra text.
Example:
[
  { "title": "Market Overview", "prompt": "A dark-background infographic slide showing a world map with highlighted regions. Use teal (#4ECDC4) for key markets. Include a large headline 'Global Reach' at the top and three metric boxes at the bottom." }
]`;

  const raw    = await _callTextLLM(state, `Generate exactly ${count} slide briefs for this presentation:\n\n${presentation}`, systemPrompt);
  const briefs = _parseSlideJSON(raw);
  state.setSlideBriefs(briefs);

  // Background vault save
  if (state.vaultConnected && state.vaultDeckId) {
    _bgSave(() => vaultOps.saveSlideBriefs(state.vault, state.vaultDeckId, state, {}), state);
  } else {
    state.incrementPending();
  }

  return briefs;
}

function _parseSlideJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found in LLM response');
  return JSON.parse(match[0]);
}

// ── Step 4: Generate Slide ────────────────────────────────────────────────────

/**
 * Generate a single slide image, compress it into three variants, and
 * optionally save to vault.
 *
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{index: number, model?: string, customBrief?: string, customSystemPrompt?: string}} params
 * @returns {Promise<string>} imageSrc data URL
 */
export async function generateSlide(state, params) {
  const { index, customBrief, customSystemPrompt } = params;
  if (params.model) state.imageModel = params.model;

  const briefs = state.getSlideBriefs();
  if (!briefs[index]) throw new Error(`No brief at index ${index}`);

  const brief        = briefs[index];
  const briefPrompt  = customBrief || brief.prompt;
  const systemPrompt = customSystemPrompt || DEFAULT_INFOGRAPHIC_SYSTEM_PROMPT;

  state.setSlideResult(index, { status: 'generating', imageSrc: null });

  try {
    const userPrompt = `Title: ${brief.title}\n\nVisual brief: ${briefPrompt}`;
    const { imageSrc, cost, latencyMs } = await _callImageLLM(state, systemPrompt, userPrompt);

    // Compress into 3 variants (PNG kept for display, dist+li JPEGs for storage)
    let distBlob = null;
    let liBlob   = null;
    let sizes    = null;
    try {
      const opt = await optimizeSlide(imageSrc);
      distBlob  = opt.dist;
      liBlob    = opt.li;
      sizes     = opt.sizes;
    } catch (_) {
      // Compression failed — proceed without optimized variants
    }

    state.addSlideVersion(index, {
      imageSrc,
      distBlob,
      liBlob,
      sizes,
      title:        brief.title,
      briefPrompt,
      systemPrompt,
      model:        state.imageModel,
      cost,
      ts:           Date.now(),
      latencyMs,
    });

    document.dispatchEvent(new CustomEvent('plm:slide-complete', {
      detail: { index, imageSrc },
      bubbles: true,
    }));

    // Background vault save
    if (state.vaultConnected && state.vaultDeckId) {
      _bgSave(() => vaultOps.saveSlide(state.vault, state.vaultDeckId, state, index, {}), state);
    } else {
      state.incrementPending();
    }

    return imageSrc;
  } catch (err) {
    state.setSlideResult(index, { status: 'error', error: err.message, imageSrc: null });
    document.dispatchEvent(new CustomEvent('plm:slide-error', {
      detail: { index, error: err.message },
      bubbles: true,
    }));
    throw err;
  }
}

// ── Step 4b: Generate All Slides ──────────────────────────────────────────────

/**
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{model?: string, concurrency?: number}} [params]
 * @returns {Promise<void>}
 */
export async function generateAllSlides(state, params = {}) {
  const { concurrency = 1 } = params;
  if (params.model) state.imageModel = params.model;

  const briefs  = state.getSlideBriefs();
  const indices = briefs.map((_, i) => i);

  for (let i = 0; i < indices.length; i += concurrency) {
    const batch = indices.slice(i, i + concurrency);
    await Promise.all(batch.map(idx =>
      generateSlide(state, { index: idx }).catch(() => {})
    ));
    if (state.stopped) break;
  }

  document.dispatchEvent(new CustomEvent('plm:all-slides-complete', {
    detail: { count: briefs.length },
    bubbles: true,
  }));
}

// ── Step 5: Export ────────────────────────────────────────────────────────────

/**
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{format: 'pdf'|'zip'|'archive'}} params
 * @returns {Promise<void>}
 */
export async function exportDeck(state, params) {
  const { format = 'pdf' } = params;
  const results = state.getSlideResults().filter(r => r.status === 'complete' && r.imageSrc);
  const briefs  = state.getSlideBriefs();

  if (!results.length) throw new Error('No completed slides to export');

  if (format === 'pdf') {
    await _exportPDF(state, results, briefs);
  } else if (format === 'archive') {
    await _exportArchive(state, results, briefs);
  } else {
    await _exportZIP(results, briefs);
  }

  document.dispatchEvent(new CustomEvent('plm:export-complete', {
    detail: { format },
    bubbles: true,
  }));
}

/**
 * Export PDF using dist JPEG blobs when available (87% smaller than PNG).
 * Falls back to PNG data URL if distBlob not present.
 */
async function _exportPDF(state, results, briefs) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });

  for (let i = 0; i < results.length; i++) {
    if (i > 0) doc.addPage();
    const r       = results[i];
    const selIdx  = state.getSelectedVersion(r.index);
    const ver     = selIdx >= 0 ? state.getSlideVersions(r.index)[selIdx] : null;
    const distBlob = ver?.distBlob;

    if (distBlob) {
      const dataUrl = await _blobToDataUrl(distBlob);
      doc.addImage(dataUrl, 'JPEG', 0, 0, 1280, 720);
    } else {
      doc.addImage(r.imageSrc, 'PNG', 0, 0, 1280, 720);
    }
  }

  doc.save('playbooklm-deck.pdf');
}

async function _exportZIP(results, briefs) {
  const zip    = new JSZip();
  const folder = zip.folder('slides');

  for (let i = 0; i < results.length; i++) {
    const r      = results[i];
    const b      = briefs[i];
    const base64 = r.imageSrc.split(',')[1];
    const title  = (b?.title || `slide-${i + 1}`).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    folder.file(`${String(i + 1).padStart(2, '0')}-${title}.png`, base64, { base64: true });
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  _triggerDownload(blob, 'playbooklm-deck.zip');
}

/**
 * Build the full session archive ZIP.
 *
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {Array} results
 * @param {Array} briefs
 * @returns {Promise<Blob>}
 */
export async function buildArchiveBlob(state, results, briefs) {
  const zip        = new JSZip();
  const slideDir   = zip.folder('slides');
  const promptsDir = zip.folder('prompts');
  const versDir    = zip.folder('slide-versions');

  // Selected slide images
  for (let i = 0; i < results.length; i++) {
    const r     = results[i];
    const b     = briefs[i];
    const base64 = r.imageSrc.split(',')[1];
    const slug  = (b?.title || `slide-${i + 1}`).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    slideDir.file(`${String(i + 1).padStart(2, '0')}-${slug}.png`, base64, { base64: true });
  }

  // All versions per slide (PNG + dist JPEG + li JPEG)
  for (let i = 0; i < briefs.length; i++) {
    const versions = state.getSlideVersions(i);
    const slug     = (briefs[i]?.title || `slide-${i + 1}`).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const prefix   = `slide-${String(i + 1).padStart(2, '0')}-${slug}`;

    for (let v = 0; v < versions.length; v++) {
      const ver = versions[v];
      const vn  = `v${v + 1}`;

      // PNG archive
      const base64 = ver.imageSrc.split(',')[1];
      versDir.file(`${prefix}-${vn}.png`, base64, { base64: true });

      // dist JPEG
      if (ver.distBlob) {
        versDir.file(`${prefix}-${vn}-dist.jpg`, ver.distBlob);
      }

      // li JPEG
      if (ver.liBlob) {
        versDir.file(`${prefix}-${vn}-li.jpg`, ver.liBlob);
      }
    }
  }

  // Presentation strategy
  const presDoc = state.getPresentation();
  if (presDoc) zip.file('presentation-strategy.md', presDoc);

  // Slide briefs
  const briefLines = briefs.map((b, i) =>
    `## Slide ${i + 1}: ${b.title}\n\n${b.prompt}`
  ).join('\n\n---\n\n');
  zip.file('slide-briefs.md', `# Slide Briefs\n\n${briefLines}`);

  // Per-slide prompt history
  for (let i = 0; i < briefs.length; i++) {
    const versions = state.getSlideVersions(i);
    if (!versions.length) continue;
    const slug  = (briefs[i]?.title || `slide-${i + 1}`).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const lines = [`# Slide ${i + 1}: ${briefs[i].title}\n`];
    for (let v = 0; v < versions.length; v++) {
      const ver = versions[v];
      lines.push(`## Version ${v + 1}`);
      lines.push(`- Model: ${ver.model}`);
      lines.push(`- Cost: $${(ver.cost || 0).toFixed(6)}`);
      lines.push(`- Latency: ${ver.latencyMs}ms`);
      lines.push(`- Generated: ${new Date(ver.ts).toISOString()}`);
      if (ver.sizes) {
        lines.push(`- Sizes: PNG ${_fmtBytes(ver.sizes.png)}, dist JPEG ${_fmtBytes(ver.sizes.dist)}, li JPEG ${_fmtBytes(ver.sizes.li)}`);
      }
      lines.push(`\n### Visual Brief\n\n${ver.briefPrompt}`);
      lines.push(`\n### System Prompt\n\n${ver.systemPrompt}\n`);
    }
    promptsDir.file(`slide-${String(i + 1).padStart(2, '0')}-${slug}-prompts.md`, lines.join('\n'));
  }

  // Cost summary
  const fullState = state.getFullState();
  const costLines = [
    '# Cost Summary\n',
    `- Session cost: $${state.sessionCost.toFixed(6)}`,
    `- Deck total cost: $${state.deckCost.toFixed(6)}`,
    `- Text model: ${fullState.textModel}`,
    `- Image model: ${fullState.imageModel}`,
    `\n## Per-Slide Version Costs\n`,
  ];
  for (const [idx, info] of Object.entries(fullState.slideVersions)) {
    costLines.push(`### Slide ${Number(idx) + 1}`);
    for (const v of info.versions) {
      const sizeNote = v.sizes ? ` | dist ${_fmtBytes(v.sizes.dist)}` : '';
      costLines.push(`  - v${v.v}: ${v.model} — $${(v.cost || 0).toFixed(6)} — ${v.latencyMs}ms${sizeNote}`);
    }
  }
  zip.file('cost-summary.md', costLines.join('\n'));

  // Sources
  const sourcesDir = zip.folder('sources');
  for (const src of state.getSources()) {
    sourcesDir.file(src.name, src.textContent);
  }

  // PDF (uses dist JPEG blobs — much smaller than PNG)
  if (results.length && window.jspdf?.jsPDF) {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });

      for (let i = 0; i < results.length; i++) {
        if (i > 0) doc.addPage();
        const r      = results[i];
        const selIdx = state.getSelectedVersion(r.index);
        const ver    = selIdx >= 0 ? state.getSlideVersions(r.index)[selIdx] : null;

        if (ver?.distBlob) {
          const dataUrl = await _blobToDataUrl(ver.distBlob);
          doc.addImage(dataUrl, 'JPEG', 0, 0, 1280, 720);
        } else {
          doc.addImage(r.imageSrc, 'PNG', 0, 0, 1280, 720);
        }
      }
      zip.file('playbooklm-deck.pdf', doc.output('arraybuffer'));
    } catch (_) { /* jsPDF unavailable — skip */ }
  }

  return zip.generateAsync({ type: 'blob' });
}

async function _exportArchive(state, results, briefs) {
  const blob = await buildArchiveBlob(state, results, briefs);
  _triggerDownload(blob, 'playbooklm-session-archive.zip');
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Convert a Blob to a base64 data URL.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function _blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader  = new FileReader();
    reader.onload = () => resolve(/** @type {string} */ (reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Format bytes as human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function _fmtBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Trigger a browser download for a Blob.
 *
 * @param {Blob} blob
 * @param {string} filename
 * @returns {void}
 */
export function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Fire-and-forget vault save. On failure, increments pending changes.
 *
 * @param {() => Promise<void>} saveFn
 * @param {import('./pipeline-state.js').PipelineState} state
 * @returns {void}
 */
function _bgSave(saveFn, state) {
  saveFn().catch(() => state.incrementPending());
}
