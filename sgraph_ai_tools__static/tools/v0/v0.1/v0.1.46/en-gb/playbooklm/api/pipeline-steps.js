/**
 * PlaybookLM — pipeline step execution.
 *
 * v0.1.5 changes:
 *  - buildArchiveBlob: adds slide deck PDF (playbooklm-deck.pdf) to the archive ZIP.
 *    Uses window.jspdf.jsPDF (already loaded by manifest phase 1). If jsPDF is not
 *    available the PDF is silently omitted — other archive contents are unaffected.
 *
 * v0.1.4 changes:
 *  - _callImageLLM: now returns {imageSrc, cost, latencyMs} instead of just imageSrc.
 *    Cost is still recorded to state internally. Latency is measured from promise creation.
 *  - generateSlide: accepts optional `customBrief` param to override brief.prompt for
 *    iterative editing. Calls state.addSlideVersion() with full SlideVersion data after
 *    each successful generation. setSlideResult() no longer called on success (addSlideVersion
 *    handles _slideResults sync). Error path still uses setSlideResult for backward compat.
 *
 * @module pipeline-steps
 * @version 0.1.5
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';

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
  'anthropic/claude-haiku-4-5-20251001': { input:  0.80, output:  4.00 }, // legacy alias
  'google/gemini-2.5-flash':             { input:  0.15, output:  0.60 },
  'google/gemini-2.5-pro':               { input:  1.25, output: 10.00 },
  'openai/gpt-4o':                       { input:  2.50, output: 10.00 },
  'openai/gpt-4o-mini':                  { input:  0.15, output:  0.60 },
};

const IMAGE_FLAT_COST = {
  'google/gemini-3.1-flash-image-preview': 0.04,
  'google/gemini-2.0-flash-exp:image':     0.04,
};

/**
 * @param {string} model
 * @param {{prompt_tokens?: number, completion_tokens?: number}} usage
 * @returns {number}
 */
function _calcTextCost(model, usage) {
  const p = MODEL_PRICING[model] || { input: 0, output: 0 };
  return ((usage.prompt_tokens || 0) * p.input + (usage.completion_tokens || 0) * p.output) / 1_000_000;
}

/**
 * @param {string} model
 * @param {object} [rawResponse]
 * @returns {number}
 */
function _calcImageCost(model, rawResponse) {
  const usage = rawResponse?.usage;
  if (usage?.prompt_tokens || usage?.completion_tokens) return _calcTextCost(model, usage);
  return IMAGE_FLAT_COST[model] ?? 0.04;
}

// ── LLM call logging ──────────────────────────────────────────────────────────

/**
 * Generate a short random ID for correlating start/end log entries.
 *
 * @returns {string}
 */
