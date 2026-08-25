/**
 * Mermaid Diagrams — UI shell.
 *
 * Layout (sg-layout, 2-column row):
 *   Left  35%: [🎨 Examples] [✏️ Editor] tab stack
 *   Right 65%: [📊 Preview] tab (sg-mermaid-render)
 *
 * Wires:
 *   demo-selected  → editor.setValue() + renderer.render()
 *   markup-changed → renderer.render()
 *
 * Returns { renderer, editor, demos } for api wiring.
 *
 * @module ui-shell
 * @version 0.1.57
 */

import { SGL_EVENTS } from '/core/sg-layout/v0.1.0/sg-layout-events.js';
import { buildDevPanel } from '../dev-panel.js';

const INITIAL_MARKUP = `flowchart TD
    A([Browser]) --> B{API Gateway}
    B -->|Valid token| C[Service A]
    B -->|Invalid token| D[401 Unauthorized]
    C --> E[(PostgreSQL)]
    C --> F[(Redis Cache)]
    F -->|Cache hit| G([Response])
    E -->|Cache miss| G`;

/**
 * @param {HTMLElement} layoutWrap  — the #layout-wrap div
 * @returns {Promise<{ renderer: HTMLElement, editor: HTMLElement, demos: HTMLElement }>}
 */
export async function init(layoutWrap) {
    // ── Outer flex column: tool area + dev panel ──────────────────────────────
    layoutWrap.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;';

    const toolArea = document.createElement('div');
    toolArea.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;';
    layoutWrap.appendChild(toolArea);

    // ── sg-layout ─────────────────────────────────────────────────────────────
    const layout = document.createElement('sg-layout');
    layout.style.cssText = 'width:100%;height:100%;display:block;';
    toolArea.appendChild(layout);

    await new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));

    layout.setLayout({
        type: 'row', id: 'main', sizes: [0.35, 0.65],
        children: [
            {
                type: 'stack', id: 's-left', activeTab: 0,
                tabs: [
                    { type: 'tab', id: 't-demos',  title: '🎨 Examples', tag: 'div', locked: true, closable: false },
                    { type: 'tab', id: 't-editor', title: '✏️ Editor',   tag: 'div', locked: true, closable: false },
                ],
            },
            {
                type: 'stack', id: 's-right', activeTab: 0,
                tabs: [
                    { type: 'tab', id: 't-render', title: '📊 Preview', tag: 'div', locked: true, closable: false },
                ],
            },
        ],
    });

    await new Promise(resolve => layout.events.on(SGL_EVENTS.LAYOUT_READY, resolve));

    const demosPanel  = layout.getPanelElement('t-demos');
    const editorPanel = layout.getPanelElement('t-editor');
    const renderPanel = layout.getPanelElement('t-render');

    // ── Panel base styles ─────────────────────────────────────────────────────
    [demosPanel, editorPanel, renderPanel].forEach(p => {
        p.style.cssText = 'height:100%;overflow:hidden;display:flex;flex-direction:column;min-height:0;background:#0a0a18;box-sizing:border-box;';
    });

    // ── DEMOS PANEL ───────────────────────────────────────────────────────────
    const demosWrap = document.createElement('div');
    demosWrap.className = 'md-demos-panel';
    demosWrap.style.cssText = 'height:100%;display:flex;flex-direction:column;min-height:0;';
    demosPanel.appendChild(demosWrap);

    const demos = document.createElement('sg-mermaid-demos');
    demos.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;';
    demosWrap.appendChild(demos);

    // ── EDITOR PANEL ─────────────────────────────────────────────────────────
    const editorWrap = document.createElement('div');
    editorWrap.style.cssText = 'height:100%;display:flex;flex-direction:column;min-height:0;padding:10px;box-sizing:border-box;';
    editorPanel.appendChild(editorWrap);

    const editor = document.createElement('sg-mermaid-editor');
    editor.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;';
    editor.setAttribute('placeholder', 'Enter Mermaid markup here…\n\nTry: graph TD\n    A --> B');
    editorWrap.appendChild(editor);

    // Export / action bar below editor
    const actionBar = _buildActionBar(editor);
    editorWrap.appendChild(actionBar);

    // ── RENDER PANEL ─────────────────────────────────────────────────────────
    const renderWrap = document.createElement('div');
    renderWrap.style.cssText = 'height:100%;display:flex;flex-direction:column;min-height:0;padding:12px;box-sizing:border-box;';
    renderPanel.appendChild(renderWrap);

    const renderer = document.createElement('sg-mermaid-render');
    renderer.style.cssText = 'flex:1;min-height:0;display:block;';
    renderer.setAttribute('theme', 'dark');
    renderWrap.appendChild(renderer);

    // ── EVENT WIRING ─────────────────────────────────────────────────────────

    // Demo selected → load into editor + render
    document.addEventListener('sg-mermaid:demo-selected', e => {
        editor.setValue(e.detail.markup, true);
        renderer.render(e.detail.markup);
        // Switch to editor tab to show what was loaded
        layout.activateTab?.('t-editor');
    });

    // Editor change → render
    document.addEventListener('sg-mermaid:markup-changed', e => {
        const markup = e.detail.markup.trim();
        if (markup) {
            renderer.render(markup);
        } else {
            renderer.clear();
        }
    });

    // ── INITIAL CONTENT ───────────────────────────────────────────────────────
    // Wait for custom elements to be ready, then load default demo
    await customElements.whenDefined('sg-mermaid-demos');
    await customElements.whenDefined('sg-mermaid-editor');
    await customElements.whenDefined('sg-mermaid-render');

    editor.setValue(INITIAL_MARKUP, true);
    renderer.render(INITIAL_MARKUP);

    // Highlight the first demo as active (without firing demo-selected)
    setTimeout(() => demos._highlight?.('flowchart-api'), 100);

    // ── DEV PANEL (footer bar + collapsible) ──────────────────────────────────
    buildDevPanel(layoutWrap);

    return { renderer, editor, demos };
}

/**
 * Build the SVG/PNG export action bar below the editor.
 * @param {HTMLElement} editor
 * @returns {HTMLElement}
 */
function _buildActionBar(editor) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 0 0;flex-shrink:0;';

    const btnStyle = 'background:#111120;border:1px solid #1a2a3a;color:#8899aa;cursor:pointer;border-radius:4px;padding:4px 10px;font-size:.7rem;font-family:system-ui,sans-serif;transition:color .15s,border-color .15s;';

    const hint = document.createElement('span');
    hint.textContent = 'Tab key inserts 2 spaces';
    hint.style.cssText = 'font-size:.65rem;color:#4a5568;font-family:monospace;margin-right:auto;';
    bar.appendChild(hint);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear editor';
    clearBtn.style.cssText = btnStyle;
    clearBtn.addEventListener('mouseover', () => { clearBtn.style.color = '#e94560'; clearBtn.style.borderColor = '#e94560'; });
    clearBtn.addEventListener('mouseout',  () => { clearBtn.style.color = '#8899aa'; clearBtn.style.borderColor = '#1a2a3a'; });
    clearBtn.addEventListener('click', () => editor.clear());
    bar.appendChild(clearBtn);

    return bar;
}
