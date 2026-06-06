# Google Contacts — API Capability Spec

**Tool:** google-contacts
**Version:** ui=0.1.0, api=0.1.0, content=0.1.0
**Instance ID:** `google-contacts:root`
**Environment:** browser only (HTTPS or `localhost` required — GIS refuses other origins)
**Registry keys:** `window.__tool` / `window.__tools['google-contacts:root']`

---

## Identity

```
name:        google-contacts
slug:        google-contacts
category:    misc
status:      alpha
url-pattern: /en-gb/google-contacts/
scope:       https://www.googleapis.com/auth/contacts.readonly
```

---

## Lifecycle

```
1. Page loads -> manifest-loader runs phases 1..3
2. Phase 3 entry runs api/google-contacts-api.js -> init(manifest)
3. init() creates SgToolApi, registers methods, calls api.activate()
4. activate() registers under window.__tools and fires `tool:ready`
5. window.__tool also points at the most recently activated tool

Wait pattern:
  await new Promise(r => window.addEventListener('tool:ready', r, { once: true }));
```

---

## State model

```
clientId        string   persisted to localStorage ('sg-google-contacts:clientId')
accessToken     string   memory only, never persisted
tokenExpiresAt  number   ms-since-epoch from GIS expires_in
signedIn        boolean
contacts        Contact[]  normalised, see shape below
filter          string     current search query
selectedId      string     People API resourceName, or null
loading         boolean
loadProgress    { soFar, total } | null
error           string | null
```

### Contact shape (normalisePerson output)

```
id            string   People API resourceName, e.g. 'people/c12345…'
etag          string
displayName   string
givenName     string | null
familyName    string | null
nickname      string | null
emails        string[]
phones        string[]
addresses     string[]   formattedValue (or assembled fallback)
organization  string | null   primary org.name
jobTitle      string | null   primary org.title
addressPrimary string | null  primary address formattedValue
birthday      string | null   'YYYY-MM-DD' (parts may be empty)
photoUrl      string | null
biography     string | null
urls          string[]
raw           object   the original People API Person, unchanged
```

---

## Methods

### connect

```
signature:  connect({ clientId }) -> Promise<{ ok, clientId }>
async:      true
params:
  clientId  string   must end with '.apps.googleusercontent.com'
errors:
  invalid-arg  clientId missing or wrong shape
events:
  gc:auth:connected   { clientId }
side-effects:
  Writes 'sg-google-contacts:clientId' to localStorage.
```

### signIn

```
signature:  signIn({ prompt }?) -> Promise<{ ok, expiresAt, scope }>
async:      true
params:
  prompt    string   ''|'none'|'consent'|'select_account'   default ''
errors:
  not-connected  connect() was never called and localStorage is empty
  oauth-error    user dismissed or denied consent
  busy           another signIn is in flight
events:
  gc:auth:signed-in  { expiresAt, scope }
  gc:auth:error      { message, code }
notes:
  Lazy-loads accounts.google.com/gsi/client on first call. Subsequent
  calls reuse the cached token client. The access token lives ~1 hour.
```

### signOut

```
signature:  signOut() -> Promise<{ ok }>
async:      true
side-effects:
  Best-effort revoke via google.accounts.oauth2.revoke.
  Drops accessToken, contacts, selection from state.
events:
  gc:auth:signed-out   { }
```

### getAuthStatus

```
signature:  getAuthStatus() -> { connected, clientId, signedIn, expiresAt, expiresInMin, scope }
async:      false
```

### loadContacts

```
signature:  loadContacts({ personFields }?) -> Promise<{ ok, count }>
async:      true
params:
  personFields  string   default: 'names,nicknames,emailAddresses,phoneNumbers,
                                   addresses,organizations,birthdays,photos,
                                   biographies,urls,memberships'
errors:
  not-signed-in   no access token in state
  busy            a load is already in flight
  people-api-error / Error   non-2xx from People API; .status carries HTTP code
events:
  gc:contacts:loading   { }
  gc:contacts:page      { page, pageCount, soFar, total }   per page
  gc:contacts:loaded    { count }
  gc:contacts:error     { message, code }
notes:
  Auto-paginated via nextPageToken. pageSize is fixed at 1000.
  Each Person is normalised through normalisePerson() before being stored.
```

### getContacts

```
signature:  getContacts({ query, limit }?) -> Contact[]
async:      false
params:
  query     string   client-side filter, case-insensitive substring across
                     displayName, organization, emails, phones
  limit     number   cap on results returned
```

### getContact

```
signature:  getContact({ id }) -> Contact
async:      false
errors:
  invalid-arg   id missing
  unknown-item  id not in state
```

### searchContacts

```
signature:  searchContacts({ query }) -> Contact[]
async:      false
params:
  query     string
side-effects:
  Updates state.filter (drives the UI search input).
events:
  gc:filter:changed   { query }
```

