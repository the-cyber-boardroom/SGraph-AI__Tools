# YouTube Editor — Human Guide

Sign in with Google to upload, list, and edit your YouTube videos. Everything runs in your browser; no SGraph server sees the bytes or the metadata.

## What you need (one-time setup)

The tool needs a Google **OAuth Web Client ID** from a Google Cloud project that owns the channel you'll be uploading/editing.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or pick a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (Workspace users may pick Internal).
   - Add scope `https://www.googleapis.com/auth/youtube` — this covers upload + read + edit + delete + thumbnails. (You can add `youtube.upload` too if you want backwards compatibility with the upload-only tool.)
   - Add your Google account as a **test user** so you can use the unverified app.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorised JavaScript origins**: every origin you load the tool from — e.g. `https://tools.sgraph.ai`, `http://localhost:8000`, plus any preview URLs.
   - Leave redirect URIs blank.
5. Copy the resulting `....apps.googleusercontent.com` ID into the tool's "Google OAuth Client ID" field. The tools.sgraph.ai default is bundled.

## Using the tool

The layout splits left ↔ right.

**Left — Account**
- OAuth Client ID input (cached in `localStorage`).
- **Connect to YouTube** opens Google's consent popup. Subsequent visits within ~1 hour reuse the cached token; expired tokens silently refresh when GIS still has a session, or popup again.
- After connecting, a channel card appears with your avatar + subscriber/video/view stats.

**Right — tabs**
- **📋 My Videos** — your uploads, lazily paginated (50 per page, "Load more" at the bottom). Click a row to open an editor tab.
- **⬆ Upload** — drop a file, set title/description/tags/privacy, click upload. The new video pops into "My Videos" automatically when it finishes.
- **✎ Per-video tabs** — opened on click. Edit title / description / tags / privacy, replace the thumbnail, or delete (Danger zone — type the title to confirm). Closeable; multiple may be open at once.

## Quota note

Default daily quota is 10,000 units. Listing is cheap (1 unit/page), edits are 50 each, uploads are 1,600 each. To raise the limit, go to **APIs & Services → YouTube Data API v3 → Quotas** in your Cloud project and submit the audit form.

## What is stored locally

| Key | Contents |
|---|---|
| `sg-youtube-client-id` | Your OAuth client ID |
| `sg-auth-token-youtube-editor` | Access token + expiry + scope |

Both move into the SGraph vault in a future minor version.
