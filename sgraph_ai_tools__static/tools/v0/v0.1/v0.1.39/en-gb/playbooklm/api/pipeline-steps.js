/**
 * PlaybookLM — pipeline step execution.
 *
 * All LLM call logic for Steps 2–5. Text LLM calls go direct to OpenRouter
 * via fetch(). Image LLM calls use the mini-bus pattern with sg-llm-request.
 *
 * @module pipeline-steps
 * @version 0.1.0
 */

import { SGL_LLM } from '/components/llm/sg-llm-events/v0/v0.1/v0.1.1/sg-llm-events.js';

export const DEFAULT_TEXT_MODEL  = 'google/gemini-2.5-flash-preview';
export const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

const DEFAULT_INFOGRAPHIC_SYSTEM_PROMPT = `You are an expert visual communicator and presentation designer.
Create visually striking, clear, and professional slide images.
Use a dark background (#0a0a1a) with teal accents (#4ECDC4), white headlines, and clear hierarchy.
Each slide should have a strong visual composition with one key idea per slide.`;

// ── Text LLM (direct fetch) ───────────────────────────────────────────────────

/**
 * Call a text LLM via OpenRouter using direct fetch.
 * Registers an AbortController on the state so stop() can cancel it.
 *
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {string} userPrompt
 * @param {string} systemPrompt
 * @returns {Promise<string>} The text response content
 */
