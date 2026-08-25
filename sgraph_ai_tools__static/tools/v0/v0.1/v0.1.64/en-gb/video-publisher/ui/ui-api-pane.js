/**
 * ui-api-pane.js
 * Collapsible JS API dev panel (Explorer / Console / Manifest / Skills)
 * + footer bar showing tool name + version + dep count.
 *
 * @module ui-api-pane
 */

const DEV_HEIGHT = 280;

const DEV_TABS = [
    { id: 'explorer', label: '⚡ Explorer', tag: 'sg-tool-api-explorer' },
    { id: 'console',  label: '> Console',  tag: 'sg-tool-api-console'  },
    { id: 'manifest', label: '📋 Manifest', tag: 'sg-tool-api-manifest' },
    { id: 'skills',   label: '📄 Skills'                                },
];

const SKILLS = [
    { label: '👤 Human Guide',          url: './skills/SKILL-human.md' },
    { label: '🎭 Browser / Playwright', url: './skills/SKILL-browser.md' },
    { label: '⚙️ API Spec',              url: './skills/SKILL-api.md' },
];

export function initApiPane(wrap) {
    let devOpen = false;

    const devPanel = document.createElement('div');
    devPanel.className = 'vp-dev-panel';
    devPanel.style.cssText = 'height:0;overflow:hidden;flex-shrink:0;transition:height 0.22s ease;display:flex;flex-direction:column;background:#0a0a18;';
    wrap.appendChild(devPanel);

    const tabBar = document.createElement('div');
    tabBar.className = 'vp-dev-panel__tabs';
    devPanel.appendChild(tabBar);

    const content = document.createElement('div');
    content.className = 'vp-dev-panel__content';
    devPanel.appendChild(content);

    let activeTab = 'explorer';
    const btns = {};

    function switchTab(id) {
        activeTab = id;
        for (const [tid, btn] of Object.entries(btns)) btn.classList.toggle('is-active', tid === id);
        for (const pane of content.querySelectorAll('[data-dev-pane]')) {
            pane.style.display = pane.dataset.devPane === id ? 'block' : 'none';
        }
    }

    for (const t of DEV_TABS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vp-dev-panel__tab' + (t.id === activeTab ? ' is-active' : '');
        btn.textContent = t.label;
        btn.addEventListener('click', () => switchTab(t.id));
        tabBar.appendChild(btn);
        btns[t.id] = btn;

        const pane = document.createElement('div');
        pane.dataset.devPane = t.id;
        pane.className = 'vp-dev-panel__pane';
        pane.style.display = t.id === activeTab ? 'block' : 'none';

        if (t.tag) {
            const el = document.createElement(t.tag);
            el.style.cssText = 'display:block;width:100%;height:100%;';
            pane.appendChild(el);
        } else {
            pane.appendChild(_buildSkills());
        }
        content.appendChild(pane);
    }

    const footer = document.createElement('div');
    footer.className = 'vp-footer-bar';
    const inner = document.createElement('div');
    inner.className = 'vp-footer-bar__inner';
    inner.innerHTML = `
        <span class="ft-icon" aria-hidden="true">🚀</span>
        <span class="ft-name"></span>
        <span class="ft-ver"></span>
        <span class="ft-status"></span>
        <span class="ft-deps"></span>
        <span class="ft-arrow">▸ JS API</span>
    `;
    footer.appendChild(inner);
    wrap.appendChild(footer);

    inner.addEventListener('click', () => {
        devOpen = !devOpen;
        devPanel.style.height = devOpen ? `${DEV_HEIGHT}px` : '0';
        inner.classList.toggle('is-open', devOpen);
        const arrow = inner.querySelector('.ft-arrow');
        if (arrow) arrow.style.transform = devOpen ? 'rotate(90deg)' : '';
    });

    fetch('./manifest.json').then(r => r.json()).then(m => {
        const deps = Object.values(m.dependencies || {})
            .reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
        const q = sel => inner.querySelector(sel);
        q('.ft-icon').textContent   = m.icon    || '🚀';
        q('.ft-name').textContent   = m.name    || '';
        q('.ft-ver').textContent    = `v${m.version || ''}`;
        q('.ft-status').textContent = m.status  || '';
        q('.ft-deps').textContent   = `${deps} deps`;
    }).catch(() => {});
}

function _buildSkills() {
    const wrap = document.createElement('div');
    wrap.className = 'vp-skills';
    for (const s of SKILLS) {
        const card = document.createElement('div');
        card.className = 'vp-skills__card';
        const hdr = document.createElement('div');
        hdr.className = 'vp-skills__header';
        hdr.innerHTML = `<span>${s.label}</span><span class="vp-skills__chev">▼ expand</span>`;
        const body = document.createElement('pre');
        body.className = 'vp-skills__body';
        body.textContent = 'Loading…';
        hdr.addEventListener('click', () => {
            const open = body.style.display === 'block';
            body.style.display = open ? 'none' : 'block';
            hdr.querySelector('.vp-skills__chev').textContent = open ? '▼ expand' : '▲ collapse';
            if (!open && body.textContent === 'Loading…') {
                fetch(s.url).then(r => r.text()).then(t => { body.textContent = t; })
                            .catch(() => { body.textContent = 'Failed to load.'; });
            }
        });
        card.appendChild(hdr);
        card.appendChild(body);
        wrap.appendChild(card);
    }
    return wrap;
}
