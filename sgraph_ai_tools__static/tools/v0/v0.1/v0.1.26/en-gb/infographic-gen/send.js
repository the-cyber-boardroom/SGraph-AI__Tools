/**
 * Infographic Generator — SEND interceptor.
 *
 * Handles SGL_LLM.SEND events from the bus, creates result tabs, wires
 * the per-request mini-bus, and dispatches window-level tool events
 * (Phase 0 of the JS API Primitive).
 *
 * Window events dispatched (SGA_TOOL constants):
 *   tool:generation:started   — when a request is queued
 *   tool:generation:complete  — when REQUEST_COMPLETE fires
 *   tool:generation:error     — when REQUEST_ERROR fires
 *   tool:generation:cancelled — when REQUEST_CANCEL fires
 *
 * @version 0.1.26
 */

import { SGL_LLM }  from '/components/llm/sg-llm-events/v0/v0.1/v0.1.0/sg-llm-events.js';
import { SGA_TOOL } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api-events.js';
import { setupResultFractal, setupLoadingState, setupDetailsPanel, extractImageSrc } from './panels.js';
import { isImageModel } from '/components/infographic/sg-infographic-model-picker/v0/v0.1/v0.1.0/sg-infographic-model-picker.js';
import { DOCUMENT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT } from './constants.js';

/**
 * Register the SEND interceptor on the bus element.
 *
 * @param {object} refs
 * @param {HTMLElement}  refs.bus
 * @param {HTMLElement}  refs.layout           sg-layout instance
 * @param {HTMLInputElement} refs.apiKeyEl
 * @param {object}       refs.modelPicker
 * @param {HTMLTextAreaElement} refs.textarea
 * @param {HTMLTextAreaElement} refs.advTextarea
 * @param {HTMLTextAreaElement} refs.directionTextarea
 * @param {HTMLElement}  refs.dropZone
 * @param {Map}          refs.activeRequests   panelEl → cancelFn
 * @param {Function}     refs.updateStopBtn
 * @param {Function}     refs.getCurrentMode   () => 'text' | 'document'
 * @param {Function}     refs.getCurrentDoc    () => doc | null
 * @param {string}       refs.instanceId       e.g. 'infographic-generator:root'
 */
