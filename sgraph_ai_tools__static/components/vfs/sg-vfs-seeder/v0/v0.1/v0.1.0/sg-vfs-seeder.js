/**
 * sg-vfs-seeder — Headless seed-data component for the SGraph Virtual File System.
 *
 * Dispatches vfs:write-request and vfs:create-folder-request events on the
 * [data-vfs-bus] ancestor to create preset file/folder structures, then
 * dispatches sg-vfs-seeder:complete when done.
 *
 * Presets write under /fe/current/ to match the folder-editor root.
 *
 * Usage:
 *   <sg-vfs-seeder></sg-vfs-seeder>
 *
 * Events emitted:
 *   sg-vfs-seeder:complete  — { preset, total, errors, wallTime }
 *
 * @module sg-vfs-seeder
 * @version 0.1.0
 */

import { SGL_VFS } from '/core/sg-vfs/v0/v0.1/v0.1.0/sg-vfs-events.js';

const ROOT = '/fe/current';

// ── Preset definitions ───────────────────────────────────────────────────────

const PRESETS = {

    'web-project': {
        label: 'Web Project',
        icon: '\u2699',
        files: [
            { path: `${ROOT}/src/main.js`, content:
`/**
 * main.js — application entry point
 */
import { setupApi } from './api.js';
import { debounce, formatDate } from './utils.js';

const api = setupApi({ baseUrl: '/api/v1' });

document.addEventListener('DOMContentLoaded', async () => {
    const data = await api.get('/items');
    console.log('Loaded:', data.length, 'items');
});
` },
            { path: `${ROOT}/src/utils.js`, content:
`/**
 * utils.js — shared utility functions
 */

/** @param {Function} fn @param {number} ms */
export function debounce(fn, ms = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** @param {Date|string} d @returns {string} */
export function formatDate(d) {
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'short' }).format(new Date(d));
}

/** @param {string} key @param {*} fallback */
export function env(key, fallback = '') {
    return globalThis.__ENV?.[key] ?? fallback;
}
` },
            { path: `${ROOT}/src/api.js`, content:
`/**
 * api.js — lightweight fetch client
 */

export function setupApi({ baseUrl = '', headers = {} } = {}) {
    async function request(method, path, body) {
        const res = await fetch(baseUrl + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(\`\${method} \${path} \${res.status}\`);
        return res.json();
    }
    return {
        get:    path       => request('GET',    path),
        post:   (path, b)  => request('POST',   path, b),
        put:    (path, b)  => request('PUT',    path, b),
        delete: path       => request('DELETE', path),
    };
}
` },
            { path: `${ROOT}/src/styles.css`, content:
`:root {
    --color-primary: #4ecdc4;
    --color-bg: #0d0d1a;
    --color-text: #e2e8f0;
    --radius: 6px;
    --font: system-ui, -apple-system, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--color-bg); color: var(--color-text); }

.btn { padding: 8px 16px; border-radius: var(--radius); border: none; cursor: pointer; font-size: 14px; }
.btn-primary { background: var(--color-primary); color: #0d0d1a; font-weight: 600; }
.btn-primary:hover { opacity: 0.9; }
` },
            { path: `${ROOT}/public/index.html`, content:
`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My App</title>
    <link rel="stylesheet" href="/src/styles.css">
</head>
<body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
</body>
</html>
` },
            { path: `${ROOT}/public/favicon.svg`, content:
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="6" fill="#0d0d1a"/>
    <text x="16" y="22" text-anchor="middle" font-size="18" fill="#4ecdc4">\u2665</text>
</svg>
` },
            { path: `${ROOT}/tests/main.test.js`, content:
`import { describe, it, expect } from 'vitest';
import { formatDate, debounce } from '../src/utils.js';

describe('formatDate', () => {
    it('formats a date string', () => {
        const result = formatDate('2024-01-15');
        expect(result).toMatch(/15\/01\/2024/);
    });
});

describe('debounce', () => {
    it('delays function execution', async () => {
        let count = 0;
        const inc = debounce(() => count++, 50);
        inc(); inc(); inc();
        await new Promise(r => setTimeout(r, 100));
        expect(count).toBe(1);
    });
});
` },
            { path: `${ROOT}/tests/api.test.js`, content:
`import { describe, it, expect, vi } from 'vitest';
import { setupApi } from '../src/api.js';

describe('setupApi', () => {
    it('returns get/post/put/delete methods', () => {
        const api = setupApi({ baseUrl: 'https://example.com' });
        expect(typeof api.get).toBe('function');
        expect(typeof api.post).toBe('function');
    });
});
` },
            { path: `${ROOT}/package.json`, content: JSON.stringify({
                name: 'my-app', version: '1.0.0', type: 'module',
                scripts: { dev: 'vite', build: 'vite build', test: 'vitest' },
                devDependencies: { vite: '^5.0.0', vitest: '^1.0.0' }
            }, null, 2) + '\n' },
            { path: `${ROOT}/.env`, content:
`# Environment variables
API_BASE_URL=https://api.example.com
DEBUG=false
` },
            { path: `${ROOT}/README.md`, content:
`# My App

A minimal web application.

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Structure

- \`src/\` — application source
- \`public/\` — static assets
- \`tests/\` — test files
` },
        ],
    },

    'markdown-docs': {
        label: 'Docs Folder',
        icon: '\u{1F4DA}',
        files: [
            { path: `${ROOT}/docs/getting-started.md`, content:
`# Getting Started

## Prerequisites

- Node.js 18+
- npm or pnpm

## Installation

\`\`\`bash
npm install
\`\`\`

## Running Locally

\`\`\`bash
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) in your browser.
` },
            { path: `${ROOT}/docs/api-reference.md`, content:
`# API Reference

## Authentication

All API requests require a Bearer token:

\`\`\`http
Authorization: Bearer <token>
\`\`\`

## Endpoints

### GET /api/v1/items

Returns a list of items.

**Response:**
\`\`\`json
{ "items": [], "total": 0 }
\`\`\`

### POST /api/v1/items

Creates a new item.

**Body:**
\`\`\`json
{ "name": "string", "value": "any" }
\`\`\`
` },
            { path: `${ROOT}/docs/guides/installation.md`, content:
`# Installation Guide

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Node.js   | 16.x    | 20.x        |
| RAM       | 512 MB  | 2 GB        |
| Disk      | 100 MB  | 1 GB        |

## Install via npm

\`\`\`bash
npm install @sgraph/tools
\`\`\`

## Verify Installation

\`\`\`bash
npx sgraph --version
\`\`\`
` },
            { path: `${ROOT}/docs/guides/configuration.md`, content:
`# Configuration

## Config File

Create \`sgraph.config.json\` in your project root:

\`\`\`json
{
    "provider": "memory",
    "debug": false,
    "maxFileSize": "10MB"
}
\`\`\`

## Environment Variables

| Variable     | Default   | Description          |
|-------------|-----------|----------------------|
| PROVIDER    | memory    | Storage provider     |
| DEBUG       | false     | Enable debug logging |
| PORT        | 3000      | Server port          |
` },
            { path: `${ROOT}/docs/examples/basic.md`, content:
`# Basic Example

\`\`\`js
import { SgVfs } from '@sgraph/vfs';

const vfs = new SgVfs({ provider: 'memory' });
await vfs.writeFile('/hello.txt', 'Hello, world!');
const content = await vfs.readFile('/hello.txt');
console.log(content); // Hello, world!
\`\`\`
` },
            { path: `${ROOT}/docs/examples/advanced.md`, content:
`# Advanced Example

## Nested Folders

\`\`\`js
await vfs.createFolder('/project/src');
await vfs.writeFile('/project/src/main.js', '// entry point');
const entries = await vfs.listFolder('/project');
\`\`\`

## Rename

\`\`\`js
await vfs.rename('/old-name.txt', '/new-name.txt');
\`\`\`
` },
            { path: `${ROOT}/CHANGELOG.md`, content:
`# Changelog

## v0.2.0 — 2026-03-01
- Added drag-and-drop support
- VFS IndexedDB provider

## v0.1.0 — 2026-01-15
- Initial release
- VFS memory provider
- File upload support
` },
            { path: `${ROOT}/README.md`, content:
`# Project Documentation

See the [docs/](./docs/) folder for full documentation.

- [Getting Started](./docs/getting-started.md)
- [API Reference](./docs/api-reference.md)
- [Installation Guide](./docs/guides/installation.md)
` },
        ],
    },

    'sample-data': {
        label: 'Sample Data',
        icon: '\u{1F4CA}',
        files: [
            { path: `${ROOT}/data/users.csv`, content:
`id,name,email,role,created_at
1,Alice Johnson,alice@example.com,admin,2024-01-01
2,Bob Smith,bob@example.com,user,2024-01-15
3,Carol White,carol@example.com,user,2024-02-01
4,David Lee,david@example.com,editor,2024-02-14
5,Eve Brown,eve@example.com,user,2024-03-01
` },
            { path: `${ROOT}/data/products.csv`, content:
`id,name,category,price,stock
1,Widget A,electronics,29.99,150
2,Widget B,electronics,49.99,75
3,Gadget X,accessories,9.99,500
4,Gadget Y,accessories,14.99,200
5,Device Z,electronics,199.99,25
` },
            { path: `${ROOT}/data/config.json`, content: JSON.stringify({
                version: '1.0.0',
                environment: 'development',
                features: { darkMode: true, multiSelect: true, virtualScroll: true },
                limits: { maxFileSize: 10485760, maxFiles: 1000 },
                paths: { uploads: '/fe/current/', temp: '/tmp/' }
            }, null, 2) + '\n' },
            { path: `${ROOT}/data/report.json`, content: JSON.stringify({
                generated: new Date().toISOString(),
                summary: { totalFiles: 42, totalSize: 1048576, providers: ['indexeddb'] },
                operations: [
                    { type: 'read',  count: 120, avgMs: 2  },
                    { type: 'write', count: 85,  avgMs: 8  },
                    { type: 'list',  count: 30,  avgMs: 5  },
                ],
            }, null, 2) + '\n' },
            { path: `${ROOT}/logs/app.log`, content:
`2026-04-06 09:00:01 INFO  Server started on port 3000
2026-04-06 09:00:02 INFO  VFS provider: indexeddb (db=sg-folder-editor-v1)
2026-04-06 09:01:15 INFO  Provider ready
2026-04-06 09:01:16 INFO  Manifest loaded: 4 files
2026-04-06 09:05:32 DEBUG Read /fe/current/.manifest.json (4ms)
2026-04-06 09:10:01 INFO  File dropped: users.csv (1.2 KB)
2026-04-06 09:10:01 DEBUG Write /fe/current/users.csv (6ms)
` },
            { path: `${ROOT}/logs/errors.log`, content:
`# Error log — errors only
# No errors recorded yet.
` },
            { path: `${ROOT}/README.md`, content:
`# Sample Data

| File | Description |
|------|-------------|
| data/users.csv | Sample user records |
| data/products.csv | Sample product catalogue |
| data/config.json | Application configuration |
| data/report.json | Usage report snapshot |
| logs/app.log | Application log |
` },
        ],
    },

    'deep-tree': {
        label: 'Deep Tree',
        icon: '\u{1F333}',
        files: (() => {
            const files = [];
            const branches = ['alpha', 'beta', 'gamma'];
            branches.forEach(branch => {
                ['core', 'ext', 'utils'].forEach(mod => {
                    ['v1', 'v2'].forEach(ver => {
                        ['index.js', 'types.ts', 'README.md'].forEach(file => {
                            files.push({
                                path: `${ROOT}/${branch}/${mod}/${ver}/${file}`,
                                content: `// ${branch}/${mod}/${ver}/${file}\nexport default {};\n`,
                            });
                        });
                    });
                });
            });
            // Add some deep singleton files
            files.push({ path: `${ROOT}/alpha/core/v1/helpers/format.js`, content: '// formatter\nexport const fmt = x => String(x);\n' });
            files.push({ path: `${ROOT}/alpha/core/v1/helpers/parse.js`,  content: '// parser\nexport const parse = x => JSON.parse(x);\n' });
            files.push({ path: `${ROOT}/gamma/ext/v2/plugins/auth.js`,    content: '// auth plugin\nexport class AuthPlugin {}\n' });
            return files;
        })(),
    },
};

