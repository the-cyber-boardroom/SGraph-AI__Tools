/**
 * sg-vault-commit-log — Commit history viewer for vault sessions.
 *
 * Walks the commit chain from the current HEAD and displays a scrollable
 * list of commits with decrypted messages, timestamps, and parent links.
 * Auto-refreshes after vault:file-saved events.
 *
 * Bus events consumed:
 *   vault:connected    — { session }
 *   vault:disconnected — {}
 *   vault:file-saved   — {} (triggers refresh)
 *   vault:sync-pulled  — {} (triggers refresh)
 *
 * @module sg-vault-commit-log
 * @version 0.1.0
 */

import { cachedFetchJson, cachedFetch } from '/core/vault-cache/v1/v1.0/v1.0.0/sg-vault-cache.js';
import { decryptMetadata } from '/core/vault-client/v1/v1.2/v1.2.1/sg-vault-client.js';

export class SgVaultCommitLog extends HTMLElement {

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._session  = null;
        this._handlers = {};
        this._commits  = [];
    }

    static MAX_COMMITS = 50;

    connectedCallback() {
        this._render();
        this._bindBusEvents();
    }

    disconnectedCallback() {
        const bus = this._bus();
        for (const [evt, fn] of Object.entries(this._handlers)) {
            bus.removeEventListener(evt, fn);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _render() {
        this.shadowRoot.innerHTML = `
<style>
  :host { display: block; font-family: inherit; height: 100%; overflow: hidden; }
  .cl-panel {
      height: 100%;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--sg-border, #2a3a5c);
      border-radius: var(--sg-radius, 6px);
      background: var(--sg-bg-secondary, #16213e);
      overflow: hidden;
  }
  .cl-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--sg-border, #2a3a5c);
      flex-shrink: 0;
  }
  .cl-title {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--sg-text-muted, #8892b0);
  }
  .cl-count {
      font-size: 0.7rem;
      color: var(--sg-text-muted, #8892b0);
  }
  .cl-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 0.375rem 0;
  }
  .cl-empty {
      padding: 1rem 0.75rem;
      font-size: 0.8rem;
      color: var(--sg-text-muted, #8892b0);
      text-align: center;
  }
  .cl-loading {
      padding: 0.75rem;
      font-size: 0.8rem;
      color: var(--sg-text-muted, #8892b0);
      display: flex;
      align-items: center;
      gap: 0.5rem;
  }
  .spinner {
      flex-shrink: 0;
      width: 12px; height: 12px;
      border: 2px solid var(--sg-border, #2a3a5c);
      border-top-color: var(--sg-accent, #4ecdc4);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .cl-commit {
      padding: 0.4rem 0.75rem;
      border-bottom: 1px solid rgba(42,58,92,0.3);
      font-size: 0.8rem;
  }
  .cl-commit:last-child { border-bottom: none; }
  .cl-commit:hover { background: rgba(78,205,196,0.04); }
  .cl-commit-msg {
      color: var(--sg-text, #ccd6f6);
      margin-bottom: 0.15rem;
      word-break: break-word;
  }
  .cl-commit-meta {
      font-size: 0.7rem;
      color: var(--sg-text-muted, #8892b0);
      display: flex;
      gap: 0.75rem;
  }
  .cl-commit-id {
      font-family: monospace;
      font-size: 0.65rem;
      color: #64748b;
  }
  .cl-head-badge {
      display: inline-block;
      font-size: 0.6rem;
      padding: 0 0.3rem;
      border-radius: 3px;
      font-weight: 600;
      vertical-align: middle;
      margin-left: 0.3rem;
  }
  .cl-head-local {
      background: rgba(78,205,196,0.15);
      color: var(--sg-accent, #4ecdc4);
  }
  .cl-head-remote {
      background: rgba(251,191,36,0.15);
      color: #fbbf24;
  }
</style>

<div class="cl-panel">
  <div class="cl-header">
    <span class="cl-title">Commits</span>
    <span class="cl-count" id="count"></span>
  </div>
  <div class="cl-scroll" id="scroll">
    <div class="cl-empty">Connect to a vault to view commits.</div>
  </div>
</div>
`;
    }

    // ── Bus ────────────────────────────────────────────────────────────────

    _bindBusEvents() {
        const bus = this._bus();
        const on = (evt, fn) => {
            const bound = fn.bind(this);
            this._handlers[evt] = bound;
            bus.addEventListener(evt, bound);
        };
        on('vault:connected',    (e) => { this._session = e.detail.session; this._loadCommits(); });
        on('vault:disconnected', ()  => { this._session = null; this._showEmpty('Connect to a vault to view commits.'); });
        on('vault:file-saved',   ()  => { if (this._session) this._loadCommits(); });
        on('vault:sync-pulled',  ()  => { if (this._session) this._loadCommits(); });
    }

    // ── Load commits ───────────────────────────────────────────────────────

    async _loadCommits() {
        const scroll = this.shadowRoot.getElementById('scroll');
        scroll.innerHTML = '<div class="cl-loading"><div class="spinner"></div>Loading commits…</div>';

        const { apiBaseUrl, vaultId, keys } = this._session;
        const headId  = this._session.headCommitId;
        const namedId = this._session.namedHeadId;

        if (!headId) {
            this._showEmpty('No commits yet.');
            return;
        }

        const commits = [];
        let cursor = headId;

        try {
            while (cursor && commits.length < SgVaultCommitLog.MAX_COMMITS) {
                const commit = await cachedFetchJson(apiBaseUrl, vaultId, cursor, keys.readKey);

                let message = '[encrypted]';
                if (commit.message_enc) {
                    try {
                        message = await decryptMetadata(keys.readKey, commit.message_enc);
                    } catch { /* keep placeholder */ }
                } else if (commit.message) {
                    message = commit.message;
                }

                commits.push({
                    id: cursor,
                    message,
                    timestamp: commit.timestamp_ms || commit.timestamp || null,
                    treeId: commit.tree_id || commit.treeId || null,
                    parents: commit.parents || [],
                    isHead: cursor === headId,
                    isNamed: cursor === namedId,
                });

                cursor = (commit.parents && commit.parents[0]) || null;
            }

            this._commits = commits;
            this._renderCommits();
        } catch (err) {
            scroll.innerHTML = `<div class="cl-empty" style="color:var(--sg-error,#e94560)">Error: ${_esc(err.message)}</div>`;
        }
    }

    _renderCommits() {
        const scroll = this.shadowRoot.getElementById('scroll');
        const count  = this.shadowRoot.getElementById('count');
        scroll.innerHTML = '';

        if (this._commits.length === 0) {
            this._showEmpty('No commits yet.');
            return;
        }

        count.textContent = `${this._commits.length} commit${this._commits.length === 1 ? '' : 's'}`;

        for (const c of this._commits) {
            const div = document.createElement('div');
            div.className = 'cl-commit';

            const msgDiv = document.createElement('div');
            msgDiv.className = 'cl-commit-msg';
            msgDiv.textContent = c.message;

            if (c.isHead && c.isNamed) {
                msgDiv.insertAdjacentHTML('beforeend',
                    ' <span class="cl-head-badge cl-head-local">HEAD</span>');
            } else {
                if (c.isHead) {
                    msgDiv.insertAdjacentHTML('beforeend',
                        ' <span class="cl-head-badge cl-head-local">LOCAL</span>');
                }
                if (c.isNamed) {
                    msgDiv.insertAdjacentHTML('beforeend',
                        ' <span class="cl-head-badge cl-head-remote">REMOTE</span>');
                }
            }

            const metaDiv = document.createElement('div');
            metaDiv.className = 'cl-commit-meta';

            if (c.timestamp) {
                const time = document.createElement('span');
                time.textContent = _formatTime(c.timestamp);
                metaDiv.appendChild(time);
            }

            const idSpan = document.createElement('span');
            idSpan.className = 'cl-commit-id';
            idSpan.textContent = c.id.slice(0, 20) + '…';
            idSpan.title = c.id;
            metaDiv.appendChild(idSpan);

            div.append(msgDiv, metaDiv);
            scroll.appendChild(div);
        }
    }

    _showEmpty(msg) {
        const scroll = this.shadowRoot.getElementById('scroll');
        scroll.innerHTML = `<div class="cl-empty">${_esc(msg)}</div>`;
        this.shadowRoot.getElementById('count').textContent = '';
    }

    // ── Helpers ────────────────────────────────────────────────────────────

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
            bubbles: true,
            composed: true,
        }));
    }
}

customElements.define('sg-vault-commit-log', SgVaultCommitLog);

function _esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _formatTime(ms) {
    try {
        const d = new Date(ms);
        const now = Date.now();
        const diff = now - ms;
        if (diff < 60_000) return 'just now';
        if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
        if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return '';
    }
}
