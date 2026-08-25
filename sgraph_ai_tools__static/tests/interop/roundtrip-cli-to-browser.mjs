/**
 * CLI → browser: open a vault made by `sgit init && sgit commit && sgit push`
 * with the published browser modules, walk its tree and decrypt every file.
 *
 * Driven by run-roundtrip.sh, which creates the vault first. Expects:
 *   API_BASE   — KV store base URL
 *   VAULT_KEY  — the vault key exactly as sgit printed it (prefix included)
 *   EXPECTED   — JSON object of { "/path": "contents" } the CLI committed
 *   STRIP_PREFIX — "0" to keep the sgit key prefix in the passphrase, which
 *                  reproduces the pre-v1.2.3 failure. Defaults to stripping.
 */
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE        = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = resolvePath(HERE, '../..');
register('./site-root-loader.mjs', import.meta.url, { data: { staticRoot: STATIC_ROOT } });

const { deriveWriteKeys } = await import('/core/vault-write/v1/v1.1/v1.1.2/sg-vault-write.js');
const { parseVaultKey }   = await import('/core/vault-client/v1/v1.2/v1.2.3/sg-vault-client.js');
const { createSession }   = await import('/core/vault-session/v1/v1.0/v1.0.1/sg-vault-session.js');

const API       = process.env.API_BASE || 'http://127.0.0.1:8899';
const VAULT_KEY = process.env.VAULT_KEY;
const EXPECTED  = JSON.parse(process.env.EXPECTED || '{}');
const STRIP     = process.env.STRIP_PREFIX !== '0';

// STRIP_PREFIX=0 opts out of prefix stripping, reproducing the pre-v1.2.3
// behaviour that made CLI-made vaults unreachable. Anything else is the default.
const { passphrase, vaultId } = parseVaultKey(VAULT_KEY, { stripSgitPrefix: STRIP });

const keys = await deriveWriteKeys(passphrase, vaultId);
console.log(`  key prefix stripped : ${STRIP}`);
console.log(`  derived named ref   : ${keys.refFileId}`);
console.log(`  derived branch index: ${keys.branchIndexFileId}`);

const session = createSession({ apiBaseUrl: API, vaultId, keys });
try {
    await session.open();
} catch (err) {
    console.error(`  FAILED to open: ${err.message}`);
    process.exit(1);
}

/** Walk the whole tree, loading sub-tree folders on demand, decrypting each file. */
async function collect(dir, found) {
    for (const item of session.treeModel.listFolder(dir)) {
        const path = dir === '/' ? `/${item.name}` : `${dir}/${item.name}`;
        if (item.type === 'folder') {
            if (!item._loaded) await session.loadSubTree(path);
            await collect(path, found);
        } else {
            found[path] = new TextDecoder().decode(await session.getFile(item.blob_id));
        }
    }
    return found;
}

const found = await collect('/', {});

let failed = 0;
for (const [path, contents] of Object.entries(EXPECTED)) {
    if (found[path] === contents) {
        console.log(`  ✓ ${path} (${contents.length} bytes, byte-identical)`);
    } else {
        console.error(`  ✗ ${path}\n      expected: ${JSON.stringify(contents)}` +
                      `\n      actual:   ${JSON.stringify(found[path])}`);
        failed++;
    }
}

process.exit(failed === 0 ? 0 : 1);
