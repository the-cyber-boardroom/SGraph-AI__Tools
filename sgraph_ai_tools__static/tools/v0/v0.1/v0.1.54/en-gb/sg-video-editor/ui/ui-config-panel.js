/** ui-config-panel.js — Config + Debug tab for the right-hand panel. */

import { editorConfig } from './editor-config.js';
import { initMemoryProbe, setLogLevel } from './debug/memory-probe.js';

const FEATURE_TOGGLES = [
    {
        key: 'previewEnabled',
        label: 'Preview / Composer',
        desc: 'Rebuild composer on every state change. Disable first when diagnosing memory issues.',
    },
    {
        key: 'timelineEnabled',
        label: 'Timeline renders',
        desc: 'Re-render timeline clips on every state change.',
    },
    {
        key: 'assetPanelEnabled',
        label: 'Asset panel refresh',
        desc: 'Rebuild the asset list on every state change.',
    },
    {
        key: 'overlayEnabled',
        label: 'Overlay updates',
        desc: 'Push active-clip overlay to the preview canvas on changes.',
    },
    {
        key: 'autosaveEnabled',
        label: 'Autosave',
        desc: 'Debounced autosave to localStorage / IDB after mutations.',
    },
];

const DEBUG_TOGGLES = [
    {
        key: 'memoryProbeEnabled',
        label: 'Memory probe',
        desc: 'Enable URL.* + <video> counters (same as ?debug=1). Shows in Debug tab.',
    },
    {
        key: 'logComposerRebuilds',
        label: 'Log composer rebuilds',
        desc: 'Print [sgve] line per rebuild with asset count.',
    },
];

const LOG_LEVELS = ['off', 'error', 'info', 'verbose'];

function buildSectionEl(title) {
    const el = document.createElement('div');
    el.className = 'sgve-cfg-section';
    const h = document.createElement('div');
    h.className = 'sgve-cfg-heading';
    h.textContent = title;
    el.appendChild(h);
    return el;
}

function buildToggle({ key, label, desc }) {
    const lbl = document.createElement('label');
    lbl.className = 'sgve-cfg-row';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.dataset.cfgKey = key;
    chk.checked = !!editorConfig.get(key);
    chk.addEventListener('change', () => {
        editorConfig.set(key, chk.checked);
        if (key === 'memoryProbeEnabled' && chk.checked) initMemoryProbe();
    });
    const info = document.createElement('span');
    info.className = 'sgve-cfg-info';
    info.innerHTML = `<strong>${label}</strong><br><small>${desc}</small>`;
    lbl.appendChild(chk);
    lbl.appendChild(info);
    return lbl;
}

function buildLogLevelRow() {
    const wrap = document.createElement('div');
    wrap.className = 'sgve-cfg-row sgve-cfg-select-row';
    const info = document.createElement('span');
    info.className = 'sgve-cfg-info';
    info.innerHTML = '<strong>Log level</strong><br><small>Console verbosity for [sgve] messages.</small>';
    const sel = document.createElement('select');
    sel.className = 'sgve-cfg-select';
    sel.dataset.cfgKey = 'logLevel';
    LOG_LEVELS.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = l;
        if (editorConfig.get('logLevel') === l) opt.selected = true;
        sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
        editorConfig.set('logLevel', sel.value);
        setLogLevel(sel.value);
    });
    wrap.appendChild(info);
    wrap.appendChild(sel);
    return wrap;
}

function syncAll(host) {
    host.querySelectorAll('input[data-cfg-key]').forEach(chk => {
        chk.checked = !!editorConfig.get(chk.dataset.cfgKey);
    });
    host.querySelectorAll('select[data-cfg-key]').forEach(sel => {
        sel.value = editorConfig.get(sel.dataset.cfgKey);
    });
}

/**
 * Mount the Config + Debug panel into a host element.
 * @param {{ host: HTMLElement }} opts
 * @returns {{ destroy: () => void }}
 */
export function mountConfigPanel({ host }) {
    if (!host) return { destroy() {} };

    const root = document.createElement('div');
    root.className = 'sgve-cfg-panel';

    // Config section
    const cfgSec = buildSectionEl('Config');
    FEATURE_TOGGLES.forEach(t => cfgSec.appendChild(buildToggle(t)));
    root.appendChild(cfgSec);

    // Debug section
    const dbgSec = buildSectionEl('Debug');
    DEBUG_TOGGLES.forEach(t => dbgSec.appendChild(buildToggle(t)));
    dbgSec.appendChild(buildLogLevelRow());
    root.appendChild(dbgSec);

    // Actions section
    const actSec = buildSectionEl('Actions');
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'sgve-cfg-action-btn';
    cancelBtn.textContent = 'Cancel pending changes';
    cancelBtn.title = 'Clear any queued handleChange debounce — stops the next pipeline run. Console: sgveCancel()';
    cancelBtn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('sgve:cancel-pending'));
    });
    actSec.appendChild(cancelBtn);

    const STRESS_DURATIONS = [
        { label: 'Timeline test: 30 s', sec: 30 },
        { label: 'Timeline test: 5 min', sec: 300 },
        { label: 'Timeline test: 30 min', sec: 1800 },
        { label: 'Timeline test: 2 hr', sec: 7200 },
    ];
    STRESS_DURATIONS.forEach(({ label, sec }) => {
        const btn = document.createElement('button');
        btn.className = 'sgve-cfg-action-btn';
        btn.textContent = label;
        btn.title = `Inject a synthetic ${label} project into the timeline. Console: sgveTimelineTest(${sec})`;
        btn.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('sgve:timeline-test', { detail: { durationSec: sec } }));
        });
        actSec.appendChild(btn);
    });

    root.appendChild(actSec);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'sgve-cfg-reset';
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.addEventListener('click', () => {
        editorConfig.reset();
        syncAll(root);
    });
    root.appendChild(resetBtn);

    const unsub = editorConfig.onChange(() => syncAll(root));
    host.appendChild(root);

    return {
        destroy() {
            unsub();
            try { host.removeChild(root); } catch (_) {}
        },
    };
}
