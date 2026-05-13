/**
 * agent-with-tools — entry point + JS API Primitive.
 *
 * Imported as the manifest phase-3 entry module.
 * Fetches system.md, wires the agentic-loop, registers 7 methods on window.__tool.
 *
 * Methods:
 *   connect()          → Promise<{ ok, version, workspace }>
 *   chat(msg)          → Promise<string>
 *   getTranscript()    → Array<turn>
 *   getBridgeStatus()  → { ok, latency_ms, workspace } | null
 *   setProvider(name)  → void
 *   setModel(name)     → void
 *   clearChat()        → void
 *
 * @module agent-with-tools-api
 * @version 0.1.58
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { initShell }  from '../ui/ui-shell.js';

// ── Element references ────────────────────────────────────────────────────────

const bus      = document.querySelector('[data-llm-bus]');
const bridge   = bus?.querySelector('sg-local-bridge');
const loop     = bus?.querySelector('sg-agentic-loop');
const llmReq   = bus?.querySelector('sg-llm-request');
const toolDef  = bus?.querySelector('sg-tool-definition');

// ── System prompt loading ─────────────────────────────────────────────────────

/** @type {string} Live system prompt text (substituted). */
let _systemPrompt = '';

/**
 * Generate the {TOOL_LIST} bullet string from sg-tool-definition (if available)
 * or from the static lb_* tool names.
 * @returns {string}
 */
function _buildToolList() {
    const defaultList = [
        '- `lb_read_file(path)` — Read a text file from the workspace.',
        '- `lb_write_file(path, content)` — Write a file to the workspace (creates dirs).',
        '- `lb_delete_file(path)` — Delete a file from the workspace.',
        '- `lb_list_folder(path, recursive?)` — List files/folders in a directory.',
        '- `lb_run_bash(command, cwd?, timeout_s?)` — Run a bash command in the container.',
        '- `lb_fetch_url(url, method?, headers?, body?)` — Fetch a URL and return the response.',
    ].join('\n');

    if (toolDef && typeof toolDef.getSchemas === 'function') {
        const schemas = toolDef.getSchemas();
        if (schemas && schemas.length > 0) {
            return schemas.map(s => {
                const fn = s.function || s;
                return `- \`${fn.name}\` — ${fn.description || ''}`;
            }).join('\n');
        }
    }
    return defaultList;
}

/**
 * Load system.md, substitute placeholders, store as _systemPrompt.
 * @returns {Promise<void>}
 */
async function _loadSystemPrompt() {
    let text = '';
    try {
        const resp = await fetch('./prompts/system.md');
        text = await resp.text();
    } catch {
        text = 'You are a helpful agent with access to file system tools.';
    }
    const workspace = bridge?.getAttribute('workspace') || '/workspace';
    const toolList  = _buildToolList();
    _systemPrompt = text
        .replace('{WORKSPACE_PATH}', workspace)
        .replace('{TOOL_LIST}', toolList);

    // Notify sg-agentic-loop of updated system turn
    _pushSystemTurn();
}

/**
 * Dispatch updated system turn to the bus so sg-agentic-loop picks it up.
 */
function _pushSystemTurn() {
    if (!bus || !_systemPrompt) return;
    bus.dispatchEvent(new CustomEvent('llm:system-prompt', {
        detail: { content: _systemPrompt },
        bubbles: false, composed: false,
    }));
}

// Reload {TOOL_LIST} when enabled tools change
bus?.addEventListener('llm:tool-defs-changed', () => {
    const toolList  = _buildToolList();
    const workspace = bridge?.getAttribute('workspace') || '/workspace';
    _systemPrompt = _systemPrompt
        .replace(/^## Available tools[\s\S]*?(?=\n##|$)/m, `## Available tools\n\n${toolList}`);
    // Fall back to full reload on mismatch
    _loadSystemPrompt().catch(() => {});
});

// ── Chat promise plumbing ─────────────────────────────────────────────────────

let _chatResolve = null;

bus?.addEventListener('llm:response-complete', (e) => {
    if (_chatResolve) {
        const text = e.detail?.content ?? '';
        _chatResolve(text);
        _chatResolve = null;
    }
});

// ── SgToolApi ─────────────────────────────────────────────────────────────────

const api = new SgToolApi({
    name:    'agent-with-tools',
    version: '0.1.58',
    manifest: './manifest.json',
    skills: {
        human:   './SKILL-human.md',
        browser: './SKILL-browser.md',
        api:     './SKILL-api.md',
    },
});

api.register('connect', async () => {
    await bridge?.connect();
    return bridge?._status ?? { ok: false, version: 'unknown', workspace: '/workspace' };
}, { async: true });

api.register('chat', (msg) => {
    if (typeof msg !== 'string' || !msg.trim()) throw new Error('chat() requires a non-empty string');
    bus?.dispatchEvent(new CustomEvent('llm:chat-message', {
        detail: { role: 'user', content: msg },
        bubbles: false, composed: false,
    }));
    return new Promise((resolve) => { _chatResolve = resolve; });
}, { async: true });

api.register('getTranscript', () => {
    if (loop && typeof loop.getTurns === 'function') return loop.getTurns();
    return [];
});

api.register('getBridgeStatus', () => bridge?._status ?? null);

api.register('setProvider', (name) => {
    if (llmReq) llmReq.setAttribute('provider', String(name));
});

api.register('setModel', (name) => {
    if (llmReq) llmReq.setAttribute('model', String(name));
});

api.register('clearChat', () => {
    bus?.dispatchEvent(new CustomEvent('llm:clear-history', {
        bubbles: false, composed: false,
    }));
});

// ── Boot sequence ─────────────────────────────────────────────────────────────

await _loadSystemPrompt();
api.activate();
initShell(bus, api);
