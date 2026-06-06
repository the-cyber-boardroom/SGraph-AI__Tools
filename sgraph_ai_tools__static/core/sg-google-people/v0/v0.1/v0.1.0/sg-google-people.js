/**
 * sg-google-people — minimal browser-side client for the Google People API.
 *
 * Pure JS, no UI. Takes an OAuth access token (use sg-google-auth to
 * obtain one) and calls people.googleapis.com via fetch. CORS is enabled
 * by Google for these endpoints, so no proxy is needed.
 *
 * Covers:
 *   - listConnections      single page of /people/me/connections
 *   - listAllConnections   auto-paginated, with onPage progress callback
 *   - normalisePerson      flatten a People API Person into a UI-friendly object
 *
 * @module sg-google-people
 * @version 0.1.0
 */

const API_BASE = 'https://people.googleapis.com/v1';

/** Fields we read by default. Keep aligned with normalisePerson(). */
export const DEFAULT_PERSON_FIELDS = [
    'names', 'nicknames', 'emailAddresses', 'phoneNumbers', 'addresses',
    'organizations', 'birthdays', 'photos', 'biographies', 'urls', 'memberships',
].join(',');

async function _bearerFetch(url, { accessToken } = {}) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch { /* non-JSON */ }
        const msg = body?.error?.message || `People API ${res.status}`;
        throw Object.assign(new Error(msg), {
            code:   body?.error?.status || 'people-api-error',
            status: res.status,
            body,
        });
    }
    return res.json();
}

/**
 * Fetch a single page of the signed-in user's saved contacts.
 *
 * @param {object} opts
 * @param {string} opts.accessToken         OAuth bearer token with contacts.readonly.
 * @param {string} [opts.personFields]      Comma-separated People API fields.
 * @param {number} [opts.pageSize=1000]     1..1000.
 * @param {string} [opts.pageToken]         Continuation token from a previous response.
 * @returns {Promise<{connections:object[], nextPageToken?:string, totalPeople?:number}>}
 */
export async function listConnections({ accessToken, personFields = DEFAULT_PERSON_FIELDS, pageSize = 1000, pageToken } = {}) {
    if (!accessToken) throw Object.assign(new Error('accessToken required'), { code: 'invalid-arg' });
    const params = new URLSearchParams({ personFields, pageSize: String(pageSize) });
    if (pageToken) params.set('pageToken', pageToken);
    const url  = `${API_BASE}/people/me/connections?${params}`;
    const data = await _bearerFetch(url, { accessToken });
    return {
        connections:   data.connections   || [],
        nextPageToken: data.nextPageToken || null,
        totalPeople:   data.totalPeople   || data.totalItems || null,
    };
}

/**
 * Fetch every page of the user's connections, with optional progress callback.
 *
 * @param {object}   opts
 * @param {string}   opts.accessToken
 * @param {string}   [opts.personFields]
 * @param {number}   [opts.pageSize=1000]
 * @param {Function} [opts.onPage]   Called with ({ page, pageCount, total }) after each page.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<object[]>} Flat array of People API Person objects.
 */
export async function listAllConnections({ accessToken, personFields = DEFAULT_PERSON_FIELDS, pageSize = 1000, onPage, signal } = {}) {
    const all = [];
    let pageToken = undefined;
    let pageIndex = 0;
    let total = null;
    while (true) {
        if (signal?.aborted) throw Object.assign(new Error('Aborted'), { code: 'aborted' });
        const { connections, nextPageToken, totalPeople } = await listConnections({
            accessToken, personFields, pageSize, pageToken,
        });
        all.push(...connections);
        if (totalPeople != null) total = totalPeople;
        pageIndex += 1;
        if (typeof onPage === 'function') {
            try { onPage({ page: pageIndex, pageCount: connections.length, total, soFar: all.length }); } catch { /* ignore */ }
        }
        if (!nextPageToken) break;
        pageToken = nextPageToken;
    }
    return all;
}

function _primary(arr, key = 'value') {
    if (!Array.isArray(arr) || !arr.length) return null;
    const primary = arr.find(x => x.metadata?.primary);
    return (primary || arr[0])?.[key] ?? null;
}

function _all(arr, key = 'value') {
    if (!Array.isArray(arr)) return [];
    return arr.map(x => x?.[key]).filter(Boolean);
}

/**
 * Flatten a People API Person into a UI-friendly shape.
 *
 * @param {object} person
 * @returns {object}
 */
export function normalisePerson(person) {
    if (!person) return null;
    const name        = (person.names && person.names[0]) || {};
    const primaryOrg  = (person.organizations && person.organizations[0]) || {};
    const primaryAddr = (person.addresses && person.addresses[0]) || {};
    const photo       = (person.photos && person.photos[0]) || {};
    const birthday    = (person.birthdays && person.birthdays[0]?.date) || null;

    return {
        id:            person.resourceName || null,
        etag:          person.etag || null,
        displayName:   name.displayName || _primary(person.emailAddresses) || '(no name)',
        givenName:     name.givenName || null,
        familyName:    name.familyName || null,
        nickname:      person.nicknames?.[0]?.value || null,
        emails:        _all(person.emailAddresses, 'value'),
        phones:        _all(person.phoneNumbers,   'value'),
        addresses:     (person.addresses || []).map(a => a.formattedValue || [
            a.streetAddress, a.city, a.region, a.postalCode, a.country,
        ].filter(Boolean).join(', ')).filter(Boolean),
        organization:  primaryOrg.name || null,
        jobTitle:      primaryOrg.title || null,
        addressPrimary: primaryAddr.formattedValue || null,
        birthday:      birthday ? `${birthday.year || ''}-${String(birthday.month || '').padStart(2, '0')}-${String(birthday.day || '').padStart(2, '0')}` : null,
        photoUrl:      photo.url || null,
        biography:     person.biographies?.[0]?.value || null,
        urls:          _all(person.urls, 'value'),
        raw:           person,
    };
}
