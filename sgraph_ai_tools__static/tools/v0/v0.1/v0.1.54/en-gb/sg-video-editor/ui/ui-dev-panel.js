/**
 * ui-dev-panel.js — collapsible bottom developer panel for sg-video-editor.
 *
 * Mirrors the pattern from infographic-gen v0.1.33-37: appends a resize
 * handle, a collapsible dev panel (Explorer / Console / Manifest / Skills
 * tabs), and an always-visible footer bar that toggles the panel. Reads
 * manifest.json for footer metadata. Reuses sg-tool-api-* components and
 * delegates skills rendering to dev-panel-tabs.js (sg-markdown core).
 *
 * @module ui-dev-panel
 * @version 0.1.0
 */

import { DEV_TABS, buildSkillsPanel } from './dev-panel-tabs.js';

const DEV_HEIGHT_DEFAULT = 340;

function _buildResizeHandle(devPanel, getH, setH) {
    const handle = document.createElement('div');
    handle.style.cssText = 'flex-shrink:0;height:6px;display:none;background:#1a1a3a;cursor:ns-resize;position:relative;transition:background 120ms;';
    const grip = document.createElement('div');
    grip.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:36px;height:2px;background:#2d3748;border-radius:2px;pointer-events:none;';
    handle.appendChild(grip);
    handle.addEventListener('mouseenter', () => { handle.style.background = '#4ECDC4'; grip.style.background = '#4ECDC4'; });
    handle.addEventListener('mouseleave', () => { handle.style.background = '#1a1a3a'; grip.style.background = '#2d3748'; });
    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        const startY = e.clientY, startH = devPanel.offsetHeight;
        devPanel.style.transition = 'none';
        const onMove = ev => {
            const next = Math.max(140, Math.min(startH + (startY - ev.clientY), window.innerHeight * 0.75));
            setH(next);
            devPanel.style.height = `${next}px`;
        };
        const onUp = () => {
            devPanel.style.transition = 'height 0.22s ease';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
    return handle;
}

function _buildTabs(devContent, devTabBar) {
    let active = 'explorer';
    const btns = {};
    const switchTo = id => {
        active = id;
        for (const [tid, btn] of Object.entries(btns)) {
            btn.style.color             = tid === id ? '#4ECDC4' : '#4a5568';
            btn.style.borderBottomColor = tid === id ? '#4ECDC4' : 'transparent';
        }
        for (const pane of devContent.querySelectorAll('[data-dev-pane]')) {
            pane.style.display = pane.dataset.devPane === id ? 'block' : 'none';
        }
    };
    for (const t of DEV_TABS) {
        const btn = document.createElement('button');
        btn.textContent = t.label;
        btn.style.cssText = `padding:7px 14px;font-size:11px;font-weight:600;background:none;border:none;border-bottom:2px solid ${t.id === active ? '#4ECDC4' : 'transparent'};cursor:pointer;white-space:nowrap;font-family:system-ui,sans-serif;color:${t.id === active ? '#4ECDC4' : '#4a5568'};`;
        btn.addEventListener('click', () => switchTo(t.id));
        devTabBar.appendChild(btn);
        btns[t.id] = btn;

        const pane = document.createElement('div');
        pane.dataset.devPane = t.id;
        pane.style.cssText = `position:absolute;inset:0;display:${t.id === active ? 'block' : 'none'};overflow:hidden;`;
        if (t.tag) {
            const el = document.createElement(t.tag);
            el.style.cssText = 'display:block;width:100%;height:100%;';
            pane.appendChild(el);
        } else {
            pane.appendChild(buildSkillsPanel());
        }
        devContent.appendChild(pane);
    }
}

function _populateFooter(footerInner, manifestUrl) {
    fetch(manifestUrl)
        .then(r => r.json())
        .then(m => {
            const deps = Object.values(m.dependencies || {})
                .reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
            const q = cls => footerInner.querySelector(`.${cls}`);
            if (q('ft-icon'))   q('ft-icon').textContent   = m.icon    || '';
            if (q('ft-name'))   q('ft-name').textContent   = m.name    || '';
            if (q('ft-ver'))    q('ft-ver').textContent    = `v${m.version || ''}`;
            if (q('ft-status')) q('ft-status').textContent = m.status  || '';
            if (q('ft-deps'))   q('ft-deps').textContent   = `${deps} deps`;
        })
        .catch(() => {});
}

/**
 * Mount the resize handle, collapsible dev panel, and footer bar into host
 * (a flex-column container). Appends after any existing children.
 *
 * @param {{host: HTMLElement, manifestUrl?: string}} opts
 * @returns {{destroy: () => void}}
 */
export function mountDevPanel({ host, manifestUrl = './manifest.json' }) {
    if (!host) return { destroy() {} };

    let devOpen = false;
    let devCurrentH = DEV_HEIGHT_DEFAULT;

    const devPanel = document.createElement('div');
    devPanel.style.cssText = 'height:0;overflow:hidden;flex-shrink:0;transition:height 0.22s ease;display:flex;flex-direction:column;background:#0a0a18;';

    const resizeHandle = _buildResizeHandle(devPanel, () => devCurrentH, h => { devCurrentH = h; });
    host.appendChild(resizeHandle);
    host.appendChild(devPanel);

    const devTabBar = document.createElement('div');
    devTabBar.style.cssText = 'display:flex;background:#0d0d1a;border-bottom:1px solid #1a1a3a;flex-shrink:0;';
    devPanel.appendChild(devTabBar);

    const devContent = document.createElement('div');
    devContent.style.cssText = 'flex:1;position:relative;overflow:hidden;min-height:0;';
    devPanel.appendChild(devContent);

    _buildTabs(devContent, devTabBar);

    const footerBar = document.createElement('div');
    footerBar.style.cssText = 'flex-shrink:0;padding:0 0.75rem 0.5rem;background:#0a0a18;';
    const footerInner = document.createElement('div');
    footerInner.style.cssText = 'background:#0d0d1a;border:1px solid #1e293b;border-radius:6px;display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none;font-family:system-ui,sans-serif;font-size:13px;color:#cbd5e0;transition:background 150ms;';
    footerInner.innerHTML = `
        <span class="ft-icon"   style="font-size:16px;line-height:1;"></span>
        <span class="ft-name"   style="font-weight:600;font-size:13px;"></span>
        <span class="ft-ver"    style="color:#64748b;font-size:11px;font-family:'SF Mono',Monaco,monospace;"></span>
        <span class="ft-status" style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:rgba(78,205,196,.15);color:#4ecdc4;"></span>
        <span class="ft-deps"   style="color:#64748b;font-size:11px;"></span>
        <span class="ft-arrow"  style="margin-left:auto;color:#64748b;font-size:11px;transition:transform 150ms;">&#9656;</span>
    `;
    footerBar.appendChild(footerInner);
    host.appendChild(footerBar);

    footerInner.addEventListener('mouseenter', () => { footerInner.style.background = 'rgba(78,205,196,0.04)'; });
    footerInner.addEventListener('mouseleave', () => { footerInner.style.background = devOpen ? 'rgba(78,205,196,0.04)' : ''; });
    footerInner.addEventListener('click', () => {
        devOpen = !devOpen;
        devPanel.style.height          = devOpen ? `${devCurrentH}px` : '0';
        resizeHandle.style.display     = devOpen ? 'block' : 'none';
        footerInner.style.borderRadius = devOpen ? '0 0 6px 6px' : '6px';
        footerInner.style.borderTop    = devOpen ? '1px solid #4ECDC4' : '1px solid #1e293b';
        footerInner.style.background   = devOpen ? 'rgba(78,205,196,0.04)' : '';
        const arrow = footerInner.querySelector('.ft-arrow');
        if (arrow) arrow.style.transform = devOpen ? 'rotate(90deg)' : '';
    });

    _populateFooter(footerInner, manifestUrl);

    function destroy() {
        try { host.removeChild(footerBar); } catch (_) {}
        try { host.removeChild(devPanel); } catch (_) {}
        try { host.removeChild(resizeHandle); } catch (_) {}
    }
    return { destroy };
}