// ── Component ────────────────────────────────────────────────────────────────

const CSS = `
:host { display: flex; flex-direction: column; height: 100%; background: #0a0a16; overflow: hidden; }

.hdr { flex-shrink: 0; padding: 6px 10px; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em; color: #5a6478;
    border-bottom: 1px solid #1e1e3a; background: #0a0a16; }

.presets { flex-shrink: 0; padding: 8px; display: flex; flex-direction: column; gap: 5px; }

.preset-btn {
    display: flex; align-items: center; gap: 8px; padding: 7px 10px;
    background: #1a1a3a; border: 1px solid #2a2a4a; border-radius: 4px;
    color: #c8d3e0; font-size: 12px; font-family: monospace; cursor: pointer;
    text-align: left; width: 100%;
    transition: border-color 0.15s, background 0.15s;
}
.preset-btn:hover:not(:disabled) { border-color: #4ECDC4; background: #1e2240; }
.preset-btn:disabled { opacity: 0.4; cursor: default; }
.preset-btn .icon { font-size: 14px; }
.preset-btn .info { flex: 1; }
.preset-btn .label { display: block; font-weight: 600; }
.preset-btn .count { display: block; font-size: 10px; color: #5a6478; margin-top: 1px; }

.progress-wrap { flex-shrink: 0; padding: 8px 10px; border-top: 1px solid #1e1e3a; }
.progress-bar  { height: 4px; background: #1a1a3a; border-radius: 2px; overflow: hidden; margin-bottom: 5px; }
.progress-fill { height: 100%; background: #4ECDC4; border-radius: 2px; width: 0%; transition: width 0.1s; }
.progress-text { font-size: 10px; color: #5a6478; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.progress-text.done  { color: #6ee7b7; }
.progress-text.error { color: #ff6b6b; }
`;

