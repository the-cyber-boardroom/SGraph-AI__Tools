/**
 * sg-vault-sync-status — Push/pull status bar for vault sessions.
 *
 * Shows ahead/behind badges and push/pull buttons. Polls for remote changes
 * on a configurable interval. Uses session.getAheadCount(), getBehindCount(),
 * push(), and pull() from the VaultSession API.
 *
 * Bus events consumed:
 *   vault:connected    — { session }
 *   vault:disconnected — {}
 *   vault:file-saved   — {} (triggers ahead count refresh)
 *
 * Bus events emitted:
 *   vault:tree-refresh — {} (after pull replaces the tree)
 *   vault:sync-pushed  — { commitId }
 *   vault:sync-pulled  — {}
 *
 * Attributes:
 *   poll-interval — remote-check interval in seconds (default: 30, 0 = off)
 *
 * @module sg-vault-sync-status
 * @version 0.1.0
 */

export class SgVaultSyncStatus extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._session  = null;
        this._handlers = {};
        this._pollTimer = null;
        this._ahead  = 0;
        this._behind = 0;
    }

    connectedCallback() {
        this._render();
        this._bindBusEvents();
    }

    disconnectedCallback() {
        this._stopPolling();
        const bus = this._bus();
        for (const [evt, fn] of Object.entries(this._handlers)) {
            bus.removeEventListener(evt, fn);
        }
    }

    get pollInterval() {
        const val = parseInt(this.getAttribute('poll-interval') ?? '30', 10);
        return Number.isFinite(val) ? val : 30;
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
<style>
  :host { display: block; font-family: inherit; }
  .ss-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: var(--sg-radius, 6px);
      background: var(--sg-bg-secondary, #16213e);
      font-size: 0.75rem;
      color: var(--sg-text-muted, #8892b0);
  }
  .ss-bar.hidden { display: none; }
  .ss-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      padding: 0.1rem 0.4rem;
      border-radius: 3px;
      font-size: 0.7rem;
      font-weight: 600;
  }
  .ss-badge-ahead {
      background: rgba(78,205,196,0.12);
      color: var(--sg-accent, #4ecdc4);
  }
  .ss-badge-behind {
      background: rgba(251,191,36,0.12);
      color: #fbbf24;
  }
  .ss-badge-zero { opacity: 0.5; }
  .ss-btn {
      background: transparent;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: 4px;
      color: var(--sg-text-muted, #8892b0);
      font-size: 0.7rem;
      padding: 0.15rem 0.4rem;
      cursor: pointer;
  }
  .ss-btn:hover:not(:disabled) {
      border-color: var(--sg-accent, #4ecdc4);
      color: var(--sg-accent, #4ecdc4);
  }
  .ss-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .ss-status {
      flex: 1;
      text-align: right;
      font-size: 0.7rem;
  }
  .ss-status.ok    { color: #6ee7b7; }
  .ss-status.error { color: var(--sg-error, #e94560); }
  .ss-spacer { flex: 1; }
</style>

<div class="ss-bar hidden" id="bar">
  <span class="ss-badge ss-badge-ahead ss-badge-zero" id="badge-ahead" title="Local commits not yet pushed">↑ 0</span>
  <button class="ss-btn" id="btn-push" disabled title="Push local commits">Push</button>
  <span class="ss-badge ss-badge-behind ss-badge-zero" id="badge-behind" title="Remote commits not yet pulled">↓ 0</span>
  <button class="ss-btn" id="btn-pull" disabled title="Pull remote changes">Pull</button>
  <span class="ss-spacer"></span>
  <span class="ss-status" id="status"></span>
</div>
`;
        this.shadowRoot.getElementById('btn-push').addEventListener('click', () => this._push());
        this.shadowRoot.getElementById('btn-pull').addEventListener('click', () => this._pull());
    }

    // ── Bus ────────────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on = (evt, fn) => {
            const bound = fn.bind(this);
            this._handlers[evt] = bound;
            bus.addEventListener(evt, bound);
        };
        on('vault:connected',    (e) => this._onConnected(e));
        on('vault:disconnected', ()  => this._onDisconnected());
        on('vault:file-saved',   ()  => this._refreshCounts());
    }

    _onConnected(e) {
        this._session = e.detail.session;
        this.shadowRoot.getElementById('bar').classList.remove('hidden');

        if (!this._session.writable) {
            this.shadowRoot.getElementById('btn-push').style.display = 'none';
            this.shadowRoot.getElementById('btn-pull').style.display = 'none';
        }

        this._refreshCounts();
        this._startPolling();
    }

    _onDisconnected() {
        this._session = null;
        this._stopPolling();
        this.shadowRoot.getElementById('bar').classList.add('hidden');
        this._setStatus('');
    }

    // ── Counts ─────────────────────────────────────────────────────────────

    async _refreshCounts() {
        if (!this._session) return;

        try {
            const [ahead, behind] = await Promise.all([
                this._session.getAheadCount(),
                this._session.getBehindCount(),
            ]);
            this._ahead  = ahead;
            this._behind = behind;
            this._updateBadges();
        } catch {
            // Silently ignore count errors during polling
        }
    }

    _updateBadges() {
        const aheadEl  = this.shadowRoot.getElementById('badge-ahead');
        const behindEl = this.shadowRoot.getElementById('badge-behind');
        const pushBtn  = this.shadowRoot.getElementById('btn-push');
        const pullBtn  = this.shadowRoot.getElementById('btn-pull');

        aheadEl.textContent = `↑ ${this._ahead}`;
        aheadEl.classList.toggle('ss-badge-zero', this._ahead === 0);
        pushBtn.disabled = this._ahead === 0 || !this._session?.writable;

        behindEl.textContent = `↓ ${this._behind}`;
        behindEl.classList.toggle('ss-badge-zero', this._behind === 0);
        pullBtn.disabled = this._behind === 0 || !this._session?.writable;
    }

    // ── Push / Pull ────────────────────────────────────────────────────────

    async _push() {
        if (!this._session || this._ahead === 0) return;

        const btn = this.shadowRoot.getElementById('btn-push');
        btn.disabled = true;
        this._setStatus('Pushing…');

        try {
            await this._session.push();
            this._ahead = 0;
            this._updateBadges();
            this._setStatus('Pushed.', 'ok');
            this._emit('vault:sync-pushed', { commitId: this._session.headCommitId });
        } catch (err) {
            this._setStatus(`Push failed: ${err.message}`, 'error');
            btn.disabled = false;
        }
    }

    async _pull() {
        if (!this._session || this._behind === 0) return;

        const btn = this.shadowRoot.getElementById('btn-pull');
        btn.disabled = true;
        this._setStatus('Pulling…');

        try {
            const pulled = await this._session.pull();
            this._behind = 0;
            this._updateBadges();

            if (pulled) {
                this._setStatus('Pulled.', 'ok');
                this._emit('vault:tree-refresh', {});
                this._emit('vault:sync-pulled', {});
            } else {
                this._setStatus('Already up to date.', 'ok');
            }
        } catch (err) {
            this._setStatus(`Pull failed: ${err.message}`, 'error');
            btn.disabled = false;
        }
    }

    // ── Polling ────────────────────────────────────────────────────────────

    _startPolling() {
        this._stopPolling();
        const sec = this.pollInterval;
        if (sec <= 0) return;
        this._pollTimer = setInterval(() => this._refreshCounts(), sec * 1000);
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    _setStatus(msg, type = '') {
        const el = this.shadowRoot.getElementById('status');
        el.textContent = msg;
        el.className = `ss-status ${type}`;
    }

    _bus() {
        let el = this.parentElement;
        while (el) {
            if (el.hasAttribute('data-vault-bus')) return el;
            el = el.parentElement;
        }
        return this.parentElement || document;
    }

    _emit(eventName, detail) {
        this._bus().dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles:  true,
            composed: true,
        }));
    }
}

customElements.define('sg-vault-sync-status', SgVaultSyncStatus);
