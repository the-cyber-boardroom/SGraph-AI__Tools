/**
 * LinkedIn Phase 0 Probe — verifies the four building blocks before any
 * code is written for the linkedin-publisher tool.
 *
 * Each probe interprets the *type* of failure, not just success/failure:
 *   - CORS error → blocked by browser (need proxy)
 *   - HTTP 401 / 400 → request got through (no proxy needed)
 *   - Network error → user is offline / DNS issue
 *
 * Findings should be copied into
 * team/explorer/architect/v0.1.0__phase-0__linkedin-cors-findings.md
 */

import { runApiCorsProbe } from './linkedin-probe-api.js';
import { runOauthAuthorizeProbe, runOauthTokenProbe } from './linkedin-probe-oauth.js';
import { runPkceProbe } from './linkedin-probe-pkce.js';

const PROBES = [
  {
    id: 'api-cors',
    title: 'api.linkedin.com — Posts endpoint CORS',
    detail: 'fetch(\'https://api.linkedin.com/rest/posts\') with required headers. Browser-only test — a CORS block will hide the HTTP status from JS.',
    run: runApiCorsProbe,
    answers: {
      pass: { answer: 'Yes — direct browser calls work', implies: 'Mirror YouTube architecture (Option D)' },
      fail: { answer: 'No — CORS-blocked', implies: 'Need proxy (Option A: managed, B: BYO)' },
    },
  },
  {
    id: 'auth-cors',
    title: 'linkedin.com/oauth/v2/authorization — preflight',
    detail: 'OPTIONS preflight on the authorize URL. Note: this endpoint is normally a top-level redirect (popup/tab navigation), not fetched — the probe just checks whether a CORS preflight is even acceptable for diagnostic purposes.',
    run: runOauthAuthorizeProbe,
    answers: {
      pass: { answer: 'Reachable via fetch', implies: 'Diagnostic only — popup nav is the real flow' },
      fail: { answer: 'Blocked', implies: 'Expected — popup-with-postMessage flow still fine' },
    },
  },
  {
    id: 'token-cors',
    title: 'linkedin.com/oauth/v2/accessToken — POST CORS',
    detail: 'POST with bogus code + grant_type=authorization_code. CORS error → token exchange must go via proxy. HTTP 400 (invalid grant) → CORS is fine, browser-side exchange works.',
    run: runOauthTokenProbe,
    answers: {
      pass: { answer: 'Yes — browser POST reached server', implies: 'Token exchange in-browser; PKCE keeps client public' },
      fail: { answer: 'No — CORS-blocked', implies: 'Token exchange must go through the proxy' },
    },
  },
  {
    id: 'pkce',
    title: 'Web Crypto — PKCE S256 challenge generation',
    detail: 'crypto.getRandomValues + crypto.subtle.digest(\'SHA-256\') + base64url encoding. Required for the public-client OAuth flow.',
    run: runPkceProbe,
    answers: {
      pass: { answer: 'Yes — S256 challenges OK', implies: 'Use PKCE; no client secret needed' },
      fail: { answer: 'No — Web Crypto unavailable', implies: 'Browser too old; tool is HTTPS-only' },
    },
  },
];

const $ = (sel) => document.querySelector(sel);
const probesEl = $('#probes');
const logEl = $('#log');
const runBtn = $('#run-all');

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  logEl.textContent += `[${ts}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function renderProbes() {
  probesEl.innerHTML = '';
  for (const p of PROBES) {
    const el = document.createElement('div');
    el.className = 'step pending';
    el.dataset.id = p.id;
    el.innerHTML = `
      <div class="step-icon">·</div>
      <div class="step-body">
        <div class="step-title">${p.title}</div>
        <div class="step-detail">${p.detail}</div>
      </div>
    `;
    probesEl.appendChild(el);
  }
}

function setProbeState(id, state, detail) {
  const el = probesEl.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  el.className = `step ${state}`;
  const icons = { pending: '·', running: '…', pass: '✓', fail: '✗', warn: '!' };
  el.querySelector('.step-icon').textContent = icons[state] || '·';
  if (detail) {
    el.querySelector('.step-detail').textContent = detail;
  }
}

function setDecision(id, verdict, probe) {
  const row = document.querySelector(`#decisions tr[data-row="${id}"]`);
  if (!row) return;
  const answerCell = row.querySelector('.answer');
  const impliesCell = row.querySelector('.implies');
  const a = probe.answers[verdict] || { answer: '—', implies: '—' };
  answerCell.textContent = a.answer;
  impliesCell.textContent = a.implies;
  answerCell.classList.remove('yes', 'no');
  answerCell.classList.add(verdict === 'pass' ? 'yes' : 'no');
}

async function runAll() {
  runBtn.disabled = true;
  log('Starting probes…');
  for (const p of PROBES) {
    setProbeState(p.id, 'running');
    log(`▶ ${p.title}`);
    try {
      const result = await p.run();
      const verdict = result.pass ? 'pass' : 'fail';
      setProbeState(p.id, verdict, result.detail);
      setDecision(p.id, verdict, p);
      log(`  ${verdict.toUpperCase()} — ${result.detail}`);
    } catch (err) {
      setProbeState(p.id, 'fail', `Probe crashed: ${err.message}`);
      setDecision(p.id, 'fail', p);
      log(`  CRASH — ${err.stack || err.message}`);
    }
  }
  log('All probes complete.');
  runBtn.disabled = false;
}

renderProbes();
runBtn.addEventListener('click', runAll);
