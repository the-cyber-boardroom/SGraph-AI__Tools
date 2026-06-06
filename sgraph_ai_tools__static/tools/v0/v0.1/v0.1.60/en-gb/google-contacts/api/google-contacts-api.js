/**
 * google-contacts-api — entry point.
 *
 * Phase-3 entry script for the manifest-loader. Builds state, registers
 * every SgToolApi method, calls activate(), then mounts the UI.
 *
 * @module google-contacts/google-contacts-api
 */

import { SgToolApi } from '/core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js';
import { createState } from '../ui/state.js';
import { buildAuthMethods, CONTACTS_SCOPE } from './api-auth.js';
import { buildContactsMethods } from './api-contacts.js';
import { buildExportMethods } from './api-export.js';
import { GC_EVENT_NAMES } from './google-contacts-events.js';
import { mountShell } from '../ui/ui-shell.js';

const passthrough = (p) => p;

/** Mask the client ID in logged params (still mostly public, but harmless to mask). */
const maskClientId = (p = {}) => p.clientId
    ? { ...p, clientId: p.clientId.replace(/^(.{8}).+(.{8})$/, '$1…$2') }
    : p;

/**
 * Entry — called by manifest-loader after every phase resolves.
 * @param {object} manifest
 * @returns {Promise<SgToolApi>}
 */
export async function init(manifest) {
    const state = createState();

    const api = new SgToolApi({
        name:    'google-contacts',
        version: { api: '0.1.0', ui: '0.1.0', content: '0.1.0' },
        panelId: 'root',
        manifest: './manifest.json',
        skills:   (manifest && manifest.skills) || {},
    });

    const emit = (name, detail) => api._emit(name, detail || {});

    const auth     = buildAuthMethods({ state, emit });
    const contacts = buildContactsMethods({ state, emit });
    const exports  = buildExportMethods({ state, emit });

    api
        .register('connect',        auth.connect,            { async: true,  sanitiseParams: maskClientId, events: ['gc:auth:connected'] })
        .register('signIn',         auth.signIn,             { async: true,  sanitiseParams: passthrough,   events: ['gc:auth:signed-in', 'gc:auth:error'] })
        .register('signOut',        auth.signOut,            { async: true,  sanitiseParams: passthrough,   events: ['gc:auth:signed-out'] })
        .register('getAuthStatus',  auth.getAuthStatus,      { async: false, sanitiseParams: passthrough })
        .register('loadContacts',   contacts.loadContacts,   { async: true,  sanitiseParams: passthrough,   events: ['gc:contacts:loading', 'gc:contacts:page', 'gc:contacts:loaded', 'gc:contacts:error'] })
        .register('getContacts',    contacts.getContacts,    { async: false, sanitiseParams: passthrough })
        .register('getContact',     contacts.getContact,     { async: false, sanitiseParams: passthrough })
        .register('searchContacts', contacts.searchContacts, { async: false, sanitiseParams: passthrough,   events: ['gc:filter:changed'] })
        .register('selectContact',  contacts.selectContact,  { async: false, sanitiseParams: passthrough,   events: ['gc:selection:changed'] })
        .register('clearContacts',  contacts.clearContacts,  { async: false, sanitiseParams: passthrough,   events: ['gc:contacts:cleared'] })
        .register('exportJson',     exports.exportJson,      { async: true,  sanitiseParams: passthrough,   events: ['gc:export:complete'] });

    api.activate();

    const host = document.querySelector('#google-contacts-root');
    mountShell({ host, state, api });

    // Expose meta for the dev panel: list of all event names this tool emits.
    api.meta.eventNames = () => [...GC_EVENT_NAMES];
    api.meta.scope      = () => CONTACTS_SCOPE;

    return api;
}
