/**
 * nr-vault.js
 * Save the session into an SG/Send vault — the "home" the brief wants, rather
 * than a container format: the same folder shape the zip uses, written as vault
 * files so a session can be shared by handing over a key, and a later review can
 * see the earlier one.
 *
 *   reviews/<sessionId>/review.md
 *                      /images/pair-NN.png
 *                      /raw/pXX.txt
 *                      /session.json
 *                      /audio/…            (optional — see includeAudio)
 *
 * Raw audio is a deliberate toggle. Keeping it costs the most space by far but
 * is the only way to re-transcribe later with a better model, re-cut a boundary,
 * or build something else (e.g. a video) out of the same materials. Dropping it
 * makes the vault small and still leaves a complete, readable document.
 *
 * @module nr-vault
 */

import { state, sessionToJson } from './nr-state.js';
import { buildDocument, imageName } from './nr-document.js';

const VAULT_CLIENT = '/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js';
const VAULT_WRITE = '/core/vault-write/v1/v1.1/v1.1.1/sg-vault-write.js';

/** @returns {Promise<Uint8Array>} */
async function blobBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Files to write, in vault-path order. Pure — no vault calls, so it is testable
 * and the UI can preview exactly what would be written.
 *
 * @param {{ includeAudio?: boolean, includeTake?: boolean, folder?: string }} opts
 * @returns {Array<{ path: string, blob?: Blob, text?: string }>}
 */
export function buildVaultFiles(opts = {}) {
    const includeAudio = opts.includeAudio === true;          // OFF by default: it is the big one
    const includeTake = opts.includeTake !== false && includeAudio;
    const base = opts.folder || `reviews/${state.sessionId || 'session'}`;
    const { markdown, images } = buildDocument(state, state.pairs);

    const files = [{ path: `${base}/review.md`, text: markdown }];
    for (const { name, pairId } of images) {
        const pair = state.pairs.find(p => p.id === pairId);
        if (pair && pair.screenshot) files.push({ path: `${base}/images/${name}`, blob: pair.screenshot });
    }
    for (const pair of state.pairs) {
        if (pair.raw) files.push({ path: `${base}/raw/${pair.id}.txt`, text: pair.raw.text });
        if (pair.notes) files.push({ path: `${base}/notes/${pair.id}.md`, text: pair.notes });
    }
    files.push({ path: `${base}/session.json`, text: JSON.stringify(sessionToJson(), null, 2) });
    if (includeTake && state.take && state.take.blob) {
        const ext = /ogg/.test(state.take.mimeType || '') ? 'ogg' : 'webm';
        files.push({ path: `${base}/audio/take.${ext}`, blob: state.take.blob });
    }
    return { files, includeAudio, base, imageCount: images.length };
}

/**
 * Write the session into a vault.
 *
 * Auth is whatever the vault modules accept: a write passphrase, or a Simple
 * Token. Nothing is persisted by this tool — the caller supplies it per call.
 *
 * @param {{ vaultId: string, passphrase?: string, token?: string,
 *           endpoint?: string, includeAudio?: boolean, folder?: string,
 *           perPairWav?: boolean }} p
 * @param {(name: string, detail?: object) => void} emit
 * @returns {Promise<{ vaultId, base, written, includeAudio }>}
 */
export async function saveToVault(p = {}, emit = () => {}, pairWav = null) {
    if (!p.vaultId) throw Object.assign(new Error('saveToVault needs { vaultId }'), { code: 'bad-params' });
    if (!p.passphrase && !p.token) {
        throw Object.assign(new Error('saveToVault needs { passphrase } or { token }'), { code: 'vault-auth-required' });
    }

    const { files, includeAudio, base } = buildVaultFiles(p);
    // Per-pair WAVs are sliced on demand (they are not held in memory).
    if (includeAudio && p.perPairWav !== false && typeof pairWav === 'function') {
        for (const pair of state.pairs) {
            if (pair.tEnd == null) continue;
            try { files.push({ path: `${base}/audio/${pair.id}.wav`, blob: pairWav(pair) }); }
            catch (_) { /* unbounded — skip */ }
        }
    }

    emit('nr:vault:started', { vaultId: p.vaultId, files: files.length, includeAudio });

    const [client, write] = await Promise.all([import(VAULT_CLIENT), import(VAULT_WRITE)]);
    const keys = p.token
        ? await write.deriveWriteKeysFromSimpleToken(p.token)
        : await write.deriveWriteKeys(p.passphrase, p.vaultId);
    const vault = await client.openVault(keys, p.endpoint ? { apiBaseUrl: p.endpoint } : {});

    let written = 0;
    for (const f of files) {
        const content = f.blob ? await blobBytes(f.blob) : f.text;
        await write.writeVaultFile(vault, f.path, content, {});
        written += 1;
        emit('nr:vault:progress', { written, total: files.length, path: f.path });
    }

    emit('nr:vault:complete', { vaultId: p.vaultId, base, written, includeAudio });
    return { vaultId: p.vaultId, base, written, includeAudio };
}
