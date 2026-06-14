/**
 * Audio Transcribe — bottom JS-API dev panel.
 *
 * Appends a footer bar + collapsible dev panel (📄 Skills / ⚡ Explorer /
 * > Console / 📋 Manifest) to the provided layout wrapper. This is the standard
 * pattern shared by mermaid-diagrams / send-receive / auth-mvp: the Explorer /
 * Console / Manifest tabs host the three `components/tool-api/*` widgets, which
 * auto-bind to `window.__tool` once activate() has fired.
 *
 * @module audio-transcribe/dev-panel
 */

import { renderMarkdown } from './markdown.js';

const DEV_HEIGHT_DEFAULT = 300;
let _styleInjected = false;

function _injectStyle() {
    if (_styleInjected) return;
    _styleInjected = true;
    const s = document.createElement('style');
    s.textContent = `
.at-skill-md{line-height:1.7;color:#a0aec0;font-size:12px;font-family:system-ui,sans-serif}
.at-skill-md h1,.at-skill-md h2,.at-skill-md h3{margin:.75em 0 .3em;color:#818cf8}
.at-skill-md h1{font-size:1.25em}.at-skill-md h2{font-size:1.1em}.at-skill-md h3{font-size:1em}
.at-skill-md p{margin:.45em 0}
.at-skill-md ul,.at-skill-md ol{margin:.4em 0;padding-left:1.4em}
.at-skill-md li{margin:.2em 0}
.at-skill-md code{background:#1a1a3a;border-radius:3px;padding:1px 4px;font-size:11px;font-family:'SF Mono',Monaco,monospace;color:#e2e8f0}
.at-skill-md pre{background:#111122;border-radius:4px;padding:8px 10px;overflow-x:auto;margin:.5em 0}
.at-skill-md pre code{background:none;padding:0;color:#a0aec0}
.at-skill-md strong{color:#e2e8f0}.at-skill-md em{color:#cbd5e0}
.at-skill-md a{color:#818cf8}
.at-skill-md hr{border:none;border-top:1px solid #1a1a3a;margin:.7em 0}
.at-skill-md table{border-collapse:collapse;width:100%;margin:.5em 0;font-size:11px}
.at-skill-md th{background:#1a1a3a;color:#e2e8f0;padding:4px 8px;text-align:left;border:1px solid #2d3748}
.at-skill-md td{padding:4px 8px;border:1px solid #1a1a3a;color:#a0aec0}
.at-skill-md blockquote{border-left:3px solid #818cf8;margin:.5em 0;padding:0 .75em;color:#718096}
`;
    document.head.appendChild(s);
}

function _buildSkillsPanel() {
    _injectStyle();
    const SKILLS = [
        { label: '👤 Human Guide',     url: './skills/SKILL__human.md' },
        { label: '🤖 Browser / Agent', url: './skills/SKILL__browser.md' },
        { label: '⚡ API Reference',   url: './skills/SKILL__api.md' },
    ];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'height:100%;overflow-y:auto;padding:10px 12px;background:#0a0a18;box-sizing:border-box;';

    for (const s of SKILLS) {
        const card = document.createElement('div');
        card.style.cssText = 'background:#0d0d1a;border:1px solid #1a1a3a;border-radius:4px;margin-bottom:8px;overflow:hidden;';
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;cursor:pointer;font-family:system-ui,sans-serif;';
        hdr.innerHTML = `<span style="font-size:12px;font-weight:600;color:#a0aec0;">${s.label}</span><span style="color:#818cf8;font-size:10px;">▼ expand</span>`;
        hdr.addEventListener('mouseenter', () => { hdr.style.background = '#111120'; });
        hdr.addEventListener('mouseleave', () => { hdr.style.background = ''; });
        const body = document.createElement('div');
        body.className = 'at-skill-md';
        body.style.cssText = 'display:none;padding:10px 12px;max-height:340px;overflow-y:auto;border-top:1px solid #1a1a3a;';
        body.textContent = 'Loading…';
        hdr.addEventListener('click', () => {
            const open = body.style.display === 'block';
            body.style.display = open ? 'none' : 'block';
            hdr.querySelector('span:last-child').textContent = open ? '▼ expand' : '▲ collapse';
            if (!open && body.textContent === 'Loading…') {
                fetch(s.url).then(r => r.text())
                    .then(t => { body.innerHTML = renderMarkdown(t); })
                    .catch(() => { body.textContent = 'Failed to load.'; });
            }
        });
        card.appendChild(hdr);
        card.appendChild(body);
        wrap.appendChild(card);
    }
    return wrap;
}

