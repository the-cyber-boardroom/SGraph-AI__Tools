/**
 * CLI → browser: open a vault made by `sgit init && sgit commit && sgit push`
 * with the published browser modules, walk its tree and decrypt every file.
 *
 * Driven by run-roundtrip.sh, which creates the vault first. Expects:
 *   API_BASE   — KV store base URL
 *   VAULT_KEY  — the vault key exactly as sgit printed it (prefix included)
 *   EXPECTED   — JSON object of { "/path": "contents" } the CLI committed
 *   STRIP_PREFIX — "1" to strip the sgit key prefix before deriving
 */
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE        = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = resolvePath(HERE, '../..');
register('./site-root-loader.mjs', import.meta.url, { data: { staticRoot: STATIC_ROOT } });

const { deriveWriteKeys } = await import('/core/vault-write/v1/v1.1/v1.1.1/sg-vault-write.js');
const { createSession }   = await import('/core/vault-session/v1/v1.0/v1.0.0/sg-vault-session.js');

const API       = process.env.API_BASE || 'http://127.0.0.1:8899';
const VAULT_KEY = process.env.VAULT_KEY;
const EXPECTED  = JSON.parse(process.env.EXPECTED || '{}');
const STRIP     = process.env.STRIP_PREFIX === '1';

const SGIT_KEY_PREFIXES = ['sgit_private_vault_', 'sgit_private_read_', 'sgit_public_read_',
                           'sgit_vk1_', 'sgit_rk1_'];

function stripSgitKeyPrefix(key) {
    key = (key || '').trim();
    for (const p of SGIT_KEY_PREFIXES) if (key.startsWith(p)) return key.slice(p.length);
    return key;
}

// How sg-vault-connect v0.1.3 splits a pasted key (lines 248-251).
const raw        = STRIP ? stripSgitKeyPrefix(VAULT_KEY) : VAULT_KEY;
const lastColon  = raw.lastIndexOf(':');
const passphrase = raw.slice(0, lastColon);
const vaultId    = raw.slice(lastColon + 1);

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
