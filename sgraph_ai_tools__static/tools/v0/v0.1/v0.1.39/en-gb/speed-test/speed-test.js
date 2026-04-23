/**
 * Speed Test v2 — main orchestrator.
 *
 * Changes from v0.1.38 → v0.1.39
 * --------------------------------
 *  - Imports from sg-send-upload v1.1.0 and sg-send-download v1.0.0 (zero
 *    reimplementation: SpeedTracker, formatSpeed, ChunkedUploader/Downloader
 *    all sourced from core modules).
 *  - Two modes: Sim (crypto benchmark, works offline) and Live (real server,
 *    uses ChunkedUploader/Downloader — no non-existent probe endpoints).
 *  - Fixed crypto.getRandomValues crash (now uses randomBytes() helper that
 *    fills in 65,536-byte chunks).
 *  - sg-layout fractal window management + collapsible bottom dev panel
 *    (⚡ Explorer / > Console / 📋 Manifest / 📄 Skills).
 *  - SgToolApi registration → window.__tool with 11 discoverable methods.
 *  - Three SKILL files (human/browser/api).
 *  - Test history: last 10 runs with min/mean/max summary.
 *
 * @version 0.1.39
 */

import { SgToolApi }  from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { SGA_TOOL }   from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api-events.js';

import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

import { runSimBenchmark, formatSpeed, formatEta }    from './speed-test-sim.js';
import { runLiveUpload, runLiveDownload }              from './speed-test-live.js';

// ── Layout shell refs (from index.html) ───────────────────────────────────────
const layoutWrap   = document.getElementById('layout-wrap');

// ── State ─────────────────────────────────────────────────────────────────────
let _mode          = 'sim';     // 'sim' | 'live'
let _abortCtrl     = null;
let _history       = [];        // last 10 SimResult or LiveResult objects
const MAX_HISTORY  = 10;

// ── UI construction ───────────────────────────────────────────────────────────

