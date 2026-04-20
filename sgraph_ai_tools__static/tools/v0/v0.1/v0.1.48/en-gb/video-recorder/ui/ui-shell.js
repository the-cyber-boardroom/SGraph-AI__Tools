/**
 * ui-shell.js
 * Main layout orchestrator — sg-layout row split (Controls | Preview/Recordings)
 * with infographic-style collapsible JS API dev panel and footer bar.
 *
 * Layout:
 *   #layout-wrap (flex column)
 *     toolArea   (flex:1) — inner sg-layout
 *       s-controls stack: "🎙 Recording" tab
 *       s-preview  stack: "Preview" tab + per-recording tabs (added on RECORD_STOP)
 *     devPanel   (0 → 280px) — tabs: Explorer | Console | Manifest | Skills
 *     footerBar  (fixed) — icon, name, version, status, deps; click to toggle devPanel
 *
 * @module ui-shell
 */

import { SGL_EVENTS }      from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { SGA_RECORDER }    from '../api/recorder-events.js';
import { initControls }    from './ui-controls.js';
import { initRecordingTab } from './ui-recording-tab.js';

// Side-effect imports — register custom elements before use
import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';
import '/components/sg-audio-viz/v0/v0.1/v0.1.0/sg-audio-viz.js';

let _recCount = 0;

/**
 * @param {import('../api/recorder-state.js').RecordingState}  state
 * @param {import('../api/recorder-state.js').RecordingConfig} config
 * @param {object}   api   SgToolApi instance
 * @param {Function} emit
 */
