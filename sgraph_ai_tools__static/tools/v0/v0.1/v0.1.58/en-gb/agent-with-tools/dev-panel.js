/**
 * agent-with-tools — bottom dev panel (footer bar + collapsible panel).
 *
 * Adapted from mermaid-diagrams dev-panel.js. Appends a footer toggle bar
 * to document.body that opens a resizable panel with Skills, Explorer,
 * Console, and Manifest tabs.
 *
 * @module dev-panel
 * @version 0.1.58
 */

const DEV_HEIGHT_DEFAULT = 300;

/** @param {HTMLElement} target - element to append footer+panel to */
export function buildDevPanel(target) {
    let devOpen = false;
    let devCurrentH = DEV_HEIGHT_DEFAULT;

    // ── Resize handle ─────────────────────────────────────────────────────────
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = 'flex-shrink:0;height:6px;display:none;background:#1a1a3a;cursor:ns-resize;';
    target.appendChild(resizeHandle);

    resizeHandle.addEventListener('mousedown', e => {
        e.preventDefault();
        const startY = e.clientY, startH = devPanel.offsetHeight;
        const onMove = ev => {
            devCurrentH = Math.max(140, Math.min(startH + (startY - ev.clientY), window.innerHeight * 0.75));
            devPanel.style.height = `${devCurrentH}px`;
        };
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    // ── Panel ─────────────────────────────────────────────────────────────────
    const devPanel = document.createElement('div');
    devPanel.style.cssText = 'height:0;overflow:hidden;flex-shrink:0;transition:height .22s ease;display:flex;flex-direction:column;background:#0a0a18;';
    target.appendChild(devPanel);

    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;background:#0d0d1a;border-bottom:1px solid #1a1a3a;flex-shrink:0;';
    devPanel.appendChild(tabBar);

    const content = document.createElement('div');
    content.style.cssText = 'flex:1;position:relative;overflow:hidden;min-height:0;';
    devPanel.appendChild(content);

    const TABS = [
        { id: 'explorer', label: '⚡ Explorer', tag: 'sg-tool-api-explorer' },
        { id: 'console',  label: '> Console',  tag: 'sg-tool-api-console' },
        { id: 'manifest', label: '📋 Manifest', tag: 'sg-tool-api-manifest' },
    ];
    let activeTab = 'explorer';
    const btnMap = {};

    const switchTab = id => {
        activeTab = id;
        for (const [tid, btn] of Object.entries(btnMap)) {
            btn.style.color             = tid === id ? '#4ECDC4' : '#4a5568';
            btn.style.borderBottomColor = tid === id ? '#4ECDC4' : 'transparent';
        }
        for (const pane of content.querySelectorAll('[data-dev-pane]')) {
            pane.style.display = pane.dataset.devPane === id ? 'block' : 'none';
        }
    };

    for (const t of TABS) {
        const btn = document.createElement('button');
        btn.textContent = t.label;
        btn.style.cssText = `padding:7px 14px;font-size:11px;font-weight:600;background:none;border:none;border-bottom:2px solid ${t.id === activeTab ? '#4ECDC4' : 'transparent'};cursor:pointer;white-space:nowrap;font-family:system-ui,sans-serif;color:${t.id === activeTab ? '#4ECDC4' : '#4a5568'};`;
        btn.addEventListener('click', () => switchTab(t.id));
        tabBar.appendChild(btn);
        btnMap[t.id] = btn;

        const pane = document.createElement('div');
        pane.dataset.devPane = t.id;
        pane.style.cssText = `position:absolute;inset:0;display:${t.id === activeTab ? 'block' : 'none'};overflow:hidden;`;
        const el = document.createElement(t.tag);
        el.style.cssText = 'display:block;width:100%;height:100%;';
        pane.appendChild(el);
        content.appendChild(pane);
    }

    // ── Footer bar ────────────────────────────────────────────────────────────
    const footerBar = document.createElement('div');
    footerBar.style.cssText = 'flex-shrink:0;padding:0 .75rem .5rem;background:#0a0a18;';
    const inner = document.createElement('div');
    inner.style.cssText = 'background:#0d0d1a;border:1px solid #1e293b;border-radius:6px;display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none;font-family:system-ui,sans-serif;font-size:13px;color:#cbd5e0;transition:background 150ms;';
    inner.innerHTML = `<span style="font-size:16px;">🛠️</span><span style="font-weight:600;">Agent with Tools</span><span style="color:#64748b;font-size:11px;font-family:'SF Mono',Monaco,monospace;">v0.1.58</span><span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:rgba(78,205,196,.15);color:#4ecdc4;">live</span><span style="margin-left:auto;color:#4ecdc4;font-size:10px;font-weight:600;">JS API panel</span><span class="ft-arrow" style="color:#64748b;font-size:11px;transition:transform 150ms;">▸</span>`;
    footerBar.appendChild(inner);
    target.appendChild(footerBar);

    inner.addEventListener('click', () => {
        devOpen = !devOpen;
        devPanel.style.height      = devOpen ? `${devCurrentH}px` : '0';
        resizeHandle.style.display = devOpen ? 'block' : 'none';
        inner.querySelector('.ft-arrow').style.transform = devOpen ? 'rotate(90deg)' : '';
    });
}
