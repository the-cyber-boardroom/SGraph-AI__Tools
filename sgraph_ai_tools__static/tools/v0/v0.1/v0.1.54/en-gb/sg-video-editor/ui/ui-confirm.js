// ui-confirm.js — in-page replacement for browser confirm()

/**
 * Show a non-blocking in-page modal dialog. Returns Promise<boolean>.
 * True = confirmed, false = cancelled / Escape pressed.
 *
 * @param {string} message
 * @param {{
 *   title?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   danger?: boolean,
 * }} [opts]
 * @returns {Promise<boolean>}
 */
export function showConfirm(message, opts = {}) {
    const {
        title = 'Confirm',
        confirmLabel = 'OK',
        cancelLabel = 'Cancel',
        danger = false,
    } = opts;
    return new Promise(resolve => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center';
        const box = document.createElement('div');
        box.style.cssText = 'background:#1e2535;color:#e2e8f0;border-radius:12px;padding:24px 28px;max-width:380px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.6);font-family:system-ui,sans-serif';
        const h = document.createElement('div');
        h.style.cssText = 'font-weight:600;font-size:15px;margin-bottom:8px';
        h.textContent = title;
        const p = document.createElement('div');
        p.style.cssText = 'font-size:13px;color:#94a3b8;margin-bottom:20px;line-height:1.5';
        p.textContent = message;
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
        function done(v) {
            document.removeEventListener('keydown', onKey);
            try { ov.remove(); } catch (_) {}
            resolve(v);
        }
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = cancelLabel;
        cancelBtn.style.cssText = 'padding:7px 16px;border-radius:6px;border:1px solid #334155;background:transparent;color:#94a3b8;cursor:pointer;font-size:13px';
        cancelBtn.onclick = () => done(false);
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = confirmLabel;
        confirmBtn.style.cssText = [
            'padding:7px 16px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:600',
            danger
                ? 'background:#ef4444;color:#fff'
                : 'background:#22c55e;color:#052e16',
        ].join(';');
        confirmBtn.onclick = () => done(true);
        function onKey(e) {
            if (e.key === 'Escape') done(false);
            else if (e.key === 'Enter') { e.preventDefault(); done(true); }
        }
        document.addEventListener('keydown', onKey);
        btns.append(cancelBtn, confirmBtn);
        box.append(h, p, btns);
        ov.appendChild(box);
        document.body.appendChild(ov);
        confirmBtn.focus();
    });
}
