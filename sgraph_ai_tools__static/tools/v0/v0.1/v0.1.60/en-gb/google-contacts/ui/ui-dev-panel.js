/**
 * ui-dev-panel — collapsible SgToolApi console.
 *
 * Mounts the three tool-api dev components in a single <details> block.
 * They auto-bind to the registered tool once api.activate() fires
 * `tool:ready`.
 *
 * @module google-contacts/ui-dev-panel
 */

export function mountDevPanel({ root }) {
    root.innerHTML = `
        <details class="gc-dev" id="gc-dev">
            <summary class="gc-dev__summary">Developer panel — SgToolApi console, explorer, manifest</summary>
            <div class="gc-dev__grid">
                <sg-tool-api-explorer></sg-tool-api-explorer>
                <sg-tool-api-console></sg-tool-api-console>
                <sg-tool-api-manifest></sg-tool-api-manifest>
            </div>
        </details>
    `;
    return { destroy() { root.innerHTML = ''; } };
}
