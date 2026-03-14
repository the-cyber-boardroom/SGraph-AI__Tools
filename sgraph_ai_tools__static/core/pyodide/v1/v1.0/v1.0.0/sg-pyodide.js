/* =============================================================================
   SGraph — Pyodide Loader Module
   v1.0.0 — Lazy-loads Pyodide (CPython in WebAssembly) for browser-based Python

   Provides a managed Pyodide lifecycle: load, install packages via micropip,
   run Python code, and bridge between JS and Python. Designed for vault
   operations but usable for any Python-in-browser scenario.

   Usage:
     import { loadPyodide, installPackages, runPython, getStatus } from './sg-pyodide.js';

     const py = await loadPyodide({ onProgress });
     await installPackages(py, ['cryptography']);
     const result = await runPython(py, 'import sys; sys.version');
   ============================================================================= */

/** @type {string} CDN URL for Pyodide */
export const PYODIDE_CDN_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/'

/** @type {string} Pyodide script URL */
export const PYODIDE_SCRIPT_URL = `${PYODIDE_CDN_URL}pyodide.js`

/** @type {object|null} Cached Pyodide instance (singleton) */
let _pyodideInstance = null

/** @type {string} Current status */
let _status = 'idle'

/** @type {string|null} Error message if loading failed */
let _error = null

/**
 * Get the current Pyodide loading status.
 *
 * @returns {{ status: string, error: string|null, loaded: boolean }}
 */
export function getStatus() {
    return {
        status: _status,
        error:  _error,
        loaded: _pyodideInstance !== null
    }
}

/**
 * Load Pyodide from CDN. Returns the cached instance if already loaded.
 * This is the main entry point — call this first.
 *
 * @param {object} [options]
 * @param {function} [options.onProgress] - Progress callback: ({ stage, detail }) => void
 * @param {string}   [options.cdnUrl] - Override CDN URL
 * @returns {Promise<object>} The Pyodide instance
 */
export async function loadPyodide(options = {}) {
    if (_pyodideInstance) {
        return _pyodideInstance
    }

    const onProgress = options.onProgress || (() => {})
    const cdnUrl     = options.cdnUrl || PYODIDE_CDN_URL

    try {
        _status = 'loading-script'
        _error  = null
        onProgress({ stage: 'loading-script', detail: 'Downloading Pyodide runtime...' })

        await loadScript(`${cdnUrl}pyodide.js`)

        _status = 'initialising'
        onProgress({ stage: 'initialising', detail: 'Initialising Python runtime...' })

        /* global loadPyodide as pyodideLoader */
        // eslint-disable-next-line no-undef
        _pyodideInstance = await globalThis.loadPyodide({
            indexURL: cdnUrl
        })

        _status = 'loading-micropip'
        onProgress({ stage: 'loading-micropip', detail: 'Loading package manager...' })

        await _pyodideInstance.loadPackage('micropip')

        _status = 'ready'
        onProgress({ stage: 'ready', detail: 'Python runtime ready.' })

        return _pyodideInstance

    } catch (err) {
        _status = 'error'
        _error  = err.message
        onProgress({ stage: 'error', detail: err.message })
        throw err
    }
}

/**
 * Install Python packages via micropip.
 *
 * @param {object} pyodide - The Pyodide instance
 * @param {string[]} packages - Package names (PyPI or wheel URLs)
 * @param {object} [options]
 * @param {function} [options.onProgress] - Progress callback
 * @returns {Promise<void>}
 */
export async function installPackages(pyodide, packages, options = {}) {
    const onProgress = options.onProgress || (() => {})

    _status = 'installing-packages'
    onProgress({ stage: 'installing-packages', detail: `Installing: ${packages.join(', ')}` })

    const micropip = pyodide.pyimport('micropip')
    await micropip.install(packages)

    _status = 'ready'
    onProgress({ stage: 'ready', detail: `Installed: ${packages.join(', ')}` })
}

/**
 * Run Python code and return the result.
 *
 * @param {object} pyodide - The Pyodide instance
 * @param {string} code - Python code to execute
 * @returns {Promise<*>} The return value of the Python code
 */
export async function runPython(pyodide, code) {
    return pyodide.runPythonAsync(code)
}

/**
 * Run Python code that produces stdout output. Captures and returns it.
 *
 * @param {object} pyodide - The Pyodide instance
 * @param {string} code - Python code to execute
 * @returns {Promise<{ result: *, stdout: string, stderr: string }>}
 */
export async function runPythonCapture(pyodide, code) {
    const captureCode = `
import sys, io
_sg_stdout = io.StringIO()
_sg_stderr = io.StringIO()
sys.stdout = _sg_stdout
sys.stderr = _sg_stderr
try:
    _sg_result = None
    exec(${JSON.stringify(code)})
finally:
    sys.stdout = sys.__stdout__
    sys.stderr = sys.__stderr__
    _sg_captured_out = _sg_stdout.getvalue()
    _sg_captured_err = _sg_stderr.getvalue()
`
    await pyodide.runPythonAsync(captureCode)

    const stdout = pyodide.globals.get('_sg_captured_out') || ''
    const stderr = pyodide.globals.get('_sg_captured_err') || ''
    const result = pyodide.globals.get('_sg_result')

    return { result, stdout, stderr }
}

