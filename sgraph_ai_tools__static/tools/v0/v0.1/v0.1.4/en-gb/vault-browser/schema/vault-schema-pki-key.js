/**
 * <vault-schema-pki-key> — Renders PKI public key objects.
 *
 * Shows label, fingerprints, and PEM-encoded key data.
 */
import { registerSchemaViewer } from './vault-schema-registry.js'

export class VaultSchemaPkiKey extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-schema-pki-key { display: block; }
                vault-schema-pki-key .vspk-section {
                    margin-bottom: 1rem;
                }
                vault-schema-pki-key .vspk-label {
                    font-size: 0.75rem;
                    color: var(--sg-text-dim);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 0.25rem;
                }
                vault-schema-pki-key .vspk-value {
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                    word-break: break-all;
                }
                vault-schema-pki-key .vspk-pem {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 0.75rem 1rem;
                    font-family: var(--sg-font-mono);
                    font-size: 0.75rem;
                    line-height: 1.5;
                    white-space: pre-wrap;
                    word-break: break-all;
                    max-height: 200px;
                    overflow-y: auto;
                }
            </style>
            <div id="vspk-root"></div>`

        this._root = this.querySelector('#vspk-root')
    }

    render(data) {
        this._root.innerHTML = ''

        this._addTextRow('Label', data.label)
        this._addTextRow('Fingerprint', data.fingerprint)
        this._addTextRow('Signing Fingerprint', data.signing_fingerprint)

        if (data.public_key_pem) {
            this._addPemRow('Public Key (PEM)', data.public_key_pem)
        }
        if (data.signing_key_pem) {
            this._addPemRow('Signing Key (PEM)', data.signing_key_pem)
        }
    }

    _addTextRow(label, value) {
        if (value === null || value === undefined) return
        const section = document.createElement('div')
        section.className = 'vspk-section'
        const lbl = document.createElement('div')
        lbl.className = 'vspk-label'
        lbl.textContent = label
        section.appendChild(lbl)
        const val = document.createElement('div')
        val.className = 'vspk-value'
        val.textContent = String(value)
        section.appendChild(val)
        this._root.appendChild(section)
    }

    _addPemRow(label, pem) {
        const section = document.createElement('div')
        section.className = 'vspk-section'
        const lbl = document.createElement('div')
        lbl.className = 'vspk-label'
        lbl.textContent = label
        section.appendChild(lbl)
        const pre = document.createElement('div')
        pre.className = 'vspk-pem'
        pre.textContent = pem
        section.appendChild(pre)
        this._root.appendChild(section)
    }
}

customElements.define('vault-schema-pki-key', VaultSchemaPkiKey)
registerSchemaViewer('pki_public_key', 'vault-schema-pki-key')
