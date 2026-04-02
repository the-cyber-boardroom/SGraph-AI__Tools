/**
 * sg-git-graph — Interactive branch and commit graph visualiser.
 *
 * Renders a git-style commit graph entirely with inline SVG — no external
 * dependencies, no build step. Suitable for visualising SGit vault histories,
 * LLM conversation branches, IFD component version trees, or any directed
 * acyclic graph with branches and merges.
 *
 * Phase 1: Static JSON data source.
 * Phase 2 (future): Live SGit vault connection via structure key.
 * Phase 3 (future): Programmatic API for real-time LLM thread visualisation.
 *
 * ## Data Format
 *
 * ```js
 * {
 *   "branches": [
 *     { "id": "main",      "label": "main",      "color": "#7c9ef8" },
 *     { "id": "exp-a",     "label": "experiment-a", "color": "#4ade80" }
 *   ],
 *   "commits": [
 *     { "id": "c1", "branch": "main",  "message": "Initial commit",    "author": "dinis", "timestamp": "2026-03-01T10:00:00Z", "parents": [] },
 *     { "id": "c2", "branch": "main",  "message": "Add context blocks", "author": "dinis", "timestamp": "2026-03-02T11:00:00Z", "parents": ["c1"] },
 *     { "id": "c3", "branch": "exp-a", "message": "Try approach A",     "author": "claude","timestamp": "2026-03-02T12:00:00Z", "parents": ["c2"], "branchPoint": true },
 *     { "id": "c4", "branch": "main",  "message": "Merge exp-a",        "author": "dinis", "timestamp": "2026-03-03T09:00:00Z", "parents": ["c2","c3"], "merge": true },
 *     { "id": "c5", "branch": "exp-b", "message": "Try approach B",     "author": "claude","timestamp": "2026-03-02T14:00:00Z", "parents": ["c2"], "abandoned": true }
 *   ]
 * }
 * ```
 *
 * ## Usage
 *
 * ```html
 * <!-- Inline data via attribute -->
 * <sg-git-graph graph='{"branches":[...],"commits":[...]}'></sg-git-graph>
 *
 * <!-- Programmatic -->
 * <sg-git-graph></sg-git-graph>
 * <script>
 *   document.querySelector('sg-git-graph').setGraph(data);
 * </script>
 * ```
 *
 * ## Interactions
 *
 * - Click a commit node → emit `sg-git-graph:commit-selected { commit }` + show detail panel
 * - Hover a commit → show tooltip with message + author + timestamp
 *
 * ## Public API
 *
 * ```js
 * graph.setGraph(data)         // Load graph from JS object
 * graph.loadUrl(url)           // Fetch JSON from URL and load
 * graph.getSelected()          // Returns currently selected commit or null
 * graph.clearSelection()       // Deselect
 * ```
 *
 * ## Emits
 *
 * - `sg-git-graph:commit-selected` — `{ commit }` — bubbles, composed
 * - `sg-git-graph:commit-deselected` — `{}` — bubbles, composed
 *
 * @module sg-git-graph
 * @version 0.1.0
 */

// Default branch colours (cycled when branch has no explicit color)
const BRANCH_COLOURS = [
    '#7c9ef8', '#4ade80', '#f472b6', '#fb923c',
    '#a78bfa', '#34d399', '#fbbf24', '#60a5fa',
];

const COMMIT_R   = 7;    // commit node radius
const COL_W      = 28;   // horizontal spacing between branch lanes
const ROW_H      = 44;   // vertical spacing between commits
const PADDING    = 16;   // SVG outer padding

