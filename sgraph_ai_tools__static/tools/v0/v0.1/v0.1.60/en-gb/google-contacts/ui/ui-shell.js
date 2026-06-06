/**
 * ui-shell — assemble the google-contacts page layout.
 *
 * Single-column linear flow: topbar → connect → toolbar → contacts
 * (list + detail) → dev panel. Each child panel mounts itself into a
 * <section> we create here.
 *
 * @module google-contacts/ui-shell
 */

import { mountConnect } from './ui-connect.js';
import { mountToolbar } from './ui-toolbar.js';
import { mountContacts } from './ui-contacts.js';
import { mountDevPanel } from './ui-dev-panel.js';

/**
 * @param {{host: HTMLElement, state: object, api: object}} opts
 * @returns {{destroy: () => void}}
 */
export function mountShell({ host, state, api }) {
    if (!host) return { destroy() {} };
    host.innerHTML = '';

    const topbar = document.createElement('header');
    topbar.className = 'gc-topbar';
    topbar.innerHTML = `
        <div class="gc-title">
            <h1>Google Contacts</h1>
            <p class="gc-subtitle">
                Read the contacts saved in your Google account, entirely in your browser.
                Sign in with a Google OAuth client ID you create, search and browse, and
                export to JSON. The People API is called directly with a short-lived
                access token; nothing is uploaded anywhere else.
            </p>
        </div>
    `;
    host.appendChild(topbar);

    const sections = ['connect', 'toolbar', 'contacts', 'dev'].map(name => {
        const el = document.createElement('section');
        el.className = `gc-panel gc-panel--${name}`;
        host.appendChild(el);
        return el;
    });

    const mounted = [
        mountConnect ({ root: sections[0], state, api }),
        mountToolbar ({ root: sections[1], state, api }),
        mountContacts({ root: sections[2], state, api }),
        mountDevPanel({ root: sections[3], api }),
    ];

    return {
        destroy() {
            mounted.forEach(m => m?.destroy?.());
            host.innerHTML = '';
        },
    };
}
