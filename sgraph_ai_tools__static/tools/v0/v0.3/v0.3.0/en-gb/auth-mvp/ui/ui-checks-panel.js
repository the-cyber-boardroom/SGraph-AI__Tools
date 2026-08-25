/**
 * Auth MVP — left panel: Setup + 7 check sections.
 * @module ui-checks-panel
 * @version 0.1.50
 */

import { CHECKS, checkState, iconFor, setGoogleEl, setDriveEl, CLIENT_ID_KEY, RUNNERS } from '../api/checks.js';

/**
 * Build the left "Checks" panel into the given element.
 * @param {HTMLElement} el
 */
export function buildChecksPanel(el, config = {}) {
    el.style.cssText = 'overflow-y:auto;height:100%;background:#080812;box-sizing:border-box;';

    // Config provides the default; localStorage override wins once user saves manually
    if (config.googleClientId && !localStorage.getItem(CLIENT_ID_KEY)) {
        localStorage.setItem(CLIENT_ID_KEY, config.googleClientId);
    }
    const clientId = localStorage.getItem(CLIENT_ID_KEY) || '';

    // ── Setup section ─────────────────────────────────────────────────────────

    const setup = document.createElement('div');
    setup.style.cssText = 'padding:14px;border-bottom:1px solid #1a1a3a;font-family:system-ui,sans-serif;';
    setup.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:#4a5568;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Setup</div>
        <div style="font-size:11px;color:#718096;margin-bottom:5px;">Google OAuth Client ID</div>
        <div style="display:flex;gap:6px;">
            <input id="am-client-id" type="text" placeholder="xxx.apps.googleusercontent.com"
                   value="${clientId}"
                   style="flex:1;background:#111122;border:1px solid #1a1a3a;border-radius:4px;padding:6px 8px;color:#e2e8f0;font-size:12px;font-family:inherit;">
            <button id="am-save-id" style="font-size:11px;padding:6px 10px;border-radius:4px;border:1px solid #4ecdc4;background:none;color:#4ecdc4;cursor:pointer;white-space:nowrap;font-family:inherit;">Save</button>
        </div>
        <div style="font-size:10px;color:#2d3748;margin-top:5px;">
            Get yours at <span style="color:#4ecdc4">console.cloud.google.com</span> → APIs &amp; Services → Credentials
        </div>
        <button id="am-run-all" style="margin-top:10px;width:100%;padding:7px;font-size:11px;font-weight:700;border-radius:4px;border:1px solid #4ecdc4;background:rgba(78,205,196,.08);color:#4ecdc4;cursor:pointer;font-family:inherit;">▶ Run All Checks</button>
    `;
    el.appendChild(setup);

    // ── Check sections ────────────────────────────────────────────────────────

    const checksWrap = document.createElement('div');
    for (const check of CHECKS) {
        const section = _buildCheckSection(check);
        checksWrap.appendChild(section);
    }
    el.appendChild(checksWrap);

    // ── Bindings ──────────────────────────────────────────────────────────────

    setup.querySelector('#am-save-id').addEventListener('click', () => {
        const val = setup.querySelector('#am-client-id').value.trim();
        localStorage.setItem(CLIENT_ID_KEY, val);
        const googleComp = document.getElementById('am-google-comp');
        if (googleComp && val) googleComp.initialize(val);
        const btn = setup.querySelector('#am-save-id');
        btn.textContent = '✓ Saved';
        setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    });

    setup.querySelector('#am-run-all').addEventListener('click', async () => {
        for (const check of CHECKS) {
            checkState[check.id].status = 'running';
            _refreshCheckIcon(check.id);
            await RUNNERS[check.id]?.().catch(e => {
                checkState[check.id].output = [`Error: ${e.message}`];
                checkState[check.id].status = 'fail';
                _refreshCheckIcon(check.id);
            });
        }
    });

    el.addEventListener('click', e => {
        const btn = e.target.closest('[data-run]');
        if (!btn) return;
        const id = btn.dataset.run;
        checkState[id].status = 'running';
        _refreshCheckIcon(id);
        RUNNERS[id]?.().catch(err => {
            checkState[id].output = [`Error: ${err.message}`];
            checkState[id].status = 'fail';
            _refreshCheckIcon(id);
        });
    });
}

function _buildCheckSection(check) {
    const section = document.createElement('div');
    section.id    = `am-section-${check.id}`;
    section.style.cssText = 'border-bottom:1px solid #0d0d1a;font-family:system-ui,sans-serif;';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;';
    hdr.innerHTML = `
        <span id="am-icon-${check.id}" style="font-size:14px;width:18px;text-align:center;">${iconFor('pending')}</span>
        <span style="flex:1;font-size:12px;color:#a0aec0;font-weight:600;">${check.label}</span>
        <button data-run="${check.id}" style="font-size:10px;padding:3px 8px;border-radius:4px;border:1px solid #2d3748;background:none;color:#718096;cursor:pointer;font-family:inherit;">Run</button>
    `;
    section.appendChild(hdr);

    // Inline components
    const inner = document.createElement('div');
    inner.style.cssText = 'padding:0 14px 10px;';

    if (check.id === 'status') {
        inner.innerHTML = `<sg-auth-status style="display:block;"></sg-auth-status>`;
    }
    if (check.id === 'google') {
        inner.innerHTML = `
            <sg-auth-google id="am-google-comp" style="display:block;"></sg-auth-google>
            <div style="font-size:10px;color:#2d3748;margin-top:4px;">Enter Client ID above → Save → sign in here</div>
        `;
        // Wire googleEl reference after DOM insertion
        requestAnimationFrame(() => {
            const comp = document.getElementById('am-google-comp');
            if (comp) {
                setGoogleEl(comp);
                const saved = localStorage.getItem(CLIENT_ID_KEY);
                if (saved) comp.initialize(saved);
            }
        });
    }
    if (check.id === 'user') {
        inner.innerHTML = `<sg-auth-user show-details style="display:block;"></sg-auth-user>`;
    }
    if (check.id === 'credstore') {
        inner.innerHTML = `<sg-credential-store style="display:block;"></sg-credential-store>`;
    }
    if (check.id === 'credlist') {
        inner.innerHTML = `<sg-credential-list style="display:block;"></sg-credential-list>`;
    }
    if (check.id === 'driveappdata') {
        inner.innerHTML = `<sg-drive-appdata id="am-drive-comp" style="display:block;"></sg-drive-appdata>`;
        requestAnimationFrame(() => {
            const comp = document.getElementById('am-drive-comp');
            if (comp) setDriveEl(comp);
        });
    }

    if (inner.innerHTML.trim()) section.appendChild(inner);
    return section;
}

function _refreshCheckIcon(id) {
    const el = document.getElementById(`am-icon-${id}`);
    if (el) el.textContent = iconFor(checkState[id].status);
}

/** Called by ui-output-panel's onCheckUpdate callback */
export function refreshCheckIcon(id) { _refreshCheckIcon(id); }
