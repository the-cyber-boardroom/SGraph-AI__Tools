/**
 * nr-billing.js
 * Every generation this session paid for, with the provider's own receipt.
 *
 * TWO DIFFERENT NUMBERS, AND WHY BOTH ARE KEPT
 * A completion response carries a cost the moment it returns, but that figure is
 * provisional. The charged amount lands a couple of seconds later at
 * `GET /api/v1/generation?id=…`, together with the token counts, the provider
 * that actually served the request, cache discounts and latency. So each entry
 * holds `localCostUsd` (what the response claimed) alongside `data` (the
 * provider's record), and reports when they disagree.
 *
 * THE ID IS THE RECEIPT
 * A generation id is recorded the instant a request returns, before any cost
 * lookup is attempted and whether or not the lookup ever succeeds. That ordering
 * is the whole point: a lookup can fail for a dozen reasons (not ready yet, no
 * network, a rotated key), and if the id were only kept on success the spend
 * would be unauditable afterwards. With the id, the receipt can always be
 * fetched later — from this tool, from a script, or from the vault copy months
 * on.
 *
 * The record is stored VERBATIM, not reshaped. It is the provider's document,
 * not ours, and reshaping it would silently drop whatever OpenRouter adds next.
 *
 * @module nr-billing
 */

import { state } from './nr-state.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
/** A billing lookup must never hold up an export. */
const REQUEST_TIMEOUT_MS = 8000;

let emitFn = () => {};
let keyFn = () => '';

/** @param {{ emit: Function, getApiKey: Function }} deps */
export function initBilling({ emit, getApiKey }) {
    emitFn = emit || emitFn;
    keyFn = getApiKey || keyFn;
}

/**
 * Record a generation. Called for EVERY request that comes back with an id,
 * whatever it was for.
 * @param {{ id: string, scope: string, pairId?: string, model?: string, localCostUsd?: number|null, step?: number }} p
 */
export function recordGeneration(p = {}) {
    if (!p.id) return null;                                    // nothing to look up later
    const existing = state.billing.find(e => e.id === p.id);
    if (existing) return existing;
    const entry = {
        id: p.id,
        at: Date.now(),
        scope: p.scope || 'unknown',                           // transcribe | clean | chat-pair | chat-session
        pairId: p.pairId || null,
        step: p.step ?? null,                                  // agentic chat: which loop step
        model: p.model || null,
        localCostUsd: typeof p.localCostUsd === 'number' ? p.localCostUsd : null,
        data: null,                                            // the provider's record, verbatim
        fetchedAt: null,
        attempts: 0,
        lastError: null,
    };
    state.billing.push(entry);
    emitFn('nr:billing:recorded', { id: entry.id, scope: entry.scope, pairId: entry.pairId });
    return entry;
}

/**
 * Wrap a transport so no generation can be made without being recorded.
 *
 * Every paid call in this tool goes through one of two transports, so wrapping
 * them is the one place that cannot be forgotten later — an ordinary
 * "remember to log it at each call site" would be missing an entry within a
 * release or two.
 *
 * @param {Function} transport  (req) => Promise<{ content, generationId, responseCost }>
 * @param {object} [defaults]   scope/pairId to use when a caller passes none
 * @returns {Function} (req, ctx?) => same promise
 */
export function billed(transport, defaults = {}) {
    return async (req, ctx = {}) => {
        const res = await transport(req);
        recordGeneration({
            id: res && res.generationId,
            model: (req && req.model) || null,
            localCostUsd: res && typeof res.responseCost === 'number' ? res.responseCost : null,
            ...defaults, ...ctx,
        });
        return res;
    };
}