function buildUI() {
    // ── Outer flex column: tool area + resize handle + dev panel ─────────────
    layoutWrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    // ── Tool area (flex:1) ────────────────────────────────────────────────────
    const toolArea = document.createElement('div');
    toolArea.id = 'speed-test-main';
    toolArea.dataset.panelId = 'speed-test-main';
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;';
    layoutWrap.appendChild(toolArea);

    buildToolContent(toolArea);

    // ── Resize handle ─────────────────────────────────────────────────────────
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = [
        'flex-shrink:0', 'height:6px', 'display:none',
        'background:#1a1a3a', 'cursor:ns-resize', 'position:relative',
        'transition:background 120ms',
    ].join(';');
    const grip = document.createElement('div');
    grip.style.cssText = [
        'position:absolute', 'left:50%', 'top:50%',
        'transform:translate(-50%,-50%)',
        'width:36px', 'height:2px',
        'background:#2d3748', 'border-radius:2px',
        'pointer-events:none',
    ].join(';');
    resizeHandle.appendChild(grip);
    resizeHandle.addEventListener('mouseenter', () => { resizeHandle.style.background = '#4ECDC4'; grip.style.background = '#4ECDC4'; });
    resizeHandle.addEventListener('mouseleave', () => { resizeHandle.style.background = '#1a1a3a'; grip.style.background = '#2d3748'; });
    layoutWrap.appendChild(resizeHandle);

    // ── Collapsible dev panel ─────────────────────────────────────────────────
    const DEV_DEFAULT_H = 320;
    let devOpen = false;
    let devH    = DEV_DEFAULT_H;

    const devPanel = document.createElement('div');
    devPanel.style.cssText = [
        'height:0', 'overflow:hidden', 'flex-shrink:0',
        'transition:height 0.22s ease',
        'display:flex', 'flex-direction:column',
        'background:#0a0a18',
    ].join(';');
    layoutWrap.appendChild(devPanel);

    // Drag-to-resize
    resizeHandle.addEventListener('mousedown', e => {
        e.preventDefault();
        const startY = e.clientY;
        const startH = devPanel.offsetHeight;
        devPanel.style.transition = 'none';
        const onMove = e => {
            const d = startY - e.clientY;
            devH = Math.max(140, Math.min(startH + d, window.innerHeight * 0.75));
            devPanel.style.height = `${devH}px`;
        };
        const onUp = () => {
            devPanel.style.transition = 'height 0.22s ease';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    // Dev panel tab bar
    const devTabBar = document.createElement('div');
    devTabBar.style.cssText = 'display:flex;background:#0d0d1a;border-bottom:1px solid #1a1a3a;flex-shrink:0;';
    devPanel.appendChild(devTabBar);

    const devContent = document.createElement('div');
    devContent.style.cssText = 'flex:1;position:relative;overflow:hidden;min-height:0;';
    devPanel.appendChild(devContent);

    const DEV_TABS = [
        { id: 'explorer', label: '⚡ Explorer', tag: 'sg-tool-api-explorer' },
        { id: 'console',  label: '> Console',  tag: 'sg-tool-api-console'  },
        { id: 'manifest', label: '📋 Manifest', tag: 'sg-tool-api-manifest' },
        { id: 'skills',   label: '📄 Skills' },
    ];
    let activeDevTab = 'explorer';
    const devBtns = {};

    function switchDevTab(id) {
        activeDevTab = id;
        for (const [tid, btn] of Object.entries(devBtns)) {
            const on = tid === id;
            btn.style.color             = on ? '#4ECDC4' : '#4a5568';
            btn.style.borderBottomColor = on ? '#4ECDC4' : 'transparent';
        }
        for (const p of devContent.querySelectorAll('[data-dev-pane]')) {
            p.style.display = p.dataset.devPane === id ? 'block' : 'none';
        }
    }

    for (const t of DEV_TABS) {
        const btn = document.createElement('button');
        btn.textContent = t.label;
        btn.style.cssText = [
            'padding:7px 14px', 'font-size:11px', 'font-weight:600',
            'background:none', 'border:none', 'border-bottom:2px solid transparent',
            'cursor:pointer', 'white-space:nowrap', 'font-family:system-ui,sans-serif',
            `color:${t.id === activeDevTab ? '#4ECDC4' : '#4a5568'}`,
            `border-bottom-color:${t.id === activeDevTab ? '#4ECDC4' : 'transparent'}`,
        ].join(';');
        btn.addEventListener('click', () => switchDevTab(t.id));
        devTabBar.appendChild(btn);
        devBtns[t.id] = btn;

        const pane = document.createElement('div');
        pane.dataset.devPane = t.id;
        pane.style.cssText = [
            'position:absolute', 'inset:0', 'overflow:hidden',
            `display:${t.id === activeDevTab ? 'block' : 'none'}`,
        ].join(';');

        if (t.tag) {
            const el = document.createElement(t.tag);
            el.style.cssText = 'display:block;width:100%;height:100%;';
            pane.appendChild(el);
        } else {
            pane.appendChild(_buildSkillsPane());
        }
        devContent.appendChild(pane);
    }

    // ── Footer bar (toggle dev panel) ─────────────────────────────────────────
    const footerBar = document.createElement('div');
    footerBar.style.cssText = [
        'flex-shrink:0', 'display:flex', 'align-items:center', 'gap:10px',
        'padding:5px 12px', 'background:#070b14',
        'border-top:1px solid #1e2a40',
        'cursor:pointer', 'user-select:none',
        'font-family:system-ui,sans-serif', 'font-size:11px', 'color:#4a6080',
    ].join(';');
    footerBar.innerHTML = `
        <span style="font-size:13px;">⚡</span>
        <span style="font-weight:600;color:#6b7280;">Speed Test</span>
        <span id="ft-version" style="color:#374151;">v0.1.39</span>
        <span id="ft-badge" style="padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:#0f2a1a;color:#4ade80;border:1px solid #166534;">beta</span>
        <span style="margin-left:auto;color:#374151;" id="ft-toggle">▲ Developer Panel</span>
    `;
    layoutWrap.appendChild(footerBar);

    footerBar.addEventListener('click', () => {
        devOpen = !devOpen;
        devPanel.style.height      = devOpen ? `${devH}px` : '0';
        resizeHandle.style.display = devOpen ? 'block' : 'none';
        footerBar.style.borderTopColor = devOpen ? '#4ECDC4' : '#1e2a40';
        footerBar.querySelector('#ft-toggle').textContent = devOpen ? '▼ Developer Panel' : '▲ Developer Panel';
    });
}

// ── Tool content area ─────────────────────────────────────────────────────────

// DOM refs populated by buildToolContent
let _modeSimBtn, _modeLiveBtn;
let _simSection, _liveSection;
let _probeSize;
let _sendUrlInput, _tokenInput;
let _dlUrlInput;
let _runBtn, _cancelBtn;
let _simEncCard, _simDecCard;
let _dlCard, _ulCard;
let _historyList;

function buildToolContent(container) {
    container.innerHTML = `
<div style="
    flex:1; overflow-y:auto; padding:1rem 1rem 0.5rem;
    display:flex; flex-direction:column; gap:0.75rem;
    font-family:system-ui,sans-serif; background:#070b14; color:#c8d0e0;
">
    <!-- Mode selector -->
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:11px;color:#4a6080;text-transform:uppercase;letter-spacing:.06em;">Mode</span>
        <button id="mode-sim-btn"  style="${modeBtn(true )}">⚙ Sim (offline)</button>
        <button id="mode-live-btn" style="${modeBtn(false)}">🌐 Live (server)</button>
        <span style="flex:1;"></span>
        <select id="probe-size" style="${selectStyle()}">
            <option value="${1  *1048576}" >1 MB</option>
            <option value="${4  *1048576}" selected>4 MB</option>
            <option value="${10 *1048576}">10 MB</option>
            <option value="${25 *1048576}">25 MB</option>
        </select>
    </div>

    <!-- Sim section -->
    <div id="sim-section" style="display:flex;flex-direction:column;gap:4px;">
        <div style="font-size:11px;color:#374151;">
            Crypto benchmark — encrypts &amp; decrypts a random payload locally.
            No server required. Measures AES-256-GCM throughput.
        </div>
    </div>

    <!-- Live section -->
    <div id="live-section" style="display:none;flex-direction:column;gap:6px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <label style="font-size:11px;color:#4a6080;white-space:nowrap;">TARGET URL</label>
            <input id="send-url-input" type="text" value="https://send.sgraph.ai"
                style="${inputStyle()};flex:1;min-width:200px;" spellcheck="false">
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <label style="font-size:11px;color:#4a6080;white-space:nowrap;">ACCESS TOKEN</label>
            <input id="token-input" type="password" placeholder="x-sgraph-access-token"
                style="${inputStyle()};flex:1;min-width:200px;" autocomplete="off">
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <label style="font-size:11px;color:#4a6080;white-space:nowrap;">DOWNLOAD URL</label>
            <input id="dl-url-input" type="text" placeholder="Paste a direct binary URL to test download speed (or run upload first)"
                style="${inputStyle()};flex:1;min-width:200px;" spellcheck="false">
        </div>
        <div style="font-size:11px;color:#374151;">
            Upload: creates a real encrypted transfer. Download: fetches the URL you provide
            via HTTP Range requests. After upload, the transfer URL is pasted automatically.
        </div>
    </div>

    <!-- Run controls -->
    <div style="display:flex;gap:8px;align-items:center;">
        <button id="run-btn" style="${runBtnStyle()}">Run Test</button>
        <button id="cancel-btn" style="${cancelBtnStyle()};display:none;">Cancel</button>
    </div>

    <!-- Meter cards row -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <!-- Sim cards (shown in sim mode) -->
        <div id="sim-enc-card" style="${cardStyle()}">
            ${meterCard('sim-enc', '⚙ Encrypt', 'AES-256-GCM throughput')}
        </div>
        <div id="sim-dec-card" style="${cardStyle()}">
            ${meterCard('sim-dec', '⚙ Decrypt', 'AES-256-GCM throughput')}
        </div>
        <!-- Live cards (shown in live mode) -->
        <div id="ul-card" style="${cardStyle()};display:none;">
            ${meterCard('ul', '⬆ Upload', 'ChunkedUploader network speed')}
        </div>
        <div id="dl-card" style="${cardStyle()};display:none;">
            ${meterCard('dl', '⬇ Download', 'ChunkedDownloader network speed')}
        </div>
    </div>

    <!-- History -->
    <div style="font-size:11px;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-top:4px;">
        History
    </div>
    <div id="history-list"
        style="font-size:11px;font-family:monospace;color:#4a6080;background:#0d1422;
               border:1px solid #1e2a40;border-radius:6px;padding:8px 10px;
               min-height:40px;max-height:160px;overflow-y:auto;">
        No runs yet.
    </div>
</div>
`;

    _modeSimBtn  = container.querySelector('#mode-sim-btn');
    _modeLiveBtn = container.querySelector('#mode-live-btn');
    _simSection  = container.querySelector('#sim-section');
    _liveSection = container.querySelector('#live-section');
    _probeSize   = container.querySelector('#probe-size');
    _sendUrlInput = container.querySelector('#send-url-input');
    _tokenInput  = container.querySelector('#token-input');
    _dlUrlInput  = container.querySelector('#dl-url-input');
    _runBtn      = container.querySelector('#run-btn');
    _cancelBtn   = container.querySelector('#cancel-btn');
    _simEncCard  = container.querySelector('#sim-enc-card');
    _simDecCard  = container.querySelector('#sim-dec-card');
    _ulCard      = container.querySelector('#ul-card');
    _dlCard      = container.querySelector('#dl-card');
    _historyList = container.querySelector('#history-list');

    _modeSimBtn.addEventListener('click',  () => setMode('sim'));
    _modeLiveBtn.addEventListener('click', () => setMode('live'));
    _runBtn.addEventListener('click',     () => _run().catch(console.error));
    _cancelBtn.addEventListener('click',  () => { if (_abortCtrl) _abortCtrl.abort(); });
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const modeBtn  = (active) => [
    'padding:4px 14px', 'border-radius:4px', 'font-size:12px', 'cursor:pointer',
    'font-family:system-ui,sans-serif', 'font-weight:600',
    active
        ? 'background:#0f2a1a;border:1px solid #166534;color:#4ade80;'
        : 'background:#0d1422;border:1px solid #1e2a40;color:#4a6080;',
].join(';');

const inputStyle = () => [
    'background:#0d1422', 'border:1px solid #1e2a40', 'border-radius:4px',
    'color:#8aa0c0', 'font-size:12px', 'padding:4px 8px',
].join(';');

const selectStyle = () => inputStyle() + ';min-width:80px;';

const runBtnStyle = () => [
    'padding:7px 24px', 'background:#1a3a6e', 'border:1px solid #3b82f6',
    'border-radius:6px', 'color:#93c5fd', 'cursor:pointer',
    'font-size:13px', 'font-weight:600',
].join(';');

const cancelBtnStyle = () => [
    'padding:5px 14px', 'background:transparent', 'border:1px solid #7f1d1d',
    'border-radius:6px', 'color:#f87171', 'cursor:pointer', 'font-size:12px',
].join(';');

const cardStyle = () => [
    'flex:1', 'min-width:180px', 'background:#0d1422', 'border:1px solid #1e2a40',
    'border-radius:8px', 'padding:14px 16px 10px',
].join(';');

function meterCard(id, title, subtitle) {
    return `
        <div style="font-size:11px;color:#4a6080;margin-bottom:6px;">
            ${title}
            <span style="color:#2d3a4a;font-size:10px;margin-left:4px;">${subtitle}</span>
        </div>
        <div id="${id}-speed"
            style="font-size:2rem;font-weight:700;color:#c8d0e0;line-height:1;min-height:2.2rem;">—</div>
        <div id="${id}-mbps"
            style="font-size:12px;color:#3b82f6;min-height:1.2rem;margin-top:2px;"></div>
        <div style="margin-top:8px;height:5px;background:#0a0f1a;border-radius:3px;overflow:hidden;">
            <div id="${id}-bar" data-state="idle"
                style="height:100%;width:0%;border-radius:3px;background:#3b82f6;transition:width .3s ease;"></div>
        </div>
        <div id="${id}-status" style="font-size:11px;color:#374151;min-height:1.2rem;margin-top:4px;"></div>
    `;
}

// ── Skills pane ───────────────────────────────────────────────────────────────
function _buildSkillsPane() {
    const SKILLS = [
        { label: '👤 Human Guide',          url: './SKILL-human.md' },
        { label: '🎭 Browser / Playwright',  url: './SKILL-browser.md' },
        { label: '⚙ API Spec',              url: './SKILL-api.md' },
    ];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'height:100%;overflow-y:auto;padding:10px 12px;background:#0a0a18;box-sizing:border-box;';
    for (const s of SKILLS) {
        const card = document.createElement('div');
        card.style.cssText = 'background:#0d0d1a;border:1px solid #1a1a3a;border-radius:4px;margin-bottom:8px;overflow:hidden;';
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;cursor:pointer;font-family:system-ui,sans-serif;';
        hdr.innerHTML = `<span style="font-size:11px;color:#6b7280;">${s.label}</span>
            <span style="font-size:10px;color:#374151;">▶ Load</span>`;
        const body = document.createElement('div');
        body.style.cssText = 'display:none;padding:8px 10px;font-size:11px;color:#6b7280;font-family:monospace;white-space:pre-wrap;';
        hdr.addEventListener('click', async () => {
            if (body.style.display === 'none') {
                if (!body.textContent) {
                    body.textContent = 'Loading…';
                    try { body.textContent = await (await fetch(s.url)).text(); } catch { body.textContent = '(failed to load)'; }
                }
                body.style.display = 'block';
                hdr.querySelector('span:last-child').textContent = '▼ Collapse';
            } else {
                body.style.display = 'none';
                hdr.querySelector('span:last-child').textContent = '▶ Load';
            }
        });
        card.appendChild(hdr);
        card.appendChild(body);
        wrap.appendChild(card);
    }
    return wrap;
}

// ── Mode switching ────────────────────────────────────────────────────────────

function setMode(mode) {
    _mode = mode;
    const simOn  = mode === 'sim';
    const liveOn = mode === 'live';
    _modeSimBtn.style  = modeBtn(simOn);
    _modeLiveBtn.style = modeBtn(liveOn);
    _simSection.style.display  = simOn  ? 'flex' : 'none';
    _liveSection.style.display = liveOn ? 'flex' : 'none';
    _simEncCard.style.display  = simOn  ? 'block' : 'none';
    _simDecCard.style.display  = simOn  ? 'block' : 'none';
    _ulCard.style.display      = liveOn ? 'block' : 'none';
    _dlCard.style.display      = liveOn ? 'block' : 'none';
}

// ── Card helpers ──────────────────────────────────────────────────────────────

function resetCard(prefix) {
    document.getElementById(`${prefix}-speed`).textContent = '—';
    document.getElementById(`${prefix}-mbps`).textContent  = '';
    document.getElementById(`${prefix}-bar`).style.width   = '0%';
    document.getElementById(`${prefix}-bar`).dataset.state = 'idle';
    document.getElementById(`${prefix}-status`).textContent = '';
}

function updateCard(prefix, { bps, mbps, percent, status }) {
    if (bps > 0) {
        document.getElementById(`${prefix}-speed`).textContent = formatSpeed(bps);
        document.getElementById(`${prefix}-mbps`).textContent  = `${((bps * 8) / 1e6).toFixed(1)} Mbps`;
    }
    if (percent >= 0) {
        document.getElementById(`${prefix}-bar`).style.width   = `${Math.min(percent, 100)}%`;
        document.getElementById(`${prefix}-bar`).dataset.state = 'running';
    }
    if (status) document.getElementById(`${prefix}-status`).textContent = status;
}

function finalCard(prefix, result, label) {
    const bps  = result.bps  ?? result.encryptBps ?? result.decryptBps ?? 0;
    const mbps = result.mbps ?? ((bps * 8) / 1e6);
    const lbl  = label || result.label || result.encryptLabel || result.decryptLabel || '—';
    document.getElementById(`${prefix}-speed`).textContent = lbl;
    document.getElementById(`${prefix}-mbps`).textContent  = `${mbps.toFixed(1)} Mbps`;
    document.getElementById(`${prefix}-bar`).style.width   = '100%';
    document.getElementById(`${prefix}-bar`).dataset.state = result.aborted ? 'aborted' : 'done';
    if (!result.aborted) {
        const bytesM = ((result.bytesTotal ?? result.sizeBytes ?? 0) / 1e6).toFixed(1);
        const durS   = ((result.durationMs ?? (result.encryptMs ?? 0) + (result.decryptMs ?? 0)) / 1e3).toFixed(1);
        document.getElementById(`${prefix}-status`).textContent = `${bytesM} MB in ${durS}s`;
    }
}

// ── Bar animation CSS ─────────────────────────────────────────────────────────

(function injectBarCSS() {
    const s = document.createElement('style');
    s.textContent = `
        [data-state="running"] {
            background: linear-gradient(90deg,#1d4ed8,#3b82f6,#60a5fa) !important;
            background-size:200% 100% !important;
            animation: st-shimmer 1.2s infinite linear;
        }
        [data-state="done"]    { background:#22c55e !important; }
        [data-state="error"]   { background:#ef4444 !important; }
        [data-state="aborted"] { background:#6b7280 !important; }
        @keyframes st-shimmer {
            0%   { background-position:200% 0; }
            100% { background-position:0%   0; }
        }
    `;
    document.head.appendChild(s);
})();

// ── Run test ──────────────────────────────────────────────────────────────────

function setRunning(running) {
    _runBtn.disabled           = running;
    _cancelBtn.style.display   = running ? 'inline-block' : 'none';
    _runBtn.style.opacity      = running ? '0.4' : '1';
    _runBtn.style.cursor       = running ? 'not-allowed' : 'pointer';
}

async function _run() {
    _abortCtrl = new AbortController();
    const signal = _abortCtrl.signal;
    const sizeBytes = parseInt(_probeSize.value, 10);

    setRunning(true);

    let result = null;

    try {
        if (_mode === 'sim') {
            resetCard('sim-enc');
            resetCard('sim-dec');
            document.getElementById('sim-enc-status').textContent = 'Running…';
            document.getElementById('sim-dec-status').textContent = 'Pending…';

            result = await runSimBenchmark({
                sizeBytes,
                signal,
                onProgress: ({ stage, percent }) => {
                    if (stage === 'encrypting' || stage === 'keygen' || stage === 'generating') {
                        updateCard('sim-enc', { bps: 0, mbps: 0, percent, status: `${stage}…` });
                    } else if (stage === 'decrypting') {
                        document.getElementById('sim-enc-bar').style.width = '100%';
                        document.getElementById('sim-enc-bar').dataset.state = 'done';
                        updateCard('sim-dec', { bps: 0, mbps: 0, percent, status: 'decrypting…' });
                    } else if (stage === 'complete') {
                        updateCard('sim-dec', { bps: 0, mbps: 0, percent: 100, status: '' });
                    }
                },
            });

            finalCard('sim-enc', { bps: result.encryptBps, mbps: (result.encryptBps * 8) / 1e6, label: result.encryptLabel,
                bytesTotal: result.sizeBytes, durationMs: result.encryptMs, aborted: result.aborted });
            finalCard('sim-dec', { bps: result.decryptBps, mbps: (result.decryptBps * 8) / 1e6, label: result.decryptLabel,
                bytesTotal: result.sizeBytes, durationMs: result.decryptMs, aborted: result.aborted });

        } else {
            // Live mode
            const sendUrl     = _sendUrlInput.value.trim().replace(/\/$/, '');
            const accessToken = _tokenInput.value.trim();
            const dlUrl       = _dlUrlInput.value.trim();

            resetCard('ul');
            resetCard('dl');

            let ulResult = null;
            let dlResult = null;

            // Upload test (requires accessToken)
            if (accessToken) {
                document.getElementById('ul-status').textContent = 'Testing…';
                try {
                    ulResult = await runLiveUpload({
                        sendUrl, accessToken, sizeBytes, signal,
                        onProgress: p => updateCard('ul', {
                            bps: p.bytesPerSecond, mbps: (p.bytesPerSecond * 8) / 1e6,
                            percent: p.percent, status: `${p.chunksDone}/${p.chunksTotal} chunks • ${p.threadCount} threads`,
                        }),
                    });
                    finalCard('ul', ulResult, ulResult.label);
                    // Auto-fill download URL with the transfer URL
                    if (ulResult.downloadUrl && !_dlUrlInput.value.trim()) {
                        _dlUrlInput.value = ulResult.downloadUrl;
                    }
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        document.getElementById('ul-status').textContent = `Error: ${err.message}`;
                        document.getElementById('ul-bar').dataset.state  = 'error';
                    }
                }
            } else {
                document.getElementById('ul-status').textContent = 'No access token — upload test skipped.';
            }

            if (signal.aborted) { setRunning(false); return; }

            // Download test
            const downloadTarget = _dlUrlInput.value.trim() || (ulResult?.downloadUrl ?? '');
            if (downloadTarget) {
                document.getElementById('dl-status').textContent = 'Testing…';
                try {
                    dlResult = await runLiveDownload(downloadTarget, {
                        signal,
                        onProgress: p => updateCard('dl', {
                            bps: p.bytesPerSecond, mbps: (p.bytesPerSecond * 8) / 1e6,
                            percent: p.percent, status: `${p.chunksDone}/${p.chunksTotal} chunks`,
                        }),
                    });
                    finalCard('dl', dlResult, dlResult.label);
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        document.getElementById('dl-status').textContent = `Error: ${err.message}`;
                        document.getElementById('dl-bar').dataset.state  = 'error';
                    }
                }
            } else {
                document.getElementById('dl-status').textContent = 'No download URL — paste a URL or run upload test first.';
            }

            result = { type: 'live', upload: ulResult, download: dlResult };
        }

    } catch (err) {
        if (err.name !== 'AbortError') console.error('[speed-test]', err);
    }

    setRunning(false);

    if (result && !signal.aborted) {
        _addHistory(result);
    }

    // Update API last results
    if (_api) _api._lastResult = result;
}

// ── History ───────────────────────────────────────────────────────────────────

function _addHistory(result) {
    _history.unshift({ ts: Date.now(), result });
    if (_history.length > MAX_HISTORY) _history.pop();
    _renderHistory();
}

function _renderHistory() {
    if (!_historyList) return;
    if (_history.length === 0) { _historyList.textContent = 'No runs yet.'; return; }

    const lines = _history.map((h, i) => {
        const ts = new Date(h.ts).toLocaleTimeString();
        if (h.result.type === 'sim') {
            return `[${i === 0 ? 'latest' : ts}] sim  enc:${h.result.encryptLabel}  dec:${h.result.decryptLabel}`;
        } else {
            const ul = h.result.upload?.label   ?? '—';
            const dl = h.result.download?.label ?? '—';
            return `[${i === 0 ? 'latest' : ts}] live  up:${ul}  down:${dl}`;
        }
    });

    // Statistics for same-mode runs
    const simRuns  = _history.filter(h => h.result.type === 'sim').map(h => h.result.encryptBps);
    const liveUp   = _history.filter(h => h.result.upload).map(h => h.result.upload.bps);
    const liveDl   = _history.filter(h => h.result.download).map(h => h.result.download.bps);

    const stats = (arr, label) => {
        if (arr.length < 2) return null;
        const mn  = Math.min(...arr);
        const mx  = Math.max(...arr);
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        return `${label}: min ${formatSpeed(mn)}  avg ${formatSpeed(avg)}  max ${formatSpeed(mx)}`;
    };

    const statLines = [
        stats(simRuns, 'enc avg'),
        stats(liveUp,  'up  avg'),
        stats(liveDl,  'dl  avg'),
    ].filter(Boolean);

    _historyList.textContent = [...lines, ...(statLines.length ? ['', ...statLines] : [])].join('\n');
}

// ── SgToolApi ─────────────────────────────────────────────────────────────────

let _api = null;

async function initApi() {
    _api = new SgToolApi({
        name:     'speed-test',
        version:  { api: '0.1.0', ui: '0.1.39' },
        panelId:  'speed-test-main',
        manifest: './manifest.json',
        skills: {
            human:   './SKILL-human.md',
            browser: './SKILL-browser.md',
            api:     './SKILL-api.md',
        },
    });

    _api.register('runAll',            async ()           => _run(),                          { async: true  });
    _api.register('runSim',            async (opts = {})  => runSimBenchmark({ ...opts, sizeBytes: parseInt(_probeSize?.value ?? '4194304', 10) }), { async: true  });
    _api.register('runUpload',         async (opts = {})  => runLiveUpload({ sendUrl: _sendUrlInput?.value, accessToken: _tokenInput?.value, ...opts }), { async: true });
    _api.register('runDownload',       async (url, opts)  => runLiveDownload(url, opts),      { async: true  });
    _api.register('cancel',            ()                 => { if (_abortCtrl) _abortCtrl.abort(); }, { async: false });
    _api.register('setMode',           (mode)             => setMode(mode),                   { async: false });
    _api.register('setTarget',         (url)              => { if (_sendUrlInput) _sendUrlInput.value = url; }, { async: false });
    _api.register('setAccessToken',    (tok)              => { if (_tokenInput) _tokenInput.value = tok; }, { async: false, sanitiseParams: () => ({ token: '••••' }) });
    _api.register('setDownloadUrl',    (url)              => { if (_dlUrlInput) _dlUrlInput.value = url; }, { async: false });
    _api.register('getLastResult',     ()                 => _api._lastResult ?? null,         { async: false });
    _api.register('getHistory',        ()                 => _history.map(h => ({ ts: h.ts, result: h.result })), { async: false });

    _api._lastResult = null;
    _api.activate();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

buildUI();
setMode('sim');     // default mode: sim (works offline, no credentials needed)
initApi().catch(console.error);
