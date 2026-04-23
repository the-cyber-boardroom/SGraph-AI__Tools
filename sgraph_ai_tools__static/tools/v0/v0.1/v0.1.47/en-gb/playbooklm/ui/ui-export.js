/**
 * PlaybookLM — Step 5: Export panel.
 *
 * v0.1.2 changes:
 *  - PDF export description updated to reflect JPEG compression (87% smaller).
 *  - Archive export description updated to mention dist+li JPEG variants.
 *  - No code change needed: _exportPDF and buildArchiveBlob in pipeline-steps.js
 *    v0.1.6 already use distBlob when present. This file just passes through
 *    to window.__tool.exportDeck().
 *
 * @module ui-export
 * @version 0.1.2
 */

import { buildArchiveBlob } from '../api/pipeline-steps.js';

/**
 * Build the Step 5 Export panel.
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {(n: number) => void} setStep
 * @returns {void}
 */
export function buildExportPanel(container, state, setStep) {
  container.style.cssText =
    'overflow-y:auto;height:100%;box-sizing:border-box;padding:16px;background:#0d0d1a;' +
    'font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:16px;';

  container.innerHTML = `
    <h2 class="plm-step-title">Step 5 &mdash; Export Deck</h2>
    <p class="plm-step-desc">Export your completed slides. Only slides with generated images are included.</p>

    <div class="plm-export-card">
      <div class="plm-export-card-header">
        <span class="plm-export-icon">PDF</span>
        <div>
          <div class="plm-export-title">Slide Deck PDF</div>
          <div class="plm-export-desc">Landscape 1280&times;720 &mdash; uses compressed JPEG slides (~87% smaller than PNG)</div>
        </div>
      </div>
      <button id="plm-export-pdf-btn" class="plm-btn-primary plm-export-btn">Export PDF</button>
      <span id="plm-pdf-status" class="plm-status-text"></span>
    </div>

    <div class="plm-export-card">
      <div class="plm-export-card-header">
        <span class="plm-export-icon">ZIP</span>
        <div>
          <div class="plm-export-title">Slides ZIP</div>
          <div class="plm-export-desc">Selected slide images as individual PNG files</div>
        </div>
      </div>
      <button id="plm-export-zip-btn" class="plm-btn-primary plm-export-btn">Export ZIP</button>
      <span id="plm-zip-status" class="plm-status-text"></span>
    </div>

    <div class="plm-export-card" style="border-color:#2d4a44;">
      <div class="plm-export-card-header">
        <span class="plm-export-icon" style="background:#0d3d3a;color:#4ECDC4;border-color:#2c7a73;">&#128230;</span>
        <div>
          <div class="plm-export-title" style="color:#4ECDC4;">Session Archive</div>
          <div class="plm-export-desc">All slides (every version + dist/li JPEG variants), presentation doc,
            briefs, prompt history, cost summary, sources, and deck PDF.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="plm-export-archive-btn" class="plm-btn-primary plm-export-btn"
          style="background:#0d3d3a;border-color:#2c7a73;color:#4ECDC4;">Download Archive</button>
        <button id="plm-share-send-btn" class="plm-btn-secondary plm-export-btn">Share via SG/Send</button>
      </div>
      <span id="plm-archive-status" class="plm-status-text"></span>
    </div>

    <div id="plm-export-summary" class="plm-export-summary"></div>
    <div id="plm-share-toast" style="display:none;background:#0d3d3a;border:1px solid #4ECDC4;
      border-radius:6px;padding:12px;font-size:12px;color:#a0aec0;line-height:1.6;"></div>
  `;

  const pdfBtn     = container.querySelector('#plm-export-pdf-btn');
  const zipBtn     = container.querySelector('#plm-export-zip-btn');
  const archiveBtn = container.querySelector('#plm-export-archive-btn');
  const sendBtn    = container.querySelector('#plm-share-send-btn');
  const pdfStatus  = container.querySelector('#plm-pdf-status');
  const zipStatus  = container.querySelector('#plm-zip-status');
  const archStat   = container.querySelector('#plm-archive-status');
  const summaryEl  = container.querySelector('#plm-export-summary');
  const toastEl    = container.querySelector('#plm-share-toast');

  function _updateSummary() {
    const results = state.getSlideResults().filter(r => r.status === 'complete' && r.imageSrc);
    const total   = state.getSlideBriefs().length;
    summaryEl.textContent =
      `${results.length} of ${total} slide${total !== 1 ? 's' : ''} ready for export.`;
  }
  state.onChange(_updateSummary);
  _updateSummary();

  // ── PDF ────────────────────────────────────────────────────────────────────
  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    pdfStatus.textContent = 'Building PDF\u2026';
    pdfStatus.className = 'plm-status-text plm-status-info';
    try {
      await window.__tool.exportDeck({ format: 'pdf' });
      pdfStatus.textContent = 'PDF downloaded \u2713';
      pdfStatus.className = 'plm-status-text plm-status-ok';
    } catch (err) {
      pdfStatus.textContent = `Error: ${err.message}`;
      pdfStatus.className = 'plm-status-text plm-status-error';
    } finally {
      pdfBtn.disabled = false;
    }
  });

  // ── ZIP ────────────────────────────────────────────────────────────────────
  zipBtn.addEventListener('click', async () => {
    zipBtn.disabled = true;
    zipStatus.textContent = 'Building ZIP\u2026';
    zipStatus.className = 'plm-status-text plm-status-info';
    try {
      await window.__tool.exportDeck({ format: 'zip' });
      zipStatus.textContent = 'ZIP downloaded \u2713';
      zipStatus.className = 'plm-status-text plm-status-ok';
    } catch (err) {
      zipStatus.textContent = `Error: ${err.message}`;
      zipStatus.className = 'plm-status-text plm-status-error';
    } finally {
      zipBtn.disabled = false;
    }
  });

  // ── Archive ────────────────────────────────────────────────────────────────
  archiveBtn.addEventListener('click', async () => {
    archiveBtn.disabled = true;
    archStat.textContent = 'Building archive\u2026';
    archStat.className = 'plm-status-text plm-status-info';
    try {
      await window.__tool.exportDeck({ format: 'archive' });
      archStat.textContent = 'Archive downloaded \u2713';
      archStat.className = 'plm-status-text plm-status-ok';
    } catch (err) {
      archStat.textContent = `Error: ${err.message}`;
      archStat.className = 'plm-status-text plm-status-error';
    } finally {
      archiveBtn.disabled = false;
    }
  });

  // ── SG/Send share ─────────────────────────────────────────────────────────
  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    archStat.textContent = 'Building archive for sharing\u2026';
    archStat.className = 'plm-status-text plm-status-info';
    toastEl.style.display = 'none';

    try {
      const results = state.getSlideResults().filter(r => r.status === 'complete' && r.imageSrc);
      const briefs  = state.getSlideBriefs();
      if (!results.length) throw new Error('No completed slides to share');

      const blob = await buildArchiveBlob(state, results, briefs);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'playbooklm-session-archive.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      window.open('https://send.sgraph.ai', '_blank', 'noopener,noreferrer');

      archStat.textContent = 'Archive downloaded \u2713';
      archStat.className = 'plm-status-text plm-status-ok';

      toastEl.style.display = '';
      toastEl.innerHTML = `
        <strong style="color:#4ECDC4;">Share via SG/Send</strong><br>
        Your session archive has been downloaded as
        <code style="color:#e2e8f0;background:#0a1a14;padding:1px 5px;border-radius:3px;">playbooklm-session-archive.zip</code>.<br>
        <strong style="color:#e2e8f0;">SG/Send has opened in a new tab.</strong>
        Upload the downloaded file there to get a shareable link.
      `;
    } catch (err) {
      archStat.textContent = `Error: ${err.message}`;
      archStat.className = 'plm-status-text plm-status-error';
    } finally {
      sendBtn.disabled = false;
    }
  });
}
