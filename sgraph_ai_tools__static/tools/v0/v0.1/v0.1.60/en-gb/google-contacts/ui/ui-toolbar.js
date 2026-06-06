/**
 * ui-toolbar — load / search / export controls.
 *
 * Hidden until the user is signed in. The search input filters the
 * in-memory contact list (no extra API calls). Load Contacts pulls
 * every page of /people/me/connections.
 *
 * @module google-contacts/ui-toolbar
 */

export function mountToolbar({ root, state, api }) {
    function render(s) {
        if (!s.signedIn) {
            root.innerHTML = '';
            return;
        }
        const hasContacts = s.contacts.length > 0;
        const filtered    = s.filter ? api.getContacts({ query: s.filter }).length : s.contacts.length;
        const loadLabel   = s.loading
            ? `Loading… ${s.loadProgress?.soFar || 0}${s.loadProgress?.total ? ' / ' + s.loadProgress.total : ''}`
            : (hasContacts ? 'Reload' : 'Load contacts');

        root.innerHTML = `
            <div class="gc-toolbar">
                <button class="gc-btn gc-btn--primary" data-act="load" ${s.loading ? 'disabled' : ''}>${loadLabel}</button>
                <input type="search" class="gc-input gc-input--search"
                    placeholder="${hasContacts ? 'Search name, email, phone, org…' : 'Load contacts to search'}"
                    value="${_attr(s.filter)}" ${hasContacts ? '' : 'disabled'}
                    data-input="filter">
                <span class="gc-count">
                    ${hasContacts
                        ? (s.filter
                            ? `<strong>${filtered}</strong> of ${s.contacts.length}`
                            : `<strong>${s.contacts.length}</strong> contacts`)
                        : ''}
                </span>
                <button class="gc-btn gc-btn--ghost" data-act="export" ${hasContacts ? '' : 'disabled'}>Export JSON</button>
                ${s.error ? `<span class="gc-err">${_html(s.error)}</span>` : ''}
            </div>
        `;

        root.querySelector('[data-act="load"]').onclick = async () => {
            try { await api.loadContacts({}); }
            catch (e) { /* state already carries the error */ }
        };

        const filter = root.querySelector('[data-input="filter"]');
        filter?.addEventListener('input', (e) => {
            api.searchContacts({ query: e.target.value });
        });

        root.querySelector('[data-act="export"]').onclick = async () => {
            try { await api.exportJson({ query: s.filter || undefined }); }
            catch (e) { _flash(root, e.message); }
        };
    }

    const off = state.subscribe(render);
    return { destroy() { off(); root.innerHTML = ''; } };
}

function _attr(s) { return (s || '').replace(/"/g, '&quot;'); }
function _html(s) { return (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function _flash(root, msg) {
    let el = root.querySelector('.gc-err');
    if (!el) {
        el = document.createElement('span');
        el.className = 'gc-err';
        root.querySelector('.gc-toolbar')?.appendChild(el);
    }
    el.textContent = msg;
}
