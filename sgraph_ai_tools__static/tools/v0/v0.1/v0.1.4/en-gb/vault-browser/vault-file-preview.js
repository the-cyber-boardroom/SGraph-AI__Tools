/**
 * <vault-file-preview> — Displays decrypted file content with Schema/Graph/Raw tabs.
 *
 * Methods:
 *   showFile(name, data, preDecryptedJson)  — Display file content (data = ArrayBuffer, optional pre-decrypted JSON)
 *   setFetchFn(fn)              — Set async fetch function for graph traversal: fn(fileId) => parsed JSON
 *   hide()                      — Close the preview
 */
import { detectSchema, getSchemaViewer } from './schema/vault-schema-registry.js'

const GRAPH_SCHEMAS = new Set(['branch_index_v1', 'commit_v1', 'ref_v1'])

export class VaultFilePreview extends HTMLElement {

    connectedCallback() {
        this._fileData   = null
        this._fileName   = null
        this._parsedJson = null
        this._fetchFn    = null

        this.innerHTML = `
            <style>
                vault-file-preview { display: none; }
                vault-file-preview.visible { display: block; }

                vault-file-preview .vfp-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 0.5rem;
                }
                vault-file-preview .vfp-title {
                    font-size: 0.9375rem;
                    font-weight: 600;
                    word-break: break-all;
                }
                vault-file-preview .vfp-size {
                    color: var(--sg-text-dim);
                    font-size: 0.75rem;
                    font-family: var(--sg-font-mono);
                    margin-left: 1rem;
                    white-space: nowrap;
                }

                /* Tabs */
                vault-file-preview .vfp-tabs {
                    display: flex;
                    gap: 0;
                    margin-bottom: 0.75rem;
                    border-bottom: 1px solid var(--sg-border);
                }
                vault-file-preview .vfp-tab {
                    padding: 0.5rem 1rem;
                    font-size: 0.8125rem;
                    font-weight: 500;
                    cursor: pointer;
                    border: 1px solid transparent;
                    border-bottom: none;
                    border-radius: var(--sg-radius) var(--sg-radius) 0 0;
                    color: var(--sg-text-dim);
                    background: none;
                    transition: color 0.15s, background 0.15s;
                }
                vault-file-preview .vfp-tab:hover {
                    color: var(--sg-text);
                    background: rgba(78,205,196,0.05);
                }
                vault-file-preview .vfp-tab.active {
                    color: var(--sg-accent);
                    border-color: var(--sg-border);
                    background: var(--sg-bg-card);
                    margin-bottom: -1px;
                }

                vault-file-preview .vfp-tab-panel {
                    display: none;
                }
                vault-file-preview .vfp-tab-panel.active {
                    display: block;
                }

                /* Schema panel */
                vault-file-preview .vfp-schema-wrap {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 1rem;
                    max-height: 600px;
                    overflow: auto;
                }
                vault-file-preview .vfp-schema-badge {
                    display: inline-block;
                    font-size: 0.6875rem;
                    padding: 0.125rem 0.5rem;
                    border-radius: 9999px;
                    background: rgba(78,205,196,0.15);
                    color: var(--sg-accent);
                    font-family: var(--sg-font-mono);
                    margin-bottom: 0.75rem;
                }

                /* Plain content fallback */
                vault-file-preview .vfp-content {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 1rem;
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                    line-height: 1.6;
                    max-height: 600px;
                    overflow: auto;
                    white-space: pre-wrap;
                    word-break: break-word;
                }

                vault-file-preview .vfp-actions {
                    margin-top: 0.75rem;
                    display: flex;
                    gap: 0.5rem;
                }
            </style>
            <div class="vfp-header">
                <span class="vfp-title" id="vfp-title"></span>
                <span class="vfp-size"  id="vfp-size"></span>
            </div>
            <div class="vfp-tabs" id="vfp-tabs" style="display:none;">
                <button class="vfp-tab active" data-tab="schema">Schema</button>
                <button class="vfp-tab"        data-tab="graph" id="vfp-tab-graph" style="display:none;">Graph</button>
                <button class="vfp-tab"        data-tab="raw">Raw</button>
            </div>
            <div class="vfp-tab-panel active" id="vfp-panel-schema">
                <div class="vfp-schema-wrap" id="vfp-schema-wrap"></div>
            </div>
            <div class="vfp-tab-panel" id="vfp-panel-graph">
                <div id="vfp-graph-container"></div>
            </div>
            <div class="vfp-tab-panel" id="vfp-panel-raw">
                <div id="vfp-raw-container"></div>
            </div>
            <div class="vfp-tab-panel" id="vfp-panel-plain">
                <div class="vfp-content" id="vfp-content"></div>
            </div>
            <div class="vfp-actions">
                <button class="btn btn--secondary" id="vfp-download">Download</button>
                <button class="btn btn--secondary" id="vfp-close">Close</button>
            </div>`

        this._tabs           = this.querySelector('#vfp-tabs')
        this._schemaWrap     = this.querySelector('#vfp-schema-wrap')
        this._graphContainer = this.querySelector('#vfp-graph-container')
        this._graphTab       = this.querySelector('#vfp-tab-graph')
        this._rawContainer   = this.querySelector('#vfp-raw-container')
        this._content        = this.querySelector('#vfp-content')

        for (const btn of this.querySelectorAll('.vfp-tab')) {
            btn.addEventListener('click', () => this._switchTab(btn.dataset.tab))
        }

        this.querySelector('#vfp-download').addEventListener('click', () => this._download())
        this.querySelector('#vfp-close').addEventListener('click', () => this.hide())
    }

