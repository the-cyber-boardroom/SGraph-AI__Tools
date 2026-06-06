# Google Contacts — Browser Console Cookbook

Everything below assumes the tool page is open, `window.__tool` exists
(wait for `tool:ready` first), and you have already pasted your OAuth
Client ID at least once.

## Wait for ready

```js
await new Promise(r => window.addEventListener('tool:ready', r, { once: true }));
```

## Connect + sign in

```js
await window.__tool.connect({ clientId: '1234567890-abc.apps.googleusercontent.com' });
await window.__tool.signIn({});  // opens the GIS consent popup
window.__tool.getAuthStatus();
// → { connected: true, signedIn: true, expiresAt: 1733… , expiresInMin: 59, scope: '…/contacts.readonly' }
```

If you already pasted the Client ID via the UI, `signIn` alone is enough.

## Load all contacts

```js
const { count } = await window.__tool.loadContacts({});
console.log('loaded', count, 'contacts');
```

Listen for per-page progress (useful for very large address books):

```js
window.addEventListener('gc:contacts:page', e =>
    console.log('page', e.detail.page, 'so far', e.detail.soFar, '/', e.detail.total));
```

## Read / search

```js
window.__tool.getContacts({}).length;              // all
window.__tool.getContacts({ query: 'acme' });      // filter
window.__tool.getContacts({ limit: 5 });           // first 5

const first = window.__tool.getContacts({})[0];
const detail = window.__tool.getContact({ id: first.id });
detail.emails;   // ['…@…']
detail.phones;   // ['+44 …']
detail.raw;      // the original People API Person, in case you need a field we didn't normalise
```

## Drive the UI from the console

```js
window.__tool.searchContacts({ query: 'london' });   // updates the search input + filter
window.__tool.selectContact({ id: first.id });        // highlights the row + opens the detail card
window.__tool.selectContact({ id: null });            // clears the selection
```

## Export

```js
// Everything currently loaded
await window.__tool.exportJson({});

// Just the filtered subset
await window.__tool.exportJson({ query: 'gmail.com' });

// Only some ids, and keep the raw People API Person on each row
const ids = window.__tool.getContacts({}).slice(0, 10).map(c => c.id);
await window.__tool.exportJson({ ids, includeRaw: true, filename: 'top-10.json' });
```

## Sign out / clear

```js
await window.__tool.signOut();        // revokes the token + drops the list
window.__tool.clearContacts();        // drops the list only (token stays)
```

## Tail every event in the namespace

```js
['tool:ready', 'gc:auth:connected', 'gc:auth:signed-in', 'gc:auth:signed-out',
 'gc:auth:error', 'gc:contacts:loading', 'gc:contacts:page', 'gc:contacts:loaded',
 'gc:contacts:error', 'gc:contacts:cleared', 'gc:filter:changed',
 'gc:selection:changed', 'gc:export:complete'
].forEach(n => window.addEventListener(n, e => console.log(n, e.detail)));
```

## Inspect the API surface

```js
window.__tool.meta.getMethods();      // ['connect','signIn',…]
window.__tool.meta.getEvents();       // every event name registered methods may emit
window.__tool.meta.health();          // { status:'ready', methodCount: 11, … }
window.__tool.meta.getManifest();     // the full manifest.json
window.__tool.meta.getLog();          // last 500 invocation records
```

## Force the consent dialog

GIS suppresses the dialog when a previous grant is still valid. Force it:

```js
await window.__tool.signOut();
await window.__tool.signIn({ prompt: 'consent' });
```
