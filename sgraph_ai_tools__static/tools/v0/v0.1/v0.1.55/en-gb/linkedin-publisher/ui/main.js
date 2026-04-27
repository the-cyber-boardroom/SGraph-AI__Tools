/**
 * Entry point for the LinkedIn Publisher tool.
 *
 * Phase 0: mount the connection-probe panel. Phase 1+ will add the auth +
 * compose panels alongside this one.
 */

import { mountProbePanel } from './ui-probe-panel.js';

const panel = mountProbePanel({
    probesEl: document.getElementById('lp-probes'),
    logEl: document.getElementById('lp-log'),
    runBtn: document.getElementById('lp-run-all'),
    decisionsEl: document.getElementById('lp-decisions'),
});

// Auto-run on load so the tool is diagnostic-ready immediately.
panel.runAll();
