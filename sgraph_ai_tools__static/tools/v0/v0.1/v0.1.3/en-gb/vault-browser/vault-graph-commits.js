/**
 * <vault-graph-commits> — Mermaid diagram of commit history.
 *
 * Walks the commit chain via parent links and renders a clean vertical flowchart.
 * Tree IDs are shown inline within commit nodes (not as separate nodes) to avoid
 * edge crossings and visual clutter.
 *
 * Styling:
 *   - Commit messages: bold, bright text
 *   - Timestamps: dim, smaller
 *   - Tree refs: monospace, green tint
 *   - Merge commits: distinct border style
 *
 * Methods:
 *   render(startCommit, fetchFn, branchName)
 *     startCommit — parsed commit object to start from
 *     fetchFn(fileId) — async function that returns parsed JSON for a vault object
 *     branchName — optional branch name label
 *
 * Events emitted:
 *   vault-object-navigate  — { detail: { fileId } }
 */
export class VaultGraphCommits extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-graph-commits { display: block; }
                vault-graph-commits .vgc-stats {
                    font-size: 0.75rem;
                    color: var(--sg-text-dim);
                    margin-bottom: 0.5rem;
                    font-family: var(--sg-font-mono);
                }

                /* ── Node text styling ─────────────────────────────── */
                /* First line = commit message (bold, bright) */
                vault-graph-commits .node .nodeLabel span[class=""] tspan:first-child,
                vault-graph-commits .node .label foreignObject div span tspan:first-child,
                vault-graph-commits .commitNode .nodeLabel tspan:first-child,
                vault-graph-commits .node foreignObject div tspan:first-child {
                    font-weight: 600;
                }
                /* Target tspan elements inside nodes for visual hierarchy */
                vault-graph-commits .node .nodeLabel {
                    line-height: 1.4;
                }

                /* ── Tree links below diagram ────────────────────── */
                vault-graph-commits .vgc-tree-links {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.25rem 0.75rem;
                    margin-top: 0.5rem;
                    font-size: 0.75rem;
                    font-family: var(--sg-font-mono);
                }
                vault-graph-commits .vgc-tree-link {
                    color: #c3e88d;
                    cursor: pointer;
                    padding: 0.15rem 0.4rem;
                    border: 1px solid #c3e88d44;
                    border-radius: 3px;
                    background: #16213E;
                    transition: background 0.15s;
                }
                vault-graph-commits .vgc-tree-link:hover {
                    background: #1a3a5c;
                    border-color: #c3e88d;
                }
                vault-graph-commits .vgc-tree-link .vgc-tree-label {
                    color: var(--sg-text-dim);
                    margin-right: 0.25rem;
                }
            </style>
            <div class="vgc-stats" id="vgc-stats"></div>
            <vault-mermaid id="vgc-mermaid"></vault-mermaid>
            <div class="vgc-tree-links" id="vgc-tree-links"></div>`

        this._mermaid   = this.querySelector('#vgc-mermaid')
        this._stats     = this.querySelector('#vgc-stats')
        this._treeLinks = this.querySelector('#vgc-tree-links')
    }

    async render(startCommit, fetchFn, branchName) {
        this._stats.textContent = 'Walking commit chain…'
        this._treeLinks.innerHTML = ''
        this._commits = new Map()  // objId -> commit data
        this._fetchFn = fetchFn

        // Walk the chain (BFS, max depth to avoid infinite loops)
        await this._walkChain(startCommit, 50)

        const count = this._commits.size
        this._stats.textContent = `${count} commit(s) loaded`

        if (count === 0) {
            this._mermaid.clear()
            return
        }

        // Build the diagram
        const markup = this._buildFlowchart(branchName)
        await this._mermaid.render(markup, { cache: true })
        this._wireClicks()
        this._renderTreeLinks()
        this._styleNodeText()
    }

    async _walkChain(commit, maxDepth) {
        if (maxDepth <= 0) return

        const commitId = this._commitId(commit)
        if (this._commits.has(commitId)) return
        this._commits.set(commitId, commit)

        // Walk parents
        const parents = commit.parents || (commit.parent ? [commit.parent] : [])
        for (const parentRef of parents) {
            const fileId = parentRef.startsWith('bare/') ? parentRef : `bare/data/${parentRef}`
            try {
                const parentCommit = await this._fetchFn(fileId)
                if (parentCommit && (parentCommit.schema === 'commit_v1' || parentCommit.tree_id)) {
                    parentCommit._fileId = fileId
                    parentCommit._objId  = parentRef
                    await this._walkChain(parentCommit, maxDepth - 1)
                }
            } catch {
                // Parent not found — orphan or truncated history
            }
        }
    }

    _commitId(commit) {
        return commit._objId || commit.tree_id || `commit-${this._commits.size}`
    }

    _buildFlowchart(branchName) {
        const lines = [
            '%%{ init: { "flowchart": { "curve": "monotoneY", "nodeSpacing": 30, "rankSpacing": 40 } } }%%',
            'flowchart TD'
        ]
        const commits = [...this._commits.entries()]

        // Sort by timestamp (newest first)
        commits.sort((a, b) => (b[1].timestamp_ms || 0) - (a[1].timestamp_ms || 0))

        // Add branch label
        if (branchName) {
            lines.push(`    branch_label(["${this._esc(branchName)}"]):::branchLabel`)
            if (commits.length > 0) {
                lines.push(`    branch_label --> ${this._safe(commits[0][0])}`)
            }
        }

        for (const [id, commit] of commits) {
            const safeId = this._safe(id)
            const msg    = this._truncMsg(commit.message || '(no message)')
            const time   = commit.timestamp_ms
                ? new Date(commit.timestamp_ms).toISOString().slice(0, 16).replace('T', ' ')
                : ''
            const treeTag = commit.tree_id ? `tree: ${this._shortId(commit.tree_id)}` : ''

            // Build multi-line label: message, timestamp, tree ref
            const parts = [msg]
            if (time) parts.push(time)
            if (treeTag) parts.push(treeTag)

            const label = parts.join('\\n')

            // Merge commits get a distinct style
            const parents = commit.parents || (commit.parent ? [commit.parent] : [])
            const isMerge = parents.length > 1
            const cls = isMerge ? 'mergeNode' : 'commitNode'
            lines.push(`    ${safeId}["${label}"]:::${cls}`)

            // Parent links — only draw edges, no separate tree nodes
            for (const p of parents) {
                const parentSafe = this._safe(p)
                if (this._commits.has(p)) {
                    lines.push(`    ${safeId} --> ${parentSafe}`)
                } else {
                    lines.push(`    ${parentSafe}["${this._shortId(p)}\\n(not loaded)"]:::orphanNode`)
                    lines.push(`    ${safeId} --> ${parentSafe}`)
                }
            }
        }

        lines.push(`    classDef branchLabel fill:#0f3460,stroke:#4ecdc4,color:#4ecdc4,stroke-width:2px,font-weight:bold`)
        lines.push(`    classDef commitNode fill:#1a3a5c,stroke:#82aaff,color:#e0e0e0,stroke-width:1px`)
        lines.push(`    classDef mergeNode fill:#1a3a5c,stroke:#c792ea,color:#e0e0e0,stroke-width:2px,stroke-dasharray:4 2`)
        lines.push(`    classDef orphanNode fill:#16213E,stroke:#89ddff,color:#89ddff,stroke-dasharray:5 5`)

        return lines.join('\n')
    }

    /**
     * Post-render: style individual tspan lines inside SVG nodes.
     * Line 1 = message (bold, bright), Line 2 = timestamp (dim), Line 3 = tree (green)
     */
    _styleNodeText() {
        requestAnimationFrame(() => {
            const svg = this._mermaid.querySelector('svg')
            if (!svg) return

            for (const node of svg.querySelectorAll('.node')) {
                const tspans = node.querySelectorAll('tspan')
                if (tspans.length >= 1) {
                    // Message line — bold, bright
                    tspans[0].style.fontWeight = '600'
                    tspans[0].style.fill = '#e0e0e0'
                    tspans[0].style.fontSize = '0.85rem'
                }
                if (tspans.length >= 2) {
                    // Timestamp line — dim, smaller
                    tspans[1].style.fontWeight = '400'
                    tspans[1].style.fill = '#82aaff'
                    tspans[1].style.fontSize = '0.7rem'
                    tspans[1].style.opacity = '0.8'
                }
                if (tspans.length >= 3) {
                    // Tree ref line — green, mono
                    tspans[2].style.fontWeight = '400'
                    tspans[2].style.fill = '#c3e88d'
                    tspans[2].style.fontSize = '0.65rem'
                    tspans[2].style.opacity = '0.7'
                }
            }
        })
    }

    /** Render clickable tree links below the diagram */
    _renderTreeLinks() {
        this._treeLinks.innerHTML = ''
        const commits = [...this._commits.entries()]
        commits.sort((a, b) => (b[1].timestamp_ms || 0) - (a[1].timestamp_ms || 0))

        for (const [, commit] of commits) {
            if (!commit.tree_id) continue
            const msg = this._truncMsg(commit.message || '(no message)')
            const el  = document.createElement('span')
            el.className = 'vgc-tree-link'
            el.innerHTML = `<span class="vgc-tree-label">${msg} →</span> ${this._shortId(commit.tree_id)}`
            el.title = `Open tree: ${commit.tree_id}`
            el.addEventListener('click', () => {
                this.dispatchEvent(new CustomEvent('vault-object-navigate', {
                    bubbles: true,
                    detail: { fileId: `bare/data/${commit.tree_id}` }
                }))
            })
            this._treeLinks.appendChild(el)
        }
    }

    _wireClicks() {
        requestAnimationFrame(() => {
            const svg = this._mermaid.querySelector('svg')
            if (!svg) return

            for (const node of svg.querySelectorAll('.node')) {
                node.style.cursor = 'pointer'
                node.addEventListener('click', () => {
                    const fileId = this._resolveNodeClick(node.id)
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

    _resolveNodeClick(nodeId) {
        const clean = (nodeId || '').replace(/^flowchart-/, '').replace(/-\d+$/, '')

        // Check if it matches a commit
        for (const [id, commit] of this._commits) {
            if (this._safe(id) === clean) {
                return commit._fileId || `bare/data/${id}`
            }
        }

        if (clean.startsWith('obj_') || clean.startsWith('obj-')) {
            return `bare/data/${clean.replace(/_/g, '-')}`
        }

        return null
    }

    _safe(s) {
        return (s || '').replace(/[^a-zA-Z0-9]/g, '_')
    }

    _shortId(s) {
        if (!s) return ''
        return s.length > 16 ? s.slice(0, 14) + '..' : s
    }

    _truncMsg(msg) {
        const first = msg.split('\n')[0]
        return this._esc(first.length > 40 ? first.slice(0, 38) + '..' : first)
    }

    _esc(s) {
        return (s || '').replace(/"/g, "'").replace(/[<>]/g, '').replace(/[#]/g, '')
    }
}

customElements.define('vault-graph-commits', VaultGraphCommits)
