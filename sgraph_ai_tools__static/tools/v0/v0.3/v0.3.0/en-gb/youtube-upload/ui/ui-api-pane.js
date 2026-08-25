/**
 * ui-api-pane.js
 * Collapsible JS API dev panel (Explorer / Console / Manifest / Skills)
 * with footer bar showing tool name + version + dep count.
 *
 * Mirrors the pattern in video-recorder/ui/ui-shell.js so behaviour is uniform.
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

/**
 * Mount the dev panel + footer at the bottom of `wrap`.
 * @param {HTMLElement} wrap  The flex-column #layout-wrap element
 */
export function initApiPane(wrap) {
    let devOpen = false;

    // ── Panel ────────────────────────────────────────────────────────────────
    const devPanel = document.createElement('div');
    devPanel.className = 'yt-dev-panel';
    devPanel.style.cssText = 'height:0;overflow:hidden;flex-shrink:0;transition:height 0.22s ease;display:flex;flex-direction:column;background:#0a0a18;';
    wrap.appendChild(devPanel);

    const devTabBar = document.createElement('div');
    devTabBar.className = 'yt-dev-panel__tabs';
    devPanel.appendChild(devTabBar);

    const devContent = document.createElement('div');
    devContent.className = 'yt-dev-panel__content';
    devPanel.appendChild(devContent);

    let activeTab = 'explorer';
    const btns = {};

    function switchTab(id) {
        activeTab = id;
        for (const [tid, btn] of Object.entries(btns)) btn.classList.toggle('is-active', tid === id);
        for (const pane of devContent.querySelectorAll('[data-dev-pane]')) {
            pane.style.display = pane.dataset.devPane === id ? 'block' : 'none';
        }
    }

    for (const t of DEV_TABS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'yt-dev-panel__tab' + (t.id === activeTab ? ' is-active' : '');
        btn.textContent = t.label;
        btn.addEventListener('click', () => switchTab(t.id));
        devTabBar.appendChild(btn);
        btns[t.id] = btn;

        const pane = document.createElement('div');
        pane.dataset.devPane = t.id;
        pane.className = 'yt-dev-panel__pane';
        pane.style.display = t.id === activeTab ? 'block' : 'none';

        if (t.tag) {
            const el = document.createElement(t.tag);
            el.style.cssText = 'display:block;width:100%;height:100%;';
            pane.appendChild(el);
        } else {
            pane.appendChild(_buildSkillsPanel());
        }
        devContent.appendChild(pane);
    }

    // ── Footer bar ────────────────────────────────────────────────────────────
    const footerBar = document.createElement('div');
    footerBar.className = 'yt-footer-bar';

    const footerInner = document.createElement('div');
    footerInner.className = 'yt-footer-bar__inner';
    footerInner.innerHTML = `
        <span class="ft-icon"   aria-hidden="true">▶</span>
        <span class="ft-name"></span>
        <span class="ft-ver"></span>
        <span class="ft-status"></span>
        <span class="ft-deps"></span>
        <span class="ft-arrow">▸ JS API</span>
    `;
    footerBar.appendChild(footerInner);
    wrap.appendChild(footerBar);

    footerInner.addEventListener('click', () => {
        devOpen = !devOpen;
        devPanel.style.height = devOpen ? `${DEV_HEIGHT}px` : '0';
        footerInner.classList.toggle('is-open', devOpen);
        const arrow = footerInner.querySelector('.ft-arrow');
        if (arrow) arrow.style.transform = devOpen ? 'rotate(90deg)' : '';
    });

    fetch('./manifest.json').then(r => r.json()).then(m => {
        const deps = Object.values(m.dependencies || {})
            .reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
        const q = sel => footerInner.querySelector(sel);
        q('.ft-icon').textContent   = m.icon    || '▶';
        q('.ft-name').textContent   = m.name    || '';
        q('.ft-ver').textContent    = `v${m.version || ''}`;
        q('.ft-status').textContent = m.status  || '';
        q('.ft-deps').textContent   = `${deps} deps`;
    }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────

function _buildSkillsPanel() {
    const wrap = document.createElement('div');
    wrap.className = 'yt-skills';

    for (const s of SKILLS) {
        const card = document.createElement('div');
        card.className = 'yt-skills__card';

        const hdr = document.createElement('div');
        hdr.className = 'yt-skills__header';
        hdr.innerHTML = `<span>${s.label}</span><span class="yt-skills__chev">▼ expand</span>`;

        const body = document.createElement('pre');
        body.className = 'yt-skills__body';
        body.textContent = 'Loading…';

        hdr.addEventListener('click', () => {
            const open = body.style.display === 'block';
            body.style.display = open ? 'none' : 'block';
            hdr.querySelector('.yt-skills__chev').textContent = open ? '▼ expand' : '▲ collapse';
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
