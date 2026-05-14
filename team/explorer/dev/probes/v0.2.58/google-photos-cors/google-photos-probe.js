/**
 * google-photos-probe — Phase 0 de-risk probe for the Google Photos Picker API
 * (Architect plan v0.2.58 §9, §8.3).
 *
 * Goal: scaffold + document a test harness for whether `baseUrl` media
 * downloads from the Picker API are reachable from browser JS (CORS), and
 * exercise the full Picker session flow end-to-end once credentials exist.
 *
 * BLOCKED until the user creates the Google OAuth client ID and completes
 * the Google Cloud setup (see plan §11). Until then the page is wired up and
 * runnable, it just cannot Connect. The on-page instructions explain exactly
 * what the user must do.
 *
 * THROWAWAY probe. Not a shipped tool. Lives under team/explorer/dev/probes/.
 *
 * @module google-photos-probe
 */

import {
    requestPhotosAccess,
    createPickerSession,
    pollSession,
    listPickedItems,
    downloadMediaBytes,
    PHOTOS_PICKER_SCOPE,
} from './picker-client.js';

// localStorage key — this is a probe page, persistence is fine here (and the
// CLAUDE.md no-localStorage rule applies to *core modules*, not probe pages).
const CLIENT_ID_KEY = 'sg-google-photos-probe-client-id';

/** @type {{accessToken: string, expiresAt: number}|null} */
let token = null;
/** @type {object|null} current picker session resource */
let session = null;
/** @type {Array<object>} picked media items */
let pickedItems = [];

const el = {
    clientId:   document.getElementById('client-id'),
    connectBtn: document.getElementById('connect'),
    openBtn:    document.getElementById('open-picker'),
    pollBtn:    document.getElementById('poll'),
    listBtn:    document.getElementById('list-items'),
    dlBtn:      document.getElementById('download-test'),
    status:     document.getElementById('status'),
    log:        document.getElementById('log'),
    items:      document.getElementById('items'),
    scopeNote:  document.getElementById('scope-note'),
};

el.scopeNote.textContent = PHOTOS_PICKER_SCOPE;

/**
 * Append a timestamped line to the on-page log and the console.
 * @param {string} msg
 * @param {'info'|'ok'|'err'} [level]
 * @returns {void}
 */
function log(msg, level = 'info') {
    const t = new Date().toISOString().slice(11, 19);
    const line = `[${t}] ${msg}`;
    const div = document.createElement('div');
    div.className = `log-line log-${level}`;
    div.textContent = line;
    el.log.appendChild(div);
    el.log.scrollTop = el.log.scrollHeight;
    if (level === 'err') console.error(line);
    else console.log(line);
}

/**
 * Set the big status banner.
 * @param {'idle'|'running'|'pass'|'fail'|'blocked'} state
 * @param {string} text
 * @returns {void}
 */
function setStatus(state, text) {
    el.status.className = `status status-${state}`;
    el.status.textContent = text;
    console.log(`[GPHOTOS PROBE] status=${state.toUpperCase()} — ${text}`);
}

/**
 * Enable/disable the flow buttons based on how far the probe has progressed.
 * @returns {void}
 */
function syncButtons() {
    const connected = !!token;
    el.openBtn.disabled = !connected;
    el.pollBtn.disabled = !connected || !session;
    el.listBtn.disabled = !connected || !session;
    el.dlBtn.disabled   = !connected || pickedItems.length === 0;
}

// ---------------------------------------------------------------------------
// Step 1 — Connect (OAuth)
// ---------------------------------------------------------------------------

el.connectBtn.addEventListener('click', async () => {
    const clientId = el.clientId.value.trim();
    if (!clientId) {
        setStatus('fail', 'FAIL — paste an OAuth client ID first');
        return;
    }
    localStorage.setItem(CLIENT_ID_KEY, clientId);
    setStatus('running', 'Requesting Google access token…');
    log(`Connect: requesting token for client ${clientId.slice(0, 24)}… scope=${PHOTOS_PICKER_SCOPE}`);
    try {
        token = await requestPhotosAccess(clientId);
        log(`Access token acquired, expires ${new Date(token.expiresAt).toISOString()}`, 'ok');
        log(`Granted scope: ${token.scope}`, 'ok');
        setStatus('running', 'Connected — now open the Google picker (step 2)');
        syncButtons();
    } catch (err) {
        token = null;
        log(`Connect failed: ${err.message}`, 'err');
        setStatus('fail', `FAIL — OAuth: ${err.message}`);
        syncButtons();
    }
});

// ---------------------------------------------------------------------------
// Step 2 — Create + open a picker session
// ---------------------------------------------------------------------------

