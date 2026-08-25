/** ui-messages-panel.js — append-only log of toasts + errors.
 *
 * Subscribes to `tool:toast` and `tool:error` on `document` (the same events
 * the topbar toast already shows). The panel keeps a bounded history so
 * users can review past messages even after the toast auto-dismisses.
 * Messages are rendered with timestamp + kind. Click "Clear" to empty.
 */

const MAX_MESSAGES = 200;

function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * @param {{host: HTMLElement}} cfg
 * @returns {{ destroy: () => void }}
 */
export function mountMessagesPanel({ host }) {
    if (!host) return { destroy() {} };
    host.classList.add('sgve-msg-host');
    host.innerHTML = `
        <div class="sgve-msg-panel">
            <header class="sgve-msg-header">
                <span class="sgve-msg-title">Messages</span>
                <button type="button" class="sgve-msg-clear">Clear</button>
            </header>
            <ol class="sgve-msg-list" role="log" aria-live="polite"></ol>
            <div class="sgve-msg-empty">No messages yet — errors and notifications will appear here.</div>
        </div>
    `;
    const list = host.querySelector('.sgve-msg-list');
    const empty = host.querySelector('.sgve-msg-empty');
    const clearBtn = host.querySelector('.sgve-msg-clear');

    function refreshEmpty() {
        empty.style.display = list.children.length === 0 ? 'block' : 'none';
    }

    function append(kind, message, step) {
        const li = document.createElement('li');
        li.className = `sgve-msg sgve-msg--${kind}`;
        const time = document.createElement('span');
        time.className = 'sgve-msg-time';
        time.textContent = fmtTime(new Date());
        const tag = document.createElement('span');
        tag.className = 'sgve-msg-tag';
        tag.textContent = kind === 'error' ? 'ERROR' : 'INFO';
        const text = document.createElement('span');
        text.className = 'sgve-msg-text';
        text.textContent = step ? `${step}: ${message}` : message;
        li.append(time, tag, text);
        list.insertBefore(li, list.firstChild);
        while (list.children.length > MAX_MESSAGES) list.removeChild(list.lastChild);
        refreshEmpty();
    }

    function onToast(e) {
        const d = (e && e.detail) || {};
        if (!d.message) return;
        append(d.kind === 'error' ? 'error' : 'info', String(d.message), null);
    }
    function onError(e) {
        const d = (e && e.detail) || {};
        if (!d.message) return;
        append('error', String(d.message), d.step || null);
    }
    function onClear() {
        list.replaceChildren();
        refreshEmpty();
    }

    document.addEventListener('tool:toast', onToast);
    document.addEventListener('tool:error', onError);
    clearBtn.addEventListener('click', onClear);

    refreshEmpty();

    return {
        destroy() {
            try { document.removeEventListener('tool:toast', onToast); } catch (_) {}
            try { document.removeEventListener('tool:error', onError); } catch (_) {}
            try { clearBtn.removeEventListener('click', onClear); } catch (_) {}
            host.innerHTML = '';
            host.classList.remove('sgve-msg-host');
        },
    };
}
