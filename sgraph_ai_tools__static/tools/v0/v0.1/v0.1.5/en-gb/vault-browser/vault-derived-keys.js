/**
 * <vault-derived-keys> — Collapsible summary of derived vault key metadata.
 *
 * Shows a compact one-line summary with a toggle to expand full details.
 *
 * Methods:
 *   show(keys)  — Render the derived key info
 *   hide()      — Hide the panel entirely
 */
export class VaultDerivedKeys extends HTMLElement {

    connectedCallback() {
        this._expanded = false

        this.innerHTML = `
            <style>
                vault-derived-keys { display: block; }
                vault-derived-keys .vdk-bar {
                    display: none;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.5rem 0.75rem;
                    background: rgba(78,205,196,0.05);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    font-size: 0.8125rem;
                    font-family: var(--sg-font-mono);
                    margin-top: 0.75rem;
                    cursor: pointer;
                    user-select: none;
                }
                vault-derived-keys .vdk-bar.visible { display: flex; }
                vault-derived-keys .vdk-bar:hover {
                    background: rgba(78,205,196,0.1);
                }
                vault-derived-keys .vdk-summary {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    overflow: hidden;
                }
                vault-derived-keys .vdk-id {
                    color: var(--sg-accent);
                    font-weight: 600;
                    flex-shrink: 0;
                }
                vault-derived-keys .vdk-time {
                    color: var(--sg-text-dim);
                    font-size: 0.75rem;
                    flex-shrink: 0;
                }
                vault-derived-keys .vdk-toggle {
                    color: var(--sg-text-dim);
                    font-size: 0.75rem;
                    flex-shrink: 0;
                }
                vault-derived-keys .vdk-detail {
                    display: none;
                    padding: 0.75rem;
                    background: rgba(78,205,196,0.03);
                    border: 1px solid var(--sg-border);
                    border-top: none;
                    border-radius: 0 0 var(--sg-radius) var(--sg-radius);
                    font-size: 0.75rem;
                    font-family: var(--sg-font-mono);
                    line-height: 1.8;
                    word-break: break-all;
                }
                vault-derived-keys .vdk-detail.visible { display: block; }
                vault-derived-keys .vdk-bar.expanded {
                    border-radius: var(--sg-radius) var(--sg-radius) 0 0;
                    margin-bottom: 0;
                }
                vault-derived-keys .vdk-label {
                    color: var(--sg-text-dim);
                    font-weight: 600;
                    margin-right: 0.5rem;
                }
            </style>
            <div class="vdk-bar" id="vdk-bar">
                <div class="vdk-summary">
                    <span class="vdk-id" id="vdk-id"></span>
                    <span class="vdk-time" id="vdk-time"></span>
                </div>
                <span class="vdk-toggle" id="vdk-toggle">show keys ▾</span>
            </div>
            <div class="vdk-detail" id="vdk-detail">
                <div><span class="vdk-label">Vault ID:</span><span data-field="vaultId"></span></div>
                <div><span class="vdk-label">Write Key:</span><span data-field="writeKey"></span></div>
                <div><span class="vdk-label">Ref File ID:</span><span data-field="refFileId"></span></div>
                <div><span class="vdk-label">Index File ID:</span><span data-field="indexFileId"></span></div>
                <div><span class="vdk-label">Settings File ID:</span><span data-field="settingsFileId"></span></div>
                <div><span class="vdk-label">Derivation Time:</span><span data-field="derivationTimeMs"></span></div>
            </div>`

        this._bar    = this.querySelector('#vdk-bar')
        this._detail = this.querySelector('#vdk-detail')
        this._toggle = this.querySelector('#vdk-toggle')

        this._bar.addEventListener('click', () => this._toggleExpand())
    }

    show(keys) {
        this.querySelector('[data-field="vaultId"]').textContent        = keys.vaultId
        this.querySelector('[data-field="writeKey"]').textContent       = keys.writeKey
        this.querySelector('[data-field="refFileId"]').textContent      = keys.refFileId
        this.querySelector('[data-field="indexFileId"]').textContent    = keys.indexFileId
        this.querySelector('[data-field="settingsFileId"]').textContent = keys.settingsFileId
        this.querySelector('[data-field="derivationTimeMs"]').textContent = `${Math.round(keys.derivationTimeMs)} ms`

        this.querySelector('#vdk-id').textContent   = `vault: ${keys.vaultId}`
        this.querySelector('#vdk-time').textContent  = `derived in ${Math.round(keys.derivationTimeMs)} ms`

        this._bar.classList.add('visible')
        this._expanded = false
        this._detail.classList.remove('visible')
        this._bar.classList.remove('expanded')
        this._toggle.textContent = 'show keys \u25be'
    }

    hide() {
        this._bar.classList.remove('visible')
        this._detail.classList.remove('visible')
    }

    _toggleExpand() {
        this._expanded = !this._expanded
        this._detail.classList.toggle('visible', this._expanded)
        this._bar.classList.toggle('expanded', this._expanded)
        this._toggle.textContent = this._expanded ? 'hide keys \u25b4' : 'show keys \u25be'
    }
}

customElements.define('vault-derived-keys', VaultDerivedKeys)