export async function init(state, config, api, emit) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    // ── Tool area ─────────────────────────────────────────────────────────────
    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    wrap.appendChild(toolArea);

    // ── Inner sg-layout: Controls | Preview/Recordings ────────────────────────
    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    toolArea.appendChild(layout);

    const layoutReady = new Promise(r => layout.events.on(SGL_EVENTS.LAYOUT_READY, r));
    layout.setLayout({
        type: 'row', id: 'root', sizes: [0.33, 0.67],
        children: [
            {
                type: 'stack', id: 's-controls', activeTab: 0,
                tabs: [{ type: 'tab', id: 't-controls', title: '🎙 Recording', tag: 'div', locked: true, closable: false }],
            },
            {
                type: 'stack', id: 's-preview', activeTab: 0,
                tabs: [{ type: 'tab', id: 't-preview', title: 'Preview', tag: 'div', locked: false, closable: false }],
            },
        ],
    });

    await layoutReady;

    const controlsEl = layout.getPanelElement('t-controls');
    const previewEl  = layout.getPanelElement('t-preview');

    // ── Mount controls in left tab ─────────────────────────────────────────────
    if (controlsEl) {
        controlsEl.style.cssText = 'height:100%;overflow-y:auto;';
        initControls(controlsEl, state, config, api, emit);
    }

    // ── Preview tab: live camera/screen feed + viz animation ─────────────────
    let _vizEl = null;
    if (previewEl) {
        const { vizProvider, vizEl } = _initPreviewTab(previewEl, state, config, layout);
        config.vizProvider = vizProvider;
        _vizEl = vizEl;
    }

    // ── On RECORD_STOP: add a recording tab to s-preview ─────────────────────
    window.addEventListener(SGA_RECORDER.RECORD_STOP, (e) => {
        const { durationMs, sizeBytes } = e.detail;

        // Snapshot blobs before reset can clear them
        const capturedBlob  = state.blob;
        const capturedBlobs = { ...state.blobs };
        const vizWasHidden  = _vizEl?.wasHidden ?? false;

        _recCount++;
        const name = config.recordingName.trim() || `Recording ${_recCount}`;

        const tabId = layout.addTabToStack('s-preview', {
            tag:      'div',
            title:    name,
            closable: true,
            locked:   false,
        }, true);

        if (tabId) {
            const tabEl = layout.getPanelElement(tabId);
            if (tabEl) {
                tabEl.style.cssText = 'height:100%;overflow:hidden;';
                const onRegenerate = (capturedBlob && vizWasHidden)
                    ? (mode, speed = 1) => _reRenderViz(capturedBlob, mode, config.fps || 30, speed)
                    : null;
                initRecordingTab(tabEl, capturedBlob, capturedBlobs, durationMs, sizeBytes, name, {
                    vizWasHidden,
                    vizMode: config.vizMode || 'smooth-eq',
                    onRegenerate,
                });
            }
        }
    });

    // ── Dev panel (collapsible, 280px when open) ──────────────────────────────
    const DEV_HEIGHT = 280;
    let devOpen = false;

    const devPanel = document.createElement('div');
    devPanel.style.cssText = [
        'height:0', 'overflow:hidden', 'flex-shrink:0',
        'transition:height 0.22s ease',
        'display:flex', 'flex-direction:column',
        'background:#0a0a18',
    ].join(';');
    wrap.appendChild(devPanel);

    // Tab bar
    const devTabBar = document.createElement('div');
    devTabBar.style.cssText = 'display:flex;background:#0d0d1a;border-bottom:1px solid #1a1a3a;flex-shrink:0;';
    devPanel.appendChild(devTabBar);

    // Content area
    const devContent = document.createElement('div');
    devContent.style.cssText = 'flex:1;position:relative;overflow:hidden;min-height:0;';
    devPanel.appendChild(devContent);

    // Tab definitions
    const DEV_TABS = [
        { id: 'explorer', label: '⚡ Explorer', tag: 'sg-tool-api-explorer' },
        { id: 'console',  label: '> Console',  tag: 'sg-tool-api-console'  },
        { id: 'manifest', label: '📋 Manifest', tag: 'sg-tool-api-manifest' },
        { id: 'skills',   label: '📄 Skills'                                },
    ];
    let activeDevTab = 'explorer';
    const devBtns    = {};

    function _switchDevTab(id) {
        activeDevTab = id;
        for (const [tid, btn] of Object.entries(devBtns)) {
            const on = tid === id;
            btn.style.color             = on ? '#4ECDC4' : '#4a5568';
            btn.style.borderBottomColor = on ? '#4ECDC4' : 'transparent';
        }
        for (const pane of devContent.querySelectorAll('[data-dev-pane]')) {
            pane.style.display = pane.dataset.devPane === id ? 'block' : 'none';
        }
    }

    for (const t of DEV_TABS) {
        const btn = document.createElement('button');
        btn.textContent = t.label;
        btn.style.cssText = [
            'padding:7px 14px', 'font-size:11px', 'font-weight:600',
            'background:none', 'border:none', 'border-bottom:2px solid transparent',
            'cursor:pointer', 'white-space:nowrap',
            'font-family:system-ui,sans-serif',
            `color:${t.id === activeDevTab ? '#4ECDC4' : '#4a5568'}`,
            `border-bottom-color:${t.id === activeDevTab ? '#4ECDC4' : 'transparent'}`,
        ].join(';');
        btn.addEventListener('click', () => _switchDevTab(t.id));
        devTabBar.appendChild(btn);
        devBtns[t.id] = btn;

        const pane = document.createElement('div');
        pane.dataset.devPane = t.id;
        pane.style.cssText = [
            'position:absolute', 'inset:0',
            `display:${t.id === activeDevTab ? 'block' : 'none'}`,
            'overflow:hidden',
        ].join(';');

        if (t.tag) {
            const el = document.createElement(t.tag);
            el.style.cssText = 'display:block;width:100%;height:100%;';
            pane.appendChild(el);
        } else {
            pane.appendChild(_buildSkillsPanel());
        }
        devContent.appendChild(pane);
    }

    // ── Footer bar ─────────────────────────────────────────────────────────────
    const footerBar = document.createElement('div');
    footerBar.style.cssText = 'flex-shrink:0;padding:0 14px 10px;background:#0a0a18;';

    const footerInner = document.createElement('div');
    footerInner.style.cssText = [
        'background:#0d0d1a', 'border:1px solid #1e293b', 'border-radius:6px',
        'display:flex', 'align-items:center', 'gap:8px', 'padding:8px 12px',
        'cursor:pointer', 'user-select:none',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        'font-size:13px', 'color:#cbd5e0', 'transition:background 150ms',
    ].join(';');
    footerInner.innerHTML = `
        <span class="ft-icon"   style="font-size:16px;line-height:1;">🎙</span>
        <span class="ft-name"   style="font-weight:600;font-size:13px;"></span>
        <span class="ft-ver"    style="color:#64748b;font-size:11px;font-family:'SF Mono',Monaco,monospace;"></span>
        <span class="ft-status" style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;background:rgba(78,205,196,0.15);color:#4ecdc4;"></span>
        <span class="ft-deps"   style="color:#64748b;font-size:11px;"></span>
        <span class="ft-arrow"  style="margin-left:auto;color:#64748b;font-size:11px;transition:transform 150ms;">▸ JS API</span>
    `;
    footerBar.appendChild(footerInner);
    wrap.appendChild(footerBar);

    footerInner.addEventListener('mouseenter', () => { footerInner.style.background = 'rgba(78,205,196,0.04)'; });
    footerInner.addEventListener('mouseleave', () => { footerInner.style.background = devOpen ? 'rgba(78,205,196,0.04)' : ''; });
    footerInner.addEventListener('click', () => {
        devOpen = !devOpen;
        devPanel.style.height  = devOpen ? `${DEV_HEIGHT}px` : '0';
        footerInner.style.borderRadius = devOpen ? '0 0 6px 6px' : '6px';
        footerInner.style.background   = devOpen ? 'rgba(78,205,196,0.04)' : '';
        const arrow = footerInner.querySelector('.ft-arrow');
        if (arrow) arrow.style.transform = devOpen ? 'rotate(90deg)' : '';
    });

    // Populate footer from manifest
    fetch('./manifest.json').then(r => r.json()).then(m => {
        const deps = Object.values(m.dependencies || {})
            .reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
        const q = cls => footerInner.querySelector(`.${cls}`);
        if (q('ft-icon'))   q('ft-icon').textContent   = m.icon    || '🎙';
        if (q('ft-name'))   q('ft-name').textContent   = m.name    || '';
        if (q('ft-ver'))    q('ft-ver').textContent    = `v${m.version || ''}`;
        if (q('ft-status')) q('ft-status').textContent = m.status  || '';
        if (q('ft-deps'))   q('ft-deps').textContent   = `${deps} deps`;
    }).catch(() => {});
}

