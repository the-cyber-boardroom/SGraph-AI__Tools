/**
 * api-export — write the loaded contacts to a JSON file the user downloads.
 *
 * Strips the heavy `raw` (People API Person) field by default so the
 * file is the compact normalised shape. Pass `{ includeRaw: true }` to
 * keep it.
 *
 * @module google-contacts/api-export
 */

import { GC_EVENTS } from './google-contacts-events.js';

/**
 * @param {{state: object, emit: function}} deps
 */
export function buildExportMethods({ state, emit }) {
    /**
     * Export contacts (or a filtered subset) as a downloadable JSON file.
     *
     * @param {object}   [opts]
     * @param {string[]} [opts.ids]          Restrict to specific contact ids.
     * @param {string}   [opts.query]        Apply a filter (same syntax as searchContacts).
     * @param {boolean}  [opts.includeRaw]   Keep the raw People API Person on each row.
     * @param {string}   [opts.filename]
     */
    async function exportJson({ ids, query, includeRaw = false, filename } = {}) {
        let contacts = state.snapshot().contacts;
        if (Array.isArray(ids) && ids.length) {
            const set = new Set(ids);
            contacts = contacts.filter(c => set.has(c.id));
        }
        if (query && query.trim()) contacts = _filter(contacts, query);
        if (!contacts.length) throw Object.assign(new Error('No contacts to export'), { code: 'empty' });

        const rows = includeRaw ? contacts : contacts.map(({ raw, ...rest }) => rest);
        const payload = {
            generatedAt: new Date().toISOString(),
            source:      'google-people-api',
            count:       rows.length,
            contacts:    rows,
        };
        const json = JSON.stringify(payload, null, 2);
        const name = filename || `google-contacts-${_today()}.json`;
        _triggerDownload(json, name, 'application/json');
        emit(GC_EVENTS.EXPORT_COMPLETE, { format: 'json', count: rows.length, filename: name });
        return { ok: true, count: rows.length, filename: name, sizeBytes: json.length };
    }

    return { exportJson };
}

function _today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _filter(contacts, query) {
    const q = query.trim().toLowerCase();
    return contacts.filter(c => {
        if (c.displayName?.toLowerCase().includes(q)) return true;
        if (c.organization?.toLowerCase().includes(q)) return true;
        if (c.emails.some(e => e.toLowerCase().includes(q))) return true;
        if (c.phones.some(p => p.toLowerCase().includes(q))) return true;
        return false;
    });
}

function _triggerDownload(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
}