/**
 * Check if a specific Python package is available in Pyodide.
 *
 * @param {object} pyodide - The Pyodide instance
 * @param {string} packageName - Package to check
 * @returns {Promise<boolean>}
 */
export async function isPackageAvailable(pyodide, packageName) {
    try {
        await pyodide.runPythonAsync(`import ${packageName}`)
        return true
    } catch {
        return false
    }
}

/**
 * Run a compatibility check for sg-send-cli dependencies.
 * Tests whether key packages can be loaded in Pyodide.
 *
 * @param {object} pyodide - The Pyodide instance
 * @param {function} [onProgress] - Progress callback
 * @returns {Promise<{
 *   compatible: object[],
 *   incompatible: object[],
 *   overall: boolean
 * }>}
 */
export async function checkVaultCompatibility(pyodide, onProgress) {
    const cb = onProgress || (() => {})
    const results = { compatible: [], incompatible: [], overall: true }

    const checks = [
        { name: 'hashlib',       pkg: null,             critical: true,  desc: 'SHA-256 / HMAC'         },
        { name: 'hmac',          pkg: null,             critical: true,  desc: 'HMAC-SHA256 file IDs'   },
        { name: 'json',          pkg: null,             critical: true,  desc: 'JSON parsing'           },
        { name: 'cryptography',  pkg: 'cryptography',   critical: true,  desc: 'PBKDF2 + AES-256-GCM'  },
        { name: 'httpx',         pkg: 'httpx',          critical: false, desc: 'HTTP client'            },
        { name: 'pydantic',      pkg: 'pydantic',       critical: false, desc: 'Data validation'        },
    ]

    for (const check of checks) {
        cb({ stage: 'checking', detail: `Testing ${check.name} (${check.desc})...` })

        try {
            if (check.pkg) {
                const micropip = pyodide.pyimport('micropip')
                await micropip.install(check.pkg)
            }
            await pyodide.runPythonAsync(`import ${check.name}`)
            results.compatible.push({ ...check, status: 'ok' })
            cb({ stage: 'check-ok', detail: `${check.name}: OK` })
        } catch (err) {
            results.incompatible.push({ ...check, status: 'fail', error: err.message })
            if (check.critical) results.overall = false
            cb({ stage: 'check-fail', detail: `${check.name}: FAILED — ${err.message}` })
        }
    }

    return results
}

/**
 * Run vault crypto operations using Python in the browser.
 * This replicates Vault__Crypto from sg-send-cli.
 *
 * @param {object} pyodide - The Pyodide instance
 * @param {string} passphrase - Vault passphrase
 * @param {string} vaultId - 8-char hex vault ID
 * @returns {Promise<{
 *   read_key_hex:     string,
 *   write_key:        string,
 *   tree_file_id:     string,
 *   settings_file_id: string,
 *   python_version:   string
 * }>}
 */
export async function deriveVaultKeysPython(pyodide, passphrase, vaultId) {
    const code = `
import hashlib
import hmac

KDF_ITERATIONS = 600_000
KEY_LENGTH     = 32
FILE_ID_LENGTH = 12
SALT_PREFIX    = 'sg-vault-v1'

def _derive_pbkdf2(passphrase_bytes, salt_bytes):
    return hashlib.pbkdf2_hmac('sha256', passphrase_bytes, salt_bytes, KDF_ITERATIONS, dklen=KEY_LENGTH)

def _derive_file_id(read_key_bytes, input_string):
    mac = hmac.new(read_key_bytes, input_string.encode(), hashlib.sha256)
    return mac.hexdigest()[:FILE_ID_LENGTH]

passphrase = ${JSON.stringify(passphrase)}
vault_id   = ${JSON.stringify(vaultId)}

passphrase_bytes = passphrase.encode()
read_salt        = f'{SALT_PREFIX}:{vault_id}'.encode()
write_salt       = f'{SALT_PREFIX}:write:{vault_id}'.encode()

read_key_bytes   = _derive_pbkdf2(passphrase_bytes, read_salt)
write_key_bytes  = _derive_pbkdf2(passphrase_bytes, write_salt)

read_key_hex     = read_key_bytes.hex()
write_key        = write_key_bytes.hex()
tree_file_id     = _derive_file_id(read_key_bytes, f'{SALT_PREFIX}:file-id:tree:{vault_id}')
settings_file_id = _derive_file_id(read_key_bytes, f'{SALT_PREFIX}:file-id:settings:{vault_id}')

import sys
python_version = sys.version
`
    await pyodide.runPythonAsync(code)

    return {
        read_key_hex:     pyodide.globals.get('read_key_hex'),
        write_key:        pyodide.globals.get('write_key'),
        tree_file_id:     pyodide.globals.get('tree_file_id'),
        settings_file_id: pyodide.globals.get('settings_file_id'),
        python_version:   pyodide.globals.get('python_version')
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load a script tag dynamically and wait for it.
 *
 * @param {string} src - Script URL
 * @returns {Promise<void>}
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve()
            return
        }
        const script = document.createElement('script')
        script.src   = src
        script.async = true
        script.onload  = resolve
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
        document.head.appendChild(script)
    })
}