// ── Preview tab setup ─────────────────────────────────────────────────────────

function _initPreviewTab(el, state, config, layout) {
    el.style.cssText = 'height:100%;overflow:hidden;background:var(--rec-bg,#0a0a18);position:relative;';

    // Placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'preview-placeholder';
    placeholder.innerHTML = `
        <span class="preview-placeholder__icon">🎬</span>
        <span>Select a mode and click Preview or Start Recording</span>
    `;
    el.appendChild(placeholder);

    // Camera preview video (before recording)
    const pregameVideo = document.createElement('video');
    pregameVideo.className = 'preview-video';
    pregameVideo.autoplay = true;
    pregameVideo.muted    = true;
    pregameVideo.setAttribute('playsinline', '');
    pregameVideo.style.display = 'none';
    el.appendChild(pregameVideo);

    const pregameBadge = document.createElement('div');
    pregameBadge.className = 'preview-live__badge preview-live__badge--preview';
    pregameBadge.textContent = 'PREVIEW';
    pregameBadge.style.display = 'none';
    el.appendChild(pregameBadge);

    // Live recording video (camera / screen modes)
    const liveVideo = document.createElement('video');
    liveVideo.className = 'preview-video';
    liveVideo.autoplay = true;
    liveVideo.muted    = true;
    liveVideo.setAttribute('playsinline', '');
    liveVideo.style.display = 'none';
    el.appendChild(liveVideo);

    const liveBadge = document.createElement('div');
    liveBadge.className = 'preview-live__badge';
    liveBadge.textContent = 'LIVE';
    liveBadge.style.display = 'none';
    el.appendChild(liveBadge);

    // Viz animation panel (viz+audio and screen+viz+audio modes)
    const vizWrap = document.createElement('div');
    vizWrap.style.cssText = 'position:absolute;inset:0;display:none;';
    el.appendChild(vizWrap);

    const vizEl = document.createElement('sg-audio-viz');
    vizEl.setAttribute('mode', 'smooth-eq');
    vizEl.style.cssText = 'display:block;width:100%;height:100%;';
    vizWrap.appendChild(vizEl);

    const vizBadge = document.createElement('div');
    vizBadge.className = 'preview-live__badge';
    vizBadge.textContent = '● VIZ REC';
    vizBadge.style.cssText = 'display:none;background:#6366f1;';
    el.appendChild(vizBadge);

    // Camera PiP overlay for screen+camera recording modes
    const camPip = document.createElement('video');
    camPip.autoplay = true;
    camPip.muted    = true;
    camPip.setAttribute('playsinline', '');
    camPip.style.cssText = [
        'position:absolute', 'bottom:16px', 'right:16px',
        'width:200px', 'border-radius:8px', 'display:none',
        'border:2px solid rgba(255,255,255,0.18)', 'background:#000',
    ].join(';');
    el.appendChild(camPip);

    function _showOnly(which) {
        placeholder.style.display  = which === 'placeholder' ? 'flex'  : 'none';
        pregameVideo.style.display = which === 'pregame'     ? 'block' : 'none';
        pregameBadge.style.display = which === 'pregame'     ? 'block' : 'none';
        liveVideo.style.display    = which === 'live'        ? 'block' : 'none';
        liveBadge.style.display    = which === 'live'        ? 'block' : 'none';
        // Reset viz to full-screen; callers set PiP styles explicitly after
        vizWrap.style.cssText = which === 'viz'
            ? 'position:absolute;inset:0;display:block;'
            : 'position:absolute;inset:0;display:none;';
        vizBadge.style.display = which === 'viz' ? 'block' : 'none';
        camPip.style.display   = 'none';
    }

    _showOnly('placeholder');

    window.addEventListener(SGA_RECORDER.PREVIEW_START, (e) => {
        const { stream, hasVideo } = e.detail ?? {};
        if (stream && hasVideo) {
            pregameVideo.srcObject = stream;
            pregameVideo.play().catch(() => {});
            _showOnly('pregame');
        } else {
            _showOnly('placeholder');
        }
    });

    window.addEventListener(SGA_RECORDER.PREVIEW_STOP, () => {
        pregameVideo.srcObject = null;
        _showOnly('placeholder');
    });

    window.addEventListener(SGA_RECORDER.RECORD_START, () => {
        pregameVideo.srcObject = null;
        layout.focusPanel('t-preview');

        const mode = config.mode;

        if (mode === 'viz+audio') {
            // Viz fullscreen — already started by vizProvider.start()
            _showOnly('viz');

        } else if (mode === 'screen+viz+audio') {
            // Screen main view + viz as PiP in bottom-right corner
            liveVideo.srcObject = state.stream;
            liveVideo.play().catch(() => {});
            _showOnly('live');
            vizWrap.style.cssText = [
                'position:absolute', 'bottom:16px', 'right:16px',
                'width:200px', 'height:112px', 'display:block',
                'border-radius:8px', 'overflow:hidden',
                'border:2px solid rgba(255,255,255,0.18)',
            ].join(';');
            vizBadge.style.display = 'block';

        } else if (mode.includes('screen') && mode.includes('camera')) {
            // Screen main view + camera PiP in bottom-right corner
            liveVideo.srcObject = state.stream;
            liveVideo.play().catch(() => {});
            _showOnly('live');
            const camStream = state.streams?.camera;
            if (camStream) {
                camPip.srcObject = camStream;
                camPip.play().catch(() => {});
                camPip.style.display = 'block';
            }

        } else {
            const hasVideo = state.stream?.getVideoTracks().length > 0;
            if (hasVideo) {
                liveVideo.srcObject = state.stream;
                liveVideo.play().catch(() => {});
                _showOnly('live');
            } else {
                _showOnly('placeholder');
            }
        }
    });

    window.addEventListener(SGA_RECORDER.RECORD_STOP, () => {
        liveVideo.srcObject = null;
        camPip.srcObject    = null;
        _showOnly('placeholder');
    });

    window.addEventListener(SGA_RECORDER.RESET, () => {
        liveVideo.srcObject    = null;
        pregameVideo.srcObject = null;
        camPip.srcObject       = null;
        _showOnly('placeholder');
    });

    // ── vizProvider — called by recorder-pipeline for viz modes ──────────────
    const vizProvider = {
        async start(micStream, fps) {
            // Focus preview tab so the panel is visible before we size the canvas
            layout.focusPanel('t-preview');
            // Show vizWrap full-size so canvas gets real layout dimensions
            vizWrap.style.cssText = 'position:absolute;inset:0;display:block;';
            await vizEl.whenReady();
            vizEl.setMode(config.vizMode || 'smooth-eq');
            await vizEl.setSource(micStream);
            vizEl.start();
            // Two rAFs: first lets the tab switch reflow, second ensures
            // ResizeObserver has fired and canvas dimensions are correct
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            return vizEl.captureStream(fps);
        },
        stop() {
            vizEl.stop();
            vizWrap.style.cssText = 'position:absolute;inset:0;display:none;';
        },
    };

    return { vizProvider, vizEl };
}