    showFile(name, data, preDecryptedJson) {
        this._fileData   = data
        this._fileName   = name
        this._parsedJson = preDecryptedJson || null

        this.querySelector('#vfp-title').textContent = name
        this.querySelector('#vfp-size').textContent  = this._formatBytes(data.byteLength)

        const bytes = new Uint8Array(data)

        // Use pre-decrypted JSON if available, otherwise try to parse
        if (!this._parsedJson && this._isText(name, bytes)) {
            const text = new TextDecoder().decode(data)
            try {
                this._parsedJson = JSON.parse(text)
            } catch {
                this._parsedJson = null
            }
        }

        if (this._parsedJson !== null) {
            this._renderJsonViews(this._parsedJson)
        } else if (this._isText(name, bytes)) {
            this._showPlainText(new TextDecoder().decode(data))
        } else if (this._isImage(name)) {
            this._showImage(data, name)
        } else {
            this._showPlainText(`[Binary file — ${this._formatBytes(data.byteLength)}]\nClick "Download" to save.`)
        }

        this.classList.add('visible')
    }

    setFetchFn(fn) {
        this._fetchFn = fn
    }

    _renderJsonViews(json) {
        // --- Schema view ---
        const schemaId = detectSchema(json)
        const viewerTag = schemaId ? getSchemaViewer(schemaId) : null

        this._schemaWrap.innerHTML = ''

        if (viewerTag) {
            const badge = document.createElement('div')
            badge.className = 'vfp-schema-badge'
            badge.textContent = schemaId
            this._schemaWrap.appendChild(badge)

            const viewer = document.createElement(viewerTag)
            this._schemaWrap.appendChild(viewer)
            requestAnimationFrame(() => viewer.render(json))

            this._tabs.style.display = ''
            this._switchTab('schema')
        } else {
            // No schema viewer — jump straight to raw
            this._tabs.style.display = ''
            this._switchTab('raw')
        }

        // --- Graph view (for graph-capable schemas) ---
        this._graphContainer.innerHTML = ''
        if (GRAPH_SCHEMAS.has(schemaId) && this._fetchFn) {
            this._graphTab.style.display = ''
            this._prepareGraph(schemaId, json)
        } else {
            this._graphTab.style.display = 'none'
        }

        // --- Raw JSON view ---
        this._rawContainer.innerHTML = ''
        const jsonView = document.createElement('vault-json-view')
        this._rawContainer.appendChild(jsonView)

        const refFields = this._refFieldsForSchema()
        requestAnimationFrame(() => jsonView.render(json, refFields))
    }

    _prepareGraph(schemaId, json) {
        // Lazy-render: only build graph when tab is clicked
        this._pendingGraph = { schemaId, json, rendered: false }
    }