### selectContact

```
signature:  selectContact({ id }) -> { ok, id }
async:      false
params:
  id        string | null   resourceName to highlight, or null to clear
errors:
  unknown-item   id not in state
events:
  gc:selection:changed   { id }
```

### clearContacts

```
signature:  clearContacts() -> { ok }
async:      false
side-effects:
  Drops contacts and selection (does NOT sign out — token remains).
events:
  gc:contacts:cleared   { }
```

### exportJson

```
signature:  exportJson({ ids?, query?, includeRaw?, filename? }) -> Promise<{ ok, count, filename, sizeBytes }>
async:      true
params:
  ids         string[]   restrict to these resourceNames
  query       string     apply a client-side filter (same as getContacts)
  includeRaw  boolean    default false. true keeps each contact's `raw` field.
  filename    string     default 'google-contacts-YYYY-MM-DD.json'
errors:
  empty       no contacts match the selection
side-effects:
  Triggers a Blob download (<a download> click + revoke).
events:
  gc:export:complete   { format: 'json', count, filename }
```

---

## Window Events

Every detail object includes `instanceId: 'google-contacts:root'`.

```
tool:ready              activate()                      { instanceId, tool, version }
gc:auth:connected       connect resolves                { instanceId, clientId }
gc:auth:signed-in       signIn resolves                 { instanceId, expiresAt, scope }
gc:auth:signed-out      signOut resolves                { instanceId }
gc:auth:error           signIn rejects                  { instanceId, message, code }
gc:contacts:loading     loadContacts begins             { instanceId }
gc:contacts:page        each page resolves              { instanceId, page, pageCount, soFar, total }
gc:contacts:loaded      loadContacts resolves           { instanceId, count }
gc:contacts:error       loadContacts rejects            { instanceId, message, code }
gc:contacts:cleared     clearContacts                   { instanceId }
gc:filter:changed       searchContacts                  { instanceId, query }
gc:selection:changed    selectContact                   { instanceId, id }
gc:export:complete      exportJson resolves             { instanceId, format, count, filename }
```

---

## Example: end-to-end

```js
await new Promise(r => window.addEventListener('tool:ready', r, { once: true }));

await window.__tool.connect({ clientId: '…apps.googleusercontent.com' });
await window.__tool.signIn({});                  // GIS consent popup
const { count } = await window.__tool.loadContacts({});
console.log(`loaded ${count}`);

const matches = window.__tool.getContacts({ query: 'acme' });
window.__tool.selectContact({ id: matches[0].id });

await window.__tool.exportJson({ query: 'acme' });
```

---

## Dependencies

```
core:
  sg-tool-api       /core/sg-tool-api/v0/v0.1/v0.1.0/sg-tool-api.js
  manifest-loader   /core/manifest-loader/v0/v0.1/v0.1.0/manifest-loader.js
  sg-google-auth    /core/sg-google-auth/v0/v0.1/v0.1.0/sg-google-auth.js
  sg-google-people  /core/sg-google-people/v0/v0.1/v0.1.0/sg-google-people.js

components:
  sg-tool-api-explorer   /components/tool-api/sg-tool-api-explorer/v0/v0.1/v0.1.0/
  sg-tool-api-console    /components/tool-api/sg-tool-api-console/v0/v0.1/v0.1.0/
  sg-tool-api-manifest   /components/tool-api/sg-tool-api-manifest/v0/v0.1/v0.1.0/

lazy-loaded from CDN (on demand):
  accounts.google.com/gsi/client      (GIS — loaded by sg-google-auth on first signIn)

network endpoints called at runtime:
  https://accounts.google.com/...     OAuth consent + token issuance + revoke
  https://people.googleapis.com/v1/people/me/connections   contact data
```

## Known limitations

```
no-write:
  Scope is .readonly. There are no create/update/delete methods.

no-other-contacts:
  Only /people/me/connections (saved contacts) is loaded. The auto-generated
  "Other contacts" surface (otherContacts endpoint) is not included.

server-side-search:
  The People API people:searchContacts endpoint is not used — filtering is
  client-side over the loaded list. Effects: no fuzzy/typo matching, but no
  warmup request, and search works offline once loaded.

token-lifetime:
  Access tokens last ~60 minutes. There is no refresh token in the GIS token
  model — the user re-consents (silently, if still authorised) when expired.

single-concurrent-signin:
  A second signIn() while the first is pending throws { code:'busy' }.

memory:
  Contacts and decoded fields are held in memory. Tens of thousands of
  contacts could pressure the tab; call clearContacts() between runs.

panel-detection:
  panelId is hard-coded to 'root' (single-panel tool). sg-layout hosts must
  instantiate their own SgToolApi.
```