/** One generation record from the provider. Returns the raw `data` object or throws. */
async function fetchOne(id, apiKey) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
        const res = await fetch(`${OPENROUTER_BASE}/generation?id=${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            ...(ctl ? { signal: ctl.signal } : {}),
        });
        if (!res.ok) {
            const err = new Error(`generation lookup failed (HTTP ${res.status})`);
            // 404 usually means "not ready yet" rather than "gone".
            err.code = res.status === 404 ? 'not-ready' : res.status === 401 ? 'key-invalid' : 'llm-error';
            err.status = res.status;
            throw err;
        }
        const json = await res.json();
        return json && json.data ? json.data : json;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fetch the receipts for every generation that does not have one yet.
 *
 * Idempotent and safe to call repeatedly — resolved entries are skipped unless
 * `force`. The first attempt waits `delayMs` because the generation row is not
 * queryable the instant the completion returns; later attempts back off.
 *
 * @param {{ delayMs?: number, retries?: number, force?: boolean, ids?: string[] }} p
 * @returns {Promise<{ resolved: number, unresolved: number, failed: number, totals: object }>}
 */
export async function fetchBilling(p = {}) {
    const apiKey = keyFn();
    const delayMs = p.delayMs != null ? p.delayMs : 2500;
    const retries = p.retries != null ? p.retries : 2;
    let todo = state.billing.filter(e => p.force || !e.data);
    if (p.ids) todo = todo.filter(e => p.ids.includes(e.id));
    if (!todo.length) return { resolved: state.billing.filter(e => e.data).length, unresolved: 0, failed: 0, totals: billingTotals() };
    if (!apiKey) {
        throw Object.assign(new Error('No OpenRouter key — the receipts need the key that made the calls'), { code: 'no-key' });
    }

    emitFn('nr:billing:fetching', { pending: todo.length });
    let failed = 0;
    for (let attempt = 0; attempt <= retries && todo.length; attempt++) {
        if (attempt > 0 || delayMs) await sleep(attempt === 0 ? delayMs : delayMs * (attempt + 1));
        const still = [];
        for (const entry of todo) {
            entry.attempts += 1;
            try {
                entry.data = await fetchOne(entry.id, apiKey);
                entry.fetchedAt = Date.now();
                entry.lastError = null;
                emitFn('nr:billing:resolved', { id: entry.id, usd: chargedUsd(entry) });
            } catch (err) {
                entry.lastError = { code: err.code || 'llm-error', message: err.message };
                if (err.code === 'key-invalid') { failed += 1; continue; }   // retrying won't help
                still.push(entry);
            }
        }
        todo = still;
    }
    failed += todo.length;
    const out = {
        resolved: state.billing.filter(e => e.data).length,
        unresolved: state.billing.filter(e => !e.data).length,
        failed, totals: billingTotals(),
    };
    emitFn('nr:billing:complete', out);
    return out;
}

/** The charged amount from a receipt, or null if not fetched. */
function chargedUsd(entry) {
    const d = entry.data;
    if (!d) return null;
    const v = d.total_cost != null ? d.total_cost : d.cost;
    return typeof v === 'number' ? v : null;
}

/** Roll up the ledger. `charged` counts only receipts; `local` is every claim. */
export function billingTotals() {
    let charged = 0, local = 0, receipts = 0, missing = 0;
    const byScope = {}, byModel = {};
    for (const e of state.billing) {
        const c = chargedUsd(e);
        if (typeof e.localCostUsd === 'number') local += e.localCostUsd;
        if (c == null) { missing += 1; } else { charged += c; receipts += 1; }
        const usd = c != null ? c : (e.localCostUsd || 0);
        byScope[e.scope] = (byScope[e.scope] || 0) + usd;
        if (e.model) byModel[e.model] = (byModel[e.model] || 0) + usd;
    }
    return {
        generations: state.billing.length, receipts, missing,
        chargedUsd: charged, localClaimUsd: local,
        // A gap here is not an error: it is every generation whose receipt has
        // not been fetched yet, plus genuine provisional-vs-charged drift.
        deltaUsd: receipts === state.billing.length ? charged - local : null,
        byScope, byModel,
    };
}

/**
 * The ledger as it goes into `billing.json` — the ids, our context, and the
 * provider's records verbatim, so the spend can be re-audited from the export
 * alone with no access to this browser.
 */
export function billingToJson() {
    return {
        tool: 'narrated-review',
        sessionId: state.sessionId,
        note: 'Each entry pairs an OpenRouter generation id with the provider record fetched from GET /api/v1/generation. `localCostUsd` is what the completion response claimed; `data.total_cost` is what was charged. Entries with data:null were never resolved — the id is still valid and can be looked up later with the same key.',
        totals: billingTotals(),
        generations: state.billing.map(e => ({
            id: e.id, at: e.at, scope: e.scope, pairId: e.pairId, step: e.step,
            model: e.model, localCostUsd: e.localCostUsd,
            chargedUsd: chargedUsd(e), fetchedAt: e.fetchedAt,
            attempts: e.attempts, lastError: e.lastError,
            data: e.data,
        })),
    };
}

/** The JS-API view (same shape as the file). */
export function getBilling() { return billingToJson(); }