const CSS = `
:host {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: system-ui, sans-serif;
}
* { box-sizing: border-box; }

.gg-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0a0a18;
    color: #e2e8f0;
    overflow: hidden;
}

/* ── Toolbar ─────────────────────────────────────────────── */
.gg-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid #1a1f35;
    flex-shrink: 0;
}
.gg-title {
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    flex: 1;
}
.gg-branch-legend {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}
.gg-legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #64748b;
}
.gg-legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

/* ── Graph + Detail split ────────────────────────────────── */
.gg-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

/* ── Graph scroll area ───────────────────────────────────── */
.gg-graph-wrap {
    flex: 1;
    overflow: auto;
    scrollbar-width: thin;
    scrollbar-color: #222d4d transparent;
    padding: 8px;
}
svg.gg-svg {
    display: block;
    overflow: visible;
}

/* ── Commit nodes ────────────────────────────────────────── */
.gg-node {
    cursor: pointer;
    transition: r 0.1s;
}
.gg-node:hover circle {
    r: 9;
    filter: brightness(1.3);
}
.gg-node.selected circle {
    r: 9;
    stroke: #fff;
    stroke-width: 2;
}
.gg-node.abandoned circle {
    opacity: 0.4;
}
.gg-commit-label {
    font-size: 11px;
    fill: #94a3b8;
    dominant-baseline: middle;
    pointer-events: none;
    white-space: nowrap;
}
.gg-commit-label.abandoned { fill: #374151; }

/* ── Edge lines ──────────────────────────────────────────── */
.gg-edge {
    fill: none;
    stroke-width: 1.5;
    stroke-linecap: round;
}
.gg-edge.abandoned {
    stroke-dasharray: 4 3;
    opacity: 0.35;
}

/* ── Tooltip ─────────────────────────────────────────────── */
.gg-tooltip {
    position: absolute;
    background: #1a1f35;
    border: 1px solid #2d3060;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 11px;
    color: #e2e8f0;
    pointer-events: none;
    z-index: 100;
    max-width: 240px;
    display: none;
    white-space: pre-line;
    line-height: 1.5;
}

/* ── Detail panel ────────────────────────────────────────── */
.gg-detail {
    width: 220px;
    flex-shrink: 0;
    border-left: 1px solid #1a1f35;
    overflow-y: auto;
    padding: 12px;
    scrollbar-width: thin;
    font-size: 11px;
}
.gg-detail.empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1e2035;
}
.gg-detail-title {
    font-size: 10px;
    font-weight: 600;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 10px;
}
.gg-detail-field { margin-bottom: 8px; }
.gg-detail-label {
    font-size: 9px;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 2px;
}
.gg-detail-value {
    color: #94a3b8;
    word-break: break-word;
    line-height: 1.5;
}
.gg-detail-value.message { color: #e2e8f0; font-size: 12px; }
.gg-detail-value.id { font-family: monospace; font-size: 10px; color: #64748b; }
.gg-detail-value.branch { font-family: monospace; }
.gg-detail-tag {
    display: inline-block;
    font-size: 9px;
    font-family: monospace;
    padding: 1px 5px;
    border-radius: 3px;
    margin-top: 4px;
    background: #12122a;
    border: 1px solid #2d3060;
    color: #7c9ef8;
}
.gg-detail-tag.merge    { color: #a78bfa; border-color: #5b21b6; }
.gg-detail-tag.abandoned { color: #f87171; border-color: #7f1d1d; }

/* ── Empty state ─────────────────────────────────────────── */
.gg-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1e2035;
    font-size: 12px;
}
`;

export class SgGitGraph extends HTMLElement {

    constructor() {
        super();
        this._graph    = null;   // { branches, commits }
        this._selected = null;   // selected commit id
        this._layout   = null;   // computed layout { nodes, edges }
        this._shadow   = this.attachShadow({ mode: 'open' });
    }

    static get observedAttributes() { return ['graph']; }

    attributeChangedCallback(name, _old, val) {
        if (name === 'graph' && val) {
            try { this.setGraph(JSON.parse(val)); } catch(e) {
                console.error('[sg-git-graph] Invalid graph JSON:', e);
            }
        }
    }

    connectedCallback() {
        this._render();
        if (this.hasAttribute('graph')) {
            try { this.setGraph(JSON.parse(this.getAttribute('graph'))); } catch(e) {}
        }
    }

    // ── Public API ─────────────────────────────────────────────────────────

