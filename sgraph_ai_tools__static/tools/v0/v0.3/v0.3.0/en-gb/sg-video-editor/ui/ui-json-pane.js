/** ui-json-pane.js — mount a <sg-json-viewer> bound to project state changes. */

/**
 * Mount the JSON viewer pane.
 * @param {{host: HTMLElement, state: object}} opts
 * @returns {{destroy: () => void}}
 */
export function mountJsonPane({ host, state }) {
    if (!host) return { destroy() {} };
    host.innerHTML = '<sg-json-viewer></sg-json-viewer>';
    const viewer = host.querySelector('sg-json-viewer');

    function refresh() {
        if (!viewer) return;
        try { viewer.setData(state.getProject()); }
        catch (_) { viewer.setData(null); }
    }

    function onChange(e) {
        if (e && e.detail && e.detail.transient) return;
        refresh();
    }

    state.addEventListener('change', onChange);
    refresh();

    return {
        destroy() {
            try { state.removeEventListener('change', onChange); } catch (_) {}
            host.innerHTML = '';
        },
    };
}
