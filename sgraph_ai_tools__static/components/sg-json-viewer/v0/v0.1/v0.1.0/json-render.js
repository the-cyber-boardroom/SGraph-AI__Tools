/**
 * json-render.js — pure render of a JS value into a DocumentFragment.
 * @module sg-json-viewer/json-render
 */

/**
 * Build a colour-coded span for a primitive value.
 * @param {string} cls
 * @param {string} text
 * @returns {HTMLSpanElement}
 */
function span(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
}

/**
 * Render a primitive (string/number/boolean/null/undefined) as a span.
 * @param {*} value
 * @returns {HTMLSpanElement}
 */
function renderPrim(value) {
    if (value === null) return span('jv-null', 'null');
    if (value === undefined) return span('jv-null', 'undefined');
    const t = typeof value;
    if (t === 'string') return span('jv-string', JSON.stringify(value));
    if (t === 'number') return span('jv-number', String(value));
    if (t === 'boolean') return span('jv-bool', String(value));
    return span('jv-other', String(value));
}

/**
 * Render a key-value row inside an object/array <details>.
 * @param {string|null} key Object key, or array index as string, or null for top-level item.
 * @param {*} value
 * @param {{depth: number, expandedDepth: number}} opts
 * @returns {HTMLElement}
 */
function renderRow(key, value, opts) {
    const row = document.createElement('div');
    row.className = 'jv-row';
    if (key !== null) {
        const k = span('jv-key', JSON.stringify(key));
        row.appendChild(k);
        row.appendChild(span('jv-colon', ': '));
    }
    if (value && typeof value === 'object') {
        row.appendChild(renderJson(value, { ...opts, depth: opts.depth + 1 }));
    } else {
        row.appendChild(renderPrim(value));
    }
    return row;
}

/**
 * Render a value as a DocumentFragment. Objects/arrays use collapsible <details>.
 * @param {*} value
 * @param {{ expandedDepth?: number, depth?: number }} [opts]
 * @returns {DocumentFragment|HTMLElement}
 */
export function renderJson(value, opts = {}) {
    const depth = opts.depth || 0;
    const expandedDepth = Number.isFinite(opts.expandedDepth) ? opts.expandedDepth : 2;
    if (value === null || typeof value !== 'object') {
        const frag = document.createDocumentFragment();
        frag.appendChild(renderPrim(value));
        return frag;
    }
    const isArr = Array.isArray(value);
    const open = isArr ? '[' : '{';
    const close = isArr ? ']' : '}';
    const entries = isArr ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    const det = document.createElement('details');
    det.className = 'jv-block';
    if (depth < expandedDepth) det.open = true;
    const sum = document.createElement('summary');
    sum.appendChild(span('jv-bracket', open));
    const count = span('jv-count', ` ${entries.length} ${entries.length === 1 ? 'item' : 'items'} `);
    sum.appendChild(count);
    sum.appendChild(span('jv-bracket', close));
    det.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'jv-body';
    for (const [k, v] of entries) {
        body.appendChild(renderRow(isArr ? null : k, v, { depth, expandedDepth }));
    }
    det.appendChild(body);
    return det;
}
