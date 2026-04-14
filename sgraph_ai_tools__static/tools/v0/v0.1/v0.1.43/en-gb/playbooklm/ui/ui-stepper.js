/**
 * PlaybookLM — Horizontal step navigator component.
 *
 * State-aware: accepts a getCompletedSteps() callback so steps that
 * have pipeline data show ✓ regardless of where the user currently is.
 * Navigating back to step 1 no longer wipes the visual done indicators.
 *
 * @module ui-stepper
 * @version 0.1.2
 */

/** Total number of pipeline steps. */
const STEP_COUNT = 5;

/** Step metadata (1-based). */
const STEPS = [
  { n: 1, label: 'Sources' },
  { n: 2, label: 'Strategy' },
  { n: 3, label: 'Briefs' },
  { n: 4, label: 'Generate' },
  { n: 5, label: 'Export' },
];

/**
 * Build the stepper UI inside a container element.
 *
 * @param {HTMLElement} container
 * @param {() => Set<number>} [getCompletedSteps] - Returns step numbers that have data.
 *   Used to keep ✓ indicators when the user navigates backwards.
 * @returns {{ setStep: (n: number) => void, getPanelEl: (n: number) => HTMLElement, refreshStatus: () => void }}
 */
export function buildStepper(container, getCompletedSteps = () => new Set()) {
  container.style.cssText = 'overflow:hidden;height:100%;display:block;background:#0d0d1a;';

  const wrap = document.createElement('div');
  wrap.className = 'plm-stepper-wrap';

  // ── Step bar ──────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'plm-stepper-bar';

  const track = document.createElement('div');
  track.className = 'plm-steps-track';

  STEPS.forEach((s, i) => {
    const stepEl = document.createElement('div');
    stepEl.className = 'plm-step';
    stepEl.dataset.step = String(s.n);
    stepEl.innerHTML = `<div class="plm-step-node">${s.n}</div><div class="plm-step-label">${s.label}</div>`;
    track.appendChild(stepEl);
    if (i < STEPS.length - 1) {
      const conn = document.createElement('div');
      conn.className = 'plm-step-connector';
      conn.dataset.afterStep = String(s.n);
      track.appendChild(conn);
    }
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'plm-next-btn';
  nextBtn.id = 'plm-next-btn';
  nextBtn.textContent = 'Next \u2192';

  bar.appendChild(track);
  bar.appendChild(nextBtn);

  const counter = document.createElement('div');
  counter.className = 'plm-step-counter';
  counter.id = 'plm-step-counter';
  counter.textContent = `Step 1 of ${STEP_COUNT}`;

  // ── Step content panels ───────────────────────────────────────────────────
  const panelsWrap = document.createElement('div');
  panelsWrap.className = 'plm-panels';

  STEPS.forEach(s => {
    const panel = document.createElement('div');
    panel.className = 'plm-panel';
    panel.dataset.panel = String(s.n);
    panel.style.display = 'none';
    panelsWrap.appendChild(panel);
  });

  wrap.appendChild(bar);
  wrap.appendChild(counter);
  wrap.appendChild(panelsWrap);
  container.appendChild(wrap);

  // ── Step state ────────────────────────────────────────────────────────────
  let _current = 1;

  /**
   * Navigate to step n. Updates step markers, connectors, counter, panel visibility.
   * Steps with data from getCompletedSteps() always show ✓ regardless of position.
   *
   * @param {number} n - Step number (1–5)
   * @returns {void}
   */
  function setStep(n) {
    _current = Math.max(1, Math.min(STEP_COUNT, n));
    const completed = getCompletedSteps();

    track.querySelectorAll('.plm-step').forEach(el => {
      const sn = Number(el.dataset.step);
      const node = el.querySelector('.plm-step-node');
      el.classList.remove('active', 'done');

      if (sn === _current) {
        el.classList.add('active');
        node.textContent = String(sn);
      } else if (sn < _current || completed.has(sn)) {
        // Done: either behind current position OR has pipeline data
        el.classList.add('done');
        node.textContent = '\u2713';
      } else {
        node.textContent = String(sn);
      }
    });

    track.querySelectorAll('.plm-step-connector').forEach(el => {
      const a = Number(el.dataset.afterStep);
      // Connector is done when both its endpoints are done
      const leftDone  = a < _current || completed.has(a);
      const rightDone = a + 1 < _current || completed.has(a + 1);
      el.classList.toggle('done', leftDone && rightDone);
    });

    counter.textContent = `Step ${_current} of ${STEP_COUNT}`;

    if (_current === STEP_COUNT) {
      nextBtn.textContent = 'Done \u2713';
      nextBtn.disabled = true;
    } else {
      nextBtn.textContent = 'Next \u2192';
      nextBtn.disabled = false;
    }

    // Use inline display — beats any inline style.cssText set by panel builders
    panelsWrap.querySelectorAll('.plm-panel').forEach(el => {
      el.style.display = Number(el.dataset.panel) === _current ? '' : 'none';
    });
  }

  /**
   * Refresh the step indicators without changing the current step.
   * Call on state changes so ✓ marks stay in sync with pipeline data.
   *
   * @returns {void}
   */
  function refreshStatus() {
    setStep(_current);
  }

  nextBtn.addEventListener('click', () => {
    if (_current < STEP_COUNT) setStep(_current + 1);
  });

  // Allow clicking: completed steps (have data), active step, or steps behind current
  track.addEventListener('click', e => {
    const stepEl = e.target.closest('.plm-step');
    if (!stepEl) return;
    const n = Number(stepEl.dataset.step);
    const completed = getCompletedSteps();
    if (n === _current || n < _current || completed.has(n)) {
      setStep(n);
    }
  });

  /**
   * Get the content panel element for a given step number.
   *
   * @param {number} n
   * @returns {HTMLElement}
   */
  function getPanelEl(n) {
    return /** @type {HTMLElement} */ (panelsWrap.querySelector(`[data-panel="${n}"]`));
  }

  return { setStep, getPanelEl, refreshStatus };
}
