/**
 * sg-local-bridge-shim.test.js — plain Node.js tests for the JSON-in-content shim.
 *
 * Run with:
 *   node sgraph_ai_tools__static/components/agentic/sg-local-bridge/v0/v0.1/v0.1.0/sg-local-bridge-shim.test.js
 *
 * No test runner needed — uses assert from the standard library.
 */

import assert from 'node:assert/strict';
import { normaliseToolCalls, isJsonInContent } from './sg-local-bridge-shim.js';

let passed = 0;
let failed = 0;

function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
        passed++;
    } catch (err) {
        console.error(`  FAIL  ${label}`);
        console.error(`        ${err.message}`);
        failed++;
    }
}

// ── Case 1: Message with native tool_calls → returned unchanged ───────────────

test('Case 1: native tool_calls → returned unchanged (same reference)', () => {
    const msg = {
        role: 'assistant',
        content: null,
        tool_calls: [
            {
                id:   'call_abc',
                type: 'function',
                function: { name: 'lb_read_file', arguments: '{"path":"README.md"}' },
            },
        ],
    };
    const result = normaliseToolCalls(msg);
    assert.strictEqual(result, msg, 'should be the exact same object reference');
    assert.ok(Array.isArray(result.tool_calls) && result.tool_calls.length === 1);
});

// ── Case 2: JSON-in-content, single object ────────────────────────────────────

test('Case 2: single JSON object {tool, parameters} → normalised correctly', () => {
    const msg = {
        role: 'assistant',
        content: '{"tool":"lb_read_file","parameters":{"path":"README.md"}}',
    };
    const result = normaliseToolCalls(msg);
    assert.notStrictEqual(result, msg, 'should be a new object');
    assert.strictEqual(result.content, null, 'content should be nulled');
    assert.ok(Array.isArray(result.tool_calls) && result.tool_calls.length === 1);
    const tc = result.tool_calls[0];
    assert.strictEqual(tc.type, 'function');
    assert.strictEqual(tc.function.name, 'lb_read_file');
    const args = JSON.parse(tc.function.arguments);
    assert.strictEqual(args.path, 'README.md');
    assert.ok(typeof tc.id === 'string' && tc.id.length > 0, 'id should be generated');
});

// ── Case 3: JSON-in-content, array of two calls ───────────────────────────────

test('Case 3: JSON array with two calls → both normalised', () => {
    const msg = {
        role: 'assistant',
        content: JSON.stringify([
            { tool: 'lb_read_file',   parameters: { path: 'README.md' } },
            { tool: 'lb_list_folder', parameters: { path: '.' } },
        ]),
    };
    const result = normaliseToolCalls(msg);
    assert.strictEqual(result.content, null);
    assert.ok(Array.isArray(result.tool_calls) && result.tool_calls.length === 2);
    assert.strictEqual(result.tool_calls[0].function.name, 'lb_read_file');
    assert.strictEqual(result.tool_calls[1].function.name, 'lb_list_folder');
    const args1 = JSON.parse(result.tool_calls[0].function.arguments);
    assert.strictEqual(args1.path, 'README.md');
    const args2 = JSON.parse(result.tool_calls[1].function.arguments);
    assert.strictEqual(args2.path, '.');
});

// ── Case 4: Fenced code block wrapping ───────────────────────────────────────

test('Case 4: fenced ```json block → stripped and normalised', () => {
    const msg = {
        role: 'assistant',
        content: '```json\n{"tool":"lb_write_file","parameters":{"path":"out.txt","content":"hello"}}\n```',
    };
    const result = normaliseToolCalls(msg);
    assert.strictEqual(result.content, null);
    assert.ok(Array.isArray(result.tool_calls) && result.tool_calls.length === 1);
    assert.strictEqual(result.tool_calls[0].function.name, 'lb_write_file');
});

test('Case 4b: prose prefix + fenced block → stripped and normalised', () => {
    const msg = {
        role: 'assistant',
        content: "I'll read the file now.\n\n```json\n{\"tool\":\"lb_read_file\",\"parameters\":{\"path\":\"README.md\"}}\n```",
    };
    const result = normaliseToolCalls(msg);
    assert.strictEqual(result.content, null);
    assert.ok(Array.isArray(result.tool_calls) && result.tool_calls.length === 1);
    assert.strictEqual(result.tool_calls[0].function.name, 'lb_read_file');
});

// ── Case 5: Plain text content (no JSON) → returned unchanged ────────────────

test('Case 5: plain text content → returned unchanged', () => {
    const msg = {
        role: 'assistant',
        content: 'Hello! I am done with the task. The file has been written successfully.',
    };
    const result = normaliseToolCalls(msg);
    assert.strictEqual(result, msg, 'should be the exact same object reference');
});

// ── Case 6: JSON content but no `tool` key → returned unchanged ──────────────

test('Case 6: JSON with no tool key → returned unchanged', () => {
    const msg = {
        role: 'assistant',
        content: '{"name":"lb_read_file","parameters":{"path":"README.md"}}',
    };
    const result = normaliseToolCalls(msg);
    assert.strictEqual(result, msg, 'should be unchanged — no tool key');
});

test('Case 6b: JSON array with no tool keys → returned unchanged', () => {
    const msg = {
        role: 'assistant',
        content: '[{"name":"lb_read_file"},{"name":"lb_write_file"}]',
    };
    const result = normaliseToolCalls(msg);
    assert.strictEqual(result, msg);
});

// ── Case 7: isJsonInContent ───────────────────────────────────────────────────

test('Case 7a: isJsonInContent → false for native tool_calls', () => {
    const msg = {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lb_read_file', arguments: '{}' } }],
    };
    assert.strictEqual(isJsonInContent(msg), false);
});

test('Case 7b: isJsonInContent → true for JSON-in-content single object (Case 2)', () => {
    const msg = {
        role: 'assistant',
        content: '{"tool":"lb_read_file","parameters":{"path":"README.md"}}',
    };
    assert.strictEqual(isJsonInContent(msg), true);
});

test('Case 7c: isJsonInContent → true for JSON-in-content array (Case 3)', () => {
    const msg = {
        role: 'assistant',
        content: '[{"tool":"lb_read_file","parameters":{"path":"README.md"}},{"tool":"lb_list_folder","parameters":{"path":"."}}]',
    };
    assert.strictEqual(isJsonInContent(msg), true);
});

test('Case 7d: isJsonInContent → true for fenced block (Case 4)', () => {
    const msg = {
        role: 'assistant',
        content: '```json\n{"tool":"lb_write_file","parameters":{"path":"out.txt","content":"hello"}}\n```',
    };
    assert.strictEqual(isJsonInContent(msg), true);
});

test('Case 7e: isJsonInContent → false for plain text (Case 5)', () => {
    const msg = { role: 'assistant', content: 'Done. The file has been written.' };
    assert.strictEqual(isJsonInContent(msg), false);
});

test('Case 7f: isJsonInContent → false for JSON without tool key (Case 6)', () => {
    const msg = { role: 'assistant', content: '{"name":"lb_read_file"}' };
    assert.strictEqual(isJsonInContent(msg), false);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
}
