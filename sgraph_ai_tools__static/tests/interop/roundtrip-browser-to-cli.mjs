/**
 * Browser → CLI, first half: mint a vault with the published vault-init, add
 * files through vault-mutations, and push. Prints the credentials `sgit clone`
 * needs on stdout as JSON; run-roundtrip.sh does the clone and compares files.
 *
 * Expects:
 *   API_BASE      — KV store base URL
 *   SIMPLE_TOKEN  — word-word-NNNN token to mint the vault with
 *   FILES         — JSON object of { "name": "contents" } to write at the root
 */
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE        = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = resolvePath(HERE, '../..');
register('./site-root-loader.mjs', import.meta.url, { data: { staticRoot: STATIC_ROOT } });

const { createVault }   = await import('/core/vault-init/v1/v1.0/v1.0.0/sg-vault-init.js');
const { createSession } = await import('/core/vault-session/v1/v1.0/v1.0.0/sg-vault-session.js');
const { addFile }       = await import('/core/vault-mutations/v1/v1.0/v1.0.0/sg-vault-mutations.js');

const API   = process.env.API_BASE || 'http://127.0.0.1:8899';
const TOKEN = process.env.SIMPLE_TOKEN || 'amber-lantern-4417';
const FILES = JSON.parse(process.env.FILES || '{}');

const { token, vaultId, keys } = await createVault({
    apiBaseUrl : API,
    token      : TOKEN,
    vaultName  : 'Browser-minted interop vault',
    message    : 'Initial vault creation (browser)',
});

const session = createSession({ apiBaseUrl: API, vaultId, keys });
await session.open();

for (const [name, contents] of Object.entries(FILES)) {
    await addFile(session, '/', name, contents);
}
await session.commit('Interop round-trip: files written in the browser');
await session.push();

const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
const readKeyHex = toHex(keys.readKeyBytes);

// sgit clone accepts {read_key_hex}:{vault_id} for a read-only clone. A simple
// token has no passphrase form, so this is the only key shape the CLI can take
// for a browser-minted vault — see the review doc, "key families".
console.log(JSON.stringify({
    token, vaultId,
    read_key_hex : readKeyHex,
    clone_key    : `${readKeyHex}:${vaultId}`,
    ref_file_id  : keys.refFileId,
}));
