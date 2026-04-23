/**
 * Infographic Generator — SEND interceptor.
 *
 * Changes from v0.1.32:
 *   - Image attachment in Text mode. When getCurrentImage() returns a value,
 *     the user message becomes a multimodal array: image_url part first, then
 *     the text prompt. sg-llm-request handles the format transparently across
 *     OpenRouter/OpenAI (pass-through), Anthropic (base64 source block), and
 *     Ollama (separate images array).
 *
 * @version 0.1.36
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
 * @param {HTMLElement}  refs.layout
 * @param {HTMLInputElement} refs.apiKeyEl
 * @param {object}       refs.modelPicker
 * @param {HTMLTextAreaElement} refs.textarea
 * @param {HTMLTextAreaElement} refs.advTextarea
 * @param {HTMLTextAreaElement} refs.directionTextarea
 * @param {HTMLElement}  refs.dropZone
 * @param {Map}          refs.activeRequests
 * @param {Function}     refs.updateStopBtn
 * @param {Function}     refs.getCurrentMode
 * @param {Function}     refs.getCurrentDoc
 * @param {Function}     refs.getCurrentImage
 * @param {string}       refs.instanceId
 */
function wireSend(refs) {
    const {
        bus, layout, apiKeyEl, modelPicker, textarea, advTextarea,
        directionTextarea, dropZone, activeRequests, updateStopBtn,
        getCurrentMode, getCurrentDoc, getCurrentImage, instanceId,
    } = refs;

    bus.addEventListener(SGL_LLM.SEND, async e => {
        e.stopImmediatePropagation();

        const model       = modelPicker.getModel();
        const apiKey      = apiKeyEl.value.trim();
        const currentMode = getCurrentMode();
        const currentDoc  = getCurrentDoc();
        const renderUI    = e.detail?.renderUI !== false;
        // callId — set by generate() for precise Promise correlation
        const callId      = e.detail?.callId ?? null;

        // Guard: no API key
        if (!apiKey) {
            if (renderUI) {
                apiKeyEl.style.outline = '2px solid #fc8181';
                apiKeyEl.focus();
                setTimeout(() => { apiKeyEl.style.outline = ''; }, 1500);
            }
            return;
        }

        if (currentMode === 'text' && !textarea.value.trim()) return;
        if (currentMode === 'document' && !currentDoc) {
            if (renderUI) {
                dropZone.style.borderColor = '#fc8181';
                setTimeout(() => { dropZone.style.borderColor = currentDoc ? '#4ECDC4' : '#333d5a'; }, 1200);
            }
            return;
        }

        const t0        = Date.now();
        const isDocMode = currentMode === 'document';
        const prompt    = isDocMode ? `[document: ${currentDoc.name}]` : textarea.value.trim();
        const model_    = model;
        const sysPrompt = advTextarea.value.trim() || (isDocMode ? DOCUMENT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT);
        const direction = isDocMode
            ? (directionTextarea.value.trim() || 'Create an infographic that visualises the key information from this document.')
            : null;
        const docSnapshot = isDocMode ? { name: currentDoc.name, type: currentDoc.type, textContent: currentDoc.textContent } : null;

        // ── UI setup ──────────────────────────────────────────────────────────
        let imgPanel   = null;
        let detailsCtl = null;
        let panelEl    = null;

        if (renderUI) {
            const tabTitle = isDocMode
                ? `\u{1F4C4} ${model_.split('/').pop().substring(0, 28)}`
                : model_.split('/').pop().substring(0, 35);

            const tabId = layout.addTabToStack('s-right', { tag: 'div', title: tabTitle });
            panelEl = layout.getPanelElement(tabId);

            const fractal = await setupResultFractal(panelEl, model_);
            imgPanel  = fractal.imgPanel;
            setupLoadingState(imgPanel, model_);
            detailsCtl = await setupDetailsPanel(fractal.detailsPanel, model_, {
                systemPrompt: sysPrompt, doc: docSnapshot, direction,
            });
        }

        const filename = `infographic-${model_.split('/').pop()}.png`;

        // ── Mini-bus ──────────────────────────────────────────────────────────
        const miniBus = document.createElement('div');
        miniBus.setAttribute('data-llm-bus', '');
        document.body.appendChild(miniBus);
        miniBus.appendChild(document.createElement('sg-llm-request'));

        miniBus.dispatchEvent(new CustomEvent(SGL_LLM.CONNECTED, {
            detail: { provider: 'openrouter', model: model_, apiKey, baseUrl: '' },
        }));

        const finish = () => {
            imgPanel?._clearTimer?.();
            if (imgPanel) imgPanel._cancel = null;
            if (panelEl)  { activeRequests.delete(panelEl); updateStopBtn(); }
            setTimeout(() => miniBus.remove(), 0);
        };

        miniBus.addEventListener(SGL_LLM.REQUEST_COMPLETE, ev => {
            const src   = extractImageSrc(ev.detail);
            const genId = ev.detail?.rawResponse?.id
                       ?? ev.detail?.rawChunks?.find(c => c?.id)?.id
                       ?? null;

            if (renderUI) {
                if (src) {
                    imgPanel.querySelector('[data-role="loading"]')?.remove();
                    const img = imgPanel.querySelector('img');
                    if (img) { img.src = src; img.style.display = 'block'; }
                    detailsCtl.setExportSource(src, filename);
                } else if (isImageModel(model_)) {
                    const loadDiv = imgPanel.querySelector('[data-role="loading"]');
                    if (loadDiv) loadDiv.innerHTML = '<div style="color:#a0aec0;font-size:14px;text-align:center;padding:20px;">No image returned.<br><span style="font-size:12px;color:#4a5568;">Try a different model or refine your prompt.</span></div>';
                }
                detailsCtl.update(ev.detail);
                // Poll OpenRouter cost API (~10s delay before data is available)
                if (genId) {
                    let attemptsLeft = 12;
                    const poll = () => {
                        detailsCtl.showGeneration(genId, apiKey);
                        if (--attemptsLeft > 0) setTimeout(poll, 1000);
                    };
                    setTimeout(poll, 2000);
                }
            }
            finish();

            window.dispatchEvent(new CustomEvent(SGA_TOOL.GENERATION_COMPLETE, {
                detail: { instanceId, callId, generationId: genId, model: model_, duration: (Date.now() - t0) / 1000, imageSrc: src || null },
            }));
        });

        miniBus.addEventListener(SGL_LLM.REQUEST_ERROR, ev => {
            if (renderUI) {
                const loadDiv = imgPanel?.querySelector('[data-role="loading"]');
                if (loadDiv) loadDiv.innerHTML = `<div style="color:#fc8181;font-size:14px;font-family:system-ui;text-align:center;padding:20px;">Error: ${ev.detail?.error || 'Request failed'}</div>`;
            }
            finish();
            window.dispatchEvent(new CustomEvent(SGA_TOOL.GENERATION_ERROR, {
                detail: { instanceId, callId, generationId: null, model: model_, error: ev.detail?.error || 'Request failed' },
            }));
        });

        miniBus.addEventListener(SGL_LLM.REQUEST_CANCEL, () => {
            if (renderUI) {
                const loadDiv = imgPanel?.querySelector('[data-role="loading"]');
                if (loadDiv) loadDiv.innerHTML = '<div style="color:#718096;font-size:14px;text-align:center;">Cancelled</div>';
            }
            finish();
            window.dispatchEvent(new CustomEvent(SGA_TOOL.GENERATION_CANCELLED, {
                detail: { instanceId, callId, generationId: null },
            }));
        });

        if (renderUI && panelEl) {
            const cancelFn = () => miniBus.dispatchEvent(new CustomEvent(SGL_LLM.CANCEL, { bubbles: false }));
            activeRequests.set(panelEl, cancelFn);
            imgPanel._cancel = cancelFn;
            updateStopBtn();
        }

        window.dispatchEvent(new CustomEvent(SGA_TOOL.GENERATION_STARTED, {
            detail: { instanceId, callId, generationId: null, model: model_, prompt },
        }));

        // ── Messages ──────────────────────────────────────────────────────────
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
            // Text mode — include image attachment if present
            const attachedImage = getCurrentImage?.();
            const userContent = [];
            if (attachedImage) {
                userContent.push({ type: 'image_url', image_url: { url: attachedImage.dataUrl } });
            }
            userContent.push({ type: 'text', text: textarea.value.trim() });
            messages = [
                { role: 'system', content: sysPrompt },
                { role: 'user',   content: userContent },
            ];
        }

        miniBus.dispatchEvent(new CustomEvent(SGL_LLM.SEND, {
            detail: { messages, model: model_ },
            bubbles: false,
        }));
    }, true);
}

export { wireSend };
