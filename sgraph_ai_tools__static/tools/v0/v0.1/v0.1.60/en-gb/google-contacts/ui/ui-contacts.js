/**
 * ui-contacts — list + detail view.
 *
 * Left: scrollable list of (filtered) contacts. Right: detail card for
 * the currently selected one. Selection is held in state.selectedId, so
 * any API caller (or the dev panel) can drive it.
 *
 * @module google-contacts/ui-contacts
 */

export function mountContacts({ root, state, api }) {
    function render(s) {
        if (!s.signedIn) {
            root.innerHTML = `
                <div class="gc-empty">
                    Sign in above to start reading your Google contacts.
                </div>
            `;
            return;
        }
        if (!s.contacts.length) {
            root.innerHTML = `
                <div class="gc-empty">
                    ${s.loading
                        ? `Loading contacts… <strong>${s.loadProgress?.soFar || 0}</strong>${s.loadProgress?.total ? ' / ' + s.loadProgress.total : ''}`
                        : 'No contacts loaded yet — click <strong>Load contacts</strong>.'}
                </div>
            `;
            return;
        }

        const filtered = s.filter ? api.getContacts({ query: s.filter }) : s.contacts;
        const selected = s.selectedId
            ? s.contacts.find(c => c.id === s.selectedId)
            : filtered[0] || null;

        root.innerHTML = `
            <div class="gc-split">
                <ul class="gc-list" role="listbox">
                    ${filtered.map(c => _renderRow(c, selected?.id === c.id)).join('')}
                    ${filtered.length === 0
                        ? '<li class="gc-empty">No matches for that filter.</li>'
                        : ''}
                </ul>
                <div class="gc-detail">
                    ${selected ? _renderDetail(selected) : '<div class="gc-empty">Select a contact.</div>'}
                </div>
            </div>
        `;

        root.querySelectorAll('[data-row-id]').forEach(li => {
            li.addEventListener('click', () => {
                api.selectContact({ id: li.getAttribute('data-row-id') });
            });
        });
    }

    const off = state.subscribe(render);
    return { destroy() { off(); root.innerHTML = ''; } };
}

function _renderRow(c, isSelected) {
    const initials = _initials(c.displayName);
    return `
        <li class="gc-row ${isSelected ? 'gc-row--selected' : ''}"
            data-row-id="${_attr(c.id)}" role="option" aria-selected="${isSelected}">
            <span class="gc-avatar">${c.photoUrl
                ? `<img src="${_attr(c.photoUrl)}" referrerpolicy="no-referrer" alt="">`
                : initials}</span>
            <span class="gc-row__main">
                <span class="gc-row__name">${_html(c.displayName)}</span>
                <span class="gc-row__sub">${_html(c.emails[0] || c.phones[0] || c.organization || '')}</span>
            </span>
        </li>
    `;
}

function _renderDetail(c) {
    return `
        <div class="gc-card">
            <div class="gc-card__head">
                <span class="gc-avatar gc-avatar--lg">${c.photoUrl
                    ? `<img src="${_attr(c.photoUrl)}" referrerpolicy="no-referrer" alt="">`
                    : _initials(c.displayName)}</span>
                <div>
                    <h3 class="gc-card__name">${_html(c.displayName)}</h3>
                    ${c.jobTitle || c.organization
                        ? `<p class="gc-card__role">${_html([c.jobTitle, c.organization].filter(Boolean).join(' · '))}</p>`
                        : ''}
                </div>
            </div>
            <dl class="gc-fields">
                ${_field('Email',       c.emails)}
                ${_field('Phone',       c.phones)}
                ${_field('Address',     c.addresses)}
                ${_field('Nickname',    c.nickname ? [c.nickname] : [])}
                ${_field('Birthday',    c.birthday ? [c.birthday] : [])}
                ${_field('Website',     c.urls)}
                ${c.biography ? `<dt>Notes</dt><dd>${_html(c.biography)}</dd>` : ''}
            </dl>
        </div>
    `;
}

function _field(label, values) {
    if (!values || !values.length) return '';
    return `<dt>${label}</dt><dd>${values.map(v => `<div>${_html(v)}</div>`).join('')}</dd>`;
}

function _initials(name) {
    if (!name) return '?';
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function _attr(s) { return (s || '').replace(/"/g, '&quot;'); }
function _html(s) { return String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
