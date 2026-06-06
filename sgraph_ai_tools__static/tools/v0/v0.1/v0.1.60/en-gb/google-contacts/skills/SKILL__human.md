# Google Contacts — Human Guide

A pure client-side tool that reads the contacts saved in your Google account
and lets you browse, search, and export them. Nothing is uploaded anywhere
— the People API is called from your browser directly with a short-lived
access token.

## Why a paste-your-own Client ID?

There is no service in the middle, so there is no shared Google OAuth app to
trust. You create your own OAuth Client ID (free, takes about three minutes),
paste it into the tool once, and from then on you are the only party in the
transaction.

## One-time setup (about 3 minutes)

1. Open the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
   Create (or pick) a project — anything will do.
2. **Enable the People API.** APIs & Services → Library → search "People API" → Enable.
3. **OAuth consent screen.** APIs & Services → OAuth consent screen.
   - User Type: **External**.
   - App name: anything (e.g. "My Contacts Reader").
   - Add yourself as a **Test user** so you don't need Google to verify the app.
   - Scopes: add `…/auth/contacts.readonly`.
4. **Create credentials.** APIs & Services → Credentials → Create credentials
   → **OAuth client ID** → **Web application**.
   - Authorised JavaScript origins: add the origin you'll load the tool from,
     e.g. `https://tools.sgraph.ai` (and `http://localhost:8000` if you run
     it locally).
   - No redirect URI is needed — this tool uses the GIS token model, not the
     redirect model.
5. Copy the resulting **Client ID** (ends in `.apps.googleusercontent.com`).

## Using the tool

1. Paste the Client ID into the Connect panel. It's saved in this browser's
   localStorage so you only do this once.
2. Click **Sign in with Google**. Google's consent popup will appear; approve
   the `contacts.readonly` scope.
3. Click **Load contacts**. The tool calls the People API and pulls every
   page (up to 1 000 contacts per page). For a few hundred contacts this
   takes well under a second.
4. Use the search box to filter by name, email, phone, or organisation.
   Click a row to see the full detail card on the right.
5. **Export JSON** downloads everything (or just the filtered set) as a
   timestamped JSON file. The format is the flat normalised shape — open it
   in any text editor, or feed it to a script.

## Privacy properties

- The **Client ID** is public by design (every browser sees it inside the
  OAuth request); it is stored in localStorage purely for convenience.
- The **access token** is held in JavaScript memory only. It is not written
  to localStorage. It expires automatically after about an hour; signing out
  also revokes it.
- The **contacts** stay in memory for as long as the tab is open. Closing
  the tab drops everything. Reloading requires signing in again.
- The tool talks to exactly two hosts: `accounts.google.com` (for OAuth) and
  `people.googleapis.com` (for the contact data). No other network calls.

## What it does **not** do (yet)

- No editing. The scope is `.readonly`. You can't add, change, or delete
  contacts from this tool.
- No "Other contacts" (the auto-generated ones from email autocomplete) —
  only your saved contacts (`/people/me/connections`).
- No CSV or vCard export — JSON only for the first version.
- No sync. Refresh = re-load.

## When something doesn't work

- *"clientId must end with .apps.googleusercontent.com"* — copy the full
  Client ID, not just the prefix.
- *Google says "App not verified"* — that's expected in Test mode. Click
  **Advanced** → **Go to {app name} (unsafe)**. Or add yourself as a Test
  user under OAuth consent screen.
- *Popup blocked* — allow popups for `tools.sgraph.ai` and click Sign in again.
- *People API 403* — the People API isn't enabled on your Cloud project, or
  the scope wasn't granted during consent. Sign out, click Sign in, and tick
  the contacts permission.