function wireSend(refs) {
    const {
        bus, layout, apiKeyEl, modelPicker, textarea, advTextarea,
        directionTextarea, dropZone, activeRequests, updateStopBtn,
        getCurrentMode, getCurrentDoc, instanceId,
    } = refs;

    bus.addEventListener(SGL_LLM.SEND, async e => {
        e.stopImmediatePropagation();

        const model      = modelPicker.getModel();
        const apiKey     = apiKeyEl.value.trim();
        const currentMode = getCurrentMode();
        const currentDoc  = getCurrentDoc();

        if (!apiKey) return;
        if (currentMode === 'text' && !textarea.value.trim()) return;
        if (currentMode === 'document' && !currentDoc) {
            dropZone.style.borderColor = '#fc8181';
            setTimeout(() => { dropZone.style.borderColor = currentDoc ? '#4ECDC4' : '#333d5a'; }, 1200);
            return;
        }

        const t0        = Date.now();
        const isDocMode = currentMode === 'document';
        const prompt    = isDocMode ? `[document: ${currentDoc.name}]` : textarea.value.trim();
        const tabTitle  = isDocMode
            ? `\u{1F4C4} ${model.split('/').pop().substring(0, 28)}`
            : model.split('/').pop().substring(0, 35);

        const sysPrompt   = advTextarea.value.trim() || (isDocMode ? DOCUMENT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT);
        const direction   = isDocMode
            ? (directionTextarea.value.trim() || 'Create an infographic that visualises the key information from this document.')
            : null;
        const docSnapshot = isDocMode ? { name: currentDoc.name, type: currentDoc.type, textContent: currentDoc.textContent } : null;

        // Create result tab
        const tabId   = layout.addTabToStack('s-right', { tag: 'div', title: tabTitle });
        const panelEl = layout.getPanelElement(tabId);

        const { imgPanel, detailsPanel } = await setupResultFractal(panelEl, model);
        setupLoadingState(imgPanel, model);
        const detailsCtl = await setupDetailsPanel(detailsPanel, model, { systemPrompt: sysPrompt, doc: docSnapshot, direction });

        const filename = `infographic-${model.split('/').pop()}.png`;

        // Isolated mini-bus + fresh sg-llm-request per request
        const miniBus = document.createElement('div');
        miniBus.setAttribute('data-llm-bus', '');
        document.body.appendChild(miniBus);
        miniBus.appendChild(document.createElement('sg-llm-request'));

        miniBus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
            detail: { provider: 'openrouter', model, apiKey, baseUrl: '' },
        }));

        const finish = () => {
            imgPanel._clearTimer?.();
            imgPanel._cancel = null;
            activeRequests.delete(panelEl);
            updateStopBtn();
            setTimeout(() => miniBus.remove(), 0);
        };

        miniBus.addEventListener(SGL_LLM.REQUEST_COMPLETE, ev => {
            const src = extractImageSrc(ev.detail);
            if (src) {
                imgPanel.querySelector('[data-role="loading"]')?.remove();
                const img = imgPanel.querySelector('img');
                if (img) { img.src = src; img.style.display = 'block'; }
                detailsCtl.setExportSource(src, filename);
            } else if (isImageModel(model)) {
                const loadDiv = imgPanel.querySelector('[data-role="loading"]');
                if (loadDiv) loadDiv.innerHTML = '<div style="color:#a0aec0;font-size:14px;text-align:center;padding:20px;">No image returned.<br><span style="font-size:12px;color:#4a5568;">Try a different model or refine your prompt.</span></div>';
            }
            detailsCtl.update(ev.detail);
            const genId = ev.detail?.rawResponse?.id
                       ?? ev.detail?.rawChunks?.find(c => c?.id)?.id
                       ?? null;
            if (genId) setTimeout(() => detailsCtl.showGeneration(genId, apiKey), 500);
            finish();

            // ── Phase 0: window event ─────────────────────────────────────────
            window.dispatchEvent(new CustomEvent(SGA_TOOL.GENERATION_COMPLETE, {
                detail: { instanceId, generationId: genId, model, duration: (Date.now() - t0) / 1000 },
            }));
        });

        miniBus.addEventListener(SGL_LLM.REQUEST_ERROR, ev => {
            const loadDiv = imgPanel.querySelector('[data-role="loading"]');
            if (loadDiv) loadDiv.innerHTML = `<div style="color:#fc8181;font-size:14px;font-family:system-ui;text-align:center;padding:20px;">Error: ${ev.detail?.error || 'Request failed'}</div>`;
            finish();

            // ── Phase 0: window event ─────────────────────────────────────────
            window.dispatchEvent(new CustomEvent(SGA_TOOL.GENERATION_ERROR, {
                detail: { instanceId, generationId: null, model, error: ev.detail?.error || 'Request failed' },
            }));
        });

        miniBus.addEventListener(SGL_LLM.REQUEST_CANCEL, () => {
            const loadDiv = imgPanel.querySelector('[data-role="loading"]');
            if (loadDiv) loadDiv.innerHTML = '<div style="color:#718096;font-size:14px;text-align:center;">Cancelled</div>';
            finish();

            // ── Phase 0: window event ─────────────────────────────────────────
            window.dispatchEvent(new CustomEvent(SGA_TOOL.GENERATION_CANCELLED, {
                detail: { instanceId, generationId: null },
            }));
        });

        const cancelFn = () => miniBus.dispatchEvent(new CustomEvent(SGL_LLM.CANCEL, { bubbles: false }));
        activeRequests.set(panelEl, cancelFn);
        imgPanel._cancel = cancelFn;
        updateStopBtn();

        // ── Phase 0: window event ─────────────────────────────────────────────
        window.dispatchEvent(new CustomEvent(SGA_TOOL.GENERATION_STARTED, {
            detail: { instanceId, generationId: null, model, prompt },
        }));

        // Assemble messages and fire on mini-bus
        let messages;
        if (isDocMode) {
            const userContent = [];
            if (currentDoc.type === 'image') {
                userContent.push({ type: 'image_url', image_url: { url: currentDoc.dataUrl } });
                userContent.push({ type: 'text', text: direction });
            } else if (currentDoc.type === 'pdf') {
                const base64 = currentDoc.dataUrl.split(',')[1];
                userContent.push({ type: 'binary_file', name: currentDoc.name, mediaType: 'application/pdf', data: base64 });
                userContent.push({ type: 'text', text: direction });
            } else {
                userContent.push({ type: 'text', text: `Document (${currentDoc.name}):\n\n${currentDoc.textContent}\n\n${direction}` });
            }
            messages = [
                { role: 'system', content: sysPrompt },
                { role: 'user',   content: userContent },
            ];
        } else {
            messages = [
                { role: 'system', content: sysPrompt },
                { role: 'user',   content: [{ type: 'text', text: textarea.value.trim() }] },
            ];
        }

        miniBus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail: { messages, model },
            bubbles: false,
        }));
    }, true); // capture phase
}

export { wireSend };