// ── Viz post-processing: re-render visualisation from a recorded blob ─────────
//
// Creates a temporary off-screen sg-audio-viz, plays the recorded blob through
// it silently, and captures the canvas + audio into a new combined blob.
// Called after RECORD_STOP when vizEl.wasHidden was true.
//
// The AnalyserNode is a passthrough — audio in keepAliveDest.stream is
// identical to the source, so no quality is lost beyond what the original
// MediaRecorder encoding already introduced.

async function _reRenderViz(recordedBlob, mode, fps = 30, speed = 1) {
    const W = 1280, H = 720;

    // 1. Create temporary off-screen viz element
    const wrapEl = document.createElement('div');
    wrapEl.style.cssText = `position:fixed;left:-${W + 10}px;top:0;width:${W}px;height:${H}px;pointer-events:none;overflow:hidden;`;
    const tempViz = document.createElement('sg-audio-viz');
    tempViz.style.cssText = 'display:block;width:100%;height:100%;';
    wrapEl.appendChild(tempViz);
    document.body.appendChild(wrapEl);

    try {
        await tempViz.whenReady();

        // 2. Create video element to play the recorded blob
        const videoEl = document.createElement('video');
        videoEl.preload = 'auto';
        videoEl.muted   = false;  // audio needed — AudioContext will route it
        const objUrl = URL.createObjectURL(recordedBlob);
        videoEl.src = objUrl;

        await new Promise((res, rej) => {
            videoEl.addEventListener('loadedmetadata', res, { once: true });
            videoEl.addEventListener('error', rej, { once: true });
            videoEl.load();
        });

        // 3. Connect audio through viz analyser; start render loop
        tempViz.setMode(mode);
        await tempViz.setSource(videoEl);
        tempViz.start();

        // Two rAFs so canvas dimensions sync before captureStream
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        // 4. Build output stream.
        // At speed > 1× the audio is pitch-shifted (chipmunk) so we drop it — viz
        // only. The original Audio download has the clean track.
        // At 1× we include audio — analyser passthrough is bit-identical to source.
        const vizVideoTrack = tempViz.captureStream(fps).getVideoTracks()[0];
        const audioTrack    = speed === 1 ? tempViz.getAudioCaptureStream()?.getAudioTracks()[0] : null;
        const combined      = new MediaStream([vizVideoTrack, audioTrack].filter(Boolean));

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
            ? 'video/webm;codecs=vp8,opus' : 'video/webm';
        const chunks   = [];
        const recorder = new MediaRecorder(combined, { mimeType });
        recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
        recorder.start();

        // 5. Play at requested speed, wait for end, collect blob
        videoEl.playbackRate = speed;
        await videoEl.play();

        return await new Promise((resolve, reject) => {
            videoEl.addEventListener('ended', () => {
                tempViz.stop();
                recorder.stop();
            }, { once: true });
            videoEl.addEventListener('error', reject, { once: true });
            recorder.addEventListener('stop', () => {
                URL.revokeObjectURL(objUrl);
                resolve(new Blob(chunks, { type: mimeType }));
            }, { once: true });
        });

    } finally {
        document.body.removeChild(wrapEl);
    }
}

