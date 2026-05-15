/**
 * ui-results — per-item results grid.
 *
 * Subscribes to the state container's `change` event and re-renders the
 * results list whenever the queue mutates.
 *
 * @module heic-converter/ui-results
 */

/** Format a byte count to "X.Y KB" / "X.Y MB" / "X B". */
function fmtBytes(n) {
    if (n === null || n === undefined) return '–';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function rowHtml(item) {
    const sizeFrom = fmtBytes(item.sizeBytes);
    const sizeTo = item.outputSize ? fmtBytes(item.outputSize) : '–';
    const ratio = (item.outputSize && item.sizeBytes)
        ? `${Math.round((item.outputSize / item.sizeBytes) * 100)}% of original`
        : '';
    const dims = (item.width && item.height) ? `${item.width}×${item.height}` : '';
    const lib = item.decodeLib ? `<span class="hc-row__lib">via ${item.decodeLib}</span>` : '';
    const thumb = item.thumbnailUrl
        ? `<img class="hc-row__thumb" alt="" src="${item.thumbnailUrl}">`
        : `<div class="hc-row__thumb hc-row__thumb--empty" aria-hidden="true">⌛</div>`;

    let actions = '';
    if (item.status === 'queued') {
        actions = `<button type="button" class="hc-btn hc-btn--small" data-action="convert" data-id="${item.id}">Convert</button>`;
    } else if (item.status === 'running') {
        actions = `<span class="hc-row__status hc-row__status--running">Converting…</span>`;
    } else if (item.status === 'done') {
        actions = `<button type="button" class="hc-btn hc-btn--small hc-btn--primary" data-action="download" data-id="${item.id}">Download</button>`;
    } else if (item.status === 'error') {
        actions = `<span class="hc-row__status hc-row__status--err" title="${item.error || ''}">Error</span>
                   <button type="button" class="hc-btn hc-btn--small" data-action="convert" data-id="${item.id}">Retry</button>`;
    }

    return `
        <div class="hc-row hc-row--${item.status}" data-id="${item.id}">
            ${thumb}
            <div class="hc-row__meta">
                <div class="hc-row__name" title="${item.name}">${item.name}</div>
                <div class="hc-row__details">
                    <span>${sizeFrom} → ${sizeTo}</span>
                    ${ratio ? `<span class="hc-row__ratio">${ratio}</span>` : ''}
                    ${dims ? `<span>${dims}</span>` : ''}
                    ${lib}
                </div>
                ${item.error ? `<div class="hc-row__error">${item.error}</div>` : ''}
            </div>
            <div class="hc-row__actions">
                ${actions}
                <button type="button" class="hc-btn hc-btn--ghost hc-btn--small" data-action="remove" data-id="${item.id}" title="Remove">✕</button>
            </div>
        </div>
    `;
}

/**
 * Mount the results panel.
 * @param {{root: HTMLElement, state: object, api: object}} opts
 * @returns {{destroy: () => void}}
 */
export function mountResults({ root, state, api }) {
    root.innerHTML = `
        <h2 class="hc-panel__title">
            Queue <span class="hc-panel__count" id="hc-count">0</span>
        </h2>
        <div class="hc-empty" id="hc-empty">No files yet — drop some HEIC files above to get started.</div>
        <div class="hc-rows" id="hc-rows"></div>
    `;

    const rowsEl = root.querySelector('#hc-rows');
    const emptyEl = root.querySelector('#hc-empty');
    const countEl = root.querySelector('#hc-count');

    function render() {
        const items = state.getItems();
        countEl.textContent = String(items.length);
        if (items.length === 0) {
            rowsEl.innerHTML = '';
            emptyEl.style.display = '';
            return;
        }
        emptyEl.style.display = 'none';
        rowsEl.innerHTML = items.map(rowHtml).join('');
    }

    async function onClick(e) {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.getAttribute('data-id');
        const action = btn.getAttribute('data-action');
        if (action === 'convert') {
            try { await api.convertOne({ id }); }
            catch (err) { console.error('[hc] convertOne', err); }
        } else if (action === 'download') {
            try { await api.downloadOne({ id }); }
            catch (err) { console.error('[hc] downloadOne', err); }
        } else if (action === 'remove') {
            state.removeItem(id);
        }
    }

    rowsEl.addEventListener('click', onClick);
    state.addEventListener('change', render);
    render();

    return {
        destroy() {
            rowsEl.removeEventListener('click', onClick);
            state.removeEventListener('change', render);
        },
    };
}
