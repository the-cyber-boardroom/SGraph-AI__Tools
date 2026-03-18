/**
 * <vault-schema-branch-index> — Renders branch_index_v1 objects.
 *
 * Shows the branch list with clickable refs and keys.
 */
import { registerSchemaViewer } from './vault-schema-registry.js'
import { fileIdToPath } from '/core/vault-client/v1/v1.1/v1.1.0/vault-id-utils.js'

export class VaultSchemaBranchIndex extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-schema-branch-index { display: block; }
                vault-schema-branch-index .vsbi-section {
                    margin-bottom: 1.25rem;
                }
                vault-schema-branch-index .vsbi-label {
                    font-size: 0.75rem;
                    color: var(--sg-text-dim);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 0.25rem;
                }
                vault-schema-branch-index .vsbi-value {
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                }
                vault-schema-branch-index .vsbi-branch {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 0.75rem 1rem;
                    margin-bottom: 0.5rem;
                }
                vault-schema-branch-index .vsbi-branch-name {
                    font-weight: 600;
                    font-size: 0.9375rem;
                    margin-bottom: 0.5rem;
                }
                vault-schema-branch-index .vsbi-branch-type {
                    display: inline-block;
                    font-size: 0.6875rem;
                    padding: 0.125rem 0.5rem;
                    border-radius: 9999px;
                    margin-left: 0.5rem;
                    font-weight: 500;
                }
                vault-schema-branch-index .vsbi-type-named  { background: rgba(78,205,196,0.15); color: var(--sg-accent); }
                vault-schema-branch-index .vsbi-type-clone   { background: rgba(130,170,255,0.15); color: #82aaff; }
                vault-schema-branch-index .vsbi-row {
                    display: flex;
                    gap: 0.5rem;
                    margin-top: 0.25rem;
                    font-size: 0.8125rem;
                    font-family: var(--sg-font-mono);
                }
                vault-schema-branch-index .vsbi-row-label {
                    color: var(--sg-text-dim);
                    min-width: 110px;
                    flex-shrink: 0;
                }
                vault-schema-branch-index .vsbi-ref {
                    color: var(--sg-accent, #4ecdc4);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                    cursor: pointer;
                }
                vault-schema-branch-index .vsbi-ref:hover {
                    text-decoration-style: solid;
                    filter: brightness(1.2);
                }
            </style>
            <div id="vsbi-root"></div>`

        this._root = this.querySelector('#vsbi-root')
    }

    render(data) {
        this._root.innerHTML = ''

        // Header info
        this._addSection('Schema', data.schema || 'branch_index_v1')
        this._addSection('Index ID', data.index_id || '—')

        // Branches
        const header = document.createElement('div')
        header.className = 'vsbi-label'
        header.textContent = `BRANCHES (${(data.branches || []).length})`
        header.style.marginTop = '1rem'
        this._root.appendChild(header)

        for (const branch of (data.branches || [])) {
            this._root.appendChild(this._renderBranch(branch))
        }
    }

    _renderBranch(b) {
        const card = document.createElement('div')
        card.className = 'vsbi-branch'

        const typeClass = b.branch_type === 'named' ? 'vsbi-type-named' : 'vsbi-type-clone'
        card.innerHTML = `<div class="vsbi-branch-name">${this._esc(b.name || '(unnamed)')}<span class="vsbi-branch-type ${typeClass}">${this._esc(b.branch_type || '?')}</span></div>`

        const fields = [
            ['branch_id',      b.branch_id,       false],
            ['head_ref_id',    b.head_ref_id,      true],
            ['public_key_id',  b.public_key_id,    true],
            ['private_key_id', b.private_key_id,    true],
            ['creator_branch', b.creator_branch,    false],
            ['created_at',     b.created_at ? new Date(b.created_at).toISOString() : null, false],
        ]

        for (const [label, value, isRef] of fields) {
            if (value === null || value === undefined) continue
            const row = document.createElement('div')
            row.className = 'vsbi-row'
            row.innerHTML = `<span class="vsbi-row-label">${label}</span>`
            if (isRef) {
                const link = this._refLink(value)
                row.appendChild(link)
            } else {
                const span = document.createElement('span')
                span.textContent = value
                row.appendChild(span)
            }
            card.appendChild(row)
        }

        return card
    }

    _addSection(label, value) {
        const section = document.createElement('div')
        section.className = 'vsbi-section'
        section.innerHTML = `<div class="vsbi-label">${label}</div><div class="vsbi-value">${this._esc(String(value))}</div>`
        this._root.appendChild(section)
    }

    _refLink(val) {
        const a = document.createElement('span')
        a.className   = 'vsbi-ref'
        a.textContent = val
        a.title       = `Navigate to ${val}`
        a.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('vault-object-navigate', {
                bubbles: true,
                detail: { fileId: this._refToFileId(val) }
            }))
        })
        return a
    }

    _refToFileId(val) {
        return fileIdToPath(val)
    }

    _esc(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    }
}

customElements.define('vault-schema-branch-index', VaultSchemaBranchIndex)
registerSchemaViewer('branch_index_v1', 'vault-schema-branch-index')
