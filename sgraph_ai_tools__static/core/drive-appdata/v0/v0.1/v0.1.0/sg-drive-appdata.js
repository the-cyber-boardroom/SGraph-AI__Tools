/**
 * sg-drive-appdata — Google Drive App Data Folder API wrapper.
 *
 * Provides read/write/list/delete for the hidden per-user, per-app folder
 * in Google Drive. No other app or the user's Drive UI can see these files.
 *
 * Prerequisites:
 *   1. Google Drive API enabled in Google Cloud Console
 *   2. drive.appdata scope added to OAuth consent screen
 *   3. GIS loaded (sg-auth-google handles this)
 *
 * @module sg-drive-appdata
 * @version 0.1.0
 *
 * @example
 * import { requestAccess, DriveAppData } from '/core/drive-appdata/v0/v0.1/v0.1.0/sg-drive-appdata.js';
 *
 * const token = await requestAccess(clientId);   // shows Google consent if needed
 * const drive = new DriveAppData(token);
 * await drive.writeFile('config.json', JSON.stringify({ key: 'value' }));
 * const content = await drive.readFile('config.json');
 */

const BASE   = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/**
 * Request a drive.appdata access token via GIS.
 * Shows Google's consent/permission screen if scope not yet granted.
 * Waits up to 3 s for GIS to finish loading before rejecting.
 * GIS is loaded by sg-auth-google.js which runs asynchronously.
 *
 * @param {string} clientId  Google OAuth client ID
 * @param {{ hint?: string, prompt?: string }} [opts]
 *   hint   — login_hint (email) to skip account chooser
 *   prompt — GIS prompt override: '' for silent (fails if consent needed),
 *            'consent' to force re-consent, 'select_account' for picker (default)
 * @returns {Promise<string>} access token (valid ~1 hour)
 */
export function requestAccess(clientId, { hint = '', prompt } = {}) {
    return new Promise((resolve, reject) => {
        const attempt = (retriesLeft) => {
            if (!window.google?.accounts?.oauth2) {
                if (retriesLeft > 0) {
                    setTimeout(() => attempt(retriesLeft - 1), 200);
                } else {
                    reject(new Error('Google Sign-In library not loaded — please refresh the page'));
                }
                return;
            }
            const config = {
                client_id: clientId,
                scope: DRIVE_APPDATA_SCOPE,
                callback: r => r.error
                    ? reject(new Error(r.error_description || r.error))
                    : resolve(r.access_token),
            };
            if (hint) config.hint = hint;
            const client = google.accounts.oauth2.initTokenClient(config);
            client.requestAccessToken(prompt !== undefined ? { prompt } : undefined);
        };
        attempt(15); // retry every 200 ms for up to 3 s
    });
}

/**
 * DriveAppData — wrapper for Drive App Data Folder API calls.
 * Instantiate with a valid access token from requestAccess().
 */
export class DriveAppData {
    /** @param {string} accessToken */
    constructor(accessToken) {
        this._token = accessToken;
    }

    get _auth() { return { Authorization: `Bearer ${this._token}` }; }

    async _check(r) {
        if (!r.ok) {
            const body = await r.text().catch(() => '');
            throw new Error(`Drive ${r.status}: ${body.slice(0, 200)}`);
        }
        return r;
    }

    /**
     * List all files in the App Data folder.
     * @returns {Promise<Array<{id: string, name: string, modifiedTime: string, size: string}>>}
     */
    async listFiles() {
        const r = await fetch(
            `${BASE}/files?spaces=appDataFolder&fields=files(id,name,modifiedTime,size)`,
            { headers: this._auth }
        );
        const { files } = await (await this._check(r)).json();
        return files || [];
    }

    /**
     * Read a file's text content by name. Returns null if not found.
     * @param {string} name
     * @returns {Promise<string|null>}
     */
    async readFile(name) {
        const files = await this.listFiles();
        const file  = files.find(f => f.name === name);
        if (!file) return null;
        const r = await fetch(`${BASE}/files/${file.id}?alt=media`, { headers: this._auth });
        return (await this._check(r)).text();
    }

    /**
     * Write a file (create or update by name).
     * @param {string} name
     * @param {string} content
     * @returns {Promise<{id: string, name: string}>}
     */
    async writeFile(name, content) {
        const files    = await this.listFiles();
        const existing = files.find(f => f.name === name);
        const blob     = new Blob([content], { type: 'application/json' });

        if (existing) {
            const r = await fetch(`${UPLOAD}/files/${existing.id}?uploadType=media`, {
                method: 'PATCH',
                headers: { ...this._auth, 'Content-Type': 'application/json' },
                body: blob,
            });
            return (await this._check(r)).json();
        }

        const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
        const form = new FormData();
        form.append('metadata', new Blob([meta], { type: 'application/json' }));
        form.append('file', blob);
        const r = await fetch(`${UPLOAD}/files?uploadType=multipart`, {
            method: 'POST',
            headers: this._auth,
            body: form,
        });
        return (await this._check(r)).json();
    }

    /**
     * Delete a file by its Drive file ID.
     * @param {string} fileId
     */
    async deleteFile(fileId) {
        const r = await fetch(`${BASE}/files/${fileId}`, {
            method: 'DELETE',
            headers: this._auth,
        });
        if (r.status !== 204) await this._check(r);
    }
}
