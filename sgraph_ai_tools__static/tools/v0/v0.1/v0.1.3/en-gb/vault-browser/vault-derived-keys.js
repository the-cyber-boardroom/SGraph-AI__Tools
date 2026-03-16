/**
 * <vault-derived-keys> — Displays derived vault key metadata.
 *
 * Methods:
 *   show(keys)  — Render the derived key info (keys object from deriveVaultKeys)
 *   hide()      — Hide the panel
 */
export class VaultDerivedKeys extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-derived-keys { display: block; }
                vault-derived-keys .vdk-panel {
                    display: none;
                    margin-top: 1rem;
                    padding: 1rem;
                    background: rgba(78,205,196,0.05);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    font-size: 0.75rem;
                    font-family: var(--sg-font-mono);
                    line-height: 1.8;
                    word-break: break-all;
                }
                vault-derived-keys .vdk-panel.visible { display: block; }
                vault-derived-keys .vdk-label {
                    color: var(--sg-text-dim);
                    font-weight: 600;
                    margin-right: 0.5rem;
                }
            </style>
            <div class="vdk-panel" id="vdk-panel">
                <div><span class="vdk-label">Vault ID:</span><span data-field="vaultId"></span></div>
                <div><span class="vdk-label">Write Key:</span><span data-field="writeKey"></span></div>
                <div><span class="vdk-label">Tree File ID:</span><span data-field="treeFileId"></span></div>
                <div><span class="vdk-label">Settings File ID:</span><span data-field="settingsFileId"></span></div>
                <div><span class="vdk-label">Ref File ID:</span><span data-field="refFileId"></span></div>
                <div><span class="vdk-label">Derivation Time:</span><span data-field="derivationTimeMs"></span></div>
            </div>`

        this._panel = this.querySelector('#vdk-panel')
    }

    show(keys) {
        this.querySelector('[data-field="vaultId"]').textContent        = keys.vaultId
        this.querySelector('[data-field="writeKey"]').textContent       = keys.writeKey
        this.querySelector('[data-field="treeFileId"]').textContent     = keys.treeFileId
        this.querySelector('[data-field="settingsFileId"]').textContent = keys.settingsFileId
        this.querySelector('[data-field="refFileId"]').textContent      = keys.refFileId
        this.querySelector('[data-field="derivationTimeMs"]').textContent = `${Math.round(keys.derivationTimeMs)} ms`
        this._panel.classList.add('visible')
    }

    hide() {
        this._panel.classList.remove('visible')
    }
}

customElements.define('vault-derived-keys', VaultDerivedKeys)
