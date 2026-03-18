/**
 * <vault-graph-branches> — Mermaid diagram of branch index relationships.
 *
 * Shows branches and their creator relationships in a clean vertical layout.
 * Ref and key IDs are embedded in branch nodes and shown as clickable links below.
 *
 * Styling:
 *   - Branch names: bold, prominent
 *   - Branch type (NAMED/CLONE): dim label
 *   - Ref IDs: monospace, purple tint
 *
 * Methods:
 *   render(branchIndexData)  — Generate and display the diagram
 *
 * Events emitted:
 *   vault-object-navigate  — { detail: { fileId } }
 *     Fired when the user clicks a node or link.
 */
import { fileIdToPath, shortId as _sharedShortId } from '/core/vault-client/v1/v1.1/v1.1.0/vault-id-utils.js'

export class VaultGraphBranches extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-graph-branches { display: block; }
                vault-graph-branches .vgb-diagram {
                    cursor: pointer;
                }
                vault-graph-branches .vgb-diagram .node:hover rect,
                vault-graph-branches .vgb-diagram .node:hover polygon,
                vault-graph-branches .vgb-diagram .node:hover circle {
                    filter: brightness(1.3);
                }
                vault-graph-branches .vgb-ref-links {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.25rem 0.75rem;
                    margin-top: 0.5rem;
                    font-size: 0.75rem;
                    font-family: var(--sg-font-mono);
                }
                vault-graph-branches .vgb-ref-link {
                    cursor: pointer;
                    padding: 0.15rem 0.4rem;
                    border: 1px solid rgba(255,255,255,0.15);
                    border-radius: 3px;
                    background: #16213E;
                    transition: background 0.15s, border-color 0.15s;
                }
                vault-graph-branches .vgb-ref-link:hover {
                    background: #1a3a5c;
                    border-color: rgba(255,255,255,0.4);
                }
                vault-graph-branches .vgb-ref-link .vgb-label {
                    color: var(--sg-text-dim);
                    margin-right: 0.25rem;
                }
                vault-graph-branches .vgb-ref-link .vgb-ref-val {
                    color: #c792ea;
                }
                vault-graph-branches .vgb-ref-link .vgb-key-val {
                    color: #f78c6c;
                }
            </style>
            <vault-mermaid id="vgb-mermaid"></vault-mermaid>
            <div class="vgb-ref-links" id="vgb-ref-links"></div>`

        this._mermaid  = this.querySelector('#vgb-mermaid')
        this._refLinks = this.querySelector('#vgb-ref-links')
    }

    async render(data) {
        this._data = data
        this._refLinks.innerHTML = ''
        const branches = data.branches || []
        if (branches.length === 0) {
            this._mermaid.clear()
            return
        }

        const lines = [
            '%%{ init: { "flowchart": { "curve": "monotoneY", "nodeSpacing": 40, "rankSpacing": 50 } } }%%',
            'flowchart TD'
        ]

        // Index node
        lines.push(`    IDX(["Branch Index"]):::indexNode`)

        // Track branch nodes for creator links
        const branchIds = new Map()

        // Separate named vs clone branches
        const named  = branches.filter(b => b.branch_type === 'named')
        const clones = branches.filter(b => b.branch_type !== 'named')

        // Named branches first
        for (const b of named) {
            const bid = this._safe(b.branch_id || `branch-${branchIds.size}`)
            branchIds.set(b.branch_id, bid)

            const name = this._esc(b.name || '(unnamed)')
            const refShort = b.head_ref_id ? `ref: ${this._shortId(b.head_ref_id)}` : ''
            const parts = [name, 'NAMED']
            if (refShort) parts.push(refShort)
            lines.push(`    ${bid}["${parts.join('\\n')}"]:::namedBranch`)
            lines.push(`    IDX --> ${bid}`)
        }

        // Clone branches
        for (const b of clones) {
            const bid = this._safe(b.branch_id || `branch-${branchIds.size}`)
            branchIds.set(b.branch_id, bid)

            const name = this._esc(b.name || '(unnamed)')
            const refShort = b.head_ref_id ? `ref: ${this._shortId(b.head_ref_id)}` : ''
            const parts = [name, 'CLONE']
            if (refShort) parts.push(refShort)
            lines.push(`    ${bid}["${parts.join('\\n')}"]:::cloneBranch`)
        }

        // Creator branch links (these provide the structure, no need for index→clone edges)
        for (const b of clones) {
            const to = branchIds.get(b.branch_id)
            if (b.creator_branch && branchIds.has(b.creator_branch)) {
                const from = branchIds.get(b.creator_branch)
                lines.push(`    ${from} -->|created| ${to}`)
            } else {
                // No known creator — link from index
                lines.push(`    IDX --> ${to}`)
            }
        }

        // Styles
        lines.push(`    classDef indexNode fill:#0f3460,stroke:#4ecdc4,color:#e0e0e0,stroke-width:2px,font-weight:bold`)
        lines.push(`    classDef namedBranch fill:#1a3a5c,stroke:#4ecdc4,color:#4ecdc4,stroke-width:2px`)
        lines.push(`    classDef cloneBranch fill:#1a3a5c,stroke:#82aaff,color:#82aaff,stroke-width:1px`)

        await this._mermaid.render(lines.join('\n'), { cache: true })
        this._wireClicks(data)
        this._renderRefLinks(branches)
        this._styleNodeText()
    }

    /**
     * Post-render: restyle node labels for visual hierarchy.
     * Mermaid v11 renders labels as HTML inside foreignObject:
     *   <span class="nodeLabel">Line1<br>Line2<br>Line3</span>
     * We split by <br> and wrap each segment in a styled span.
     */
    _styleNodeText() {
        requestAnimationFrame(() => {
            const svg = this._mermaid.querySelector('svg')
            if (!svg) return

            for (const label of svg.querySelectorAll('.nodeLabel')) {
                const lines = this._splitNodeLabel(label)
                if (lines.length < 2) continue  // single-line labels (index node) — skip

                label.innerHTML = lines.map((text, i) => {
                    if (i === 0) {
                        // Branch name — bold, prominent
                        return `<span style="font-weight:700;font-size:0.85rem;display:block;margin-bottom:2px">${text}</span>`
                    } else if (text === 'NAMED' || text === 'CLONE') {
                        // Type label — dim, small, uppercase
                        return `<span style="font-size:0.6rem;opacity:0.5;letter-spacing:0.08em;display:block;margin-bottom:1px">${text}</span>`
                    } else {
                        // Ref ID — purple, monospace
                        return `<span style="color:#c792ea;font-size:0.65rem;opacity:0.75;display:block">${text}</span>`
                    }
                }).join('')
            }
        })
    }

    /** Split a nodeLabel element into its text lines (handles <br> and <p> structures) */
    _splitNodeLabel(el) {
        const lines = []
        for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent.trim()
                if (text) lines.push(text)
            } else if (child.nodeName === 'BR') {
                // separator
            } else if (child.nodeName === 'P') {
                const text = child.textContent.trim()
                if (text) lines.push(text)
            }
        }
        return lines
    }

    /** Render clickable ref/key links below the diagram */
    _renderRefLinks(branches) {
        this._refLinks.innerHTML = ''

        for (const b of branches) {
            const name = b.name || '(unnamed)'

            if (b.head_ref_id) {
                const el = document.createElement('span')
                el.className = 'vgb-ref-link'
                el.innerHTML = `<span class="vgb-label">${this._esc(name)} →</span> <span class="vgb-ref-val">${this._shortId(b.head_ref_id)}</span>`
                el.title = `Open ref: ${b.head_ref_id}`
                el.addEventListener('click', () => this._navigate(fileIdToPath(b.head_ref_id)))
                this._refLinks.appendChild(el)
            }

            if (b.public_key_id) {
                const el = document.createElement('span')
                el.className = 'vgb-ref-link'
                el.innerHTML = `<span class="vgb-label">${this._esc(name)} key →</span> <span class="vgb-key-val">${this._shortId(b.public_key_id)}</span>`
                el.title = `Open key: ${b.public_key_id}`
                el.addEventListener('click', () => this._navigate(fileIdToPath(b.public_key_id)))
                this._refLinks.appendChild(el)
            }
        }
    }

    _navigate(fileId) {
        this.dispatchEvent(new CustomEvent('vault-object-navigate', {
            bubbles: true,
            detail: { fileId }
        }))
    }

    _wireClicks(data) {
        requestAnimationFrame(() => {
            const svg = this._mermaid.querySelector('svg')
            if (!svg) return

            svg.classList.add('vgb-diagram')

            for (const node of svg.querySelectorAll('.node')) {
                const id = node.id || ''
                node.style.cursor = 'pointer'
                node.addEventListener('click', () => {
                    const fileId = this._nodeToFileId(id, data)
                    if (fileId) this._navigate(fileId)
                })
            }
        })
    }

    _nodeToFileId(nodeId, data) {
        const clean = nodeId.replace(/^flowchart-/, '').replace(/-\d+$/, '')

        // Check if it's a branch — navigate to its head ref
        for (const b of (data.branches || [])) {
            const safeBid = this._safe(b.branch_id)
            if (clean === safeBid && b.head_ref_id) {
                return fileIdToPath(b.head_ref_id)
            }
        }

        // Index node — navigate to the index itself
        if (clean === 'IDX' && data.index_id) {
            return fileIdToPath(data.index_id)
        }

        return null
    }

    _safe(s) {
        return (s || '').replace(/[^a-zA-Z0-9_-]/g, '_')
    }

    _shortId(s) {
        return _sharedShortId(s, 24)
    }

    _esc(s) {
        return (s || '').replace(/"/g, "'").replace(/[<>]/g, '')
    }
}

customElements.define('vault-graph-branches', VaultGraphBranches)
