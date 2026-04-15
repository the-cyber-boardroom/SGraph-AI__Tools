/**
 * PlaybookLM — Vault read/write operations.
 *
 * All vault I/O for PlaybookLM is isolated here. Nothing else in the tool
 * touches vault APIs directly. Uses vault-write's `writeVaultFile` for all
 * writes (handles full read-modify-write-commit cycle internally).
 *
 * Vault folder structure managed:
 *
 *   playbooklm/
 *   ├── deck-index.json              (list of known decks for this vault)
 *   └── decks/
 *       └── {deck-id}/
 *           ├── deck.json
 *           ├── presentation-strategy.md
 *           ├── slide-briefs.json
 *           ├── sources/
 *           │   └── {filename}
 *           └── slides/
 *               └── {nn}-{slug}/
 *                   ├── versions.json
 *                   ├── selected.txt
 *                   ├── v{n}.png         (if profile = 'full')
 *                   ├── v{n}-dist.jpg    (always)
 *                   └── v{n}-li.jpg      (always)
 *
 * @module vault-ops
 * @version 0.1.0
 */

import {
  readFileAsJson,
  readFile,
} from '/core/vault-client/v1/v1.2/v1.2.0/sg-vault-client.js';

import {
  writeVaultFile,
} from '/core/vault-write/v1/v1.1/v1.1.1/sg-vault-write.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generate a random 8-char hex deck ID.
 *
 * @returns {string}
 */
function _genDeckId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Slugify a string for use in vault paths.
 *
 * @param {string} str
 * @returns {string}
 */
function _slug(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'slide';
}

/**
 * Format a blob object URL, read its ArrayBuffer, then revoke.
 * Needed because writeVaultFile accepts content as ArrayBuffer or string.
 *
 * @param {Blob} blob
 * @returns {Promise<ArrayBuffer>}
 */
async function _blobToArrayBuffer(blob) {
  return blob.arrayBuffer();
}

/**
 * Build a slide folder key: `{nn}-{slug}`.
 *
 * @param {number} index
 * @param {string} title
 * @returns {string}
 */
function _slideFolder(index, title) {
  return `${String(index + 1).padStart(2, '0')}-${_slug(title)}`;
}

// ── Deck index helpers ────────────────────────────────────────────────────────

/**
 * Read the deck-index.json file. Returns empty array if not found.
 *
 * @param {object} vault
 * @returns {Promise<Array<{id: string, title: string, createdAt: string, updatedAt: string}>>}
 */
async function _readDeckIndex(vault) {
  try {
    return await readFileAsJson(vault, 'playbooklm/deck-index.json');
  } catch (_) {
    return [];
  }
}

/**
 * Update the deck-index.json with a new or updated entry.
 *
 * @param {object} vault
 * @param {{id: string, title: string, slideCount: number, sessionCost: number}} entry
 * @param {string} commitMsg
 * @returns {Promise<void>}
 */
