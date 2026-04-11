/**
 * Infographic Generator — left panel UI construction.
 *
 * Changes from v0.1.26:
 *   - Image attachment support in Text mode.
 *     A 📎 button in the action bar opens a file picker (PNG/JPG/WebP/GIF).
 *     A thumbnail strip appears between the textarea and the action bar when
 *     an image is loaded, showing a 32 × 32 preview, the filename, and a ✕
 *     clear button. The strip is hidden in Document mode (which already has
 *     its own image dropzone). getCurrentImage() returns { name, dataUrl } or
 *     null, and is passed through to send.js to build multimodal messages.
 *
 * @version 0.1.36
 */

import { ALL_MODELS, DEFAULT_MODEL } from '/components/infographic/sg-infographic-model-picker/v0/v0.1/v0.1.0/sg-infographic-model-picker.js';
import { DEFAULT_SYSTEM_PROMPT, DOCUMENT_SYSTEM_PROMPT, TEMPLATES, DOC_TEMPLATES } from './constants.js';

/**
 * Build the left-panel UI and append it to `leftPanel`.
 *
 * @param {HTMLElement} leftPanel
 * @param {object}      prefs     Restored localStorage prefs
 * @param {Function}    savePrefs
 * @returns {{
 *   bus: HTMLElement,
 *   modelPicker: HTMLElement,
 *   textarea: HTMLTextAreaElement,
 *   advTextarea: HTMLTextAreaElement,
 *   directionTextarea: HTMLTextAreaElement,
 *   dropZone: HTMLElement,
 *   sendBtn: HTMLButtonElement,
 *   activeRequests: Map,
 *   updateStopBtn: Function,
 *   getCurrentMode: Function,
 *   getCurrentDoc: Function,
 *   getCurrentImage: Function,
 * }}
 */
