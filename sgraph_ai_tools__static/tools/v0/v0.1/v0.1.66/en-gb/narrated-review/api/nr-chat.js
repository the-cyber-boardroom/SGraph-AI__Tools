/**
 * nr-chat.js
 * Two conversations over a session:
 *
 *   askPair    — scoped to ONE capture. The model gets that capture's
 *                screenshot, raw transcript, cleaned text and notes, plus the
 *                rolling summary for vocabulary. Nothing else, so the answer is
 *                about this moment and the cost stays flat.
 *
 *   askSession — the whole review, with TOOLS. The model can read any capture
 *                and change the artefact: write notes, correct the analysis,
 *                reorder, insert a capture. Every mutation goes through the same
 *                nr-edit methods the UI and the JS API use, so there is one code
 *                path and the events fire either way.
 *
 * Raw transcripts are never writable from chat — the source stays the source.
 *
 * @module nr-chat
 */

import { state, getPairById, pairToJson } from './nr-state.js';

const PAIR_SYSTEM = [
    'You are discussing ONE moment from a narrated screen review.',
    'You are given the screenshot taken at that moment, the raw speech-to-text of what',
    'was said about it, the cleaned-up version, any notes already attached, and a rolling',
    'summary of the session for vocabulary. Answer about THIS moment.',
    'Be concrete and brief. If the screenshot does not show what is being asked about, say so',
    'rather than guessing.',
].join(' ');

const SESSION_SYSTEM = [
    'You are working on a narrated screen review: an ordered list of captures, each a',
    'screenshot paired with the words spoken about it.',
    'You can read the captures and CHANGE the artefact using the supplied tools:',
    'attach notes, correct the analysis text, reorder captures, or insert a new one.',
    'Raw transcripts are the source of record and cannot be edited — correct the analysis',
    'text instead, or add a note.',
    'Make only the changes asked for. After changing anything, say briefly what you changed.',
].join(' ');

/** Convert a Blob to a data URL. */
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
        fr.readAsDataURL(blob);
    });
}

/** One capture rendered for a prompt. */
function describePair(p) {
    return [
        `Capture ${p.seq + 1} (id ${p.id})${p.tPress == null ? ' [authored]' : ` at ${Math.round(p.tPress / 1000)}s`}:`,
        `  raw: ${(p.raw && p.raw.text) || '(none)'}`,
        `  analysis: ${(p.clean && p.clean.text) || '(none)'}`,
        `  notes: ${p.notes || '(none)'}`,
    ].join('\n');
}

/**
 * @param {object} deps
 * @param {Function} deps.transport   isolated LLM transport ({messages, model, tools?})
 * @param {Function} deps.getModel    () => default model id
 * @param {object}   deps.edit        nr-edit methods (setNotes/movePair/reorderPairs/insertPair)
 * @param {Function} deps.setText     setText from the API (clean-only edit)
 * @param {Function} deps.emit
 */