function _callId() {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Dispatch a plm:llm-log event on document.
 *
 * @param {object} detail
 * @returns {void}
 */
function _logLLM(detail) {
  try {
    document.dispatchEvent(new CustomEvent('plm:llm-log', { detail }));
  } catch (_) {}
}

/**
 * Safely serialise an object to JSON, truncating base64 data URIs.
 *
 * @param {unknown} obj
 * @returns {string}
 */
function _safeJson(obj) {
  return JSON.stringify(obj, (_k, v) => {
    if (typeof v === 'string' && v.startsWith('data:') && v.length > 200) {
      return `${v.slice(0, 100)}...[${v.length} chars total]`;
    }
    return v;
  }, 2);
}

// ── Text LLM (direct fetch) ───────────────────────────────────────────────────

/**
 * Call a text LLM via OpenRouter using direct fetch.
 *
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
    model: state.textModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  };

  _logLLM({
    id,
    type:              'text',
    phase:             'start',
    model:             state.textModel,
    ts:                startTs,
    systemPrompt,
    userPromptPreview: userPrompt.slice(0, 400),
    requestJson:       _safeJson(requestBody),
  });

  try {
    const res = await fetch(OPENROUTER_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${state.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': location.origin,
        'X-Title': 'PlaybookLM - tools.sgraph.ai',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      const err = new Error(`LLM error ${res.status}: ${errText}`);
      _logLLM({ id, type: 'text', phase: 'error', model: state.textModel, ts: Date.now(), error: err.message });
      throw err;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      const err = new Error('Empty response from LLM');
      _logLLM({ id, type: 'text', phase: 'error', model: state.textModel, ts: Date.now(), error: err.message, responseJson: _safeJson(data) });
      throw err;
    }

    const cost = data.usage ? _calcTextCost(state.textModel, data.usage) : 0;
    if (data.usage) state.recordCost(cost);

    _logLLM({
      id,
      type:            'text',
      phase:           'done',
      model:           state.textModel,
      ts:              Date.now(),
      latencyMs:       Date.now() - startTs,
      usage:           data.usage,
      cost,
      generationId:    data.id,
      rawResponse:     data,
      responsePreview: content.slice(0, 500),
    });

    return content;
  } finally {
    state.removeAbortController(controller);
  }
}

/**
 * Call an image LLM via the mini-bus pattern using sg-llm-request.
 * Returns full result object including cost and latency.
 *
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<{imageSrc: string, cost: number, latencyMs: number}>}
 */
export function _callImageLLM(state, systemPrompt, userPrompt) {
  const { apiKey, imageModel } = state;
  const id = _callId();
  const startTs = Date.now();

  _logLLM({
    id,
    type:              'image',
    phase:             'start',
    model:             imageModel,
    ts:                startTs,
    systemPrompt,
    userPromptPreview: userPrompt.slice(0, 400),
  });

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

      _logLLM({
        id,
        type:          'image',
        phase:         'response-raw',
        model:         imageModel,
        ts:            Date.now(),
        latencyMs,
        generationId:  ev.detail?.rawResponse?.id,
        rawDetail:     ev.detail,
        detailJson:    _safeJson(ev.detail),
      });

      const src  = _extractImageSrc(ev.detail);
      const cost = _calcImageCost(imageModel, ev.detail?.rawResponse);

      if (src) {
        state.recordCost(cost);
        _logLLM({ id, type: 'image', phase: 'done', model: imageModel, ts: Date.now(), cost, latencyMs, hasImage: true });
        resolve({ imageSrc: src, cost, latencyMs });
      } else {
        _logLLM({ id, type: 'image', phase: 'error', model: imageModel, ts: Date.now(), error: 'No image src extracted' });
        reject(new Error('No image returned from LLM'));
      }
    }, { once: true });

    miniBus.addEventListener(SGL_LLM.REQUEST_ERROR, ev => {
      cleanup();
      const errMsg = ev.detail?.error || 'Image generation failed';
      _logLLM({ id, type: 'image', phase: 'error', model: imageModel, ts: Date.now(), error: errMsg, detailJson: _safeJson(ev.detail) });
      reject(new Error(errMsg));
    }, { once: true });

    miniBus.addEventListener(SGL_LLM.REQUEST_CANCEL, () => {
      cleanup();
      _logLLM({ id, type: 'image', phase: 'error', model: imageModel, ts: Date.now(), error: 'Cancelled' });
      reject(new Error('Image generation cancelled'));
    }, { once: true });

    miniBus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
      detail: {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        model: imageModel,
      },
      bubbles: false,
    }));
  });
}

