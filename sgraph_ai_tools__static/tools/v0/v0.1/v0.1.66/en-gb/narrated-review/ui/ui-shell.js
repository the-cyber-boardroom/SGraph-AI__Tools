/**
 * ui-shell.js
 * Layout. Narrow (<900px — including the designed-for narrow side window,
 * Decision 3): single stack with Capture first. Wide: left column (Capture,
 * Steps) — right stack (Captures | Review | Chat | Document | Export).
 * @module ui-shell
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { initCapture }  from './ui-capture.js';
import { initPairs }    from './ui-pairs.js';
import { initReview }   from './ui-review.js';
import { initDocument } from './ui-document.js';
import { initExport }   from './ui-export.js';
import { initChat }     from './ui-chat.js';
import { initApiPane }  from './ui-api-pane.js';
import { initCaptureTab, tabTitle } from './ui-capture-tab.js';

import '/core/sg-layout/v0.1.0/sg-layout.js';
import '/components/sg-pipeline-steps/v0/v0.1/v0.1.0/sg-pipeline-steps.js';
import '/components/send-drop/v1/v1.0/v1.0.0/sg-send-drop.js';
import '/components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/sg-tool-api-explorer.js';
import '/components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/sg-tool-api-console.js';
import '/components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/sg-tool-api-manifest.js';

export async function init(state, config, api, emit, marker) {
    const wrap = document.getElementById('layout-wrap');
    if (!wrap) return;
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    // Title bar. The site header says SG/Send, not what THIS page is — opening
    // the tool cold gave no clue what it was called or what it does.
    const titleBar = document.createElement('div');
    titleBar.className = 'nr-titlebar';
    titleBar.innerHTML = `
        <span class="nr-titlebar__icon" aria-hidden="true">🎬</span>
        <h1 class="nr-titlebar__name">Narrated Review</h1>
        <span class="nr-titlebar__tag">narrate a screen &rarr; an ordered document of screenshots and words</span>
        <span class="nr-titlebar__ver" id="nr-title-ver"></span>`;
    wrap.appendChild(titleBar);
    fetch('./manifest.json').then(r => r.json()).then(m => {
        const v = titleBar.querySelector('#nr-title-ver');
        if (v) v.textContent = `v${m.version || ''} ${m.status || ''}`.trim();
    }).catch(() => {});

    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;';
    wrap.appendChild(toolArea);

    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    toolArea.appendChild(layout);

    const layoutReady = new Promise(r => layout.events.on(SGL_EVENTS.LAYOUT_READY, r));
    const narrow = matchMedia('(max-width: 900px)').matches;

    const captureTab = { type: 'tab', id: 't-capture', title: '🎬 Capture', tag: 'div', locked: true, closable: false };
    const stepsTab   = { type: 'tab', id: 't-steps',   title: '📋 Steps',   tag: 'div', locked: true, closable: false };
    // The Captures list is the fixed spine — locked and never closable.
    const listTab = { type: 'tab', id: 't-pairs', title: '🧩 Captures', tag: 'div', locked: true, closable: false };
    // Everything else is unlocked so sg-layout's drag-to-dock works: these can be
    // moved, split and stacked, and individual captures open alongside them.
    const workTabs = [
        { type: 'tab', id: 't-review',   title: '🔍 Review',   tag: 'div', locked: false, closable: false },
        { type: 'tab', id: 't-chat',     title: '💬 Chat',     tag: 'div', locked: false, closable: false },
        { type: 'tab', id: 't-document', title: '📄 Document', tag: 'div', locked: false, closable: false },
        { type: 'tab', id: 't-export',   title: '📦 Export',   tag: 'div', locked: false, closable: false },
    ];

    layout.setLayout(narrow
        ? { type: 'stack', id: 'root', activeTab: 0, tabs: [captureTab, listTab, ...workTabs, stepsTab] }
        : {
            type: 'row', id: 'root', sizes: [0.26, 0.26, 0.48],
            children: [
                {
                    type: 'column', id: 'c-left', sizes: [0.66, 0.34],
                    children: [
                        { type: 'stack', id: 's-capture', activeTab: 0, tabs: [captureTab] },
                        { type: 'stack', id: 's-steps',   activeTab: 0, tabs: [stepsTab] },
                    ],
                },
                // The list has its own column so opening captures never displaces it.
                { type: 'stack', id: 's-list', activeTab: 0, tabs: [listTab] },
                { type: 'stack', id: 's-work', activeTab: 0, tabs: workTabs },
            ],
        });
    await layoutReady;

    const panel = id => {
        const el = layout.getPanelElement(id);
        if (el) el.style.cssText = 'height:100%;overflow-y:auto;padding:12px;box-sizing:border-box;';
        return el;
    };

    // ── Captures open as their own tabs ──────────────────────────────────────
    // One tab per capture, unlocked + closable so they can be dragged, docked
    // side by side, and closed — while the Captures list stays put.
    const openTabs = new Map();          // pairId -> layout tab id
    function openCaptureTab(pairId) {
        const pair = state.pairs.find(x => x.id === pairId);
        if (!pair) return;
        const existing = openTabs.get(pairId);
        if (existing) {
            try { layout.focusPanel(existing); return; } catch (_) { openTabs.delete(pairId); }
        }
        const tab = layout.addTabToStack('s-work', {
            tag: 'div', title: tabTitle(pair), locked: false, closable: true,
        }, true);
        const tabId = typeof tab === 'string' ? tab : (tab && tab.id);
        if (!tabId) return;
        openTabs.set(pairId, tabId);
        const el = layout.getPanelElement(tabId);
        if (el) {
            el.style.cssText = 'height:100%;overflow-y:auto;padding:12px;box-sizing:border-box;';
            initCaptureTab(el, pairId, api);
        }
    }
    window.addEventListener('nr:ui:open-capture', e => openCaptureTab(e.detail.id));
    window.addEventListener('nr:pair:removed', e => openTabs.delete(e.detail.id));
    window.addEventListener('nr:reset', () => openTabs.clear());

    const focusTab = () => {};   // sg-layout focuses on click; selection flows via events

    initCapture(panel('t-capture'), state, config, api, emit, marker);
    initSteps(panel('t-steps'), state);
    initPairs(panel('t-pairs'), state, api);
    initReview(panel('t-review'), state, config, api);
    initChat(panel('t-chat'), state, api);
    initDocument(panel('t-document'), state, api);
    initExport(panel('t-export'), state, api);
    initApiPane(wrap, focusTab);
}

/** The pipeline spine over sg-pipeline-steps (the ~65-line adapter pattern). */
function initSteps(el, state) {
    if (!el) return;
    const steps = document.createElement('sg-pipeline-steps');
    el.appendChild(steps);
    steps.setSteps([
        { key: 'capture',    label: 'Capture' },
        { key: 'transcribe', label: 'Transcribe' },
        { key: 'clean',      label: 'Clean' },
        { key: 'document',   label: 'Document' },
    ]);

    function refresh() {
        const pairs = state.pairs;
        const raw = pairs.filter(p => p.raw).length;
        const clean = pairs.filter(p => p.clean).length;
        steps.setStatus('capture', {
            status: state.status === 'capturing' ? 'running' : (pairs.length ? 'done' : 'idle'),
            info: pairs.length ? `${pairs.length} captures` : '',
        });
        steps.setStatus('transcribe', {
            status: raw === 0 ? 'idle' : (raw === pairs.length ? 'done' : 'running'),
            info: raw ? `${raw}/${pairs.length}` : '',
        });
        steps.setStatus('clean', {
            status: clean === 0 ? 'idle' : (clean === pairs.length ? 'done' : 'running'),
            info: clean ? `${clean}/${pairs.length}` : '',
        });
    }
    for (const ev of ['nr:pair:added', 'nr:pair:updated', 'nr:pair:removed', 'nr:transcribe:complete',
                      'nr:clean:complete', 'nr:session:started', 'nr:session:ended', 'nr:reset', 'nr:store:loaded']) {
        window.addEventListener(ev, refresh);
    }
    window.addEventListener('nr:document:built', () => steps.setStatus('document', { status: 'done' }));
    refresh();
}
