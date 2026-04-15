/**
 * PlaybookLM — Vault panel: session start screen + vault status bar.
 *
 * Exports two functions:
 *
 *   buildVaultStartScreen(container, state, onVaultConnected, onSkip)
 *     Renders either the vault connect form (sg-vault-manager) or the
 *     deck picker when a vault is already connected with existing decks.
 *     Call onVaultConnected(vault, deckId) when ready. Call onSkip() to
 *     proceed without a vault.
 *
 *   buildVaultStatusBar(container, state)
 *     Renders a persistent status bar showing vault sync status and
 *     pending changes count. Reacts to state.onChange().
 *
 * @module ui-vault-panel
 * @version 0.1.0
 */

import * as vaultOps from '../api/vault-ops.js';

// ── Start screen ──────────────────────────────────────────────────────────────

/**
 * Build the vault session-start screen inside container.
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {(vault: object, deckId: string) => void} onVaultConnected
 * @param {() => void} onSkip
 * @returns {void}
 */
export function buildVaultStartScreen(container, state, onVaultConnected, onSkip) {
  container.style.cssText =
    'overflow-y:auto;height:100%;box-sizing:border-box;padding:24px;background:#0d0d1a;font-family:system-ui,sans-serif;display:flex;flex-direction:column;gap:16px;align-items:stretch;';

  container.innerHTML = `
    <div style="font-size:22px;font-weight:700;color:#e2e8f0;">PlaybookLM</div>
    <div style="font-size:13px;color:#718096;line-height:1.7;max-width:480px;">
      Connect to a vault to save every pipeline step as an encrypted, version-controlled commit
      — or continue without one and use local export only.
    </div>

    <div id="vault-bus-wrap" data-vault-bus style="max-width:480px;">
      <sg-vault-manager id="vault-mgr"></sg-vault-manager>
    </div>

    <div id="deck-picker" style="display:none;max-width:480px;">
      <div style="font-size:13px;font-weight:600;color:#a0aec0;margin-bottom:8px;">Your decks</div>
      <div id="deck-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="load-deck-btn"
          style="padding:7px 16px;background:#4ECDC4;border:none;border-radius:4px;color:#0d1b2a;font-weight:600;font-size:13px;cursor:pointer;">
          Load Selected Deck
        </button>
        <button id="new-deck-btn"
          style="padding:7px 16px;background:transparent;border:1px solid #2a3a5c;border-radius:4px;color:#a0aec0;font-size:13px;cursor:pointer;">
          Start New Deck
        </button>
      </div>
      <div id="deck-status" style="font-size:12px;color:#718096;margin-top:8px;min-height:1.2em;"></div>
    </div>

    <div id="new-deck-form" style="display:none;max-width:480px;">
      <div style="font-size:13px;font-weight:600;color:#a0aec0;margin-bottom:6px;">New deck title</div>
      <div style="display:flex;gap:8px;">
        <input id="deck-title-input" type="text" placeholder="e.g. Climate Tech 2026"
          style="flex:1;padding:7px 10px;background:#0a0f1a;border:1px solid #2a3a5c;border-radius:4px;color:#e2e8f0;font-size:13px;font-family:inherit;" />
        <button id="create-deck-btn"
          style="padding:7px 16px;background:#4ECDC4;border:none;border-radius:4px;color:#0d1b2a;font-weight:600;font-size:13px;cursor:pointer;">
          Create
        </button>
      </div>
      <div id="create-status" style="font-size:12px;color:#718096;margin-top:6px;min-height:1.2em;"></div>
    </div>

    <div style="display:flex;align-items:center;gap:8px;max-width:480px;margin-top:4px;">
      <div style="flex:1;height:1px;background:#1a2a3a;"></div>
      <span style="font-size:12px;color:#4a5568;">or</span>
      <div style="flex:1;height:1px;background:#1a2a3a;"></div>
    </div>

    <button id="skip-vault-btn"
      style="max-width:480px;padding:8px 16px;background:transparent;border:1px solid #2a3a5c;border-radius:4px;color:#718096;font-size:13px;cursor:pointer;text-align:left;">
      Continue without vault &rarr; local export only
    </button>
  `;

  // Wire skip
  container.querySelector('#skip-vault-btn').addEventListener('click', onSkip);

  // Vault bus events
  let _connectedVault = null;
  const busWrap = container.querySelector('#vault-bus-wrap');

  busWrap.addEventListener('vault:connected', async (ev) => {
    _connectedVault = ev.detail.vault;
    await _showDeckPicker(container, state, _connectedVault, onVaultConnected);
  });

  busWrap.addEventListener('vault:disconnected', () => {
    _connectedVault = null;
    container.querySelector('#deck-picker').style.display    = 'none';
    container.querySelector('#new-deck-form').style.display  = 'none';
  });

  // New deck / load deck buttons wired after deck picker is shown
}

