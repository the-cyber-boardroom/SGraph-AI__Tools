/**
 * Probe panel — renders the four Phase 0 building-block checks, runs them,
 * and auto-fills the decision matrix that drives the Phase 0 architecture
 * choice (proxy vs. direct vs. PKCE-only).
 */

import { runApiCorsProbe } from '../api/probe-api.js';
import { runOauthAuthorizeProbe, runOauthTokenProbe } from '../api/probe-oauth.js';
import { runPkceProbe } from '../api/probe-pkce.js';

const PROBES = [
    {
        id: 'api-cors',
        title: 'api.linkedin.com — Posts endpoint CORS',
        detail: "fetch('https://api.linkedin.com/rest/posts') with required headers. Browser-only test — a CORS block hides the HTTP status from JS.",
        run: runApiCorsProbe,
        answers: {
            pass: { answer: 'Yes — direct browser calls work', implies: 'Mirror YouTube architecture (Option D)' },
            fail: { answer: 'No — CORS-blocked',               implies: 'Need proxy (Option A: managed, B: BYO)' },
        },
    },
    {
        id: 'auth-cors',
        title: 'linkedin.com/oauth/v2/authorization — preflight',
        detail: 'OPTIONS preflight on the authorize URL. Note: this endpoint is normally a top-level redirect (popup/tab navigation), not fetched — diagnostic only.',
        run: runOauthAuthorizeProbe,
        answers: {
            pass: { answer: 'Reachable via fetch', implies: 'Diagnostic only — popup nav is the real flow' },
            fail: { answer: 'Blocked',             implies: 'Expected — popup-with-postMessage flow still fine' },
        },
    },
    {
        id: 'token-cors',
        title: 'linkedin.com/oauth/v2/accessToken — POST CORS',
        detail: 'POST with bogus code + grant_type=authorization_code. CORS error → token exchange must go via proxy. HTTP 400 (invalid grant) → CORS is fine, browser-side exchange works.',
        run: runOauthTokenProbe,
        answers: {
            pass: { answer: 'Yes — browser POST reached server', implies: 'Token exchange in-browser; PKCE keeps client public' },
            fail: { answer: 'No — CORS-blocked',                 implies: 'Token exchange must go through the proxy' },
        },
    },
    {
        id: 'pkce',
        title: 'Web Crypto — PKCE S256 challenge generation',
        detail: "crypto.getRandomValues + crypto.subtle.digest('SHA-256') + base64url encoding. Required for the public-client OAuth flow.",
        run: runPkceProbe,
        answers: {
            pass: { answer: 'Yes — S256 challenges OK',      implies: 'Use PKCE; no client secret needed' },
            fail: { answer: 'No — Web Crypto unavailable',   implies: 'Browser too old; tool is HTTPS-only' },
        },
    },
];

const ICONS = { pending: '·', running: '…', pass: '✓', fail: '✗' };

/**
 * Mount the probe panel: wires the run button, renders pending steps, and
 * exposes a `runAll()` method on the returned controller.
 *
 * @param {{
 *   probesEl: HTMLElement,
 *   logEl: HTMLElement,
 *   runBtn: HTMLButtonElement,
 *   decisionsEl: HTMLElement,
 * }} els
 * @returns {{ runAll: () => Promise<void> }}
 */
export function mountProbePanel(els) {
    renderProbes(els.probesEl);
    const log = (msg) => appendLog(els.logEl, msg);

    async function runAll() {
        els.runBtn.disabled = true;
        log('Starting probes…');
        for (const p of PROBES) {
            setProbeState(els.probesEl, p.id, 'running');
            log(`▶ ${p.title}`);
            try {
                const result = await p.run();
                const verdict = result.pass ? 'pass' : 'fail';
                setProbeState(els.probesEl, p.id, verdict, result.detail);
                setDecision(els.decisionsEl, p.id, verdict, p);
                log(`  ${verdict.toUpperCase()} — ${result.detail}`);
            } catch (err) {
                setProbeState(els.probesEl, p.id, 'fail', `Probe crashed: ${err.message}`);
                setDecision(els.decisionsEl, p.id, 'fail', p);
                log(`  CRASH — ${err.stack || err.message}`);
            }
        }
        log('All probes complete.');
        els.runBtn.disabled = false;
    }

    els.runBtn.addEventListener('click', runAll);
    return { runAll };
}

function renderProbes(probesEl) {
    probesEl.innerHTML = '';
    for (const p of PROBES) {
        const el = document.createElement('div');
        el.className = 'lp-step pending';
        el.dataset.id = p.id;
        el.innerHTML = `
            <div class="lp-step-icon">·</div>
            <div class="lp-step-body">
                <div class="lp-step-title"></div>
                <div class="lp-step-detail"></div>
            </div>
        `;
        el.querySelector('.lp-step-title').textContent = p.title;
        el.querySelector('.lp-step-detail').textContent = p.detail;
        probesEl.appendChild(el);
    }
}

function setProbeState(probesEl, id, state, detail) {
    const el = probesEl.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    el.className = `lp-step ${state}`;
    el.querySelector('.lp-step-icon').textContent = ICONS[state] || '·';
    if (detail) el.querySelector('.lp-step-detail').textContent = detail;
}

function setDecision(decisionsEl, id, verdict, probe) {
    const row = decisionsEl.querySelector(`tr[data-row="${id}"]`);
    if (!row) return;
    const answerCell = row.querySelector('.answer');
    const impliesCell = row.querySelector('.implies');
    const a = probe.answers[verdict] || { answer: '—', implies: '—' };
    answerCell.textContent = a.answer;
    impliesCell.textContent = a.implies;
    answerCell.classList.remove('yes', 'no');
    answerCell.classList.add(verdict === 'pass' ? 'yes' : 'no');
}

function appendLog(logEl, msg) {
    const ts = new Date().toISOString().slice(11, 19);
    logEl.textContent += `[${ts}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
}