/**
 * Extract image src from a REQUEST_COMPLETE event detail.
 *
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

  const userPrompt = `Create a presentation document from these sources:\n\n${sourceText}`;
  const result = await _callTextLLM(state, userPrompt, systemPrompt);
  state.setPresentation(result);
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

  const userPrompt = `Generate exactly ${count} slide briefs for this presentation:\n\n${presentation}`;
  const raw = await _callTextLLM(state, userPrompt, systemPrompt);
  const briefs = _parseSlideJSON(raw);
  state.setSlideBriefs(briefs);
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
 * Generate a single slide image.
 * Accepts an optional customBrief to override the stored brief.prompt for iterative editing.
 * Records the result as a new SlideVersion in state (with full metadata).
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

    // Record as a versioned snapshot — addSlideVersion syncs _slideResults
    state.addSlideVersion(index, {
      imageSrc,
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
    await _exportPDF(results, briefs);
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

async function _exportPDF(results, briefs) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });

  for (let i = 0; i < results.length; i++) {
    if (i > 0) doc.addPage();
    const r = results[i];
    doc.addImage(r.imageSrc, 'PNG', 0, 0, 1280, 720);
  }

  doc.save('playbooklm-deck.pdf');
}

async function _exportZIP(results, briefs) {
  const zip    = new JSZip();
  const folder = zip.folder('slides');

  for (let i = 0; i < results.length; i++) {
    const r     = results[i];
    const b     = briefs[i];
    const base64 = r.imageSrc.split(',')[1];
    const title  = (b?.title || `slide-${i + 1}`).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    folder.file(`${String(i + 1).padStart(2, '0')}-${title}.png`, base64, { base64: true });
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  _triggerDownload(blob, 'playbooklm-deck.zip');
}

/**
 * Build the full session archive ZIP with slides, prompts, briefs, costs, etc.
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

  // ── Slide images (selected versions) ────────────────────────────────────────
  for (let i = 0; i < results.length; i++) {
    const r      = results[i];
    const b      = briefs[i];
    const base64 = r.imageSrc.split(',')[1];
    const slug   = (b?.title || `slide-${i + 1}`).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    slideDir.file(`${String(i + 1).padStart(2, '0')}-${slug}.png`, base64, { base64: true });
  }

  // ── All versions per slide ───────────────────────────────────────────────────
  const versionsDir = zip.folder('slide-versions');
  for (let i = 0; i < briefs.length; i++) {
    const versions = state.getSlideVersions(i);
    for (let v = 0; v < versions.length; v++) {
      const ver  = versions[v];
      const slug = (briefs[i]?.title || `slide-${i + 1}`).replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const base64 = ver.imageSrc.split(',')[1];
      versionsDir.file(`slide-${String(i + 1).padStart(2,'0')}-v${v + 1}-${slug}.png`, base64, { base64: true });
    }
  }

  // ── Presentation strategy doc ────────────────────────────────────────────────
  const presDoc = state.getPresentation();
  if (presDoc) {
    zip.file('presentation-strategy.md', presDoc);
  }

  // ── Slide briefs ─────────────────────────────────────────────────────────────
  const briefLines = briefs.map((b, i) =>
    `## Slide ${i + 1}: ${b.title}\n\n${b.prompt}`
  ).join('\n\n---\n\n');
  zip.file('slide-briefs.md', `# Slide Briefs\n\n${briefLines}`);

  // ── Per-slide prompt detail ──────────────────────────────────────────────────
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
      lines.push(`\n### Visual Brief\n\n${ver.briefPrompt}`);
      lines.push(`\n### System Prompt\n\n${ver.systemPrompt}\n`);
    }
    promptsDir.file(`slide-${String(i + 1).padStart(2, '0')}-${slug}-prompts.md`, lines.join('\n'));
  }

  // ── Cost summary ─────────────────────────────────────────────────────────────
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
      costLines.push(`  - v${v.v}: ${v.model} — $${(v.cost || 0).toFixed(6)} — ${v.latencyMs}ms`);
    }
  }
  zip.file('cost-summary.md', costLines.join('\n'));

  // ── Sources ───────────────────────────────────────────────────────────────────
  const sourcesDir = zip.folder('sources');
  for (const src of state.getSources()) {
    sourcesDir.file(src.name, src.textContent);
  }

  // ── Slide deck PDF ────────────────────────────────────────────────────────────
  if (results.length && window.jspdf?.jsPDF) {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [1280, 720] });
      for (let i = 0; i < results.length; i++) {
        if (i > 0) doc.addPage();
        doc.addImage(results[i].imageSrc, 'PNG', 0, 0, 1280, 720);
      }
      zip.file('playbooklm-deck.pdf', doc.output('arraybuffer'));
    } catch (_) { /* jsPDF unavailable or image issue — skip PDF in archive */ }
  }

  return zip.generateAsync({ type: 'blob' });
}

async function _exportArchive(state, results, briefs) {
  const blob = await buildArchiveBlob(state, results, briefs);
  _triggerDownload(blob, 'playbooklm-session-archive.zip');
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