export class SgVfsSeeder extends HTMLElement {

    #seq = 0;
    #bus = null;
    #busy = false;

    connectedCallback() {
        this.attachShadow({ mode: 'open' });
        this.#bus = this.#findBus();
        this.#render();
    }

    #findBus() {
        let el = this.parentElement;
        while (el) { if (el.hasAttribute('data-vfs-bus')) return el; el = el.parentElement; }
        return document;
    }

    #render() {
        const sr = this.shadowRoot;
        const presetEntries = Object.entries(PRESETS);

        sr.innerHTML = `<style>${CSS}</style>
<div class="hdr">Seed Test Data</div>
<div class="presets">
${presetEntries.map(([key, p]) => `
<button class="preset-btn" data-key="${key}">
    <span class="icon">${p.icon}</span>
    <span class="info">
        <span class="label">${p.label}</span>
        <span class="count">${p.files.length} file${p.files.length !== 1 ? 's' : ''}</span>
    </span>
</button>`).join('')}
</div>
<div class="progress-wrap">
    <div class="progress-bar"><div class="progress-fill" id="fill"></div></div>
    <div class="progress-text" id="status">Ready</div>
</div>`;

        sr.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => this.#runPreset(btn.dataset.key));
        });
    }

    #setProgress(done, total, msg, state = '') {
        const fill   = this.shadowRoot.getElementById('fill');
        const status = this.shadowRoot.getElementById('status');
        if (fill)   fill.style.width = total ? `${Math.round((done/total)*100)}%` : '0%';
        if (status) { status.textContent = msg; status.className = `progress-text ${state}`; }
    }

    #setBusy(busy) {
        this.#busy = busy;
        this.shadowRoot.querySelectorAll('.preset-btn').forEach(b => { b.disabled = busy; });
    }

    #rid() { return `seed-${++this.#seq}-${Math.random().toString(36).slice(2,6)}`; }

    #emit(eventName, detail) {
        this.#bus.dispatchEvent(new CustomEvent(eventName, {
            detail, bubbles: true, composed: true,
        }));
    }

    async #vfsOp(requestEvent, responseEvent, detail) {
        const requestId = this.#rid();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.#bus.removeEventListener(responseEvent, ok);
                this.#bus.removeEventListener(SGL_VFS.ERROR,  err);
                reject(new Error('VFS timeout'));
            }, 10000);

            const ok = e => {
                if (e.detail.requestId !== requestId) return;
                clearTimeout(timeout);
                this.#bus.removeEventListener(responseEvent, ok);
                this.#bus.removeEventListener(SGL_VFS.ERROR,  err);
                resolve(e.detail);
            };
            const err = e => {
                if (e.detail.requestId !== requestId) return;
                clearTimeout(timeout);
                this.#bus.removeEventListener(responseEvent, ok);
                this.#bus.removeEventListener(SGL_VFS.ERROR,  err);
                reject(new Error(e.detail.error || 'VFS error'));
            };

            this.#bus.addEventListener(responseEvent, ok);
            this.#bus.addEventListener(SGL_VFS.ERROR,  err);

            this.#emit(requestEvent, { ...detail, requestId });
        });
    }

    async #runPreset(key) {
        if (this.#busy) return;
        const preset = PRESETS[key];
        if (!preset) return;

        this.#setBusy(true);
        this.#setProgress(0, preset.files.length, `Starting ${preset.label}\u2026`);

        const batchId  = this.#rid();
        const total    = preset.files.length;
        const start    = performance.now();
        let   done     = 0;
        let   errors   = 0;

        this.#emit(SGL_VFS.BATCH_STARTED, { batchId, total, preset: key });

        for (const { path, content } of preset.files) {
            const name = path.split('/').pop();
            this.#setProgress(done, total, `Writing ${name}\u2026`);
            try {
                await this.#vfsOp(SGL_VFS.WRITE_REQUEST, SGL_VFS.WRITE_RESPONSE, { path, content });
            } catch (e) {
                errors++;
                console.warn('[sg-vfs-seeder] write failed:', path, e.message);
            }
            done++;
            this.#setProgress(done, total, `${done}/${total} \u2014 ${name}`);
            this.#emit(SGL_VFS.BATCH_PROGRESS, { batchId, done, total, lastOp: path });
        }

        const wallTime = Math.round(performance.now() - start);
        this.#emit(SGL_VFS.BATCH_COMPLETE, { batchId, total, errors, wallTime });

        const state = errors ? 'error' : 'done';
        const msg   = errors
            ? `Done with ${errors} error${errors !== 1 ? 's' : ''} \u2014 ${wallTime}ms`
            : `\u2714 ${preset.label}: ${total} file${total !== 1 ? 's' : ''} in ${wallTime}ms`;
        this.#setProgress(total, total, msg, state);

        // Signal completion so consumers (e.g. folder-editor) can rebuild their tree
        this.dispatchEvent(new CustomEvent('sg-vfs-seeder:complete', {
            bubbles: true, composed: true,
            detail: { preset: key, label: preset.label, total, errors, wallTime },
        }));

        this.#setBusy(false);
    }
}

customElements.define('sg-vfs-seeder', SgVfsSeeder);
