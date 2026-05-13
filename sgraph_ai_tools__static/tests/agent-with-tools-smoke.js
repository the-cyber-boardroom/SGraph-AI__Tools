/**
 * agent-with-tools-smoke.js — Plain Node.js smoke test (no external test runner).
 *
 * Tests sg-local-bridge-client.js and sg-local-bridge-shim.js
 * with a mocked global fetch — no live bridge or Ollama required.
 *
 * Run:
 *   node sgraph_ai_tools__static/tests/agent-with-tools-smoke.js
 *
 * Exit code 0 = all pass, 1 = any failure.
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

// ── Fetch mock ───────────────────────────────────────────────────────────────

/**
 * Build a minimal Response-like object for the mock.
 * @param {number} status
 * @param {object} body
 * @returns {{ ok: boolean, status: number, json: () => Promise<object> }}
 */
function mockResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

// We need to intercept fetch calls based on URL + method. Use a queue to
// return predetermined responses in the order they are registered.
// Each entry: { url_fragment, response } — matched by substring.
const fetchQueue = [];

globalThis.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const entry = fetchQueue.shift();
    if (!entry) throw new Error(`Unexpected fetch call: ${method} ${url}`);
    return entry;
};

function queueResponse(status, body) {
    fetchQueue.push(mockResponse(status, body));
}

// ── Module paths ─────────────────────────────────────────────────────────────

const clientPath = path.resolve(
    __dirname,
    '../components/agentic/sg-local-bridge/v0/v0.1/v0.1.0/sg-local-bridge-client.js'
);
const shimPath = path.resolve(
    __dirname,
    '../components/agentic/sg-local-bridge/v0/v0.1/v0.1.0/sg-local-bridge-shim.js'
);

// ── Import modules ────────────────────────────────────────────────────────────
// Dynamic import after fetch mock is set so the modules use our stub.

const { ping, readFile, writeFile, BridgeError } = await import(
    `file://${clientPath}`
);
const { normaliseToolCalls, isJsonInContent } = await import(
    `file://${shimPath}`
);

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\nagent-with-tools smoke tests\n');

// Test 1 — ping() with 200 response
await test('ping() → returns { ok: true, latency_ms: number }', async () => {
    queueResponse(200, { ok: true, version: '0.1.0', workspace: '/workspace', started_at: '2026-05-13T00:00:00Z' });
    const result = await ping('http://localhost:8000');
    assert.equal(result.ok, true);
    assert.equal(result.version, '0.1.0');
    assert.equal(typeof result.latency_ms, 'number');
    assert.ok(result.latency_ms >= 0);
});

// Test 2 — readFile() with 200 response
await test('readFile() with 200 → returns content object', async () => {
    const body = { path: 'hello.txt', content: 'hello world', size: 11, mtime: 1700000000, is_text: true };
    queueResponse(200, body);
    const result = await readFile('http://localhost:8000', 'hello.txt');
    assert.equal(result.path, 'hello.txt');
    assert.equal(result.content, 'hello world');
    assert.equal(result.size, 11);
    assert.equal(result.is_text, true);
});

// Test 3 — readFile() with 404 → throws BridgeError with errorCode 'file_not_found'
await test('readFile() with 404 → throws BridgeError(file_not_found)', async () => {
    queueResponse(404, { error_code: 'file_not_found', message: 'File not found: missing.txt', detail: null });
    await assert.rejects(
        () => readFile('http://localhost:8000', 'missing.txt'),
        (err) => {
            assert.ok(err instanceof BridgeError, 'expected BridgeError');
            assert.equal(err.errorCode, 'file_not_found');
            assert.equal(err.status, 404);
            return true;
        }
    );
});

// Test 4 — writeFile() with 200 → returns bytes_written
await test('writeFile() with 200 → returns { bytes_written }', async () => {
    const body = { path: 'out.txt', bytes_written: 13, created: true };
    queueResponse(200, body);
    const result = await writeFile('http://localhost:8000', 'out.txt', 'hello, bridge!');
    assert.equal(result.bytes_written, 13);
    assert.equal(result.path, 'out.txt');
    assert.equal(result.created, true);
});

// Test 5 — normaliseToolCalls with native tool_calls → unchanged (same reference)
await test('normaliseToolCalls with native tool_calls → returns same object', () => {
    const msg = {
        role: 'assistant',
        content: null,
        tool_calls: [
            {
                id: 'call_abc',
                type: 'function',
                function: { name: 'lb_read_file', arguments: '{"path":"README.md"}' },
            },
        ],
    };
    const result = normaliseToolCalls(msg);
    assert.strictEqual(result, msg, 'expected same object reference (no mutation)');
    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].function.name, 'lb_read_file');
});

// Test 6 — normaliseToolCalls with JSON-in-content → normalises to native tool_calls
await test('normaliseToolCalls with JSON-in-content → normalises to tool_calls', () => {
    const jsonPayload = JSON.stringify({
        tool: 'lb_write_file',
        parameters: { path: 'output.txt', content: 'hello' },
    });
    const msg = { role: 'assistant', content: jsonPayload };
    const result = normaliseToolCalls(msg);
    assert.notStrictEqual(result, msg, 'expected a new object');
    assert.equal(result.content, null);
    assert.ok(Array.isArray(result.tool_calls));
    assert.equal(result.tool_calls.length, 1);
    assert.equal(result.tool_calls[0].type, 'function');
    assert.equal(result.tool_calls[0].function.name, 'lb_write_file');
    const args = JSON.parse(result.tool_calls[0].function.arguments);
    assert.equal(args.path, 'output.txt');
    assert.equal(args.content, 'hello');
});

// Test 6b — isJsonInContent helper
await test('isJsonInContent returns true for JSON-in-content message', () => {
    const msg = {
        role: 'assistant',
        content: JSON.stringify({ tool: 'lb_list_folder', parameters: { path: '.' } }),
    };
    assert.equal(isJsonInContent(msg), true);
});

await test('isJsonInContent returns false when native tool_calls present', () => {
    const msg = {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'x', type: 'function', function: { name: 'lb_run_bash', arguments: '{}' } }],
    };
    assert.equal(isJsonInContent(msg), false);
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    process.exit(1);
}
