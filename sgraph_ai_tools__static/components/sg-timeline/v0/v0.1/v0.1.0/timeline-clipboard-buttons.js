// timeline-clipboard-buttons.js — Copy + Paste toolbar buttons (v0.1.0)

import { SGT_EVENTS } from './timeline-events.js';

/**
 * Build the Copy + Paste toolbar buttons. Caller appends `root` to the toolbar.
 *
 * Copy is enabled when a clip is selected. Paste is enabled when the host
 * reports `clipboardFlags.canPaste === true` via `getClipboardFlags()`.
 *
 * The component is stateless about clipboard contents — it just emits the
 * intent events. The host (sg-video-editor) owns the clipboard.
 *
 * @param {{
 *   getState: () => {selectedClipId?: string|null},
 *   getClipboardFlags: () => {canPaste: boolean},
 *   dispatch: (name: string, detail: object) => void,
 * }} cfg
 * @returns {{ root: HTMLElement, refresh: () => void, dispose: () => void }}
 */
export function mountClipboardButtons(cfg) {
    const wrap = document.createElement('div');
    wrap.className = 'clipboard-buttons';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'clipboard-button copy-button';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy selected clip (Cmd/Ctrl+C)';
    copyBtn.disabled = true;

    const pasteBtn = document.createElement('button');
    pasteBtn.type = 'button';
    pasteBtn.className = 'clipboard-button paste-button';
    pasteBtn.textContent = 'Paste';
    pasteBtn.title = 'Paste clipboard at playhead (Cmd/Ctrl+V)';
    pasteBtn.disabled = true;

    wrap.appendChild(copyBtn);
    wrap.appendChild(pasteBtn);

    function refresh() {
        const sel = (cfg.getState() || {}).selectedClipId;
        copyBtn.disabled = !sel;
        const cb = (cfg.getClipboardFlags && cfg.getClipboardFlags()) || { canPaste: false };
        pasteBtn.disabled = !cb.canPaste;
    }

    copyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const sel = (cfg.getState() || {}).selectedClipId;
        if (!sel) return;
        cfg.dispatch(SGT_EVENTS.CLIP_COPIED, { clipId: sel });
    });
    pasteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const cb = (cfg.getClipboardFlags && cfg.getClipboardFlags()) || { canPaste: false };
        if (!cb.canPaste) return;
        cfg.dispatch('sg-timeline:clip-paste-requested', {});
    });

    refresh();
    return {
        root: wrap,
        refresh,
        dispose() { try { wrap.remove(); } catch (_) {} },
    };
}