    /**
     * Load and render a graph from a JS object.
     * @param {{ branches: Array, commits: Array }} data
     */
    setGraph(data) {
        this._graph    = data;
        this._selected = null;
        this._layout   = _computeLayout(data);
        this._renderGraph();
        this._renderDetail(null);
    }

    /**
     * Fetch JSON from a URL and load it.
     * @param {string} url
     * @returns {Promise<void>}
     */
    async loadUrl(url) {
        const res  = await fetch(url);
        const data = await res.json();
        this.setGraph(data);
    }

    /**
     * Returns the currently selected commit, or null.
     * @returns {Object|null}
     */
    getSelected() {
        if (!this._selected || !this._graph) return null;
        return this._graph.commits.find(c => c.id === this._selected) ?? null;
    }

    /** Deselect the current commit. */
    clearSelection() {
        this._selected = null;
        this._updateSelection();
        this._renderDetail(null);
        this.dispatchEvent(new CustomEvent('sg-git-graph:commit-deselected', {
            detail: {}, bubbles: true, composed: true,
        }));
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    _render() {
        this._shadow.innerHTML = `
        <style>${CSS}</style>
        <div class="gg-root" part="root">
            <div class="gg-toolbar">
                <span class="gg-title" id="gg-title">Commit Graph</span>
                <div class="gg-branch-legend" id="gg-legend"></div>
            </div>
            <div class="gg-body">
                <div class="gg-graph-wrap" id="gg-graph-wrap">
                    <div class="gg-empty">No graph data — call setGraph() or set the graph attribute</div>
                </div>
                <div class="gg-detail empty" id="gg-detail">
                    <span>Select a commit</span>
                </div>
            </div>
            <div class="gg-tooltip" id="gg-tooltip"></div>
        </div>`;
    }

    _renderGraph() {
        if (!this._layout) return;
        const { nodes, edges, branchMap, width, height } = this._layout;

        // Branch legend
        const legend = this._shadow.querySelector('#gg-legend');
        legend.innerHTML = '';
        for (const [id, br] of branchMap) {
            const item  = document.createElement('div');
            item.className = 'gg-legend-item';
            item.innerHTML = `<div class="gg-legend-dot" style="background:${br.color}"></div>${_esc(br.label)}`;
            legend.appendChild(item);
        }

        const svgW = width  + PADDING * 2;
        const svgH = height + PADDING * 2;

        // Build SVG
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'gg-svg');
        svg.setAttribute('width',  String(svgW));
        svg.setAttribute('height', String(svgH));
        svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

        // Draw edges first (behind nodes)
        const edgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        edgeG.setAttribute('class', 'gg-edges');
        for (const edge of edges) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', `gg-edge${edge.abandoned ? ' abandoned' : ''}`);
            path.setAttribute('stroke', edge.color);
            path.setAttribute('d', _curvePath(edge.x1, edge.y1, edge.x2, edge.y2));
            edgeG.appendChild(path);
        }
        svg.appendChild(edgeG);

        // Draw nodes
        const nodeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        nodeG.setAttribute('class', 'gg-nodes');
        for (const node of nodes) {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', `gg-node${node.abandoned ? ' abandoned' : ''}`);
            g.setAttribute('data-id', node.commit.id);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx',   String(node.x));
            circle.setAttribute('cy',   String(node.y));
            circle.setAttribute('r',    String(COMMIT_R));
            circle.setAttribute('fill', node.color);
            if (node.commit.merge) {
                circle.setAttribute('stroke', '#fff');
                circle.setAttribute('stroke-width', '1.5');
            }
            g.appendChild(circle);

            // Commit message label (truncated)
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('class', `gg-commit-label${node.abandoned ? ' abandoned' : ''}`);
            text.setAttribute('x',  String(node.x + COMMIT_R + 6));
            text.setAttribute('y',  String(node.y));
            text.textContent = _truncate(node.commit.message, 36);
            g.appendChild(text);

            // Interaction
            g.addEventListener('click',      () => this._selectCommit(node.commit));
            g.addEventListener('mouseenter', (e) => this._showTooltip(e, node.commit));
            g.addEventListener('mouseleave', ()  => this._hideTooltip());

            nodeG.appendChild(g);
        }
        svg.appendChild(nodeG);