function buildInputPanel(leftPanel, prefs, savePrefs) {

    // ── Event bus div ─────────────────────────────────────────────────────────
    const bus = document.createElement('div');
    bus.setAttribute('data-llm-bus', '');
    bus.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:#0a0a18;';
    leftPanel.style.cssText = 'overflow:hidden;height:100%;display:block;';
    leftPanel.appendChild(bus);

    // ── Model picker ──────────────────────────────────────────────────────────
    const modelPicker = document.createElement('sg-infographic-model-picker');
    modelPicker.style.cssText = 'display:block;flex-shrink:0;';
    bus.appendChild(modelPicker);
    const savedModel = prefs.model && ALL_MODELS.includes(prefs.model) ? prefs.model : DEFAULT_MODEL;
    modelPicker.setModel(savedModel);

    // ── Mode state ────────────────────────────────────────────────────────────
    let currentMode  = 'text';
    let currentDoc   = null;
    let currentImage = null;

    // ── Mode toggle ───────────────────────────────────────────────────────────
    const modeToggle = document.createElement('div');
    modeToggle.style.cssText = 'display:flex;flex-shrink:0;border-bottom:1px solid #1a1a3a;background:#0d0d1a;';
    function makeModeBtn(label) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = [
            'flex:1', 'border:none', 'border-top:none', 'border-left:none', 'border-right:none',
            'padding:7px', 'font-size:12px', 'font-weight:600', 'cursor:pointer',
            'font-family:system-ui,sans-serif', 'background:transparent', 'color:#718096',
            'border-bottom:2px solid transparent',
        ].join(';');
        modeToggle.appendChild(btn);
        return btn;
    }
    const textModeBtn = makeModeBtn('\u270f  Text');
    const docModeBtn  = makeModeBtn('\u{1F4C4}  Document');
    bus.appendChild(modeToggle);

    // ── Templates row ─────────────────────────────────────────────────────────
    const templatesOuter = document.createElement('div');
    templatesOuter.style.cssText = [
        'flex-shrink:0', 'overflow-x:auto', 'overflow-y:hidden',
        'background:#0d0d1a', 'border-bottom:1px solid #1a1a3a', 'scrollbar-width:thin',
    ].join(';');
    const templatesRow = document.createElement('div');
    templatesRow.style.cssText = [
        'display:flex', 'align-items:center', 'gap:5px',
        'padding:6px 10px', 'width:max-content', 'min-width:100%', 'box-sizing:border-box',
    ].join(';');
    const templLabel = document.createElement('span');
    templLabel.textContent = 'Templates:';
    templLabel.style.cssText = 'font-size:11px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;font-family:system-ui,sans-serif;flex-shrink:0;';
    templatesRow.appendChild(templLabel);
    templatesOuter.appendChild(templatesRow);
    bus.appendChild(templatesOuter);

    // ── Main textarea ─────────────────────────────────────────────────────────
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Describe your infographic\u2026\n\nExample: "Create an infographic showing the 5 key benefits of serverless architecture, with an icon for each benefit and a cost comparison chart."';
    textarea.style.cssText = [
        'flex:1', 'min-height:0', 'resize:none', 'width:100%', 'box-sizing:border-box',
        'padding:12px 14px', 'background:#0d0d1a', 'color:#e2e8f0',
        'border:none', 'border-bottom:1px solid #1a1a3a', 'outline:none',
        'font-size:14px', 'line-height:1.6', 'font-family:system-ui,sans-serif',
    ].join(';');
    bus.appendChild(textarea);
    if (prefs.lastPrompt) textarea.value = prefs.lastPrompt;
    textarea.addEventListener('input', () => savePrefs({ lastPrompt: textarea.value }));

    // ── Document mode panel ───────────────────────────────────────────────────
    const docModeDiv = document.createElement('div');
    docModeDiv.style.cssText = 'display:none;flex-direction:column;flex:1;min-height:0;';
    bus.appendChild(docModeDiv);

    const docTemplOuter = document.createElement('div');
    docTemplOuter.style.cssText = [
        'flex-shrink:0', 'overflow-x:auto', 'overflow-y:hidden',
        'background:#0d0d1a', 'border-bottom:1px solid #1a1a3a', 'scrollbar-width:thin',
    ].join(';');
    const docTemplRow = document.createElement('div');
    docTemplRow.style.cssText = [
        'display:flex', 'align-items:center', 'gap:5px',
        'padding:5px 8px', 'width:max-content', 'min-width:100%', 'box-sizing:border-box',
    ].join(';');
    const docTemplLabel = document.createElement('span');
    docTemplLabel.textContent = 'Focus:';
    docTemplLabel.style.cssText = 'font-size:11px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;font-family:system-ui,sans-serif;flex-shrink:0;';
    docTemplRow.appendChild(docTemplLabel);

    const directionTextarea = document.createElement('textarea');
    DOC_TEMPLATES.forEach(tmpl => {
        const btn = document.createElement('button');
        btn.innerHTML = `${tmpl.icon} ${tmpl.label}`;
        btn.style.cssText = [
            'background:#1a1a3a', 'border:1px solid #333d5a', 'border-radius:4px',
            'color:#e2e8f0', 'padding:3px 9px', 'font-size:12px', 'cursor:pointer',
            'white-space:nowrap', 'font-family:system-ui,sans-serif', 'flex-shrink:0',
        ].join(';');
        btn.addEventListener('click', () => { directionTextarea.value = tmpl.direction; });
        docTemplRow.appendChild(btn);
    });
    docTemplOuter.appendChild(docTemplRow);
    docModeDiv.appendChild(docTemplOuter);

    // Drop zone
    const dropZone = document.createElement('div');
    dropZone.style.cssText = [
        'flex:1', 'min-height:0', 'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center', 'gap:10px',
        'margin:8px', 'border:2px dashed #333d5a', 'border-radius:8px',
        'cursor:pointer', 'font-family:system-ui,sans-serif', 'transition:border-color 0.15s',
        'background:#0d0d1a',
    ].join(';');
    const dropIcon    = document.createElement('div');
    const dropMsg     = document.createElement('div');
    const dropSubMsg  = document.createElement('div');
    const docFileInfo = document.createElement('div');
    const clearDocBtn = document.createElement('button');
    dropIcon.textContent  = '\u{1F4C4}';
    dropIcon.style.cssText = 'font-size:32px;';
    dropMsg.textContent   = 'Drop a document here';
    dropMsg.style.cssText = 'font-size:14px;font-weight:600;color:#a0aec0;text-align:center;';
    dropSubMsg.textContent = 'or click to browse \u2014 PDF, Markdown, text, CSV, or image';
    dropSubMsg.style.cssText = 'font-size:12px;color:#4a5568;text-align:center;';
    docFileInfo.style.cssText = 'display:none;font-size:13px;color:#4ECDC4;font-weight:600;text-align:center;';
    clearDocBtn.textContent = '\u2715 Clear';
    clearDocBtn.style.cssText = 'display:none;background:none;border:1px solid #333d5a;border-radius:4px;color:#718096;padding:3px 10px;font-size:11px;cursor:pointer;font-family:system-ui,sans-serif;';
    dropZone.appendChild(dropIcon); dropZone.appendChild(dropMsg);
    dropZone.appendChild(dropSubMsg); dropZone.appendChild(docFileInfo); dropZone.appendChild(clearDocBtn);
    docModeDiv.appendChild(dropZone);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,.md,.markdown,.txt,.csv,.json,.html,.js,.ts,.py,.png,.jpg,.jpeg,.webp,.gif';
    fileInput.style.display = 'none';
    docModeDiv.appendChild(fileInput);

    directionTextarea.placeholder = 'Direction (optional): e.g. "focus on the timeline" or "highlight key metrics"';
    directionTextarea.rows = 2;
    directionTextarea.style.cssText = [
        'flex-shrink:0', 'resize:none', 'width:100%', 'box-sizing:border-box',
        'padding:8px 10px', 'background:#111122', 'color:#e2e8f0',
        'border:none', 'border-top:1px solid #1a1a3a', 'outline:none',
        'font-size:13px', 'line-height:1.5', 'font-family:system-ui,sans-serif',
    ].join(';');
    docModeDiv.appendChild(directionTextarea);

    function setDocLoaded(doc) {
        currentDoc = doc;
        dropIcon.textContent = doc.type === 'image' ? '\u{1F5BC}\ufe0f' : doc.name.endsWith('.pdf') ? '\u{1F4D1}' : '\u{1F4DD}';
        dropMsg.textContent = doc.name; dropMsg.style.color = '#4ECDC4';
        dropSubMsg.style.display = 'none';
        docFileInfo.style.display = 'block';
        docFileInfo.textContent = doc.type === 'image'
            ? 'Image loaded \u2014 ready to generate'
            : `${Math.round((doc.textContent?.length || 0) / 4)} tokens est.`;
        clearDocBtn.style.display = 'inline-block';
        dropZone.style.borderColor = '#4ECDC4';
    }
    function clearDoc() {
        currentDoc = null;
        dropIcon.textContent = '\u{1F4C4}'; dropMsg.textContent = 'Drop a document here'; dropMsg.style.color = '#a0aec0';
        dropSubMsg.style.display = ''; docFileInfo.style.display = 'none';
        clearDocBtn.style.display = 'none'; dropZone.style.borderColor = '#333d5a'; fileInput.value = '';
    }
    function readFile(file) {
        const isImage = file.type.startsWith('image/');
        const reader  = new FileReader();
        if (isImage) {
            reader.onload = ev => setDocLoaded({ name: file.name, type: 'image', dataUrl: ev.target.result });
            reader.readAsDataURL(file);
        } else if (file.type === 'application/pdf') {
            reader.onload = ev => setDocLoaded({ name: file.name, type: 'pdf', dataUrl: ev.target.result, textContent: null });
            reader.readAsDataURL(file);
        } else {
            reader.onload = ev => setDocLoaded({ name: file.name, type: 'text', textContent: ev.target.result });
            reader.readAsText(file);
        }
    }
    clearDocBtn.addEventListener('click', e => { e.stopPropagation(); clearDoc(); });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) readFile(fileInput.files[0]); });
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.style.borderColor = '#4ECDC4'; });
    dropZone.addEventListener('dragleave', () => { if (!currentDoc) dropZone.style.borderColor = '#333d5a'; });
    dropZone.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) readFile(f); });

    // ── Image attachment strip (text mode only) ───────────────────────────────
    const attachmentStrip = document.createElement('div');
    attachmentStrip.style.cssText = [
        'display:none', 'flex-shrink:0', 'align-items:center', 'gap:8px',
        'padding:5px 10px', 'background:#0a0a18', 'border-top:1px solid #1a1a3a',
        'font-family:system-ui,sans-serif',
    ].join(';');

    const attachThumb = document.createElement('img');
    attachThumb.style.cssText = 'width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid #333d5a;flex-shrink:0;';

    const attachName = document.createElement('span');
    attachName.style.cssText = 'font-size:12px;color:#4ECDC4;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    const clearImageBtn = document.createElement('button');
    clearImageBtn.textContent = '\u2715';
    clearImageBtn.title = 'Remove image';
    clearImageBtn.style.cssText = 'background:none;border:1px solid #333d5a;border-radius:4px;color:#718096;padding:2px 7px;font-size:11px;cursor:pointer;font-family:system-ui,sans-serif;flex-shrink:0;';

    attachmentStrip.appendChild(attachThumb);
    attachmentStrip.appendChild(attachName);
    attachmentStrip.appendChild(clearImageBtn);
    bus.appendChild(attachmentStrip);

    // ── Mode switcher ─────────────────────────────────────────────────────────
    function setMode(mode) {
        const isDoc = mode === 'document';
        if (mode !== currentMode) {
            const oldDefault = currentMode === 'document' ? DOCUMENT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
            const newDefault = isDoc ? DOCUMENT_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
            if (advTextarea.value === oldDefault) advTextarea.value = newDefault;
        }
        currentMode = mode;
        templatesRow.style.display = isDoc ? 'none' : '';
        textarea.style.display     = isDoc ? 'none' : '';
        docModeDiv.style.display   = isDoc ? 'flex' : 'none';
        // Attachment strip: only show in text mode when an image is loaded
        attachmentStrip.style.display = (!isDoc && currentImage) ? 'flex' : 'none';
        // 📎 button: only relevant in text mode
        attachBtn.style.display = isDoc ? 'none' : '';
        textModeBtn.style.cssText = textModeBtn.style.cssText.replace(/border-bottom:[^;]+/, `border-bottom:2px solid ${isDoc ? 'transparent' : '#4ECDC4'}`);
        textModeBtn.style.color = isDoc ? '#718096' : '#e2e8f0';
        docModeBtn.style.cssText  = docModeBtn.style.cssText.replace(/border-bottom:[^;]+/,  `border-bottom:2px solid ${isDoc ? '#4ECDC4' : 'transparent'}`);
        docModeBtn.style.color  = isDoc ? '#e2e8f0' : '#718096';
    }
    textModeBtn.addEventListener('click', () => setMode('text'));
    docModeBtn.addEventListener('click',  () => setMode('document'));

    // Template buttons
    TEMPLATES.forEach(tmpl => {
        const btn = document.createElement('button');
        btn.innerHTML = `${tmpl.icon} ${tmpl.label}`;
        btn.title = tmpl.prompt.substring(0, 100) + '\u2026';
        btn.style.cssText = [
            'background:#1a1a3a', 'border:1px solid #333d5a', 'border-radius:4px',
            'color:#e2e8f0', 'padding:3px 9px', 'font-size:12px', 'cursor:pointer',
            'white-space:nowrap', 'font-family:system-ui,sans-serif', 'flex-shrink:0',
        ].join(';');
        btn.addEventListener('click', () => { textarea.value = tmpl.prompt; savePrefs({ lastPrompt: tmpl.prompt }); textarea.focus(); });
        templatesRow.appendChild(btn);
    });

    // ── Action bar ────────────────────────────────────────────────────────────
    const actionBar = document.createElement('div');
    actionBar.style.cssText = [
        'display:flex', 'align-items:center', 'gap:8px', 'flex-shrink:0',
        'padding:8px 10px', 'background:#0a0a18', 'border-top:1px solid #1a1a3a',
    ].join(';');

    const advancedToggle = document.createElement('button');
    advancedToggle.textContent = '\u2699 Advanced';
    advancedToggle.style.cssText = 'background:none;border:none;color:#718096;font-size:12px;cursor:pointer;padding:4px 8px;font-family:system-ui,sans-serif;white-space:nowrap;';

    const activeRequests = new Map();
    const stopBtn = document.createElement('button');
    stopBtn.textContent = '\u25a0 Stop';
    stopBtn.style.cssText = [
        'background:#7f1d1d', 'border:none', 'border-radius:6px', 'color:#fca5a5',
        'padding:7px 14px', 'font-size:13px', 'font-weight:600', 'cursor:pointer',
        'flex-shrink:0', 'display:none',
    ].join(';');
    stopBtn.addEventListener('click', () => { for (const c of activeRequests.values()) c(); });

    // 📎 Attach button (text mode only)
    const attachBtn = document.createElement('button');
    attachBtn.textContent = '\u{1F4CE}';
    attachBtn.title = 'Attach image (PNG, JPG, WebP, GIF)';
    attachBtn.style.cssText = [
        'background:none', 'border:1px solid #333d5a', 'border-radius:6px',
        'color:#718096', 'padding:7px 10px', 'font-size:14px', 'cursor:pointer',
        'flex-shrink:0', 'line-height:1',
    ].join(';');

    // Hidden file input for image attachment
    const imageFileInput = document.createElement('input');
    imageFileInput.type = 'file';
    imageFileInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
    imageFileInput.style.display = 'none';
    document.body.appendChild(imageFileInput);

    attachBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', () => {
        const file = imageFileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            currentImage = { name: file.name, dataUrl: ev.target.result };
            attachThumb.src = ev.target.result;
            attachName.textContent = file.name;
            // Only show strip in text mode
            if (currentMode === 'text') attachmentStrip.style.display = 'flex';
            imageFileInput.value = '';
        };
        reader.readAsDataURL(file);
    });

    clearImageBtn.addEventListener('click', () => {
        currentImage = null;
        attachmentStrip.style.display = 'none';
        imageFileInput.value = '';
    });

    const sendBtn = document.createElement('button');
    sendBtn.innerHTML = '&#9658; Send';
    sendBtn.style.cssText = 'background:#1d4ed8;border:none;border-radius:6px;color:#fff;padding:8px 0;font-size:14px;font-weight:600;cursor:pointer;flex:1;';

    actionBar.appendChild(advancedToggle);
    actionBar.appendChild(stopBtn);
    actionBar.appendChild(attachBtn);
    actionBar.appendChild(sendBtn);
    bus.appendChild(actionBar);

    function updateStopBtn() {
        stopBtn.style.display = activeRequests.size > 0 ? 'inline-block' : 'none';
        stopBtn.textContent = activeRequests.size > 1 ? `\u25a0 Stop all (${activeRequests.size})` : '\u25a0 Stop';
    }

    // ── Advanced section ──────────────────────────────────────────────────────
    const advancedSection = document.createElement('div');
    advancedSection.style.cssText = 'display:none;flex-direction:column;flex-shrink:0;border-top:1px solid #1a1a3a;background:#0a0a18;';
    const advLabel = document.createElement('div');
    advLabel.textContent = 'System Prompt Override';
    advLabel.style.cssText = 'font-size:11px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:0.05em;padding:6px 10px 2px;font-family:system-ui,sans-serif;';
    const advTextarea = document.createElement('textarea');
    advTextarea.value = DEFAULT_SYSTEM_PROMPT;
    advTextarea.style.cssText = [
        'resize:none', 'height:80px', 'width:100%', 'box-sizing:border-box',
        'padding:8px 10px', 'background:#111122', 'color:#a0aec0',
        'border:1px solid #1a1a3a', 'outline:none', 'font-size:12px', 'line-height:1.5',
        'font-family:system-ui,sans-serif',
    ].join(';');
    advTextarea.addEventListener('focus', () => advTextarea.style.borderColor = '#4ECDC4');
    advTextarea.addEventListener('blur',  () => advTextarea.style.borderColor = '#1a1a3a');
    advancedSection.appendChild(advLabel); advancedSection.appendChild(advTextarea);
    bus.appendChild(advancedSection);

    let advancedOpen = false;
    advancedToggle.addEventListener('click', () => {
        advancedOpen = !advancedOpen;
        advancedSection.style.display = advancedOpen ? 'flex' : 'none';
        advancedToggle.style.color = advancedOpen ? '#4ECDC4' : '#718096';
    });

    setMode('text'); // initialise visible state

    return {
        bus, modelPicker, textarea, advTextarea, directionTextarea,
        dropZone, sendBtn, activeRequests, updateStopBtn,
        getCurrentMode:  () => currentMode,
        getCurrentDoc:   () => currentDoc,
        getCurrentImage: () => currentImage,
    };
}

export { buildInputPanel };
