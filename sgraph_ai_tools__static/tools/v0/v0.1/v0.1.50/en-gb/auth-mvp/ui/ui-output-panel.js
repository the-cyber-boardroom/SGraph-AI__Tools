/**
 * Auth MVP — right panel: Output / Events / Vaults tabs.
 * @module ui-output-panel
 * @version 0.1.50
 */

import { CHECKS, checkState, iconFor, onCheckUpdate } from '../api/checks.js';
import { refreshCheckIcon } from './ui-checks-panel.js';

const WATCHED_EVENTS = [
    'sg-auth:signed-in', 'sg-auth:signed-out', 'sg-auth:error',
    'sg-auth:token-saved', 'sg-auth:token-removed', 'sg-auth:tokens-cleared',
    'sg-cred:stored', 'sg-cred:retrieved', 'sg-cred:unsupported', 'sg-cred:error',
    'vault:opened', 'vault:created', 'vault:saved', 'vault:removed', 'vault:cancelled',
];

let _eventLog = [];

/**
 * Build the right Output/Events/Vaults panel into the given sg-layout tabs.
 * @param {HTMLElement} outputPanel
 * @param {HTMLElement} eventsPanel
 * @param {HTMLElement} vaultsPanel
 */
export function buildOutputPanels(outputPanel, eventsPanel, vaultsPanel) {
    _buildOutputTab(outputPanel);
    _buildEventsTab(eventsPanel);
    _buildVaultsTab(vaultsPanel);

    // Wire runner → output display
    onCheckUpdate(id => {
        refreshCheckIcon(id);
        _renderCheckOutput(outputPanel, id);
    });

    // Wire event monitor
    _ts(); // warm up
    WATCHED_EVENTS.forEach(name => {
        window.addEventListener(name, e => {
            _eventLog.unshift({ name, detail: e.detail, ts: _ts() });
            if (_eventLog.length > 100) _eventLog.pop();
            _renderEventLog(eventsPanel);
        });
    });
}

// ── Output tab ────────────────────────────────────────────────────────────────

function _buildOutputTab(el) {
    el.style.cssText = 'height:100%;overflow-y:auto;background:#080812;box-sizing:border-box;padding:14px;font-family:"SF Mono",Monaco,monospace;';
    el.innerHTML = `<div style="font-size:12px;color:#2d3748;">Run a check to see output here.</div>`;
}

function _renderCheckOutput(el, id) {
    const check = CHECKS.find(c => c.id === id);
    const { status, output } = checkState[id];
    el.innerHTML = `
        <div style="margin-bottom:10px;">
            <span style="font-size:14px;margin-right:6px;">${iconFor(status)}</span>
            <span style="font-size:13px;font-weight:700;color:#4ecdc4;">${check?.label || id}</span>
        </div>
        ${output.map(line => `
            <div style="font-size:12px;color:#a0aec0;line-height:1.8;padding:1px 0;">${_esc(line)}</div>
        `).join('')}
    `;
}

// ── Events tab ────────────────────────────────────────────────────────────────

function _buildEventsTab(el) {
    el.style.cssText = 'height:100%;overflow-y:auto;background:#080812;box-sizing:border-box;padding:14px;font-family:"SF Mono",Monaco,monospace;';
    el.innerHTML = `<div style="font-size:11px;color:#2d3748;">Waiting for auth events…</div>`;
}

function _renderEventLog(el) {
    if (_eventLog.length === 0) return;
    el.innerHTML = _eventLog.slice(0, 50).map(e => `
        <div style="padding:4px 0;border-bottom:1px solid #0d0d1a;font-size:10px;line-height:1.5;">
            <span style="color:#4a5568;">${e.ts}</span>
            <span style="color:#4ecdc4;margin:0 6px;font-weight:700;">${e.name}</span>
            <span style="color:#718096;">${JSON.stringify(e.detail || {}).slice(0, 120)}</span>
        </div>
    `).join('');
}

// ── Vaults tab ────────────────────────────────────────────────────────────────

function _buildVaultsTab(el) {
    el.style.cssText = 'height:100%;overflow-y:auto;background:#080812;box-sizing:border-box;padding:14px;';
    el.innerHTML = `<sg-vault-picker style="display:block;"></sg-vault-picker>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _ts() {
    return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
