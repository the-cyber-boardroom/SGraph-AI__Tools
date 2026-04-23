/**
 * PlaybookLM — Horizontal step navigator component.
 *
 * Builds the stepper bar (nodes + connectors + Next button) and
 * step content panels inside a container element. Returns setStep(n)
 * and getPanelEl(n) so callers can navigate and inject content.
 *
 * @module ui-stepper
 * @version 0.1.0
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
 * @returns {{ setStep: (n: number) => void, getPanelEl: (n: number) => HTMLElement }}
 */
export function buildStepper(container) {
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
    panel.className = 'plm-panel hidden';
    panel.dataset.panel = String(s.n);
    panelsWrap.appendChild(panel);
  });

  wrap.appendChild(bar);
  wrap.appendChild(counter);
  wrap.appendChild(panelsWrap);
  container.appendChild(wrap);

  // ── Step state ────────────────────────────────────────────────────────────
  let _current = 1;

  /**
   * Navigate to step n.
   *
   * @param {number} n - Step number (1–5)
   * @returns {void}
   */
  function setStep(n) {
    _current = Math.max(1, Math.min(STEP_COUNT, n));

    track.querySelectorAll('.plm-step').forEach(el => {
      const sn = Number(el.dataset.step);
      const node = el.querySelector('.plm-step-node');
      el.classList.remove('active', 'done');
      if (sn === _current) {
        el.classList.add('active');
        node.textContent = String(sn);
      } else if (sn < _current) {
        el.classList.add('done');
        node.textContent = '\u2713';
      } else {
        node.textContent = String(sn);
      }
    });

    track.querySelectorAll('.plm-step-connector').forEach(el => {
      el.classList.toggle('done', Number(el.dataset.afterStep) < _current);
    });

    counter.textContent = `Step ${_current} of ${STEP_COUNT}`;

    if (_current === STEP_COUNT) {
      nextBtn.textContent = 'Done \u2713';
      nextBtn.disabled = true;
    } else {
      nextBtn.textContent = 'Next \u2192';
      nextBtn.disabled = false;
    }

    panelsWrap.querySelectorAll('.plm-panel').forEach(el => {
      el.classList.toggle('hidden', Number(el.dataset.panel) !== _current);
    });
  }

  nextBtn.addEventListener('click', () => {
    if (_current < STEP_COUNT) setStep(_current + 1);
  });

  track.addEventListener('click', e => {
    const stepEl = e.target.closest('.plm-step');
    if (stepEl && stepEl.classList.contains('done')) {
      setStep(Number(stepEl.dataset.step));
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

  return { setStep, getPanelEl };
}