// ── Skills panel ──────────────────────────────────────────────────────────────

function _buildSkillsPanel() {
    const SKILLS = [
        { label: '👤 Human Guide',         url: './skills/SKILL-human.md' },
        { label: '🎭 Browser / Playwright', url: './skills/SKILL-browser.md' },
        { label: '⚙️ API Spec',             url: './skills/SKILL-api.md' },
    ];
    const wrap = document.createElement('div');
    wrap.style.cssText = 'height:100%;overflow-y:auto;padding:10px 12px;background:#0a0a18;box-sizing:border-box;';

    for (const s of SKILLS) {
        const card = document.createElement('div');
        card.style.cssText = 'background:#0d0d1a;border:1px solid #1a1a3a;border-radius:4px;margin-bottom:8px;overflow:hidden;';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;cursor:pointer;font-family:system-ui,sans-serif;';
        hdr.innerHTML = `
            <span style="font-size:12px;font-weight:600;color:#a0aec0;">${s.label}</span>
            <span style="color:#4ECDC4;font-size:10px;">▼ expand</span>
        `;
        hdr.addEventListener('mouseenter', () => { hdr.style.background = '#111120'; });
        hdr.addEventListener('mouseleave', () => { hdr.style.background = ''; });

        const body = document.createElement('pre');
        body.style.cssText = [
            'display:none', 'margin:0', 'padding:10px',
            'font-size:11px', 'line-height:1.65', 'color:#718096',
            'white-space:pre-wrap', 'word-break:break-word',
            'max-height:300px', 'overflow-y:auto',
            'font-family:system-ui,sans-serif',
            'border-top:1px solid #1a1a3a',
        ].join(';');
        body.textContent = 'Loading…';

        hdr.addEventListener('click', () => {
            const open = body.style.display === 'block';
            body.style.display = open ? 'none' : 'block';
            hdr.querySelector('span:last-child').textContent = open ? '▼ expand' : '▲ collapse';
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
