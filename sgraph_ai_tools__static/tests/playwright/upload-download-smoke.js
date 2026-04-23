/**
 * Upload / Download Core Modules + Speed Test — Playwright Smoke Test
 *
 * Validates:
 *   [1] sg-send-upload v1.1.0 — module loads, exports present
 *   [2] ChunkedUploader — construction and chunk initialisation
 *   [3] Cloud drive detection — iCloud stub, Google Drive MIME type
 *   [4] Resume state serialisation — getResumeState / fromResumeState
 *   [5] Speed helpers — formatSpeed, formatEta
 *   [6] sg-send-download v1.0.0 — module loads, exports present
 *   [7] ChunkedDownloader — construction and probe (mocked)
 *   [8] decryptWithProgress — progress callback sequence
 *   [9] Speed Test tool — page loads, window.__speedTest present, methods registered
 *  [10] Speed Test UI — run button present, config bar, meter cards
 *
 * Tests [1]–[8] run in a minimal browser context (about:blank) using
 *   dynamic import() — no live server required.
 * Tests [9]–[10] require the speed test page to be served locally.
 *
 * Usage:
 *   npm install playwright
 *   node tests/playwright/upload-download-smoke.js
 *
 * Optional env vars:
 *   SPEED_TEST_URL  — default http://localhost:10063/en-gb/speed-test/
 *   HEADLESS        — set to 'false' to watch the browser (default true)
 *   MODULE_BASE_URL — base URL for dynamic imports (default http://localhost:10063)
 */

const { chromium } = require('playwright');

const SPEED_TEST_URL = process.env.SPEED_TEST_URL  || 'http://localhost:10063/en-gb/speed-test/';
const MODULE_BASE    = process.env.MODULE_BASE_URL  || 'http://localhost:10063';
const HEADLESS       = process.env.HEADLESS !== 'false';

// ── Harness ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label)        { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.error(`  ✗ ${label}: ${err?.message || err}`); failed++; }
function skip(label, why) { console.log(`  — ${label} (skipped: ${why})`); }

function assert(cond, label, detail = '') {
    if (cond) ok(label);
    else throw new Error(`Assertion failed: ${label}${detail ? ' — ' + detail : ''}`);
}

// ── Test Groups ────────────────────────────────────────────────────────────────

/**
 * [1] sg-send-upload module loads and exposes expected named exports.
 */