async function _updateDeckIndex(vault, entry, commitMsg) {
  const index = await _readDeckIndex(vault);
  const idx   = index.findIndex(d => d.id === entry.id);
  const now   = new Date().toISOString();
  const updated = { ...entry, updatedAt: now };
  if (idx >= 0) {
    index[idx] = { ...index[idx], ...updated };
  } else {
    index.push({ ...updated, createdAt: now });
  }
  await writeVaultFile(vault, 'playbooklm/deck-index.json', JSON.stringify(index, null, 2), {
    message:     commitMsg,
    contentType: 'application/json',
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new deck folder in vault. Writes deck.json and updates deck-index.
 *
 * @param {object} vault - Vault handle {keys, apiBaseUrl, vaultId}
 * @param {{title: string, state: import('./pipeline-state.js').PipelineState}} opts
 * @returns {Promise<string>} deckId (8-char hex)
 */
export async function createDeck(vault, { title, state }) {
  const deckId  = _genDeckId();
  const now     = new Date().toISOString();
  const deck    = {
    schema:     'playbooklm-deck-v1',
    id:         deckId,
    title:      title || 'Untitled Deck',
    createdAt:  now,
    updatedAt:  now,
    textModel:  state.textModel,
    imageModel: state.imageModel,
    slideCount: 0,
    sessionCost: 0,
    deckCost:   0,
    vaultProfile: state.vaultProfile,
    selectedVersions: {},
  };

  const commitMsg = `PLM/${title || 'Deck'}/init: deck created`;

  await writeVaultFile(
    vault,
    `playbooklm/decks/${deckId}/deck.json`,
    JSON.stringify(deck, null, 2),
    { message: commitMsg, contentType: 'application/json' },
  );

  await _updateDeckIndex(vault, {
    id:         deckId,
    title:      deck.title,
    slideCount: 0,
    sessionCost: 0,
  }, commitMsg);

  return deckId;
}

/**
 * List all PlaybookLM decks in this vault.
 *
 * @param {object} vault - Vault handle
 * @returns {Promise<Array<{id: string, title: string, updatedAt: string, slideCount: number, cost: number}>>}
 */
export async function listDecks(vault) {
  const index = await _readDeckIndex(vault);
  return index.map(d => ({
    id:         d.id,
    title:      d.title || 'Untitled',
    updatedAt:  d.updatedAt || d.createdAt || '',
    slideCount: d.slideCount || 0,
    cost:       d.sessionCost || 0,
  })).sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
}

/**
 * Load a deck from vault into PipelineState.
 *
 * @param {object} vault
 * @param {string} deckId
 * @param {import('./pipeline-state.js').PipelineState} state
 * @returns {Promise<{slideCount: number, title: string}>}
 */
export async function loadDeck(vault, deckId, state) {
  const deckPath = `playbooklm/decks/${deckId}`;

  const deck = await readFileAsJson(vault, `${deckPath}/deck.json`);
  state.setDeckTitle(deck.title || null);

  // Load presentation strategy if present
  try {
    const presBytes = await readFile(vault, `${deckPath}/presentation-strategy.md`);
    const presText  = new TextDecoder().decode(presBytes);
    state.setPresentation(presText);
  } catch (_) {}

  // Load slide briefs if present
  try {
    const briefs = await readFileAsJson(vault, `${deckPath}/slide-briefs.json`);
    if (Array.isArray(briefs)) state.setSlideBriefs(briefs);
  } catch (_) {}

  return { slideCount: deck.slideCount || 0, title: deck.title || 'Untitled' };
}

/**
 * Write sources to vault.
 *
 * @param {object} vault
 * @param {string} deckId
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{message?: string}} opts
 * @returns {Promise<void>}
 */
export async function saveSources(vault, deckId, state, opts = {}) {
  const sources    = state.getSources();
  const deckTitle  = state.deckTitle || 'Deck';
  const commitBase = `PLM/${deckTitle}/step1: ${sources.length} sources loaded`;
  const msg        = opts.message || commitBase;

  for (const src of sources) {
    await writeVaultFile(
      vault,
      `playbooklm/decks/${deckId}/sources/${src.name}`,
      src.textContent,
      { message: msg, contentType: 'text/plain' },
    );
  }
}

/**
 * Write presentation strategy to vault.
 *
 * @param {object} vault
 * @param {string} deckId
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{message?: string}} opts
 * @returns {Promise<void>}
 */
export async function savePresentation(vault, deckId, state, opts = {}) {
  const deckTitle = state.deckTitle || 'Deck';
  const msg       = opts.message || `PLM/${deckTitle}/step2: presentation strategy (${state.textModel})`;
  await writeVaultFile(
    vault,
    `playbooklm/decks/${deckId}/presentation-strategy.md`,
    state.getPresentation(),
    { message: msg, contentType: 'text/markdown' },
  );
}

/**
 * Write slide briefs to vault.
 *
 * @param {object} vault
 * @param {string} deckId
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{message?: string}} opts
 * @returns {Promise<void>}
 */
export async function saveSlideBriefs(vault, deckId, state, opts = {}) {
  const briefs    = state.getSlideBriefs();
  const deckTitle = state.deckTitle || 'Deck';
  const msg       = opts.message || `PLM/${deckTitle}/step3: ${briefs.length} slide briefs (${state.textModel})`;
  await writeVaultFile(
    vault,
    `playbooklm/decks/${deckId}/slide-briefs.json`,
    JSON.stringify(briefs, null, 2),
    { message: msg, contentType: 'application/json' },
  );
}

/**
 * Write a single slide's latest version images and metadata to vault.
 * Writes dist JPEG (always), li JPEG (always), PNG (if profile = 'full').
 * Updates versions.json and selected.txt. Updates deck.json.
 *
 * @param {object} vault
 * @param {string} deckId
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {number} slideIndex
 * @param {{message?: string}} opts
 * @returns {Promise<void>}
 */
export async function saveSlide(vault, deckId, state, slideIndex, opts = {}) {
  const versions = state.getSlideVersions(slideIndex);
  if (!versions.length) return;

  const briefs    = state.getSlideBriefs();
  const brief     = briefs[slideIndex];
  const deckTitle = state.deckTitle || 'Deck';
  const vIdx      = versions.length; // 1-based version number for file names
  const ver       = versions[versions.length - 1];
  const folder    = _slideFolder(slideIndex, brief?.title || `slide-${slideIndex + 1}`);
  const base      = `playbooklm/decks/${deckId}/slides/${folder}`;

  const shortModel = (ver.model || '').split('/').pop() || ver.model;
  const costStr    = `$${(ver.cost || 0).toFixed(3)}`;
  const latStr     = `${Math.round((ver.latencyMs || 0) / 1000)}s`;
  const msg        = opts.message ||
    `PLM/${deckTitle}/slide${slideIndex + 1}-v${vIdx}: ${brief?.title || 'slide'} (${shortModel}, ${costStr}, ${latStr})`;

  // dist JPEG (always)
  if (ver.distBlob) {
    await writeVaultFile(
      vault,
      `${base}/v${vIdx}-dist.jpg`,
      await _blobToArrayBuffer(ver.distBlob),
      { message: msg, contentType: 'image/jpeg' },
    );
  }

  // li JPEG (always)
  if (ver.liBlob) {
    await writeVaultFile(
      vault,
      `${base}/v${vIdx}-li.jpg`,
      await _blobToArrayBuffer(ver.liBlob),
      { message: `PLM/${deckTitle}/slide${slideIndex + 1}-v${vIdx}: social JPEG`, contentType: 'image/jpeg' },
    );
  }

  // Archive PNG (only if profile = 'full')
  if (state.vaultProfile === 'full' && ver.imageSrc) {
    const pngBytes = _dataUrlToArrayBuffer(ver.imageSrc);
    if (pngBytes) {
      await writeVaultFile(
        vault,
        `${base}/v${vIdx}.png`,
        pngBytes,
        { message: `PLM/${deckTitle}/slide${slideIndex + 1}-v${vIdx}: archive PNG`, contentType: 'image/png' },
      );
    }
  }

  // versions.json
  const versionsJson = versions.map((v, i) => ({
    v:         i + 1,
    title:     v.title,
    model:     v.model,
    cost:      v.cost,
    latencyMs: v.latencyMs,
    ts:        v.ts,
    sizes:     v.sizes || null,
  }));
  await writeVaultFile(
    vault,
    `${base}/versions.json`,
    JSON.stringify(versionsJson, null, 2),
    { message: `PLM/${deckTitle}/slide${slideIndex + 1}: update versions.json`, contentType: 'application/json' },
  );

  // selected.txt
  const selectedIdx = state.getSelectedVersion(slideIndex);
  await writeVaultFile(
    vault,
    `${base}/selected.txt`,
    String(selectedIdx + 1),
    { message: `PLM/${deckTitle}/slide${slideIndex + 1}: selected v${selectedIdx + 1}`, contentType: 'text/plain' },
  );

  // Update deck.json with latest metadata
  await saveDeckMeta(vault, deckId, state, {
    message: `PLM/${deckTitle}/meta: update deck.json after slide ${slideIndex + 1}`,
  });
}

/**
 * Update deck.json with current cost, slide count, and selected versions.
 *
 * @param {object} vault
 * @param {string} deckId
 * @param {import('./pipeline-state.js').PipelineState} state
 * @param {{message?: string}} opts
 * @returns {Promise<void>}
 */
export async function saveDeckMeta(vault, deckId, state, opts = {}) {
  const deckTitle = state.deckTitle || 'Deck';
  const msg       = opts.message || `PLM/${deckTitle}/meta: update deck metadata`;

  // Build selected versions map
  const selectedVersions = {};
  const briefs = state.getSlideBriefs();
  for (let i = 0; i < briefs.length; i++) {
    const sel = state.getSelectedVersion(i);
    if (sel >= 0) selectedVersions[String(i)] = sel;
  }

  const slideCount = state.getSlideResults().filter(r => r.status === 'complete').length;

  let existing = {};
  try {
    existing = await readFileAsJson(vault, `playbooklm/decks/${deckId}/deck.json`);
  } catch (_) {}

  const deck = {
    ...existing,
    title:            state.deckTitle || existing.title || 'Untitled',
    updatedAt:        new Date().toISOString(),
    textModel:        state.textModel,
    imageModel:       state.imageModel,
    slideCount,
    sessionCost:      state.sessionCost,
    deckCost:         state.deckCost,
    vaultProfile:     state.vaultProfile,
    selectedVersions,
  };

  await writeVaultFile(
    vault,
    `playbooklm/decks/${deckId}/deck.json`,
    JSON.stringify(deck, null, 2),
    { message: msg, contentType: 'application/json' },
  );

  await _updateDeckIndex(vault, {
    id:         deckId,
    title:      deck.title,
    slideCount: deck.slideCount,
    sessionCost: deck.sessionCost,
  }, msg);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Convert a data URL to ArrayBuffer for vault upload.
 * Returns null if the data URL is invalid.
 *
 * @param {string} dataUrl
 * @returns {ArrayBuffer|null}
 */
function _dataUrlToArrayBuffer(dataUrl) {
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) return null;
    const b64    = dataUrl.slice(commaIdx + 1);
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (_) {
    return null;
  }
}
