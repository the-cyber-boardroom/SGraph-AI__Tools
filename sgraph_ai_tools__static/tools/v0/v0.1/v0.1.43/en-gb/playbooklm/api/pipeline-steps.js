/**
 * PlaybookLM — pipeline step execution.
 *
 * v0.1.43 changes:
 *  - _extractImageSrc: fixed to check images[0].image_url.url (OpenRouter/sg-llm-request
 *    format) not the non-existent images[0].url.  Also handles streaming accImages[].
 *  - _logLLM: dispatches 'plm:llm-log' events on document for the dev panel LLM Log tab.
 *    Logs system prompt, user prompt preview, usage, cost, and full response detail.
 *
 * @module pipeline-steps
 * @version 0.1.2
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
  'anthropic/claude-haiku-4-5-20251001': { input:  0.80, output:  4.00 },
  'google/gemini-2.5-flash':             { input:  0.15, output:  0.60 },
  'google/gemini-2.5-pro':              { input:  1.25, output: 10.00 },
  'openai/gpt-4o':                      { input:  2.50, output: 10.00 },
  'openai/gpt-4o-mini':                 { input:  0.15, output:  0.60 },
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
 * The dev panel LLM Log tab listens for these to show full request/response.
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
 * Logs full request/response to the dev panel LLM Log tab.
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
    ts:                Date.now(),
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
      usage:           data.usage,
      cost,
      responsePreview: content.slice(0, 500),
    });

    return content;
  } finally {
    state.removeAbortController(controller);
  }
}

/**
 * Call an image LLM via the mini-bus pattern using sg-llm-request.
 * Logs full request/response detail to the dev panel LLM Log tab.
 *
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
export function _callImageLLM(state, systemPrompt, userPrompt) {
  const { apiKey, imageModel } = state;
  const id = _callId();

  _logLLM({
    id,
    type:              'image',
    phase:             'start',
    model:             imageModel,
    ts:                Date.now(),
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

      // Log full detail so the LLM Log tab shows exactly what came back
      _logLLM({
        id,
        type:        'image',
        phase:       'response-raw',
        model:       imageModel,
        ts:          Date.now(),
        detailJson:  _safeJson(ev.detail),
      });

      const src = _extractImageSrc(ev.detail);
      const cost = _calcImageCost(imageModel, ev.detail?.rawResponse);

      if (src) {
        state.recordCost(cost);
        _logLLM({ id, type: 'image', phase: 'done', model: imageModel, ts: Date.now(), cost, hasImage: true });
        resolve(src);
      } else {
        _logLLM({ id, type: 'image', phase: 'error', model: imageModel, ts: Date.now(), error: 'No image src extracted — check response-raw entry above' });
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
 * Handles formats produced by sg-llm-request v0.1.4:
 *  - images[]: OpenRouter non-streaming → [{type:'image_url', image_url:{url:'...'}}]
 *  - rawResponse.choices[0].message.content: string or array
 *  - content[]: streaming accumulation (same shape as images[])
 *
 * @param {object} detail - Event detail from REQUEST_COMPLETE
 * @returns {string|null}
 */
export function _extractImageSrc(detail) {
  // Format A: sg-llm-request images[] array (non-streaming OpenRouter path)
  // Shape: [{type:'image_url', image_url:{url:'data:...'}}]
  if (detail?.images?.length) {
    for (const img of detail.images) {
      if (img?.image_url?.url) return img.image_url.url;
      if (img?.url)            return img.url;          // fallback: direct url
    }
  }

  // Format B: rawResponse (non-streaming path has rawResponse set)
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

  // Format C: content field (streaming path, content is accumulated text/array)
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
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{index: number, model?: string, template?: string}} params
 * @returns {Promise<{index: number, imageSrc: string}>}
 */
