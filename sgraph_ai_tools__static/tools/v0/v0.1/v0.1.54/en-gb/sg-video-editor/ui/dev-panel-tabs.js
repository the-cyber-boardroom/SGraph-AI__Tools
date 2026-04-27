/**
 * dev-panel-tabs.js — helpers for the bottom developer panel.
 *
 * Builds the Skills accordion (markdown-rendered SKILL files) and exposes
 * the static tab descriptors used by ui-dev-panel.js. Kept separate to keep
 * each file under the 200-line cap.
 *
 * @module dev-panel-tabs
 * @version 0.1.0
 */

import { renderMarkdown } from '/core/markdown/v1/v1.0/v1.0.0/sg-markdown.js';

export const DEV_TABS = [
    { id: 'explorer', label: 'Explorer', tag: 'sg-tool-api-explorer' },
    { id: 'console',  label: 'Console',  tag: 'sg-tool-api-console' },
    { id: 'manifest', label: 'Manifest', tag: 'sg-tool-api-manifest' },
    { id: 'skills',   label: 'Skills' },
];

export const SKILLS = [
    { label: 'Human Guide',          url: './skills/SKILL__human.md' },
    { label: 'Browser / Playwright', url: './skills/SKILL__browser.md' },
    { label: 'API Spec',             url: './skills/SKILL__api.md' },
];

let _styleInjected = false;
function _injectSkillStyle() {
    if (_styleInjected) return;
    _styleInjected = true;
    const s = document.createElement('style');
    s.textContent = `
.sgve-skill-md{line-height:1.7;color:#a0aec0;font-size:12px;font-family:system-ui,sans-serif}
.sgve-skill-md h1,.sgve-skill-md h2,.sgve-skill-md h3{margin:.75em 0 .3em;color:#4ECDC4}
.sgve-skill-md h1{font-size:1.25em}.sgve-skill-md h2{font-size:1.1em}.sgve-skill-md h3{font-size:1em}
.sgve-skill-md p{margin:.45em 0}
.sgve-skill-md ul,.sgve-skill-md ol{margin:.4em 0;padding-left:1.4em}
.sgve-skill-md li{margin:.2em 0}
.sgve-skill-md code{background:#1a1a3a;border-radius:3px;padding:1px 4px;font-size:11px;font-family:'SF Mono',Monaco,monospace;color:#e2e8f0}
.sgve-skill-md pre{background:#111122;border-radius:4px;padding:8px 10px;overflow-x:auto;margin:.5em 0}
.sgve-skill-md pre code{background:none;padding:0;color:#a0aec0}
.sgve-skill-md table{border-collapse:collapse;width:100%;margin:.5em 0;font-size:11px}
.sgve-skill-md th{background:#1a1a3a;color:#e2e8f0;padding:4px 8px;text-align:left;border:1px solid #2d3748}
.sgve-skill-md td{padding:4px 8px;border:1px solid #1a1a3a;color:#a0aec0}
`;
    document.head.appendChild(s);
}

/**
 * Build the Skills accordion. Each SKILL file is fetched lazily on first
 * expand and rendered via the canonical sg-markdown core module.
 *
 * @returns {HTMLElement}
 */
export function buildSkillsPanel() {
    _injectSkillStyle();
    const wrap = document.createElement('div');
    wrap.style.cssText = 'height:100%;overflow-y:auto;padding:10px 12px;background:#0a0a18;box-sizing:border-box;';

    for (const s of SKILLS) {
        const card = document.createElement('div');
        card.style.cssText = 'background:#0d0d1a;border:1px solid #1a1a3a;border-radius:4px;margin-bottom:8px;overflow:hidden;';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;cursor:pointer;font-family:system-ui,sans-serif;';
        hdr.innerHTML = `<span style="font-size:12px;font-weight:600;color:#a0aec0;">${s.label}</span><span class="sgve-toggle" style="color:#4ECDC4;font-size:10px;">expand</span>`;

        const body = document.createElement('div');
        body.className = 'sgve-skill-md';
        body.style.cssText = 'display:none;padding:10px 12px;max-height:320px;overflow-y:auto;border-top:1px solid #1a1a3a;';
        body.textContent = 'Loading…';

        hdr.addEventListener('click', () => {
            const open = body.style.display === 'block';
            body.style.display = open ? 'none' : 'block';
            hdr.querySelector('.sgve-toggle').textContent = open ? 'expand' : 'collapse';
            if (!open && body.textContent === 'Loading…') {
                fetch(s.url)
                    .then(r => r.text())
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
