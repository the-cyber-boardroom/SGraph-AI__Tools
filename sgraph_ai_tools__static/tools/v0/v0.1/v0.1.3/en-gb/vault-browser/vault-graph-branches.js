/**
 * <vault-graph-branches> — Mermaid diagram of branch index relationships.
 *
 * Shows branches, their refs, keys, and creator relationships.
 *
 * Methods:
 *   render(branchIndexData)  — Generate and display the diagram
 *
 * Events emitted:
 *   vault-object-navigate  — { detail: { fileId } }
 *     Fired when the user clicks a node in the diagram.
 */
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
            </style>
            <vault-mermaid id="vgb-mermaid"></vault-mermaid>`

        this._mermaid = this.querySelector('#vgb-mermaid')
    }

    async render(data) {
        const branches = data.branches || []
        if (branches.length === 0) {
            this._mermaid.clear()
            return
        }

        const lines = [
            '%%{ init: { "flowchart": { "curve": "monotoneY", "nodeSpacing": 30, "rankSpacing": 40 } } }%%',
            'flowchart TD'
        ]

        // Index node
        const indexId = this._safe(data.index_id || 'index')
        lines.push(`    ${indexId}["Branch Index"]:::indexNode`)

        // Track branch nodes for creator links
        const branchIds = new Map()

        for (let i = 0; i < branches.length; i++) {
            const b = branches[i]
            const bid = this._safe(b.branch_id || `branch-${i}`)
            branchIds.set(b.branch_id, bid)

            const typeLabel = b.branch_type === 'named' ? 'NAMED' : 'CLONE'
            const name = b.name || '(unnamed)'

            // Branch node
            lines.push(`    ${bid}["${this._esc(name)}\\n${typeLabel}"]:::${b.branch_type === 'named' ? 'namedBranch' : 'cloneBranch'}`)
            lines.push(`    ${indexId} --> ${bid}`)

            // Ref node
            if (b.head_ref_id) {
                const refId = this._safe(b.head_ref_id)
                lines.push(`    ${refId}(("${this._shortId(b.head_ref_id)}")):::refNode`)
                lines.push(`    ${bid} -->|head_ref| ${refId}`)
            }

            // Key node
            if (b.public_key_id) {
                const keyId = this._safe(b.public_key_id)
                lines.push(`    ${keyId}["${this._shortId(b.public_key_id)}"]:::keyNode`)
                lines.push(`    ${bid} -.->|pub_key| ${keyId}`)
            }
        }

        // Creator branch links
        for (const b of branches) {
            if (b.creator_branch && branchIds.has(b.creator_branch)) {
                const from = branchIds.get(b.creator_branch)
                const to   = branchIds.get(b.branch_id)
                if (from && to) {
                    lines.push(`    ${from} ==>|created| ${to}`)
                }
            }
        }

        // Styles
        lines.push(`    classDef indexNode fill:#0f3460,stroke:#4ecdc4,color:#e0e0e0,stroke-width:2px`)
        lines.push(`    classDef namedBranch fill:#1a3a5c,stroke:#4ecdc4,color:#4ecdc4,stroke-width:2px`)
        lines.push(`    classDef cloneBranch fill:#1a3a5c,stroke:#82aaff,color:#82aaff,stroke-width:1px`)
        lines.push(`    classDef refNode fill:#16213E,stroke:#c792ea,color:#c792ea`)
        lines.push(`    classDef keyNode fill:#16213E,stroke:#f78c6c,color:#f78c6c`)

        await this._mermaid.render(lines.join('\n'))

        // Wire click handlers on nodes
        this._wireClicks(data)
    }

    _wireClicks(data) {
        requestAnimationFrame(() => {
            const svg = this._mermaid.querySelector('svg')
            if (!svg) return

            svg.classList.add('vgb-diagram')

            for (const node of svg.querySelectorAll('.node')) {
                const id = node.id || ''
                // Extract the original ID from the mermaid node ID
                const text = node.textContent || ''
                node.style.cursor = 'pointer'
                node.addEventListener('click', () => {
                    const fileId = this._nodeToFileId(id, text, data)
                    if (fileId) {
                        this.dispatchEvent(new CustomEvent('vault-object-navigate', {
                            bubbles: true,
                            detail: { fileId }
                        }))
                    }
                })
            }
        })
    }

    _nodeToFileId(nodeId, text, data) {
        // Try to match node text against known IDs
        const clean = nodeId.replace(/^flowchart-/, '').replace(/-\d+$/, '')

        if (clean.startsWith('ref-'))  return `bare/refs/${clean}`
        if (clean.startsWith('key-'))  return `bare/keys/${clean}`
        if (clean.startsWith('idx-'))  return `bare/indexes/${clean}`

        // Check if it's a branch - navigate to its ref
        for (const b of (data.branches || [])) {
            const safeBid = this._safe(b.branch_id)
            if (clean === safeBid && b.head_ref_id) {
                return `bare/refs/${b.head_ref_id}`
            }
        }

        return null
    }

    _safe(s) {
        return (s || '').replace(/[^a-zA-Z0-9_-]/g, '_')
    }

    _shortId(s) {
        if (!s) return ''
        return s.length > 18 ? s.slice(0, 16) + '...' : s
    }

    _esc(s) {
        return (s || '').replace(/"/g, "'").replace(/[<>]/g, '')
    }
}

customElements.define('vault-graph-branches', VaultGraphBranches)
