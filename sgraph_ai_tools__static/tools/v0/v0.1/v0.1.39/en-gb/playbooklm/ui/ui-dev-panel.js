/**
 * PlaybookLM — Dev panel + footer bar builder.
 *
 * Adapted from infographic-gen/dev-panel.js (v0.1.37).
 * Appends to layoutWrap: resize handle, collapsible dev panel
 * (Explorer / Console / Manifest / Skills tabs), and the always-visible
 * footer bar that toggles the panel.
 *
 * @module ui-dev-panel
 * @version 0.1.0
 */

const DEV_HEIGHT_DEFAULT = 340;

// ── Minimal markdown renderer (inline only) ───────────────────────────────────
function _renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, '<p>$1</p>');
}

// ── CSS injection ─────────────────────────────────────────────────────────────
let _styleInjected = false;
function _injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.skill-md{line-height:1.7;color:#a0aec0;font-size:12px;font-family:system-ui,sans-serif}
.skill-md h1,.skill-md h2,.skill-md h3{margin:.75em 0 .3em;color:#4ECDC4}
.skill-md h1{font-size:1.25em}.skill-md h2{font-size:1.1em}.skill-md h3{font-size:1em}
.skill-md p{margin:.45em 0}
.skill-md ul{margin:.4em 0;padding-left:1.4em}.skill-md li{margin:.2em 0}
.skill-md code{background:#1a1a3a;border-radius:3px;padding:1px 4px;font-size:11px;font-family:'SF Mono',Monaco,monospace;color:#e2e8f0}
.skill-md strong{color:#e2e8f0}.skill-md em{color:#cbd5e0;font-style:italic}
`;
  document.head.appendChild(s);
}

// ── Skills accordion panel ────────────────────────────────────────────────────
function _buildSkillsPanel() {
  _injectStyle();
  const SKILLS = [
    { label: 'Human Guide',         url: './skills/SKILL-human.md' },
    { label: 'Browser / Playwright', url: './skills/SKILL-browser.md' },
    { label: 'API Spec',             url: './skills/SKILL-api.md' },
  ];

  const wrap = document.createElement('div');
  wrap.style.cssText = 'height:100%;overflow-y:auto;padding:10px 12px;background:#0a0a18;box-sizing:border-box;';

  for (const s of SKILLS) {
    const card = document.createElement('div');
    card.style.cssText = 'background:#0d0d1a;border:1px solid #1a1a3a;border-radius:4px;margin-bottom:8px;overflow:hidden;';

    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;cursor:pointer;font-family:system-ui,sans-serif;';
    hdr.innerHTML = `<span style="font-size:12px;font-weight:600;color:#a0aec0;">${s.label}</span><span style="color:#4ECDC4;font-size:10px;">&#9660; expand</span>`;
    hdr.addEventListener('mouseenter', () => { hdr.style.background = '#111120'; });
    hdr.addEventListener('mouseleave', () => { hdr.style.background = ''; });

    const body = document.createElement('div');
    body.className = 'skill-md';
    body.style.cssText = 'display:none;padding:10px 12px;max-height:320px;overflow-y:auto;border-top:1px solid #1a1a3a;';
    body.textContent = 'Loading…';

    hdr.addEventListener('click', () => {
      const open = body.style.display === 'block';
      body.style.display = open ? 'none' : 'block';
      hdr.querySelector('span:last-child').textContent = open ? '▼ expand' : '▲ collapse';
      if (!open && body.textContent === 'Loading…') {
        fetch(s.url).then(r => r.text()).then(t => { body.innerHTML = _renderMarkdown(t); }).catch(() => { body.textContent = 'Failed to load.'; });
      }
    });

    card.appendChild(hdr);
    card.appendChild(body);
    wrap.appendChild(card);
  }
  return wrap;
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build and append the resize handle, collapsible dev panel, and footer bar.
 *
 * @param {HTMLElement} layoutWrap - The flex-column wrapper (toolArea already appended)
 * @returns {void}
 */
export function buildDevPanel(layoutWrap) {
  let devOpen      = false;
  let devCurrentH  = DEV_HEIGHT_DEFAULT;

  // ── Resize handle ─────────────────────────────────────────────────────────
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = 'flex-shrink:0;height:6px;display:none;background:#1a1a3a;cursor:ns-resize;position:relative;transition:background 120ms;';
  const grip = document.createElement('div');
  grip.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:36px;height:2px;background:#2d3748;border-radius:2px;pointer-events:none;';
  resizeHandle.appendChild(grip);
  resizeHandle.addEventListener('mouseenter', () => { resizeHandle.style.background = '#4ECDC4'; grip.style.background = '#4ECDC4'; });
  resizeHandle.addEventListener('mouseleave', () => { resizeHandle.style.background = '#1a1a3a'; grip.style.background = '#2d3748'; });
  layoutWrap.appendChild(resizeHandle);

  // ── Dev panel ─────────────────────────────────────────────────────────────
  const devPanel = document.createElement('div');
  devPanel.style.cssText = 'height:0;overflow:hidden;flex-shrink:0;transition:height 0.22s ease;display:flex;flex-direction:column;background:#0a0a18;';
  layoutWrap.appendChild(devPanel);

  // Drag-to-resize
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

  // Tab bar
  const devTabBar = document.createElement('div');
  devTabBar.style.cssText = 'display:flex;background:#0d0d1a;border-bottom:1px solid #1a1a3a;flex-shrink:0;';
  devPanel.appendChild(devTabBar);

  const devContent = document.createElement('div');
  devContent.style.cssText = 'flex:1;position:relative;overflow:hidden;min-height:0;';
  devPanel.appendChild(devContent);

  const DEV_TABS = [
    { id: 'explorer', label: 'Explorer',  tag: 'sg-tool-api-explorer' },
    { id: 'console',  label: '> Console', tag: 'sg-tool-api-console' },
    { id: 'manifest', label: 'Manifest',  tag: 'sg-tool-api-manifest' },
    { id: 'skills',   label: 'Skills' },
  ];
  let activeDevTab = 'explorer';
  const devBtns = {};

  const switchDevTab = id => {
    activeDevTab = id;
    for (const [tid, btn] of Object.entries(devBtns)) {
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
    btn.style.cssText = `padding:7px 14px;font-size:11px;font-weight:600;background:none;border:none;border-bottom:2px solid ${t.id === activeDevTab ? '#4ECDC4' : 'transparent'};cursor:pointer;white-space:nowrap;font-family:system-ui,sans-serif;color:${t.id === activeDevTab ? '#4ECDC4' : '#4a5568'};`;
    btn.addEventListener('click', () => switchDevTab(t.id));
    devTabBar.appendChild(btn);
    devBtns[t.id] = btn;

    const pane = document.createElement('div');
    pane.dataset.devPane = t.id;
    pane.style.cssText = `position:absolute;inset:0;display:${t.id === activeDevTab ? 'block' : 'none'};overflow:hidden;`;

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
  footerBar.style.cssText = 'flex-shrink:0;padding:0 0.75rem 0.5rem;background:#0a0a18;';

  const footerInner = document.createElement('div');
  footerInner.style.cssText = 'background:#0d0d1a;border:1px solid #1e293b;border-radius:6px;display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#cbd5e0;transition:background 150ms;';
  footerInner.innerHTML = `
    <span class="ft-icon"   style="font-size:16px;line-height:1;">&#128214;</span>
    <span class="ft-name"   style="font-weight:600;font-size:13px;"></span>
    <span class="ft-ver"    style="color:#64748b;font-size:11px;font-family:'SF Mono',Monaco,monospace;"></span>
    <span class="ft-status" style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:rgba(78,205,196,.15);color:#4ecdc4;"></span>
    <span class="ft-deps"   style="color:#64748b;font-size:11px;"></span>
    <span class="ft-arrow"  style="margin-left:auto;color:#64748b;font-size:11px;transition:transform 150ms;">&#9656;</span>
  `;
  footerBar.appendChild(footerInner);
  layoutWrap.appendChild(footerBar);

  footerInner.addEventListener('mouseenter', () => { footerInner.style.background = 'rgba(78,205,196,0.04)'; });
  footerInner.addEventListener('mouseleave', () => { footerInner.style.background = devOpen ? 'rgba(78,205,196,0.04)' : ''; });
  footerInner.addEventListener('click', () => {
    devOpen = !devOpen;
    devPanel.style.height      = devOpen ? `${devCurrentH}px` : '0';
    resizeHandle.style.display = devOpen ? 'block' : 'none';
    footerInner.style.borderRadius = devOpen ? '0 0 6px 6px' : '6px';
    footerInner.style.borderTop    = devOpen ? '1px solid #4ECDC4' : '1px solid #1e293b';
    footerInner.style.background   = devOpen ? 'rgba(78,205,196,0.04)' : '';
    const arrow = footerInner.querySelector('.ft-arrow');
    if (arrow) arrow.style.transform = devOpen ? 'rotate(90deg)' : '';
  });

  // Populate footer from manifest.json
  fetch('./manifest.json')
    .then(r => r.json())
    .then(m => {
      const loaderCount = (m.dependencies?.loader ?? []).length;
      const q = cls => footerInner.querySelector(`.${cls}`);
      if (q('ft-name'))   q('ft-name').textContent   = m.name    || 'PlaybookLM';
      if (q('ft-ver'))    q('ft-ver').textContent    = `v${m.version || ''}`;
      if (q('ft-status')) q('ft-status').textContent = m.status  || '';
      if (q('ft-deps'))   q('ft-deps').textContent   = `${loaderCount} deps`;
    })
    .catch(() => {});
}