    async _renderGraph() {
        if (!this._pendingGraph || this._pendingGraph.rendered) return
        this._pendingGraph.rendered = true

        const { schemaId, json } = this._pendingGraph

        if (schemaId === 'branch_index_v1') {
            const graph = document.createElement('vault-graph-branches')
            this._graphContainer.appendChild(graph)
            requestAnimationFrame(() => graph.render(json))

        } else if (schemaId === 'commit_v1') {
            const graph = document.createElement('vault-graph-commits')
            this._graphContainer.appendChild(graph)
            // Walk the commit chain using the fetch function
            requestAnimationFrame(() =>
                graph.render(json, this._fetchFn, json.branch_id || 'commit')
            )

        } else if (schemaId === 'ref_v1' && json.commit_id) {
            // For a ref, load the commit first, then show its graph
            try {
                const { fileIdToPath } = await import('/core/vault-client/v1/v1.1/v1.1.0/vault-id-utils.js')
                const fileId = fileIdToPath(json.commit_id)
                const commit = await this._fetchFn(fileId)
                if (commit) {
                    commit._objId  = json.commit_id
                    commit._fileId = fileId
                    const graph = document.createElement('vault-graph-commits')
                    this._graphContainer.appendChild(graph)
                    graph.render(commit, this._fetchFn, 'ref')
                }
            } catch {
                this._graphContainer.textContent = 'Failed to load commit for graph.'
            }
        }
    }

    _showPlainText(text) {
        this._tabs.style.display = 'none'
        this._content.textContent = text
        this.querySelector('#vfp-panel-plain').classList.add('active')
        this.querySelector('#vfp-panel-schema').classList.remove('active')
        this.querySelector('#vfp-panel-raw').classList.remove('active')
    }

    _showImage(data, name) {
        this._tabs.style.display = 'none'
        const blob = new Blob([data], { type: this._mimeType(name) })
        const url  = URL.createObjectURL(blob)
        this._content.innerHTML = `<img src="${url}" style="max-width:100%;border-radius:4px;" alt="${this._esc(name)}">`
        this.querySelector('#vfp-panel-plain').classList.add('active')
        this.querySelector('#vfp-panel-schema').classList.remove('active')
        this.querySelector('#vfp-panel-raw').classList.remove('active')
    }

    _switchTab(tab) {
        for (const btn of this.querySelectorAll('.vfp-tab')) {
            btn.classList.toggle('active', btn.dataset.tab === tab)
        }
        this.querySelector('#vfp-panel-schema').classList.toggle('active', tab === 'schema')
        this.querySelector('#vfp-panel-graph').classList.toggle('active', tab === 'graph')
        this.querySelector('#vfp-panel-raw').classList.toggle('active', tab === 'raw')
        this.querySelector('#vfp-panel-plain').classList.toggle('active', tab === 'plain')

        // Lazy-render graph on first tab switch
        if (tab === 'graph') {
            this._renderGraph()
        }
    }

    hide() {
        this.classList.remove('visible')
        this._fileData   = null
        this._fileName   = null
        this._parsedJson = null
    }

    _download() {
        if (!this._fileData || !this._fileName) return
        const blob = new Blob([this._fileData])
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = this._fileName
        a.click()
        URL.revokeObjectURL(url)
    }

    _refFieldsForSchema() {
        return new Set([
            'tree_id', 'parent', 'commit_id', 'blob_id',
            'head_ref_id', 'public_key_id', 'private_key_id',
            'author_key_id', 'branch_id', 'creator_branch',
            'index_id', 'creator_key'
        ])
    }

    _formatBytes(n) {
        if (n < 1024) return `${n} B`
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
        return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }

    _isText(name, bytes) {
        const exts = ['.txt','.md','.json','.js','.py','.html','.css','.xml','.csv','.yaml','.yml','.toml','.ini','.cfg','.sh','.bat','.log','.rst','.env']
        if (exts.some(ext => name.toLowerCase().endsWith(ext))) return true
        if (bytes.length > 0 && bytes.length < 500_000) {
            const sample = bytes.slice(0, Math.min(512, bytes.length))
            return sample.every(b => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 128)
        }
        return false
    }

    _isImage(name) {
        return /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(name)
    }

    _mimeType(name) {
        const ext = name.split('.').pop().toLowerCase()
        const map = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp', ico:'image/x-icon' }
        return map[ext] || 'application/octet-stream'
    }

    _esc(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    }
}

customElements.define('vault-file-preview', VaultFilePreview)
