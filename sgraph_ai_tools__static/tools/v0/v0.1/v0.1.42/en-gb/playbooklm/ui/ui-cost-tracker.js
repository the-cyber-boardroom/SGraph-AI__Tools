/**
 * PlaybookLM — Session and deck cost display.
 *
 * Reads cost data from PipelineState and renders a compact cost bar
 * injected after the #conn-status element in the connection bar.
 * Shows session cost (in-memory) and deck cost (localStorage-persisted).
 *
 * @module ui-cost-tracker
 * @version 0.1.0
 */

/**
 * Inject a live cost display into the connection bar.
 * Call this once from _wireConnectBar() in ui-shell.js.
 *
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @returns {void}
 */
export function buildCostDisplay(state) {
  const statusEl = document.getElementById('conn-status');
  if (!statusEl) return;

  const wrap = document.createElement('div');
  wrap.className = 'plm-cost-display';
  wrap.title = 'LLM API spend. Session resets on page refresh; Deck persists across sessions.';

  wrap.innerHTML = `
    <span class="plm-cost-label">Cost:</span>
    <span class="plm-cost-session" title="This browser session">Session&nbsp;<strong class="plm-cost-session-val">$0.0000</strong></span>
    <span class="plm-cost-sep">&middot;</span>
    <span class="plm-cost-deck" title="Total across all sessions for this deck">Deck&nbsp;<strong class="plm-cost-deck-val">$0.0000</strong></span>
    <button class="plm-cost-reset" title="Reset deck total to $0.00">&#x21BA;</button>
  `;

  statusEl.insertAdjacentElement('afterend', wrap);

  const sessionVal = wrap.querySelector('.plm-cost-session-val');
  const deckVal    = wrap.querySelector('.plm-cost-deck-val');
  const resetBtn   = wrap.querySelector('.plm-cost-reset');

  function _render() {
    const s = state.sessionCost;
    const d = state.deckCost;
    sessionVal.textContent = `$${s.toFixed(4)}`;
    deckVal.textContent    = `$${d.toFixed(4)}`;
    wrap.classList.toggle('plm-cost-has-spend', s > 0);
  }

  state.onChange(_render);
  _render();

  resetBtn.addEventListener('click', () => {
    if (confirm('Reset deck total cost to $0.00?')) {
      state.resetDeckCost();
    }
  });
}
