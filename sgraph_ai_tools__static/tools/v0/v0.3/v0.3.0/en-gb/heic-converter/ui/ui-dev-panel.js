/**
 * ui-dev-panel — collapsible SgToolApi console.
 *
 * Mounts the three `components/tool-api/*` dev-only widgets in a single
 * <details> block. The widgets auto-bind to the registered tool once
 * `api.activate()` has been called (they listen for `tool:ready`).
 *
 * @module heic-converter/ui-dev-panel
 */

/**
 * Mount the dev panel into a root.
 * @param {{root: HTMLElement, api: object}} opts
 * @returns {{destroy: () => void}}
 */
export function mountDevPanel({ root }) {
    root.innerHTML = `
        <details class="hc-dev" id="hc-dev">
            <summary class="hc-dev__summary">Developer panel — SgToolApi console, explorer, manifest</summary>
            <div class="hc-dev__grid">
                <sg-tool-api-explorer></sg-tool-api-explorer>
                <sg-tool-api-console></sg-tool-api-console>
                <sg-tool-api-manifest></sg-tool-api-manifest>
            </div>
        </details>
    `;
    return {
        destroy() { root.innerHTML = ''; },
    };
}
