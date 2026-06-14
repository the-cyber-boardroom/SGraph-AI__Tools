/**
 * ui-dev-panel — collapsible SgToolApi console.
 *
 * Mounts the three `components/tool-api/*` dev-only widgets in a single
 * <details> block. They auto-bind to the registered tool once activate() has
 * been called (they listen for tool:ready).
 *
 * @module audio-transcribe/ui-dev-panel
 */

/**
 * Mount the dev panel.
 * @param {{ root: HTMLElement }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountDevPanel({ root }) {
    root.innerHTML = `
        <details class="at-dev" id="at-dev">
            <summary class="at-dev__summary">Developer panel — SgToolApi console, explorer, manifest</summary>
            <div class="at-dev__grid">
                <sg-tool-api-explorer></sg-tool-api-explorer>
                <sg-tool-api-console></sg-tool-api-console>
                <sg-tool-api-manifest></sg-tool-api-manifest>
            </div>
        </details>
    `;
    return { destroy() { root.innerHTML = ''; } };
}
