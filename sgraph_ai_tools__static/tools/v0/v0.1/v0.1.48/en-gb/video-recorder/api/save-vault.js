/**
 * save-vault.js
 * Save a recording to an SGraph Vault.
 *
 * Uses sg-vault-client.js to write the encrypted blob + metadata into a vault commit.
 * This module delegates all encryption to the vault client.
 *
 * @module save-vault
 */

import { SGA_RECORDER } from './recorder-events.js';

/**
 * Save a video blob to a vault.
 *
 * @param {Blob} blob
 * @param {{
 *   vaultId:    string,
 *   vaultKey:   string,
 *   message?:   string,
 *   filename?:  string,
 *   durationMs?: number,
 * }} opts
 * @returns {Promise<{ commitHash: string, vaultUrl: string }>}
 */
export async function saveVault(blob, opts) {
    const {
        vaultId,
        vaultKey,
        message   = 'Video recording',
        filename  = `recording-${Date.now()}.webm`,
        durationMs = 0,
    } = opts;

    if (!vaultId || !vaultKey) throw new Error('saveVault: vaultId and vaultKey are required');

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'vault', percent: 0, message: 'Loading vault client…' });

    // Lazy-import vault client at call time — only loaded if user requests vault save
    const { VaultClient } = await import('/core/vault-client/v0/v0.1/v0.1.0/sg-vault-client.js');
    const client = new VaultClient(vaultId, vaultKey);

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'vault', percent: 20, message: 'Connecting to vault…' });
    await client.connect();

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'vault', percent: 40, message: 'Writing video…' });
    const arrayBuffer = await blob.arrayBuffer();
    await client.writeFile(filename, new Uint8Array(arrayBuffer));

    const meta = {
        filename,
        durationMs,
        sizeBytes: blob.size,
        mimeType:  blob.type,
        savedAt:   new Date().toISOString(),
    };

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'vault', percent: 70, message: 'Writing metadata…' });
    await client.writeFile('metadata.json', JSON.stringify(meta, null, 2));

    _dispatch(SGA_RECORDER.SAVE_PROGRESS, { target: 'vault', percent: 90, message: 'Committing…' });
    const commitHash = await client.commit(message);
    const vaultUrl   = client.getUrl?.() ?? `https://vault.sgraph.ai/${vaultId}`;

    _dispatch(SGA_RECORDER.SAVE_COMPLETE, { target: 'vault', commitHash, vaultUrl });
    return { commitHash, vaultUrl };
}

function _dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}