        const wrap = this._shadow.querySelector('#gg-graph-wrap');
        wrap.innerHTML = '';
        wrap.appendChild(svg);
    }

    _renderDetail(commit) {
        const el = this._shadow.querySelector('#gg-detail');
        if (!commit) {
            el.className = 'gg-detail empty';
            el.innerHTML = '<span>Select a commit</span>';
            return;
        }
        el.className = 'gg-detail';

        const tags = [];
        if (commit.merge)     tags.push('<span class="gg-detail-tag merge">merge</span>');
        if (commit.abandoned) tags.push('<span class="gg-detail-tag abandoned">abandoned</span>');
        if (commit.branchPoint) tags.push('<span class="gg-detail-tag">branch point</span>');

        const ts = commit.timestamp ? new Date(commit.timestamp).toLocaleString() : '—';

        el.innerHTML = `
            <div class="gg-detail-title">Commit</div>
            <div class="gg-detail-field">
                <div class="gg-detail-label">Message</div>
                <div class="gg-detail-value message">${_esc(commit.message)}</div>
                ${tags.join('')}
            </div>
            <div class="gg-detail-field">
                <div class="gg-detail-label">Branch</div>
                <div class="gg-detail-value branch">${_esc(commit.branch)}</div>
            </div>
            <div class="gg-detail-field">
                <div class="gg-detail-label">Author</div>
                <div class="gg-detail-value">${_esc(commit.author || '—')}</div>
            </div>
            <div class="gg-detail-field">
                <div class="gg-detail-label">Time</div>
                <div class="gg-detail-value">${_esc(ts)}</div>
            </div>
            <div class="gg-detail-field">
                <div class="gg-detail-label">ID</div>
                <div class="gg-detail-value id">${_esc(commit.id)}</div>
            </div>
            ${commit.parents?.length ? `
            <div class="gg-detail-field">
                <div class="gg-detail-label">Parents</div>
                <div class="gg-detail-value id">${commit.parents.map(_esc).join(', ')}</div>
            </div>` : ''}`;
    }

    _selectCommit(commit) {
        this._selected = commit.id;
        this._updateSelection();
        this._renderDetail(commit);
        this.dispatchEvent(new CustomEvent('sg-git-graph:commit-selected', {
            detail: { commit: { ...commit } },
            bubbles: true, composed: true,
        }));
    }

    _updateSelection() {
        const nodes = this._shadow.querySelectorAll('.gg-node');
        for (const n of nodes) {
            n.classList.toggle('selected', n.dataset.id === this._selected);
        }
    }

    _showTooltip(e, commit) {
        const tip = this._shadow.querySelector('#gg-tooltip');
        if (!tip) return;
        const ts  = commit.timestamp ? new Date(commit.timestamp).toLocaleString() : '';
        tip.textContent = `${commit.message}${commit.author ? '\n' + commit.author : ''}${ts ? '\n' + ts : ''}`;
        tip.style.display = 'block';

        // Position relative to root
        const root  = this._shadow.querySelector('.gg-root');
        const rootR = root.getBoundingClientRect();
        tip.style.left = `${e.clientX - rootR.left + 12}px`;
        tip.style.top  = `${e.clientY - rootR.top  + 12}px`;
    }

    _hideTooltip() {
        const tip = this._shadow.querySelector('#gg-tooltip');
        if (tip) tip.style.display = 'none';
    }
}

customElements.define('sg-git-graph', SgGitGraph);
window.SgGitGraph = SgGitGraph;

// ── Layout computation ──────────────────────────────────────────────────────

/**
 * Compute x/y positions for all commits and edges.
 *
 * Algorithm:
 *  1. Assign each commit a row (time-ordered by topological sort of parents)
 *  2. Assign each branch a lane (column)
 *  3. Edges connect parent → child, using curved paths for cross-lane connections
 *
 * @param {{ branches: Array, commits: Array }} data
 * @returns {{ nodes, edges, branchMap, width, height }}
 */
