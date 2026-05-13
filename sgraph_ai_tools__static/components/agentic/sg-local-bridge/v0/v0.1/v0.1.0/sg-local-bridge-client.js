/**
 * sg-local-bridge-client — Typed fetch wrappers for the sgraph_bridge FastAPI service.
 * Named exports only. No default exports. No Web Component.
 * Throws BridgeError (with .errorCode, .detail, .status) on 4xx/5xx or network failure.
 * @module sg-local-bridge-client
 * @version 0.1.0
 */

/** Thrown when the bridge returns a 4xx/5xx or a network failure occurs. */
export class BridgeError extends Error {
    /** @param {string} message @param {string} errorCode @param {*} detail @param {number} status */
    constructor(message, errorCode, detail, status) {
        super(message);
        this.name = 'BridgeError'; this.errorCode = errorCode; this.detail = detail; this.status = status;
    }
}

/** @param {string} ep @param {string} path @param {Object} body @param {number} ms @returns {Promise<Object>} */
async function call(ep, path, body, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    let res;
    try {
        res = await fetch(`${ep}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (err) { clearTimeout(t); throw new BridgeError(err.message, 'fetch_failed', null, 0); }
    clearTimeout(t);
    let json; try { json = await res.json(); } catch { json = {}; }
    if (!res.ok) throw new BridgeError(json.message ?? `HTTP ${res.status}`, json.error_code ?? 'unknown', json.detail ?? null, res.status);
    return json;
}

/**
 * Ping the bridge — returns version, workspace, latency_ms.
 * @param {string} endpoint @param {number} [timeoutMs=5000]
 * @returns {Promise<{ok:boolean,version:string,workspace:string,started_at:string,latency_ms:number}>}
 */
export async function ping(endpoint, timeoutMs = 5000) {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try { res = await fetch(`${endpoint}/ping`, { signal: ctrl.signal }); }
    catch (err) { clearTimeout(t); throw new BridgeError(err.message, 'fetch_failed', null, 0); }
    clearTimeout(t);
    let json; try { json = await res.json(); } catch { json = {}; }
    if (!res.ok) throw new BridgeError(json.message ?? `HTTP ${res.status}`, json.error_code ?? 'unknown', null, res.status);
    return { ...json, latency_ms: Date.now() - t0 };
}

/**
 * Read a text file from the workspace.
 * @param {string} endpoint @param {string} path - Relative to workspace root @param {number} [timeoutMs=30000]
 * @returns {Promise<Object>} { path, content, size, mtime, is_text }
 */
export async function readFile(endpoint, path, timeoutMs = 30000) {
    return call(endpoint, '/file/read', { path }, timeoutMs);
}

/**
 * Write (overwrite) a file in the workspace.
 * @param {string} endpoint @param {string} path @param {string} content
 * @param {boolean} [createDirs=true] @param {number} [timeoutMs=30000]
 * @returns {Promise<Object>} { path, bytes_written, created }
 */
export async function writeFile(endpoint, path, content, createDirs = true, timeoutMs = 30000) {
    return call(endpoint, '/file/write', { path, content, create_dirs: createDirs }, timeoutMs);
}

/**
 * Delete a file from the workspace.
 * @param {string} endpoint @param {string} path @param {number} [timeoutMs=30000]
 * @returns {Promise<Object>} { path, deleted }
 */
export async function deleteFile(endpoint, path, timeoutMs = 30000) {
    return call(endpoint, '/file/delete', { path }, timeoutMs);
}

/**
 * List entries in a workspace folder.
 * @param {string} endpoint @param {string} path @param {boolean} [recursive=false] @param {number} [timeoutMs=30000]
 * @returns {Promise<Object>} { path, entries: [{name, type, size, mtime}] }
 */
export async function listFolder(endpoint, path, recursive = false, timeoutMs = 30000) {
    return call(endpoint, '/file/list', { path, recursive }, timeoutMs);
}

/**
 * Run a bash command in the workspace container.
 * @param {string} endpoint @param {string} command @param {string} [cwd='']
 * @param {number} [timeoutSec=30] @param {number} [timeoutMs=35000]
 * @returns {Promise<Object>} { command, cwd, exit_code, stdout, stderr, duration_ms, truncated }
 */
export async function runBash(endpoint, command, cwd = '', timeoutSec = 30, timeoutMs = 35000) {
    return call(endpoint, '/bash/exec', { command, cwd: cwd || undefined, timeout_s: timeoutSec }, timeoutMs);
}

/**
 * Fetch a URL via the bridge.
 * @param {string} endpoint @param {string} url @param {string} [method='GET']
 * @param {Object} [headers={}] @param {string} [body=''] @param {number} [timeoutMs=30000]
 * @returns {Promise<Object>} { url, status, headers, body, content_type, duration_ms }
 */
export async function fetchUrl(endpoint, url, method = 'GET', headers = {}, body = '', timeoutMs = 30000) {
    return call(endpoint, '/curl/fetch', { url, method, headers, body: body || undefined }, timeoutMs);
}
