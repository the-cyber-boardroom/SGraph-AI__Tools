/**
 * api-contacts — load / read / filter the user's Google contacts.
 *
 * Loads every page of /people/me/connections via sg-google-people,
 * normalises each Person, and keeps them in tool state. Search is
 * client-side filtering over the loaded set — no extra People API
 * round-trips, and it works offline once loaded.
 *
 * @module google-contacts/api-contacts
 */

import { listAllConnections, normalisePerson, DEFAULT_PERSON_FIELDS }
    from '/core/sg-google-people/v0/v0.1/v0.1.0/sg-google-people.js';
import { GC_EVENTS } from './google-contacts-events.js';

/**
 * @param {{state: object, emit: function}} deps
 */
export function buildContactsMethods({ state, emit }) {
    /**
     * Pull every contact from the People API. Sequential paging — the
     * People API caps pageSize at 1000 so a typical address book is one
     * or two requests.
     */
    async function loadContacts({ personFields = DEFAULT_PERSON_FIELDS } = {}) {
        const { signedIn, accessToken, loading } = state.snapshot();
        if (!signedIn || !accessToken) {
            throw Object.assign(new Error('Sign in first'), { code: 'not-signed-in' });
        }
        if (loading) throw Object.assign(new Error('Load already in progress'), { code: 'busy' });

        state.mutate({ loading: true, loadProgress: { soFar: 0, total: null }, error: null });
        emit(GC_EVENTS.CONTACTS_LOADING, {});

        try {
            const persons = await listAllConnections({
                accessToken,
                personFields,
                pageSize: 1000,
                onPage: ({ page, pageCount, total, soFar }) => {
                    state.mutate({ loadProgress: { soFar, total } });
                    emit(GC_EVENTS.CONTACTS_PAGE, { page, pageCount, soFar, total });
                },
            });
            const contacts = persons.map(normalisePerson).filter(Boolean);
            state.mutate({ contacts, loading: false, loadProgress: null });
            emit(GC_EVENTS.CONTACTS_LOADED, { count: contacts.length });
            return { ok: true, count: contacts.length };
        } catch (e) {
            state.mutate({ loading: false, loadProgress: null, error: e.message });
            emit(GC_EVENTS.CONTACTS_ERROR, { message: e.message, code: e.code || null });
            throw e;
        }
    }

    /**
     * Return the loaded contacts, optionally filtered.
     */
    function getContacts({ query, limit } = {}) {
        const { contacts } = state.snapshot();
        let out = contacts;
        if (query && query.trim()) out = _filter(contacts, query);
        if (typeof limit === 'number' && limit > 0) out = out.slice(0, limit);
        return out;
    }

    function getContact({ id } = {}) {
        if (!id) throw Object.assign(new Error('id required'), { code: 'invalid-arg' });
        const c = state.snapshot().contacts.find(x => x.id === id);
        if (!c) throw Object.assign(new Error(`Unknown contact: ${id}`), { code: 'unknown-item' });
        return c;
    }

    /**
     * Same as getContacts({ query }) but also persists the query into
     * state so the UI knows what's selected. Useful as the UI search
     * input's binding point.
     */
    function searchContacts({ query = '' } = {}) {
        state.mutate({ filter: query });
        emit(GC_EVENTS.FILTER_CHANGED, { query });
        return getContacts({ query });
    }

    function selectContact({ id } = {}) {
        if (id != null) getContact({ id }); // throws if unknown
        state.mutate({ selectedId: id || null });
        emit(GC_EVENTS.SELECTION_CHANGED, { id: id || null });
        return { ok: true, id: id || null };
    }

    function clearContacts() {
        state.mutate({ contacts: [], selectedId: null, filter: '' });
        emit(GC_EVENTS.CONTACTS_CLEARED, {});
        return { ok: true };
    }

    return { loadContacts, getContacts, getContact, searchContacts, selectContact, clearContacts };
}

function _filter(contacts, query) {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(c => {
        if (c.displayName?.toLowerCase().includes(q)) return true;
        if (c.organization?.toLowerCase().includes(q)) return true;
        if (c.emails.some(e => e.toLowerCase().includes(q))) return true;
        if (c.phones.some(p => p.toLowerCase().includes(q))) return true;
        return false;
    });
}
