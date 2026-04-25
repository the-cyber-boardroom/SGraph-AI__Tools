/** ui-shell.js — stub placeholder; Agent 4 replaces with full UI. */

/** Mount the editor shell into a host element. */
export function mountShell({ host }) {
    if (!host) return;
    host.innerHTML = `
        <div style="padding:2rem;font-family:system-ui">
            <h2 style="margin-top:0">SG Video Editor</h2>
            <p>Tool scaffolding loaded. UI shell pending (Agent 4).</p>
        </div>
    `;
}