/**
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @param {object} vault
 * @param {(vault: object, deckId: string) => void} onVaultConnected
 */
async function _showDeckPicker(container, state, vault, onVaultConnected) {
  const picker   = container.querySelector('#deck-picker');
  const deckList = container.querySelector('#deck-list');
  const status   = container.querySelector('#deck-status');

  picker.style.display = '';
  deckList.innerHTML   = '<div style="font-size:12px;color:#718096;">Loading decks…</div>';

  let decks = [];
  try {
    decks = await vaultOps.listDecks(vault);
  } catch (_) {
    decks = [];
  }

  let selectedDeckId = null;

  if (!decks.length) {
    deckList.innerHTML = '<div style="font-size:12px;color:#4a5568;">No decks yet in this vault.</div>';
    // Show new deck form immediately
    container.querySelector('#new-deck-form').style.display = '';
  } else {
    deckList.innerHTML = '';
    decks.forEach(d => {
      const row = document.createElement('div');
      row.style.cssText =
        'padding:8px 10px;border:1px solid #2a3a5c;border-radius:4px;cursor:pointer;' +
        'display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#a0aec0;';
      row.dataset.deckId = d.id;

      const ago = _relTime(d.updatedAt);
      row.innerHTML = `
        <span style="font-weight:600;color:#e2e8f0;">${_esc(d.title)}</span>
        <span style="font-size:11px;color:#4a5568;">${d.slideCount} slides · $${(d.cost||0).toFixed(2)} · ${ago}</span>
      `;

      row.addEventListener('click', () => {
        deckList.querySelectorAll('div[data-deck-id]').forEach(r =>
          r.style.borderColor = '#2a3a5c');
        row.style.borderColor = '#4ECDC4';
        selectedDeckId = d.id;
      });

      deckList.appendChild(row);
    });
  }

  // Load button
  const loadBtn = container.querySelector('#load-deck-btn');
  loadBtn.addEventListener('click', async () => {
    if (!selectedDeckId) {
      if (status) status.textContent = 'Select a deck first.';
      return;
    }
    loadBtn.disabled = true;
    if (status) status.textContent = 'Loading deck…';
    try {
      await vaultOps.loadDeck(vault, selectedDeckId, state);
      onVaultConnected(vault, selectedDeckId);
    } catch (err) {
      if (status) status.textContent = `Error: ${err.message}`;
      loadBtn.disabled = false;
    }
  });

  // New deck button
  container.querySelector('#new-deck-btn').addEventListener('click', () => {
    container.querySelector('#new-deck-form').style.display = '';
    container.querySelector('#deck-title-input').focus();
  });

  // Create deck button
  container.querySelector('#create-deck-btn').addEventListener('click', async () => {
    const titleEl   = container.querySelector('#deck-title-input');
    const createSt  = container.querySelector('#create-status');
    const title     = titleEl?.value?.trim() || 'Untitled Deck';
    const createBtn = container.querySelector('#create-deck-btn');

    createBtn.disabled = true;
    createSt.textContent = 'Creating deck…';

    try {
      const deckId = await vaultOps.createDeck(vault, { title, state });
      state.setDeckTitle(title);
      onVaultConnected(vault, deckId);
    } catch (err) {
      createSt.textContent = `Error: ${err.message}`;
      createBtn.disabled = false;
    }
  });
}

// ── Status bar ────────────────────────────────────────────────────────────────

/**
 * Build the persistent vault status bar, inserted into container.
 * Reacts to state.onChange().
 *
 * @param {HTMLElement} container
 * @param {import('../api/pipeline-state.js').PipelineState} state
 * @returns {HTMLElement} The status bar element
 */