el.openBtn.addEventListener('click', async () => {
    if (!token) return;
    setStatus('running', 'Creating picker session…');
    log('Creating picker session via POST /v1/sessions');
    try {
        session = await createPickerSession(token.accessToken);
        log(`Session created: id=${session.id}`, 'ok');
        log(`pollingConfig: ${JSON.stringify(session.pollingConfig || {})}`);
        if (session.pickerUri) {
            log(`Opening Google-hosted picker: ${session.pickerUri}`);
            window.open(session.pickerUri, '_blank', 'noopener');
            setStatus('running', 'Picker opened in a new tab — pick items there, then Poll (step 3)');
        } else {
            setStatus('fail', 'FAIL — session has no pickerUri');
        }
        syncButtons();
    } catch (err) {
        log(`createPickerSession failed: ${err.message}`, 'err');
        setStatus('fail', `FAIL — create session: ${err.message}`);
    }
});

// ---------------------------------------------------------------------------
// Step 3 — Poll the session until the user finishes picking
// ---------------------------------------------------------------------------

el.pollBtn.addEventListener('click', async () => {
    if (!token || !session) return;
    setStatus('running', 'Polling session…');
    log(`Polling session ${session.id}`);
    try {
        const updated = await pollSession(token.accessToken, session.id);
        session = updated;
        if (updated.mediaItemsSet) {
            log('mediaItemsSet=true — user has finished picking', 'ok');
            setStatus('running', 'Items ready — list them (step 4)');
        } else {
            log('mediaItemsSet=false — user still picking; poll again in a moment', 'info');
            setStatus('running', 'Not done yet — pick items in the Google tab, then Poll again');
        }
        syncButtons();
    } catch (err) {
        log(`pollSession failed: ${err.message}`, 'err');
        setStatus('fail', `FAIL — poll: ${err.message}`);
    }
});

// ---------------------------------------------------------------------------
// Step 4 — List the picked media items
// ---------------------------------------------------------------------------

el.listBtn.addEventListener('click', async () => {
    if (!token || !session) return;
    setStatus('running', 'Listing picked media items…');
    log(`GET /v1/mediaItems?sessionId=${session.id}`);
    try {
        const result = await listPickedItems(token.accessToken, session.id);
        pickedItems = result.mediaItems || [];
        log(`Listed ${pickedItems.length} picked item(s)`, 'ok');
        renderItems();
        if (pickedItems.length > 0) {
            setStatus('running', 'Items listed — run the baseUrl CORS download test (step 5)');
        } else {
            setStatus('fail', 'No items returned — did the user actually pick anything?');
        }
        syncButtons();
    } catch (err) {
        log(`listPickedItems failed: ${err.message}`, 'err');
        setStatus('fail', `FAIL — list items: ${err.message}`);
    }
});

// ---------------------------------------------------------------------------
// Step 5 — THE CORS PROBE: download baseUrl bytes
// ---------------------------------------------------------------------------

el.dlBtn.addEventListener('click', async () => {
    if (!token || pickedItems.length === 0) return;
    const item = pickedItems[0];
    setStatus('running', 'Testing baseUrl byte download (CORS probe)…');
    log(`Downloading bytes for first picked item: ${item.id || '(no id)'}`);
    try {
        const result = await downloadMediaBytes(token.accessToken, item);
        if (result.ok) {
            log(result.detail, 'ok');
            log(`content-type=${result.contentType}, bytes=${result.bytes}`, 'ok');
            setStatus('pass', `PASS — CORS PERMITS baseUrl downloads (${result.bytes} bytes). Connector can run fully client-side.`);
        } else {
            log(result.detail, 'err');
            setStatus('fail', `FAIL — ${result.detail}`);
        }
    } catch (err) {
        log(`download test crashed: ${err.message}`, 'err');
        setStatus('fail', `FAIL — download test: ${err.message}`);
    }
});

/**
 * Render the picked media items as a simple list.
 * @returns {void}
 */
function renderItems() {
    el.items.innerHTML = '';
    if (pickedItems.length === 0) {
        el.items.textContent = 'No picked items yet.';
        return;
    }
    for (const item of pickedItems) {
        const mf = item.mediaFile || {};
        const div = document.createElement('div');
        div.className = 'item';
        div.textContent =
            `${item.type || 'UNKNOWN'} — ${mf.filename || item.id || '(no name)'} `
            + `— mimeType=${mf.mimeType || 'n/a'} `
            + `— baseUrl=${mf.baseUrl ? 'present' : 'MISSING'}`;
        el.items.appendChild(div);
    }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const cached = localStorage.getItem(CLIENT_ID_KEY);
if (cached) {
    el.clientId.value = cached;
    log(`Restored cached client ID from localStorage (${cached.slice(0, 24)}…)`);
}

if (!window.google?.accounts?.oauth2) {
    log('Google Identity Services not yet loaded — it loads async; Connect will retry.', 'info');
}

setStatus('blocked',
    'BLOCKED on credentials — paste an OAuth client ID to begin. See the setup instructions below.');
log('Probe ready. Picker API flow is fully wired; the baseUrl CORS test (step 5) is the unknown this probe answers.');
syncButtons();
console.log('[GPHOTOS PROBE] ready — steps wired: connect → openPicker → poll → list → downloadTest');
