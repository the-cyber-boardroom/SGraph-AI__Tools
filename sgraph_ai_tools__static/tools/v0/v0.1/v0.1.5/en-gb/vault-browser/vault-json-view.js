/**
 * <vault-json-view> — Pretty-prints JSON with syntax colouring and vault object hyperlinks.
 *
 * Attributes:
 *   collapsed  — if present, objects/arrays start collapsed
 *
 * Methods:
 *   render(json, refFields)  — Render a parsed JSON value.
 *       refFields is an optional Set of field names whose string values are
 *       vault object references (rendered as clickable links).
 *
 * Events emitted:
 *   vault-object-navigate  — { detail: { fileId } }
 *     Fired when the user clicks a vault object reference link.
 */
import { fileIdToPath, looksLikeRef } from '/core/vault-client/v1/v1.1/v1.1.0/vault-id-utils.js'

export class VaultJsonView extends HTMLElement {

    connectedCallback() {
        this.innerHTML = `
            <style>
                vault-json-view { display: block; }
                vault-json-view .vjv-wrap {
                    background: var(--sg-bg-card);
                    border: 1px solid var(--sg-border);
                    border-radius: var(--sg-radius);
                    padding: 1rem;
                    font-family: var(--sg-font-mono);
                    font-size: 0.8125rem;
                    line-height: 1.7;
                    max-height: 600px;
                    overflow: auto;
                    white-space: pre-wrap;
                    word-break: break-word;
                }
                vault-json-view .vjv-key    { color: #82aaff; }
                vault-json-view .vjv-str    { color: #c3e88d; }
                vault-json-view .vjv-num    { color: #f78c6c; }
                vault-json-view .vjv-bool   { color: #c792ea; }
                vault-json-view .vjv-null   { color: #89ddff; font-style: italic; }
                vault-json-view .vjv-brace  { color: var(--sg-text-dim); }
                vault-json-view .vjv-ref {
                    color: var(--sg-accent, #4ecdc4);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                    cursor: pointer;
                }
                vault-json-view .vjv-ref:hover {
                    text-decoration-style: solid;
                    filter: brightness(1.2);
                }
            </style>
            <div class="vjv-wrap" id="vjv-wrap"></div>`

        this._wrap = this.querySelector('#vjv-wrap')
    }

    render(json, refFields) {
        this._refFields = refFields || new Set()
        this._wrap.innerHTML = ''
        this._wrap.appendChild(this._renderValue(json, 0, null))
    }

    _renderValue(val, depth, parentKey) {
        if (val === null)                return this._span('null', 'vjv-null')
        if (typeof val === 'boolean')    return this._span(String(val), 'vjv-bool')
        if (typeof val === 'number')     return this._span(String(val), 'vjv-num')
        if (typeof val === 'string') {
            if (parentKey && this._refFields.has(parentKey) && this._looksLikeRef(val)) {
                return this._refLink(val)
            }
            return this._span(`"${this._esc(val)}"`, 'vjv-str')
        }
        if (Array.isArray(val))  return this._renderArray(val, depth)
        if (typeof val === 'object') return this._renderObject(val, depth)
        return document.createTextNode(String(val))
    }

    _renderObject(obj, depth) {
        const frag   = document.createDocumentFragment()
        const keys   = Object.keys(obj)
        const indent = '  '.repeat(depth + 1)
        const close  = '  '.repeat(depth)

        frag.appendChild(this._span('{', 'vjv-brace'))
        frag.appendChild(document.createTextNode('\n'))

        keys.forEach((key, i) => {
            frag.appendChild(document.createTextNode(indent))
            frag.appendChild(this._span(`"${this._esc(key)}"`, 'vjv-key'))
            frag.appendChild(document.createTextNode(': '))
            frag.appendChild(this._renderValue(obj[key], depth + 1, key))
            if (i < keys.length - 1) frag.appendChild(document.createTextNode(','))
            frag.appendChild(document.createTextNode('\n'))
        })

        frag.appendChild(document.createTextNode(close))
        frag.appendChild(this._span('}', 'vjv-brace'))
        return frag
    }

    _renderArray(arr, depth) {
        const frag   = document.createDocumentFragment()
        const indent = '  '.repeat(depth + 1)
        const close  = '  '.repeat(depth)

        frag.appendChild(this._span('[', 'vjv-brace'))
        frag.appendChild(document.createTextNode('\n'))

        arr.forEach((item, i) => {
            frag.appendChild(document.createTextNode(indent))
            frag.appendChild(this._renderValue(item, depth + 1, null))
            if (i < arr.length - 1) frag.appendChild(document.createTextNode(','))
            frag.appendChild(document.createTextNode('\n'))
        })

        frag.appendChild(document.createTextNode(close))
        frag.appendChild(this._span(']', 'vjv-brace'))
        return frag
    }

    _refLink(val) {
        const a = document.createElement('span')
        a.className   = 'vjv-ref'
        a.textContent = `"${this._esc(val)}"`
        a.title       = `Navigate to ${val}`
        a.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('vault-object-navigate', {
                bubbles: true,
                detail: { fileId: this._refToFileId(val) }
            }))
        })
        return a
    }

    /** Convert a ref value to the full vault path using shared utility */
    _refToFileId(val) {
        return fileIdToPath(val)
    }

    _looksLikeRef(val) {
        return looksLikeRef(val)
    }

    _span(text, cls) {
        const s = document.createElement('span')
        s.className   = cls
        s.textContent = text
        return s
    }

    _esc(s) {
        return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    }
}

customElements.define('vault-json-view', VaultJsonView)