function _computeLayout(data) {
    const { branches = [], commits = [] } = data;

    // Build branch colour map
    const branchMap = new Map();
    branches.forEach((br, i) => {
        branchMap.set(br.id, {
            ...br,
            color: br.color || BRANCH_COLOURS[i % BRANCH_COLOURS.length],
        });
    });

    // Assign colours to any branches not in the branches array
    const seenBranches = new Set(branches.map(b => b.id));
    let colourIdx = branches.length;
    for (const c of commits) {
        if (!seenBranches.has(c.branch)) {
            seenBranches.add(c.branch);
            branchMap.set(c.branch, {
                id:    c.branch,
                label: c.branch,
                color: BRANCH_COLOURS[colourIdx++ % BRANCH_COLOURS.length],
            });
        }
    }

    // Topological sort (Kahn's algorithm)
    const commitMap   = new Map(commits.map(c => [c.id, c]));
    const inDegree    = new Map(commits.map(c => [c.id, 0]));
    const children    = new Map(commits.map(c => [c.id, []]));

    for (const c of commits) {
        for (const p of c.parents ?? []) {
            inDegree.set(c.id, (inDegree.get(c.id) || 0) + 1);
            if (children.has(p)) children.get(p).push(c.id);
        }
    }

    const queue  = commits.filter(c => (c.parents ?? []).length === 0).map(c => c.id);
    const sorted = [];
    while (queue.length) {
        const id = queue.shift();
        sorted.push(id);
        for (const childId of children.get(id) ?? []) {
            const deg = (inDegree.get(childId) || 1) - 1;
            inDegree.set(childId, deg);
            if (deg === 0) queue.push(childId);
        }
    }

    // Assign lane (column) per branch — main/first branch gets lane 0
    const laneMap = new Map();
    let   nextLane = 0;
    for (const id of sorted) {
        const c = commitMap.get(id);
        if (!c) continue;
        if (!laneMap.has(c.branch)) laneMap.set(c.branch, nextLane++);
    }

    // Compute node positions
    const nodes = sorted.map((id, rowIdx) => {
        const c    = commitMap.get(id);
        if (!c) return null;
        const lane = laneMap.get(c.branch) ?? 0;
        const br   = branchMap.get(c.branch) ?? { color: BRANCH_COLOURS[0] };
        return {
            commit:    c,
            row:       rowIdx,
            lane,
            x:         PADDING + lane * COL_W,
            y:         PADDING + rowIdx * ROW_H,
            color:     br.color,
            abandoned: !!c.abandoned,
        };
    }).filter(Boolean);

    const nodeById = new Map(nodes.map(n => [n.commit.id, n]));

    // Compute edges
    const edges = [];
    for (const node of nodes) {
        for (const parentId of node.commit.parents ?? []) {
            const pNode = nodeById.get(parentId);
            if (!pNode) continue;
            edges.push({
                x1:       pNode.x,
                y1:       pNode.y,
                x2:       node.x,
                y2:       node.y,
                color:    node.color,
                abandoned: node.abandoned,
            });
        }
    }

    // SVG dimensions
    const maxLane = Math.max(0, ...laneMap.values());
    const width   = maxLane * COL_W + 240; // room for labels
    const height  = (sorted.length - 1) * ROW_H;

    return { nodes, edges, branchMap, width, height };
}

// ── SVG helpers ─────────────────────────────────────────────────────────────

/**
 * Generate a smooth cubic bezier path between two points.
 * Curves horizontally for cross-lane edges.
 */
function _curvePath(x1, y1, x2, y2) {
    if (x1 === x2) {
        // Same lane — straight vertical line
        return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    // Cross-lane — cubic bezier curving away from origin
    const cy1 = y1 + ROW_H * 0.5;
    const cy2 = y2 - ROW_H * 0.5;
    return `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`;
}

/**
 * Truncate a string to maxLen characters.
 * @param {string} s
 * @param {number} maxLen
 * @returns {string}
 */
function _truncate(s, maxLen) {
    if (!s) return '';
    return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

/**
 * Escape HTML special characters.
 * @param {string} s
 * @returns {string}
 */
function _esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