export function buildChatMethods({ transport, getModel, edit, setText, emit }) {

    /**
     * Chat about a single capture.
     * @param {{ id: string, text: string, model?: string, includeImage?: boolean }} p
     * @returns {Promise<{ text: string, model: string, costUsd: number|null }>}
     */
    async function askPair(p = {}) {
        const pair = getPairById(p.id);
        if (!pair) throw Object.assign(new Error(`Unknown pair: ${p.id}`), { code: 'unknown-pair' });
        if (!p.text) throw Object.assign(new Error('askPair needs { text }'), { code: 'bad-params' });
        const model = p.model || getModel();

        const content = [{
            type: 'text',
            text: [
                `Session summary so far: ${state.rollingSummary || '(none yet)'}`,
                '',
                describePair(pair),
                '',
                `Question: ${p.text}`,
            ].join('\n'),
        }];
        if (p.includeImage !== false && pair.screenshot) {
            content.push({ type: 'image_url', image_url: { url: await blobToDataUrl(pair.screenshot) } });
        }
        emit('nr:chat:started', { scope: 'pair', id: pair.id, model });
        const res = await transport({
            messages: [{ role: 'system', content: PAIR_SYSTEM }, { role: 'user', content }],
            model,
        });
        const out = {
            text: String(res.content || '').trim(), model,
            costUsd: typeof res.responseCost === 'number' ? res.responseCost : null,
            generationId: res.generationId || null,
        };
        state.chatCosts.push({ scope: 'pair', id: pair.id, usd: out.costUsd });
        emit('nr:chat:complete', { scope: 'pair', id: pair.id, chars: out.text.length, costUsd: out.costUsd });
        return out;
    }

    // ── Tools the session chat may call ──────────────────────────────────────
    const TOOLS = [
        { type: 'function', function: { name: 'list_captures',
            description: 'List every capture in document order with its id, timing, analysis text and notes.',
            parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'get_capture',
            description: 'Read one capture in full (raw transcript, analysis, notes, bounds).',
            parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
        { type: 'function', function: { name: 'set_notes',
            description: 'Attach or replace the notes (extra comments) on a capture. Notes are commentary, kept separate from the transcript.',
            parameters: { type: 'object', properties: { id: { type: 'string' }, notes: { type: 'string' } }, required: ['id', 'notes'] } } },
        { type: 'function', function: { name: 'set_analysis',
            description: 'Replace the cleaned-up analysis text of a capture. The raw transcript is never changed.',
            parameters: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } } },
        { type: 'function', function: { name: 'move_capture',
            description: 'Move a capture to a different position in the document order (0-based index).',
            parameters: { type: 'object', properties: { id: { type: 'string' }, toIndex: { type: 'number' } }, required: ['id', 'toIndex'] } } },
        { type: 'function', function: { name: 'insert_capture',
            description: 'Insert a new capture (text and/or notes, no audio) after an existing one, or at an index.',
            parameters: { type: 'object', properties: {
                text: { type: 'string' }, notes: { type: 'string' },
                afterId: { type: 'string' }, atIndex: { type: 'number' } } } } },
    ];

    /** Execute one tool call against the real edit methods. */
    function runTool(name, args) {
        switch (name) {
            case 'list_captures': return state.pairs.map(pairToJson).map(x => ({
                id: x.id, index: x.seq, at: x.tPress, analysis: x.clean && x.clean.text, notes: x.notes }));
            case 'get_capture': {
                const pair = getPairById(args.id);
                if (!pair) return { error: `unknown capture ${args.id}` };
                return pairToJson(pair);
            }
            case 'set_notes':    return edit.setNotes({ id: args.id, notes: args.notes });
            case 'set_analysis': return setText({ id: args.id, text: args.text });
            case 'move_capture': return edit.movePair({ id: args.id, toIndex: args.toIndex });
            case 'insert_capture': return edit.insertPair({
                text: args.text, notes: args.notes, afterId: args.afterId, atIndex: args.atIndex });
            default: return { error: `unknown tool ${name}` };
        }
    }

    /**
     * Chat over the whole review, with tools that can change it.
     * @param {{ text: string, model?: string, maxSteps?: number }} p
     * @returns {Promise<{ text, steps, changes, model, costUsd }>}
     */
    async function askSession(p = {}) {
        if (!p.text) throw Object.assign(new Error('askSession needs { text }'), { code: 'bad-params' });
        const model = p.model || getModel();
        const maxSteps = Math.max(1, Math.min(8, p.maxSteps || 6));

        const overview = state.pairs.map(describePair).join('\n');
        const messages = [
            { role: 'system', content: SESSION_SYSTEM },
            { role: 'user', content: [
                `Session summary: ${state.rollingSummary || '(none)'}`,
                `Captures (${state.pairs.length}), in document order:`,
                overview || '(none)',
                '',
                `Request: ${p.text}`,
            ].join('\n') },
        ];

        const changes = [];
        let usd = 0;
        let steps = 0;
        emit('nr:chat:started', { scope: 'session', model });

        for (; steps < maxSteps; steps++) {
            const res = await transport({ messages, model, tools: TOOLS });
            if (typeof res.responseCost === 'number') usd += res.responseCost;
            const calls = res.toolCalls || [];
            if (!calls.length) {
                const out = { text: String(res.content || '').trim(), steps: steps + 1, changes, model, costUsd: usd };
                state.chatCosts.push({ scope: 'session', usd });
                emit('nr:chat:complete', { scope: 'session', steps: out.steps, changes: changes.length, costUsd: usd });
                return out;
            }
            messages.push({ role: 'assistant', content: res.content || '', tool_calls: calls });
            for (const call of calls) {
                const fn = call.function || {};
                let args = {};
                try { args = fn.arguments ? JSON.parse(fn.arguments) : {}; } catch (_) { /* */ }
                let result;
                try { result = runTool(fn.name, args); }
                catch (err) { result = { error: err.message, code: err.code }; }
                if (['set_notes', 'set_analysis', 'move_capture', 'insert_capture'].includes(fn.name)) {
                    changes.push({ tool: fn.name, args });
                }
                messages.push({ role: 'tool', tool_call_id: call.id, name: fn.name, content: JSON.stringify(result) });
            }
        }
        const out = { text: '(stopped: step limit reached)', steps, changes, model, costUsd: usd };
        emit('nr:chat:complete', { scope: 'session', steps, changes: changes.length, costUsd: usd, truncated: true });
        return out;
    }

    return { askPair, askSession };
}
