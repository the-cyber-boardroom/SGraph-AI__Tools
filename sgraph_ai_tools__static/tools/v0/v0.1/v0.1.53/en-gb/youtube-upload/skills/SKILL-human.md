# YouTube Upload — Human Guide

Sign in with Google and upload a video to your channel, all in your browser. No SGraph server sees the bytes — they go directly from this tab to YouTube.

## What you need (one-time setup)

The tool needs an **OAuth Client ID** from your own Google Cloud project. The owner of the project is the one whose YouTube channel videos will be uploaded to.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or pick a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (Workspace orgs may pick Internal).
   - Add scope `https://www.googleapis.com/auth/youtube.upload`.
   - Add your Google account as a **test user** (lets you use it before Google's app verification).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**.
   - **Authorised JavaScript origins**: add every origin you load the tool from — e.g. `https://tools.sgraph.ai` and `http://localhost:8000`.
   - Leave redirect URIs blank.
5. Copy the resulting `....apps.googleusercontent.com` ID into the tool.

## Using it

1. Paste the **OAuth Client ID** into the form (it's stored in your browser's `localStorage`, never sent anywhere).
2. Click **Connect to YouTube**. A Google popup asks for permission to upload to your channel — accept.
3. Drop a video file into the dropzone (or click to pick).
4. Set **Title** (required), description, tags, and privacy. Default privacy is **Unlisted** to avoid accidents.
5. Click **Upload to YouTube**. The progress bar reflects bytes pushed.
6. When done, you'll get a YouTube URL you can click straight through to.

## Quota note

The default daily upload quota is ~6 videos per project. To raise it, go to **APIs & Services → YouTube Data API v3 → Quotas** in your Cloud project and submit Google's audit form.

## What is stored locally

- `sg-youtube-client-id` — your OAuth client ID
- `sg-auth-token-youtube-upload` — the access token + expiry (cleared on **Sign out**, planned to move into the SGraph vault)

Nothing else. The video bytes never touch SGraph servers.