export async function _callTextLLM(state, userPrompt, systemPrompt) {
  const controller = new AbortController();
  state.addAbortController(controller);

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
      body: JSON.stringify({
        model: state.textModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`LLM error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from LLM');
    return content;
  } finally {
    state.removeAbortController(controller);
  }
}

/**
 * Call an image LLM via the mini-bus pattern using sg-llm-request.
 * The mini-bus element is appended to document.body and removed after completion.
 *
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>} The image src (data URL or URL)
 */
export function _callImageLLM(state, systemPrompt, userPrompt) {
  const { apiKey, imageModel } = state;

  return new Promise((resolve, reject) => {
    const miniBus = document.createElement('div');
    miniBus.setAttribute('data-llm-bus', '');
    document.body.appendChild(miniBus);
    miniBus.appendChild(document.createElement('sg-llm-request'));

    // CONNECTED must fire BEFORE SEND
    miniBus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
      detail: { provider: 'openrouter', model: imageModel, apiKey, baseUrl: '' },
    }));

    const cleanup = () => { setTimeout(() => miniBus.remove(), 0); };

    miniBus.addEventListener(SGL_LLM.REQUEST_COMPLETE, ev => {
      cleanup();
      const src = _extractImageSrc(ev.detail);
      if (src) {
        resolve(src);
      } else {
        reject(new Error('No image returned from LLM'));
      }
    }, { once: true });

    miniBus.addEventListener(SGL_LLM.REQUEST_ERROR, ev => {
      cleanup();
      reject(new Error(ev.detail?.error || 'Image generation failed'));
    }, { once: true });

    miniBus.addEventListener(SGL_LLM.REQUEST_CANCEL, () => {
      cleanup();
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
 * @param {object} detail - Event detail from REQUEST_COMPLETE
 * @returns {string|null}
 */
export function _extractImageSrc(detail) {
  if (detail?.images?.[0]?.url) return detail.images[0].url;
  const content = detail?.rawResponse?.choices?.[0]?.message?.content;
  if (!content) return null;
  if (typeof content === 'string' && content.startsWith('data:')) return content;
  if (Array.isArray(content)) {
    const img = content.find(c => c.type === 'image_url');
    return img?.image_url?.url ?? null;
  }
  return null;
}

// ── Step 2: Generate Presentation ─────────────────────────────────────────────

/**
 * Step 2: Generate a presentation document from loaded sources.
 * Updates state.presentationDoc with the result.
 *
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{model?: string}} [params]
 * @returns {Promise<string>} The generated presentation document text
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
 * Step 3: Generate slide briefs from the presentation document.
 * Updates state.slideBriefs with the result.
 *
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

/**
 * Parse a JSON array from an LLM response, stripping markdown fences.
 *
 * @param {string} text - Raw LLM response
 * @returns {Array<{title: string, prompt: string}>}
 */
function _parseSlideJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found in LLM response');
  return JSON.parse(match[0]);
}

// ── Step 4: Generate Slide ────────────────────────────────────────────────────

/**
 * Step 4: Generate a single slide image using the image LLM.
 * Updates the slide result in state.
 *
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

  const brief       = briefs[index];
  const presentation = state.getPresentation();
  const total        = briefs.length;

  state.setSlideResult(index, { status: 'generating', error: null });

  // Three-layer prompt
  const brandingAddition = params.template
    ? `\nTemplate style: ${params.template}`
    : '';

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
 * Step 4 (batch): Generate all slides, optionally in parallel.
 *
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

  if (parallel) {
    return Promise.all(indices.map(i => generateSlide(state, { index: i })));
  }

  const results = [];
  for (const i of indices) {
    if (state.stopped) break;
    results.push(await generateSlide(state, { index: i }));
  }
  return results;
}

// ── Step 5: Export Deck ───────────────────────────────────────────────────────

/**
 * Step 5: Export the generated slides as a PDF or ZIP.
 * Requires jsPDF (for PDF) or JSZip (for ZIP) to be loaded as global scripts.
 *
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{format?: 'pdf'|'zip'}} [params]
 * @returns {Promise<void>}
 */
export async function exportDeck(state, params = {}) {
  const { format = 'pdf' } = params;
  const results = state.getSlideResults().filter(r => r.status === 'complete' && r.imageSrc);

  if (!results.length) throw new Error('No completed slides to export');

  if (format === 'pdf') {
    await _exportPdf(results);
  } else if (format === 'zip') {
    await _exportZip(results);
  } else {
    throw new Error(`Unknown export format: ${format}`);
  }
}

/**
 * Export slides as a PDF using jsPDF (must be loaded as global script).
 *
 * @param {Array<{index: number, imageSrc: string}>} results
 * @returns {Promise<void>}
 */
async function _exportPdf(results) {
  if (!window.jspdf?.jsPDF) throw new Error('jsPDF not loaded — check manifest.json loader entries');
  const { jsPDF } = window.jspdf;

  // Sort by index
  const sorted = [...results].sort((a, b) => a.index - b.index);

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210; // A4 landscape mm

  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) pdf.addPage();
    const dataUrl = await _imgToDataUrl(sorted[i].imageSrc);
    pdf.addImage(dataUrl, 'PNG', 0, 0, W, H, '', 'FAST');
  }

  pdf.save('playbooklm-deck.pdf');
}

/**
 * Export slides as a ZIP of PNG images using JSZip (must be loaded as global script).
 *
 * @param {Array<{index: number, imageSrc: string}>} results
 * @returns {Promise<void>}
 */
async function _exportZip(results) {
  if (!window.JSZip) throw new Error('JSZip not loaded — check manifest.json loader entries');
  const zip = new window.JSZip();

  const sorted = [...results].sort((a, b) => a.index - b.index);
  for (const r of sorted) {
    const dataUrl = await _imgToDataUrl(r.imageSrc);
    const base64  = dataUrl.split(',')[1];
    zip.file(`slide-${String(r.index + 1).padStart(2, '0')}.png`, base64, { base64: true });
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  _triggerDownload(blob, 'playbooklm-slides.zip');
}

/**
 * Convert an image src (URL or data URL) to a data URL.
 *
 * @param {string} src - Image URL or data URL
 * @returns {Promise<string>} Data URL
 */
export async function _imgToDataUrl(src) {
  if (src.startsWith('data:')) return src;
  const res  = await fetch(src);
  const blob = await res.blob();
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = () => resolve(/** @type {string} */ (fr.result));
    fr.readAsDataURL(blob);
  });
}

/**
 * Trigger a browser file download.
 *
 * @param {Blob} blob
 * @param {string} filename
 * @returns {void}
 */
function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
