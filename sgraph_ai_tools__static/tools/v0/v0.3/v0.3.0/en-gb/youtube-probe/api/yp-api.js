/**
 * yp-api.js
 * Entry point — registers SgToolApi, activates (JS-API-first: window.__tool is
 * live from tool:ready, BEFORE the UI mounts), then hands off to the shell.
 *
 * The whole suite is drivable headlessly, which matters more here than in a
 * normal tool: the offline half (A1–A7) is a real regression suite for the mask
 * and caption hypotheses, and it should run in CI without a browser operator.
 *
 * @module yp-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { YP_EVENTS } from './yp-events.js';
import { ctx, state, loadCtx, saveCtx, record } from './yp-state.js';
import { TESTS, AUTO_IDS, runTest, runMany, summarise, reportMarkdown } from './yp-suite.js';
import { clearClips } from './yp-tests-auto.js';
import * as YT from './yp-youtube.js';
import { init as initShell } from '../ui/ui-shell.js';

const api = new SgToolApi({
    name:     'youtube-probe',
    version:  { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
    manifest: './manifest.json',
    skills:   {
        human:   './skills/SKILL-human.md',
        browser: './skills/SKILL-browser.md',
        api:     './skills/SKILL-api.md',
    },
});

function emit(name, detail = {}) { api._emit(name, detail); }
loadCtx();

function listTests() {
    return {
        tests: TESTS.map(t => ({
            id: t.id, group: t.group, title: t.title,
            hypothesis: t.hypothesis, needs: t.needs || null,
        })),
    };
}

/** Shared context for every run — `record` lands the result before the event fires. */
function runCtx(extra = {}) { return { ...ctx, emit, record, ...extra }; }

async function runOne(p = {}) {
    if (!p.id) throw Object.assign(new Error('runTest needs { id }'), { code: 'bad-params' });
    state.running = p.id;
    try { return await runTest(p.id, runCtx()); }
    finally { state.running = null; }
}

/**
 * The offline battery — no token, no gesture, safe in CI.
 *
 * Returns a summary of THIS BATCH, not of everything recorded so far. The first
 * version returned the accumulated state, so a run of 7 reported 8 when a manual
 * test had been tried earlier — "what this run did" and "everything so far" are
 * different questions, and a diagnostic must not blur them. `getResults()` is the
 * accumulated view.
 */
async function runAuto() {
    return summarise(await runMany(AUTO_IDS, runCtx()));
}

async function runAll(p = {}) {
    const ids = p.ids && p.ids.length ? p.ids : TESTS.filter(t => t.needs !== 'gesture').map(t => t.id);
    return summarise(await runMany(ids, runCtx()));
}

function setContext(p = {}) {
    for (const k of ['videoId', 'otherVideoId', 'talks', 'capturesPerTalk', 'captureSeconds']) {
        if (p[k] !== undefined) ctx[k] = p[k];
    }
    saveCtx();
    return { ...ctx, myVideos: undefined, tracks: undefined, cues: undefined };
}

function getResults() { return summarise(state.results); }
function getReport() { return reportMarkdown(state.results, ctx); }

function download(text, name, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { name, bytes: blob.size };
}

function downloadReport(p = {}) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return p.format === 'json'
        ? download(JSON.stringify(getResults(), null, 2), `youtube-probe-${stamp}.json`, 'application/json')
        : download(getReport().markdown, `youtube-probe-${stamp}.md`, 'text/markdown');
}

/** Tokens are never returned, only their presence — a probe must not leak one. */
function setToken(p = {}) {
    const r = YT.setToken(p.token);
    emit(YP_EVENTS.AUTH_CHANGED, { present: r.present });
    return r;
}

async function signIn(p = {}) {
    const r = await YT.signIn(p);
    emit(YP_EVENTS.AUTH_CHANGED, { present: true, scope: r.scope });
    return { present: true };
}

/**
 * Status, including WHO is signed in when a token is present.
 *
 * Still never returns the token — only what can be said about it. The account
 * lookup is cached against the token itself so a UI may call this freely; a new
 * token invalidates it.
 */
let accountCache = null;
async function getStatus() {
    const base = {
        running: state.running, ran: state.results.length, tests: TESTS.length,
        hasToken: !!YT.getToken(), videoId: ctx.videoId || null, otherVideoId: ctx.otherVideoId || null,
    };
    const token = YT.getToken();
    if (!token) { accountCache = null; return { ...base, token: null, channel: null }; }
    if (accountCache?.for === token) return { ...base, ...accountCache.value };
    const value = { token: null, channel: null };
    // Two independent calls, and one failing must not hide the other: a token
    // with no channel is still a valid token, and a valid token on an account
    // with no channel is exactly the case worth naming out loud.
    const [info, channel] = await Promise.allSettled([YT.tokenInfo(), YT.myChannel()]);
    if (info.status === 'fulfilled') {
        const { scopes, expiresInS, hasForceSsl } = info.value;
        value.token = { scopes, expiresInS, hasForceSsl };   // never the token itself
    }
    if (channel.status === 'fulfilled') value.channel = channel.value;
    accountCache = { for: token, value };
    return { ...base, ...value };
}

function reset() {
    state.reset();
    clearClips();
    accountCache = null;
    emit(YP_EVENTS.RESET, {});
    return { ok: true };
}

api
    .register('listTests',      listTests,       { async: false })
    .register('runTest',        runOne,          { async: true, events: [YP_EVENTS.TEST_COMPLETE] })
    .register('runAuto',        runAuto,         { async: true, events: [YP_EVENTS.SUITE_COMPLETE] })
    .register('runAll',         runAll,          { async: true, events: [YP_EVENTS.SUITE_COMPLETE] })
    .register('setContext',     setContext,      { async: false })
    .register('getContext',     () => ({ ...ctx, myVideos: undefined, tracks: undefined, cues: undefined }), { async: false })
    .register('getResults',     getResults,      { async: false })
    .register('getReport',      getReport,       { async: false })
    .register('downloadReport', downloadReport,  { async: false })
    .register('setToken',       setToken,        { async: false, events: [YP_EVENTS.AUTH_CHANGED],
        sanitiseParams: p => ({ ...p, token: p?.token ? '••••' : undefined }) })
    .register('signIn',         signIn,          { async: true, events: [YP_EVENTS.AUTH_CHANGED],
        sanitiseParams: p => ({ ...p }) })
    .register('hasToken',       () => ({ present: !!YT.getToken() }), { async: false })
    .register('getStatus',      getStatus,       { async: true })
    .register('reset',          reset,           { async: false, events: [YP_EVENTS.RESET] });

// JS-API-first: activate before UI so window.__tool is live from tool:ready.
api.activate();

await initShell(state, ctx, api, emit);
