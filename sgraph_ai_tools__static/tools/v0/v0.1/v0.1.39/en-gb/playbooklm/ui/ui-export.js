/**
 * PlaybookLM — Step 5: Export panel.
 *
 * Provides PDF and ZIP export of generated slide images.
 * Requires jsPDF (for PDF) and JSZip (for ZIP) to be loaded as global scripts.
 *
 * @module ui-export
 * @version 0.1.0
 */

/**
 * Build the Step 5 Export panel inside a container element.
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @returns {void}
 */
export function buildExportPanel(container, state) {
  container.style.cssText = 'overflow-y:auto;height:100%;box-sizing:border-box;padding:16px;background:#0d0d1a;font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:16px;';

  container.innerHTML = `
    <h2 class="plm-step-title">Step 5 — Export Deck</h2>
    <p class="plm-step-desc">Export your completed slides. Only slides with generated images will be included.</p>

    <div class="plm-export-card">
      <div class="plm-export-card-header">
        <span class="plm-export-icon">PDF</span>
        <div>
          <div class="plm-export-title">Export as PDF</div>
          <div class="plm-export-desc">A4 landscape, one slide per page</div>
        </div>
      </div>
      <button id="plm-export-pdf-btn" class="plm-btn-primary plm-export-btn">Export PDF</button>
      <span id="plm-pdf-status" class="plm-status-text"></span>
    </div>

    <div class="plm-export-card">
      <div class="plm-export-card-header">
        <span class="plm-export-icon">ZIP</span>
        <div>
          <div class="plm-export-title">Export as ZIP</div>
          <div class="plm-export-desc">All slides as individual PNG files</div>
        </div>
      </div>
      <button id="plm-export-zip-btn" class="plm-btn-primary plm-export-btn">Export ZIP</button>
      <span id="plm-zip-status" class="plm-status-text"></span>
    </div>

    <div id="plm-export-summary" class="plm-export-summary"></div>
  `;

  const pdfBtn    = container.querySelector('#plm-export-pdf-btn');
  const zipBtn    = container.querySelector('#plm-export-zip-btn');
  const pdfStatus = container.querySelector('#plm-pdf-status');
  const zipStatus = container.querySelector('#plm-zip-status');
  const summaryEl = container.querySelector('#plm-export-summary');

  function _updateSummary() {
    const results  = state.getSlideResults().filter(r => r.status === 'complete' && r.imageSrc);
    const total    = state.getSlideBriefs().length;
    summaryEl.textContent = `${results.length} of ${total} slide${total !== 1 ? 's' : ''} ready for export.`;
  }

  state.onChange(_updateSummary);
  _updateSummary();

  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    pdfStatus.textContent = 'Building PDF…';
    pdfStatus.className = 'plm-status-text plm-status-info';
    try {
      await window.__tool.exportDeck({ format: 'pdf' });
      pdfStatus.textContent = 'PDF downloaded ✓';
      pdfStatus.className = 'plm-status-text plm-status-ok';
    } catch (err) {
      pdfStatus.textContent = `Error: ${err.message}`;
      pdfStatus.className = 'plm-status-text plm-status-error';
    } finally {
      pdfBtn.disabled = false;
    }
  });

  zipBtn.addEventListener('click', async () => {
    zipBtn.disabled = true;
    zipStatus.textContent = 'Building ZIP…';
    zipStatus.className = 'plm-status-text plm-status-info';
    try {
      await window.__tool.exportDeck({ format: 'zip' });
      zipStatus.textContent = 'ZIP downloaded ✓';
      zipStatus.className = 'plm-status-text plm-status-ok';
    } catch (err) {
      zipStatus.textContent = `Error: ${err.message}`;
      zipStatus.className = 'plm-status-text plm-status-error';
    } finally {
      zipBtn.disabled = false;
    }
  });
}