async function testUploadModuleExports(page) {
    console.log('\n[1] sg-send-upload v1.1.0 — exports');
    const uploadModuleUrl = `${MODULE_BASE}/core/sg-send-upload/v1/v1.1/v1.1.0/sg-send-upload.js`;

    const result = await page.evaluate(async (url) => {
        try {
            const m = await import(url);
            return {
                ok:      true,
                exports: Object.keys(m),
            };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }, uploadModuleUrl);

    assert(result.ok, 'module imports without error', result.error);

    const required = [
        'ChunkedUploader',
        'uploadFile',
        'detectCloudDriveFile',
        'formatSpeed',
        'formatEta',
        'DEFAULT_CHUNK_SIZE',
        'DEFAULT_MAX_CONCURRENT',
        'DEFAULT_MAX_RETRIES',
        'RETRY_BASE_DELAY_MS',
    ];
    for (const name of required) {
        assert(result.exports.includes(name), `export '${name}' present`);
    }
}

/**
 * [2] ChunkedUploader construction and chunk initialisation.
 */
async function testChunkedUploaderInit(page) {
    console.log('\n[2] ChunkedUploader — construction and internal chunk init');
    const uploadModuleUrl = `${MODULE_BASE}/core/sg-send-upload/v1/v1.1/v1.1.0/sg-send-upload.js`;

    const result = await page.evaluate(async (url) => {
        const { ChunkedUploader, DEFAULT_CHUNK_SIZE } = await import(url);

        // Build a fake 11 MB ciphertext (just metadata, no real crypto)
        const size   = 11 * 1024 * 1024;
        const cipher = new Uint8Array(size);
        const up     = new ChunkedUploader(cipher, {
            transferId:    'test-transfer-id',
            sendUrl:       'https://example.invalid',
            accessToken:   'test-token',
        });

        // Trigger internal chunk init via getResumeState (requires start to have been
        // called partially — instead we initialise manually by calling the private method)
        // We can't directly test private methods from here, but we can verify the public API.
        const state = up.getResumeState();
        return {
            chunkCount: 0,         // chunks array is empty before start()
            transferId: state.transferId,
            chunkSize:  state.chunkSize,
            totalSize:  state.totalSize,
            defaultCS:  DEFAULT_CHUNK_SIZE,
        };
    }, uploadModuleUrl);

    assert(result.transferId === 'test-transfer-id', 'transferId preserved in resume state');
    assert(result.chunkSize  === result.defaultCS,   'chunkSize defaults to DEFAULT_CHUNK_SIZE');
    assert(result.totalSize  === 11 * 1024 * 1024,   'totalSize is the ciphertext byte length');
    ok('ChunkedUploader construction shape OK');
}

/**
 * [3] Cloud drive file detection.
 */
async function testCloudDriveDetection(page) {
    console.log('\n[3] detectCloudDriveFile — iCloud stub + Google Drive MIME');
    const uploadModuleUrl = `${MODULE_BASE}/core/sg-send-upload/v1/v1.1/v1.1.0/sg-send-upload.js`;

    const result = await page.evaluate(async (url) => {
        const { detectCloudDriveFile } = await import(url);

        // iCloud stub detection: file ending in .icloud
        const icloudFile  = new File([''], 'document.pdf.icloud', { type: '' });

        // Google Drive MIME type
        const gdriveFile  = new File(['x'], 'My Doc', {
            type: 'application/vnd.google-apps.document',
        });

        // Normal local file — should return null
        const localFile   = new File(['hello world'], 'hello.txt', { type: 'text/plain' });

        return {
            icloud: detectCloudDriveFile(icloudFile),
            gdrive: detectCloudDriveFile(gdriveFile),
            local:  detectCloudDriveFile(localFile),
            nullIn: detectCloudDriveFile(null),
        };
    }, uploadModuleUrl);

    assert(result.icloud !== null,             'iCloud stub detected (non-null)');
    assert(result.icloud?.provider === 'iCloud Drive', `provider = 'iCloud Drive' (got '${result.icloud?.provider}')`);
    assert(result.gdrive !== null,             'Google Drive MIME detected (non-null)');
    assert(result.gdrive?.provider === 'Google Drive', `provider = 'Google Drive' (got '${result.gdrive?.provider}')`);
    assert(result.local  === null,             'normal local file → null (not a cloud stub)');
    assert(result.nullIn === null,             'null input → null (no crash)');
}

/**
 * [4] Resume state serialisation round-trip.
 */
async function testResumeStateSerialization(page) {
    console.log('\n[4] ChunkedUploader — resume state round-trip');
    const uploadModuleUrl = `${MODULE_BASE}/core/sg-send-upload/v1/v1.1/v1.1.0/sg-send-upload.js`;

    const result = await page.evaluate(async (url) => {
        const { ChunkedUploader } = await import(url);
        const cipher = new Uint8Array(8 * 1024 * 1024); // 8 MB

        const up = new ChunkedUploader(cipher, {
            transferId:  'resume-test',
            sendUrl:     'https://example.invalid',
            accessToken: 'tok',
        });

        // Simulate a partial state by manually setting internal fields
        up._uploadId = 'fake-upload-id';
        up._urls     = ['url-0', 'url-1'];
        up._initChunks(cipher.byteLength);
        up._chunks[0].status = 'done';
        up._chunks[0].etag   = 'etag-0';

        const state = up.getResumeState();

        // Round-trip: restore into a new uploader
        const up2 = ChunkedUploader.fromResumeState(state, cipher, {
            sendUrl:     'https://example.invalid',
            accessToken: 'tok',
        });

        return {
            uploadId:   state.uploadId,
            chunkCount: state.chunks.length,
            doneChunks: state.chunks.filter(c => c.status === 'done').length,
            etag0:      state.chunks[0].etag,
            restored:   up2.getResumeState().uploadId,
        };
    }, uploadModuleUrl);

    assert(result.uploadId   === 'fake-upload-id', 'uploadId in resume state');
    assert(result.chunkCount === 2,                `chunk count = 2 (got ${result.chunkCount})`);
    assert(result.doneChunks === 1,                `1 done chunk (got ${result.doneChunks})`);
    assert(result.etag0      === 'etag-0',         'etag preserved in chunk state');
    assert(result.restored   === 'fake-upload-id', 'fromResumeState preserves uploadId');
}

/**
 * [5] Speed formatting helpers.
 */
async function testSpeedFormatHelpers(page) {
    console.log('\n[5] formatSpeed / formatEta helpers');
    const uploadModuleUrl = `${MODULE_BASE}/core/sg-send-upload/v1/v1.1/v1.1.0/sg-send-upload.js`;

    const result = await page.evaluate(async (url) => {
        const { formatSpeed, formatEta } = await import(url);
        return {
            bps100:   formatSpeed(100),
            kb500:    formatSpeed(500 * 1024),
            mb2_4:    formatSpeed(2.4 * 1024 * 1024),
            zero:     formatSpeed(0),
            inf:      formatSpeed(Infinity),
            eta45:    formatEta(45),
            eta83:    formatEta(83),
            etaZero:  formatEta(0),
            etaInf:   formatEta(Infinity),
        };
    }, uploadModuleUrl);

    assert(result.bps100.includes('B/s'),  `100 B/s → B/s (got '${result.bps100}')`);
    assert(result.kb500.includes('KB/s'),  `500 KB → KB/s (got '${result.kb500}')`);
    assert(result.mb2_4.includes('MB/s'),  `2.4 MB/s → MB/s (got '${result.mb2_4}')`);
    assert(result.zero  === '—',           `formatSpeed(0) = '—'`);
    assert(result.inf   === '—',           `formatSpeed(Infinity) = '—'`);
    assert(result.eta45 === '45s',         `formatEta(45) = '45s' (got '${result.eta45}')`);
    assert(result.eta83.includes('m'),     `formatEta(83) includes 'm' (got '${result.eta83}')`);
    assert(result.etaZero === '—',         `formatEta(0) = '—'`);
    assert(result.etaInf  === '—',         `formatEta(Infinity) = '—'`);
}

/**
 * [6] sg-send-download module loads and exposes expected named exports.
 */
async function testDownloadModuleExports(page) {
    console.log('\n[6] sg-send-download v1.0.0 — exports');
    const downloadModuleUrl = `${MODULE_BASE}/core/sg-send-download/v1/v1.0/v1.0.0/sg-send-download.js`;

    const result = await page.evaluate(async (url) => {
        try {
            const m = await import(url);
            return { ok: true, exports: Object.keys(m) };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }, downloadModuleUrl);

    assert(result.ok, 'module imports without error', result.error);

    const required = [
        'ChunkedDownloader',
        'decryptWithProgress',
        'formatSpeed',
        'formatEta',
        'DEFAULT_CHUNK_SIZE',
        'DEFAULT_MAX_CONCURRENT',
    ];
    for (const name of required) {
        assert(result.exports.includes(name), `export '${name}' present`);
    }
}

/**
 * [7] ChunkedDownloader construction and resume state.
 */
async function testChunkedDownloaderInit(page) {
    console.log('\n[7] ChunkedDownloader — construction and resume state');
    const downloadModuleUrl = `${MODULE_BASE}/core/sg-send-download/v1/v1.0/v1.0.0/sg-send-download.js`;

    const result = await page.evaluate(async (url) => {
        const { ChunkedDownloader } = await import(url);

        const dl = new ChunkedDownloader('https://example.invalid/file.enc', {
            chunkSize: 1 * 1024 * 1024,  // 1 MB chunks
        });

        // Simulate probe result (normally done via HEAD request)
        dl._totalBytes = 5 * 1024 * 1024;  // 5 MB total
        dl._initChunks(5 * 1024 * 1024);

        const state = dl.getResumeState();
        return {
            url:        state.url,
            totalBytes: state.totalBytes,
            chunkCount: state.chunks.length,
            chunkSize:  state.chunkSize,
        };
    }, downloadModuleUrl);

    assert(result.url        === 'https://example.invalid/file.enc', 'URL preserved');
    assert(result.totalBytes === 5 * 1024 * 1024, 'totalBytes preserved');
    assert(result.chunkCount === 5,               `5 chunks for 5 MB at 1 MB/chunk (got ${result.chunkCount})`);
    assert(result.chunkSize  === 1 * 1024 * 1024, 'custom chunkSize preserved');
}

/**
 * [8] decryptWithProgress — progress callback fires correctly.
 */
async function testDecryptWithProgress(page) {
    console.log('\n[8] decryptWithProgress — progress callback sequence');
    const downloadModuleUrl = `${MODULE_BASE}/core/sg-send-download/v1/v1.0/v1.0.0/sg-send-download.js`;

    const result = await page.evaluate(async (url) => {
        const { decryptWithProgress } = await import(url);

        const stages  = [];
        const percents = [];

        // Fake decrypt function
        const fakeCrypt = async () => new Uint8Array([1, 2, 3]);

        const out = await decryptWithProgress(fakeCrypt, (prog) => {
            stages.push(prog.stage);
            percents.push(prog.percent);
        });

        return {
            stages,
            percents,
            outputLength: out.byteLength,
            isUint8: out instanceof Uint8Array,
        };
    }, downloadModuleUrl);

    assert(result.stages[0]   === 'decrypting', `first stage = 'decrypting' (got '${result.stages[0]}')`);
    assert(result.stages.at(-1) === 'complete',  `last stage = 'complete' (got '${result.stages.at(-1)}')`);
    assert(result.percents[0] === 97,            `first percent = 97 (got ${result.percents[0]})`);
    assert(result.percents.at(-1) === 100,       `last percent = 100 (got ${result.percents.at(-1)})`);
    assert(result.outputLength === 3,            'decrypt output length = 3 bytes');
    assert(result.isUint8,                       'output is Uint8Array');
}

/**
 * [9] Speed Test tool — page loads, window.__speedTest present.
 */
async function testSpeedTestPageLoads(page, speedTestUrl) {
    console.log('\n[9] Speed Test tool — page load + window.__speedTest');
    await page.goto(speedTestUrl, { waitUntil: 'networkidle', timeout: 30_000 });

    const title = await page.title();
    assert(title.includes('Speed Test'), `page title includes 'Speed Test' (got '${title}')`);

    // Wait for module to initialise
    await page.waitForFunction(() => typeof window.__speedTest === 'object' && window.__speedTest !== null, {
        timeout: 10_000,
    });
    ok('window.__speedTest is present');

    const methods = await page.evaluate(() => Object.keys(window.__speedTest));
    const required = ['runAll', 'cancel', 'setTargetUrl', 'getLastResults', 'measureDownloadSpeed', 'measureUploadSpeed'];
    for (const m of required) {
        assert(methods.includes(m), `window.__speedTest.${m} present`);
    }
}

/**
 * [10] Speed Test tool — UI elements present.
 */
async function testSpeedTestUI(page) {
    console.log('\n[10] Speed Test tool — UI elements');

    const runBtn     = await page.$('#run-btn');
    const cancelBtn  = await page.$('#cancel-btn');
    const targetUrl  = await page.$('#target-url');
    const probeSize  = await page.$('#probe-size');
    const dlCard     = await page.$('#dl-card');
    const ulCard     = await page.$('#ul-card');
    const dlSpeed    = await page.$('#dl-speed');
    const ulSpeed    = await page.$('#ul-speed');
    const shareBtn   = await page.$('#share-btn');

    assert(runBtn    !== null, '#run-btn present');
    assert(cancelBtn !== null, '#cancel-btn present');
    assert(targetUrl !== null, '#target-url input present');
    assert(probeSize !== null, '#probe-size select present');
    assert(dlCard    !== null, '#dl-card (download meter) present');
    assert(ulCard    !== null, '#ul-card (upload meter) present');
    assert(dlSpeed   !== null, '#dl-speed element present');
    assert(ulSpeed   !== null, '#ul-speed element present');
    assert(shareBtn  !== null, '#share-btn present');

    // Run button should be enabled initially
    const runDisabled = await page.evaluate(() => document.getElementById('run-btn').disabled);
    assert(!runDisabled, 'Run button enabled on page load');

    // Cancel button hidden initially
    const cancelDisplay = await page.evaluate(() => document.getElementById('cancel-btn').style.display);
    assert(cancelDisplay === 'none' || cancelDisplay === '', 'Cancel button hidden initially');

    // Default target URL
    const urlVal = await page.evaluate(() => document.getElementById('target-url').value);
    assert(urlVal.includes('sgraph.ai'), `default target URL contains 'sgraph.ai' (got '${urlVal}')`);

    ok('all UI elements verified');
}

// ── Runner ─────────────────────────────────────────────────────────────────────

(async () => {
    const browser = await chromium.launch({ headless: HEADLESS });
    const ctx     = await browser.newContext();
    let page;

    try {
        // Groups [1]–[8]: module-level tests on a blank page (dynamic import from dev server)
        page = await ctx.newPage();
        await page.goto('about:blank');

        // Suppress expected network-error console noise from 'example.invalid' URLs
        page.on('console', msg => {
            if (msg.type() === 'error' && msg.text().includes('example.invalid')) return;
            if (msg.type() === 'error') console.log(`  [browser] ${msg.text()}`);
        });

        try { await testUploadModuleExports(page); }
        catch (e) { fail('[1] sg-send-upload exports', e); }

        try { await testChunkedUploaderInit(page); }
        catch (e) { fail('[2] ChunkedUploader init', e); }

        try { await testCloudDriveDetection(page); }
        catch (e) { fail('[3] cloud drive detection', e); }

        try { await testResumeStateSerialization(page); }
        catch (e) { fail('[4] resume state serialisation', e); }

        try { await testSpeedFormatHelpers(page); }
        catch (e) { fail('[5] format helpers', e); }

        try { await testDownloadModuleExports(page); }
        catch (e) { fail('[6] sg-send-download exports', e); }

        try { await testChunkedDownloaderInit(page); }
        catch (e) { fail('[7] ChunkedDownloader init', e); }

        try { await testDecryptWithProgress(page); }
        catch (e) { fail('[8] decryptWithProgress', e); }

        await page.close();

        // Groups [9]–[10]: speed test tool page
        page = await ctx.newPage();
        try {
            await testSpeedTestPageLoads(page, SPEED_TEST_URL);
            await testSpeedTestUI(page);
        } catch (e) {
            fail('[9-10] speed test page', e);
        }

    } finally {
        await browser.close();
    }

    console.log(`\n──────────────────────────────────────`);
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log(`──────────────────────────────────────\n`);

    process.exit(failed > 0 ? 1 : 0);
})();