export async function generateSlide(state, params = {}) {
  const { index } = params;
  if (typeof index !== 'number') throw new Error('generateSlide: index is required');
  if (params.model) state.imageModel = params.model;

  const briefs = state.getSlideBriefs();
  if (index < 0 || index >= briefs.length) {
    throw new Error(`generateSlide: index ${index} out of range (${briefs.length} briefs)`);
  }

  const brief        = briefs[index];
  const presentation = state.getPresentation();
  const total        = briefs.length;

  state.setSlideResult(index, { status: 'generating', error: null });

  const brandingAddition = params.template ? `\nTemplate style: ${params.template}` : '';
  const systemPrompt = DEFAULT_INFOGRAPHIC_SYSTEM_PROMPT + brandingAddition;

  const positioning = presentation
    ? `Presentation context:\n${presentation}\n\nThis is slide ${index + 1} of ${total}.\n\n`
    : `Slide ${index + 1} of ${total}.\n\n`;

  const userPrompt = `${positioning}SLIDE CONTENT:\n${brief.prompt}\n\nSlide title: "${brief.title}"`;

  try {
    if (state.stopped) throw new Error('Pipeline stopped');
    const imageSrc = await _callImageLLM(state, systemPrompt, userPrompt);
    state.setSlideResult(index, { status: 'complete', imageSrc, error: null });
    return { index, imageSrc };
  } catch (err) {
    state.setSlideResult(index, { status: 'error', error: err.message });
    throw err;
  }
}

/**
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{model?: string, parallel?: boolean}} [params]
 * @returns {Promise<Array<{index: number, imageSrc: string}>>}
 */
export async function generateAllSlides(state, params = {}) {
  const { parallel = false } = params;
  if (params.model) state.imageModel = params.model;

  const briefs = state.getSlideBriefs();
  if (!briefs.length) throw new Error('No slide briefs — call generateSlideBriefs() first');

  const indices = briefs.map((_, i) => i);
  if (parallel) return Promise.all(indices.map(i => generateSlide(state, { index: i })));

  const results = [];
  for (const i of indices) {
    if (state.stopped) break;
    results.push(await generateSlide(state, { index: i }));
  }
  return results;
}

// ── Step 5: Export Deck ───────────────────────────────────────────────────────

/**
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{format?: 'pdf'|'zip'}} [params]
 * @returns {Promise<void>}
 */
export async function exportDeck(state, params = {}) {
  const { format = 'pdf' } = params;
  const results = state.getSlideResults().filter(r => r.status === 'complete' && r.imageSrc);
  if (!results.length) throw new Error('No completed slides to export');
  if (format === 'pdf')       await _exportPdf(results);
  else if (format === 'zip')  await _exportZip(results);
  else                        throw new Error(`Unknown export format: ${format}`);
}

async function _exportPdf(results) {
  if (!window.jspdf?.jsPDF) throw new Error('jsPDF not loaded');
  const { jsPDF } = window.jspdf;
  const sorted = [...results].sort((a, b) => a.index - b.index);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) pdf.addPage();
    pdf.addImage(await _imgToDataUrl(sorted[i].imageSrc), 'PNG', 0, 0, 297, 210, '', 'FAST');
  }
  pdf.save('playbooklm-deck.pdf');
}

async function _exportZip(results) {
  if (!window.JSZip) throw new Error('JSZip not loaded');
  const zip = new window.JSZip();
  for (const r of [...results].sort((a, b) => a.index - b.index)) {
    const dataUrl = await _imgToDataUrl(r.imageSrc);
    zip.file(`slide-${String(r.index + 1).padStart(2, '0')}.png`, dataUrl.split(',')[1], { base64: true });
  }
  _triggerDownload(await zip.generateAsync({ type: 'blob' }), 'playbooklm-slides.zip');
}

export async function _imgToDataUrl(src) {
  if (src.startsWith('data:')) return src;
  const blob = await fetch(src).then(r => r.blob());
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = () => resolve(/** @type {string} */ (fr.result));
    fr.readAsDataURL(blob);
  });
}

function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