/** @param {HTMLElement} layoutWrap */
export function buildDevPanel(layoutWrap) {
    let devOpen = false;
    let devCurrentH = DEV_HEIGHT_DEFAULT;

    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = 'flex-shrink:0;height:6px;display:none;background:#1a1a3a;cursor:ns-resize;position:relative;transition:background 120ms;';
    const grip = document.createElement('div');
    grip.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:36px;height:2px;background:#2d3748;border-radius:2px;pointer-events:none;';
    resizeHandle.appendChild(grip);
    resizeHandle.addEventListener('mouseenter', () => { resizeHandle.style.background = '#818cf8'; grip.style.background = '#818cf8'; });
    resizeHandle.addEventListener('mouseleave', () => { resizeHandle.style.background = '#1a1a3a'; grip.style.background = '#2d3748'; });
    layoutWrap.appendChild(resizeHandle);

    resizeHandle.addEventListener('mousedown', e => {
        e.preventDefault();
        const startY = e.clientY, startH = devPanel.offsetHeight;
        devPanel.style.transition = 'none';
        const onMove = ev => {
            devCurrentH = Math.max(140, Math.min(startH + (startY - ev.clientY), window.innerHeight * 0.75));
            devPanel.style.height = `${devCurrentH}px`;
        };
        const onUp = () => {
            devPanel.style.transition = 'height 0.22s ease';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    const devPanel = document.createElement('div');
    devPanel.style.cssText = 'height:0;overflow:hidden;flex-shrink:0;transition:height 0.22s ease;display:flex;flex-direction:column;background:#0a0a18;';
    layoutWrap.appendChild(devPanel);

    const devTabBar = document.createElement('div');
    devTabBar.style.cssText = 'display:flex;background:#0d0d1a;border-bottom:1px solid #1a1a3a;flex-shrink:0;';
    devPanel.appendChild(devTabBar);

    const devContent = document.createElement('div');
    devContent.style.cssText = 'flex:1;position:relative;overflow:hidden;min-height:0;';
    devPanel.appendChild(devContent);

    const TABS = [
        { id: 'skills',   label: '📄 Skills' },
        { id: 'explorer', label: '⚡ Explorer', tag: 'sg-tool-api-explorer' },
        { id: 'console',  label: '> Console',  tag: 'sg-tool-api-console' },
        { id: 'manifest', label: '📋 Manifest', tag: 'sg-tool-api-manifest' },
    ];
    let activeTab = 'skills';
    const btnMap = {};

    const switchTab = id => {
        activeTab = id;
        for (const [tid, btn] of Object.entries(btnMap)) {
            btn.style.color             = tid === id ? '#818cf8' : '#4a5568';
            btn.style.borderBottomColor = tid === id ? '#818cf8' : 'transparent';
        }
        for (const pane of devContent.querySelectorAll('[data-dev-pane]')) {
            pane.style.display = pane.dataset.devPane === id ? 'block' : 'none';
        }
    };

    for (const t of TABS) {
        const btn = document.createElement('button');
        btn.textContent = t.label;
        btn.style.cssText = `padding:7px 14px;font-size:11px;font-weight:600;background:none;border:none;border-bottom:2px solid ${t.id === activeTab ? '#818cf8' : 'transparent'};cursor:pointer;white-space:nowrap;font-family:system-ui,sans-serif;color:${t.id === activeTab ? '#818cf8' : '#4a5568'};`;
        btn.addEventListener('click', () => switchTab(t.id));
        devTabBar.appendChild(btn);
        btnMap[t.id] = btn;

        const pane = document.createElement('div');
        pane.dataset.devPane = t.id;
        pane.style.cssText = `position:absolute;inset:0;display:${t.id === activeTab ? 'block' : 'none'};overflow:hidden;`;

        if (t.tag) {
            const el = document.createElement(t.tag);
            el.style.cssText = 'display:block;width:100%;height:100%;';
            pane.appendChild(el);
        } else {
            pane.appendChild(_buildSkillsPanel());
        }
        devContent.appendChild(pane);
    }

    // Footer bar (always visible; click to toggle the panel)
    const footerBar = document.createElement('div');
    footerBar.style.cssText = 'flex-shrink:0;padding:0 0.75rem 0.5rem;background:#0a0a18;';
    const footerInner = document.createElement('div');
    footerInner.style.cssText = 'background:#0d0d1a;border:1px solid #1e293b;border-radius:6px;display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#cbd5e0;transition:background 150ms;';
    footerInner.innerHTML = `
        <span style="font-size:16px;line-height:1;">🎙</span>
        <span style="font-weight:600;font-size:13px;">Audio Transcribe</span>
        <span class="at-ft-ver" style="color:#64748b;font-size:11px;font-family:'SF Mono',Monaco,monospace;"></span>
        <span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:rgba(129,140,248,.15);color:#818cf8;">alpha</span>
        <span class="at-ft-deps" style="color:#64748b;font-size:11px;"></span>
        <span style="margin-left:auto;color:#818cf8;font-size:10px;font-weight:600;">Click to open JS API panel</span>
        <span class="at-ft-arrow" style="color:#64748b;font-size:11px;transition:transform 150ms;">▸</span>`;
    footerBar.appendChild(footerInner);
    layoutWrap.appendChild(footerBar);

    footerInner.addEventListener('mouseenter', () => { footerInner.style.background = 'rgba(129,140,248,0.04)'; });
    footerInner.addEventListener('mouseleave', () => { footerInner.style.background = devOpen ? 'rgba(129,140,248,0.04)' : ''; });
    footerInner.addEventListener('click', () => {
        devOpen = !devOpen;
        devPanel.style.height      = devOpen ? `${devCurrentH}px` : '0';
        resizeHandle.style.display = devOpen ? 'block' : 'none';
        footerInner.style.borderRadius = devOpen ? '0 0 6px 6px' : '6px';
        footerInner.style.borderTop    = devOpen ? '1px solid #818cf8' : '1px solid #1e293b';
        footerInner.style.background   = devOpen ? 'rgba(129,140,248,0.04)' : '';
        const arrow = footerInner.querySelector('.at-ft-arrow');
        if (arrow) arrow.style.transform = devOpen ? 'rotate(90deg)' : '';
    });

    fetch('./manifest.json').then(r => r.json()).then(m => {
        const deps = Object.values(m.dependencies || {}).reduce((s, a) => s + a.length, 0);
        const ver = footerInner.querySelector('.at-ft-ver');
        const dep = footerInner.querySelector('.at-ft-deps');
        if (ver) ver.textContent = `v${m.version || ''}`;
        if (dep) dep.textContent = `${deps} deps`;
    }).catch(() => {});
}
