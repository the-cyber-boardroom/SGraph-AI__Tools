/**
 * PlaybookLM — Step 1: Sources panel (v0.1.40).
 *
 * Allows users to upload text files (PDF text, markdown, plain text)
 * and manage the loaded source list. Includes inline example documents
 * for quick demos. Uses FileReader for text extraction.
 *
 * @module ui-sources
 * @version 0.1.1
 */

import { EXAMPLES } from './ui-examples-data.js';

/**
 * Build the Step 1 Sources panel inside a container element.
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {(n: number) => void} setStep - Stepper navigation callback
 * @returns {void}
 */
export function buildSourcesPanel(container, state, setStep) {
  container.style.cssText = 'overflow-y:auto;height:100%;box-sizing:border-box;padding:16px;background:#0d0d1a;font-family:system-ui,sans-serif;';

  container.innerHTML = `
    <h2 class="plm-step-title">Step 1 \u2014 Sources</h2>
    <p class="plm-step-desc">Upload text files to use as source material. Supported: .txt, .md, .json, .csv, .html, .js, .ts, .py, .pdf (text layer).</p>
    <div id="plm-drop-zone" class="plm-drop-zone" tabindex="0" role="button" aria-label="Drop files or click to upload">
      <span>Drop files here or <strong>click to browse</strong></span>
      <input type="file" id="plm-file-input" multiple accept=".txt,.md,.json,.csv,.html,.htm,.js,.ts,.py,.pdf" style="display:none">
    </div>
    <div id="plm-sources-list" class="plm-sources-list"></div>
    <div class="plm-step-footer">
      <span id="plm-source-count" class="plm-count-badge">0 sources</span>
    </div>
    <div class="plm-examples">
      <div class="plm-examples-header"><span>Try an example</span></div>
      <div class="plm-examples-grid" id="plm-examples-grid"></div>
    </div>
  `;

  const dropZone  = container.querySelector('#plm-drop-zone');
  const fileInput = container.querySelector('#plm-file-input');
  const listEl    = container.querySelector('#plm-sources-list');
  const countEl   = container.querySelector('#plm-source-count');
  const grid      = container.querySelector('#plm-examples-grid');

  // ── Click to browse ───────────────────────────────────────────────────────
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

  // ── Drag and drop ─────────────────────────────────────────────────────────
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('plm-drop-active');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('plm-drop-active'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('plm-drop-active');
    _loadFiles([...e.dataTransfer.files]);
  });

  fileInput.addEventListener('change', () => {
    _loadFiles([...fileInput.files]);
    fileInput.value = '';
  });

  // ── File loader ───────────────────────────────────────────────────────────
  function _loadFiles(files) {
    Promise.all(files.map(_readFile)).then(loaded => {
      state.loadSources(loaded);
      _render();
    }).catch(err => console.error('PlaybookLM: file load error', err));
  }

  function _render() {
    const sources = state.getSources();
    countEl.textContent = `${sources.length} source${sources.length !== 1 ? 's' : ''}`;
    listEl.innerHTML = '';
    sources.forEach((src, i) => {
      const row = document.createElement('div');
      row.className = 'plm-source-row';
      row.innerHTML = `
        <span class="plm-source-name" title="${_esc(src.name)}">${_esc(src.name)}</span>
        <span class="plm-source-meta">${_formatSize(src.textContent.length)} chars</span>
        <button class="plm-source-remove" data-index="${i}" title="Remove source" aria-label="Remove ${_esc(src.name)}">&times;</button>
      `;
      row.querySelector('.plm-source-remove').addEventListener('click', () => {
        state.removeSource(i);
        _render();
      });
      listEl.appendChild(row);
    });
  }

  // ── Example cards ─────────────────────────────────────────────────────────
  EXAMPLES.forEach(ex => {
    const card = document.createElement('div');
    card.className = 'plm-example-card';
    card.dataset.id = ex.id;
    card.innerHTML = `
      <span class="plm-example-icon">${ex.icon}</span>
      <div class="plm-example-info">
        <div class="plm-example-title">${_esc(ex.title)}</div>
        <div class="plm-example-desc">${_esc(ex.description)}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      state.loadSources([{ name: ex.name, type: 'text/markdown', textContent: ex.textContent }]);
      _render();
    });
    grid.appendChild(card);
  });

  _render();
}

/**
 * Read a File object and return a source record.
 *
 * @param {File} file
 * @returns {Promise<{name: string, type: string, textContent: string}>}
 */
function _readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type || 'text/plain',
      textContent: /** @type {string} */ (reader.result),
    });
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Format a character count as a human-readable size.
 *
 * @param {number} n
 * @returns {string}
 */
function _formatSize(n) {
  if (n < 1000) return `${n}`;
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

/**
 * Escape HTML special characters.
 *
 * @param {string} s
 * @returns {string}
 */
function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
