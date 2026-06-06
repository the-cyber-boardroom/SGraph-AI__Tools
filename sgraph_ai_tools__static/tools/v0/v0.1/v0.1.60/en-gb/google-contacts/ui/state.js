/**
 * In-memory state for the google-contacts tool.
 *
 * Holds the OAuth client ID (also mirrored to localStorage so the user
 * doesn't have to paste it on every visit — the client ID is public by
 * design, like an API key for a Web OAuth app), the access token (memory
 * only — never persisted), and the loaded contacts.
 *
 * @module google-contacts/state
 */

const LS_CLIENT_ID = 'sg-google-contacts:clientId';

const SUBSCRIBERS = new Set();

/**
 * Build a fresh state container. The same listener mechanism is used by
 * every UI panel so we don't need a heavyweight pub/sub library.
 *
 * @returns {object} state with mutate/subscribe helpers and a snapshot getter
 */
export function createState() {
    const data = {
        clientId:    _readClientId() || '',
        accessToken: null,
        tokenExpiresAt: null,
        signedIn:    false,
        loading:     false,
        loadProgress: null,   // { soFar, total } during loadContacts
        contacts:    [],      // normalised Person[]
        filter:      '',
        selectedId:  null,
        error:       null,
    };

    function snapshot() {
        // Shallow-copy primitives; share the contacts array (callers must not mutate).
        return { ...data, contacts: data.contacts };
    }

    function mutate(patch) {
        Object.assign(data, patch);
        if (patch.clientId !== undefined) _writeClientId(patch.clientId);
        SUBSCRIBERS.forEach(fn => { try { fn(snapshot()); } catch { /* ignore */ } });
    }

    function subscribe(fn) {
        SUBSCRIBERS.add(fn);
        try { fn(snapshot()); } catch { /* ignore */ }
        return () => SUBSCRIBERS.delete(fn);
    }

    return { snapshot, mutate, subscribe, get raw() { return data; } };
}

function _readClientId() {
    try { return localStorage.getItem(LS_CLIENT_ID); } catch { return null; }
}

function _writeClientId(v) {
    try {
        if (v) localStorage.setItem(LS_CLIENT_ID, v);
        else   localStorage.removeItem(LS_CLIENT_ID);
    } catch { /* private mode — ignore */ }
}