export function buildVaultStatusBar(container, state) {
  const bar = document.createElement('div');
  bar.id = 'vault-status-bar';
  bar.style.cssText =
    'padding:5px 12px;font-size:12px;font-family:system-ui,sans-serif;' +
    'display:flex;align-items:center;gap:10px;border-bottom:1px solid #1a2a3a;' +
    'background:#090e1a;flex-shrink:0;';

  container.appendChild(bar);

  function _render() {
    const pending   = state.vaultPendingChanges;
    const connected = state.vaultConnected;
    const deckTitle = state.deckTitle;

    if (!connected) {
      bar.innerHTML = `<span style="color:#4a5568;">&#9675; No vault — local export only</span>`;
      return;
    }

    const vaultId = state.vault?.vaultId || '';
    const vLabel  = deckTitle
      ? `<span style="color:#718096;">Vault</span> <span style="color:#a0aec0;">${_esc(vaultId.slice(0, 8))}\u2026</span>
         &nbsp;·&nbsp; <span style="color:#718096;">Deck</span> <span style="color:#e2e8f0;">${_esc(deckTitle)}</span>`
      : `<span style="color:#718096;">Vault</span> <span style="color:#a0aec0;">${_esc(vaultId.slice(0, 8))}\u2026</span>`;

    let syncEl;
    if (pending > 0) {
      syncEl = `<span style="color:#f6ad55;">&#9888; ${pending} unsaved change${pending !== 1 ? 's' : ''}
        <button id="vsb-save-now" style="margin-left:6px;padding:1px 7px;background:transparent;
          border:1px solid #f6ad55;border-radius:3px;color:#f6ad55;font-size:11px;cursor:pointer;">
          Save now
        </button>
      </span>`;
    } else {
      syncEl = `<span style="color:#68d391;">&#9679; Saved</span>`;
    }

    bar.innerHTML = `
      <span style="color:#4ECDC4;">&#128274;</span>
      ${vLabel}
      &nbsp;·&nbsp;
      ${syncEl}
      <span style="flex:1;"></span>
      <button id="vsb-config" style="padding:1px 7px;background:transparent;border:1px solid #2a3a5c;
        border-radius:3px;color:#718096;font-size:11px;cursor:pointer;" title="Deck config">&#9881;</button>
    `;

    bar.querySelector('#vsb-save-now')?.addEventListener('click', async () => {
      if (!state.vaultConnected || !state.vaultDeckId) return;
      try {
        await window.__tool?.saveStep({ step: 'meta', message: '' });
        state.clearPending();
      } catch (_) {}
    });

    bar.querySelector('#vsb-config')?.addEventListener('click', () => {
      _showConfigPopover(bar, state);
    });
  }

  state.onChange(_render);
  _render();
  return bar;
}

// ── Config popover ────────────────────────────────────────────────────────────

function _showConfigPopover(anchor, state) {
  document.getElementById('vsb-popover')?.remove();

  const pop = document.createElement('div');
  pop.id = 'vsb-popover';
  pop.style.cssText =
    'position:fixed;z-index:9999;background:#0f1a2e;border:1px solid #2a3a5c;border-radius:6px;' +
    'padding:14px;font-family:system-ui,sans-serif;font-size:13px;color:#a0aec0;' +
    'box-shadow:0 8px 24px rgba(0,0,0,0.5);min-width:260px;';

  const rect = anchor.getBoundingClientRect();
  pop.style.top   = `${rect.bottom + 4}px`;
  pop.style.right = `${window.innerWidth - rect.right}px`;

  const currentTitle   = state.deckTitle || '';
  const currentProfile = state.vaultProfile;

  pop.innerHTML = `
    <div style="font-weight:600;color:#e2e8f0;margin-bottom:10px;">Deck Configuration</div>
    <label style="display:block;font-size:11px;color:#718096;margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em;">Deck title</label>
    <input id="pop-title" type="text" value="${_esc(currentTitle)}" placeholder="Untitled Deck"
      style="width:100%;box-sizing:border-box;padding:5px 8px;background:#0a0f1a;border:1px solid #2a3a5c;
      border-radius:4px;color:#e2e8f0;font-size:13px;font-family:inherit;margin-bottom:10px;" />

    <label style="display:block;font-size:11px;color:#718096;margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em;">Vault storage profile</label>
    <select id="pop-profile"
      style="width:100%;box-sizing:border-box;padding:5px 8px;background:#0a0f1a;border:1px solid #2a3a5c;
      border-radius:4px;color:#e2e8f0;font-size:13px;font-family:inherit;margin-bottom:10px;">
      <option value="full" ${currentProfile === 'full' ? 'selected' : ''}>Full archive (PNG + JPEG)</option>
      <option value="distribution" ${currentProfile === 'distribution' ? 'selected' : ''}>Distribution (JPEG only)</option>
      <option value="minimal" ${currentProfile === 'minimal' ? 'selected' : ''}>Minimal (dist JPEG only)</option>
    </select>

    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="pop-disconnect" style="padding:5px 12px;background:transparent;border:1px solid #2a3a5c;border-radius:4px;color:#718096;font-size:12px;cursor:pointer;">Disconnect vault</button>
      <button id="pop-save" style="padding:5px 12px;background:#4ECDC4;border:none;border-radius:4px;color:#0d1b2a;font-weight:600;font-size:12px;cursor:pointer;">Save</button>
    </div>
  `;

  document.body.appendChild(pop);

  pop.querySelector('#pop-save').addEventListener('click', () => {
    const title   = pop.querySelector('#pop-title').value.trim();
    const profile = pop.querySelector('#pop-profile').value;
    if (title) state.setDeckTitle(title);
    state.vaultProfile = profile;
    pop.remove();
  });

  pop.querySelector('#pop-disconnect').addEventListener('click', () => {
    window.__tool?.disconnectVault?.();
    pop.remove();
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
