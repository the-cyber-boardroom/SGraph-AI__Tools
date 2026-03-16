/**
 * <vault-graph-commits> — Mermaid diagram of commit history.
 *
 * Walks the commit chain via parent links and renders a gitGraph or flowchart.
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
            </style>
            <div class="vgc-stats" id="vgc-stats"></div>
            <vault-mermaid id="vgc-mermaid"></vault-mermaid>`

        this._mermaid = this.querySelector('#vgc-mermaid')
        this._stats   = this.querySelector('#vgc-stats')
    }

    async render(startCommit, fetchFn, branchName) {
        this._stats.textContent = 'Walking commit chain…'
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
        await this._mermaid.render(markup)
        this._wireClicks()
    }

    async _walkChain(commit, maxDepth) {
        if (maxDepth <= 0) return

        // Need a stable ID for this commit — find it from tree_id or use a counter
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
        // Use the object ID if available, otherwise hash key fields
        return commit._objId || commit.tree_id || `commit-${this._commits.size}`
    }

    _buildFlowchart(branchName) {
        const lines = ['flowchart TD']
        const commits = [...this._commits.entries()]

        // Sort by timestamp (newest first)
        commits.sort((a, b) => (b[1].timestamp_ms || 0) - (a[1].timestamp_ms || 0))

        // Add branch label
        if (branchName) {
            lines.push(`    branch_label["${this._esc(branchName)}"]:::branchLabel`)
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

            const label = time ? `${msg}\\n${time}` : msg
            lines.push(`    ${safeId}["${label}"]:::commitNode`)

            // Tree link
            if (commit.tree_id) {
                const treeId = this._safe(commit.tree_id)
                lines.push(`    ${safeId} -.->|tree| ${treeId}(["${this._shortId(commit.tree_id)}"]):::treeNode`)
            }

            // Parent links
            const parents = commit.parents || (commit.parent ? [commit.parent] : [])
            for (const p of parents) {
                const parentSafe = this._safe(p)
                if (this._commits.has(p)) {
                    lines.push(`    ${safeId} -->|parent| ${parentSafe}`)
                } else {
                    // Orphan parent
                    lines.push(`    ${parentSafe}["${this._shortId(p)}\\n(not loaded)"]:::orphanNode`)
                    lines.push(`    ${safeId} -->|parent| ${parentSafe}`)
                }
            }
        }

        lines.push(`    classDef branchLabel fill:#0f3460,stroke:#4ecdc4,color:#4ecdc4,stroke-width:2px,font-weight:bold`)
        lines.push(`    classDef commitNode fill:#1a3a5c,stroke:#82aaff,color:#e0e0e0,stroke-width:1px`)
        lines.push(`    classDef treeNode fill:#16213E,stroke:#c3e88d,color:#c3e88d`)
        lines.push(`    classDef orphanNode fill:#16213E,stroke:#89ddff,color:#89ddff,stroke-dasharray:5 5`)

        return lines.join('\n')
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
                const fid = commit._fileId || `bare/data/${id}`
                return fid
            }
        }

        // Check tree refs
        for (const [, commit] of this._commits) {
            if (commit.tree_id && this._safe(commit.tree_id) === clean) {
                return `bare/data/${commit.tree_id}`
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
