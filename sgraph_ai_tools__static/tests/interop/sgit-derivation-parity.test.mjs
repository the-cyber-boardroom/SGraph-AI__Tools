/**
 * sgit ↔ browser derivation parity — golden vectors from sgit-ai 0.16.0.
 *
 * Guards the interop contract that CLI-made vaults depend on: the same vault key
 * must yield the same read key, write key and file IDs in both runtimes. It is a
 * pure-Node test — no server, no Python, no sgit install.
 *
 * Run:  node sgraph_ai_tools__static/tests/interop/sgit-derivation-parity.test.mjs
 */

import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';

const HERE        = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = resolvePath(HERE, '../..');
const GOLDEN      = JSON.parse(readFileSync(join(HERE, 'sgit-golden-vectors.json'), 'utf8'));

// The published modules import each other by site-absolute path ("/core/…"),
// as the browser loads them. Teach Node the same mapping before importing.
register('./site-root-loader.mjs', import.meta.url, { data: { staticRoot: STATIC_ROOT } });

const { deriveWriteKeys }                      = await import('/core/vault-write/v1/v1.1/v1.1.2/sg-vault-write.js');
const { deriveBranchRefFileId, parseVaultKey } = await import('/core/vault-client/v1/v1.2/v1.2.3/sg-vault-client.js');
const { fileIdToPath }                         = await import('/core/vault-client/v1/v1.2/v1.2.3/vault-id-utils.js');

/** Does this vector's key carry a prefix the modules have to strip? */
const hasSgitPrefix = (key) => key.startsWith('sgit_');

let passed = 0, failed = 0;

function test(label, fn) {
    try { fn(); console.log(`  ✓ ${label}`); passed++; }
    catch (e) { console.error(`  ✗ ${label}\n      ${e.message}`); failed++; }
}

async function testAsync(label, fn) {
    try { await fn(); console.log(`  ✓ ${label}`); passed++; }
    catch (e) { console.error(`  ✗ ${label}\n      ${e.message}`); failed++; }
}

const eq = (actual, expected, what) => {
    if (actual !== expected) {
        throw new Error(`${what}\n      expected: ${expected}\n      actual:   ${actual}`);
    }
};

const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

// ── Key parsing ──────────────────────────────────────────────────────────────
// A vault key may arrive with a self-identifying sgit prefix. It is not part of
// the passphrase — keeping it changes the PBKDF2 input and every file ID with it.
// Every case below passes the key EXACTLY as sgit prints it; the modules strip.

console.log('\nsgit ↔ browser derivation parity (sgit-ai 0.16.0 golden vectors)\n');
console.log('key parsing');

for (const vec of GOLDEN.vectors) {
    test(`${vec.name}: parseVaultKey() recovers the sgit passphrase`, () => {
        const { passphrase, vaultId } = parseVaultKey(vec.vault_key);
        eq(passphrase, vec.passphrase, 'passphrase');
        eq(vaultId,    vec.vault_id,   'vault_id');
    });
}

// ── Derived key material ─────────────────────────────────────────────────────

console.log('\nderived key material');

for (const vec of GOLDEN.vectors) {
    await testAsync(`${vec.name}: read key, write key and file IDs match the CLI`, async () => {
        const { passphrase, vaultId } = parseVaultKey(vec.vault_key);
        const keys = await deriveWriteKeys(passphrase, vaultId);

        eq(toHex(keys.readKeyBytes),  vec.read_key_hex,         'read key');
        eq(keys.writeKey,             vec.write_key_hex,        'write key');
        eq(keys.refFileId,            vec.ref_file_id,          'named HEAD ref file ID');
        eq(keys.branchIndexFileId,    vec.branch_index_file_id, 'branch index file ID');
    });
}

// ── Branch refs ──────────────────────────────────────────────────────────────

console.log('\nbranch ref derivation');

for (const vec of GOLDEN.vectors) {
    await testAsync(`${vec.name}: branch refs match for 'main' and 'web-ui'`, async () => {
        const { passphrase, vaultId } = parseVaultKey(vec.vault_key);
        const keys = await deriveWriteKeys(passphrase, vaultId);

        eq(await deriveBranchRefFileId(keys.readKeyBytes, vaultId, 'main'),
           vec.branch_ref_main,   "branch ref 'main'");
        eq(await deriveBranchRefFileId(keys.readKeyBytes, vaultId, 'web-ui'),
           vec.branch_ref_web_ui, "branch ref 'web-ui'");
    });
}

// ── Storage layout ───────────────────────────────────────────────────────────
// fileIdToPath() decides where each object type is fetched from. It has to agree
// with where sgit actually writes, or reads 404 against a vault that is present.

console.log('\nstorage layout');

for (const [type, expectedDir] of Object.entries(GOLDEN.layout)) {
    if (type.startsWith('_')) continue;
    test(`${type}-* resolves to ${expectedDir}/ (where sgit writes it)`, () => {
        const sampleId = `${type}-pid-muw-000000000000`;
        eq(fileIdToPath(sampleId), `${expectedDir}/${sampleId}`, `${type} path`);
    });
}

// ── Prefix handling, explicitly ──────────────────────────────────────────────
// The regression that started all this: a prefix surviving into the KDF input.

console.log('\nsgit key prefix handling');

for (const vec of GOLDEN.vectors) {
    if (!hasSgitPrefix(vec.vault_key)) continue;
    test(`${vec.name}: the prefix does not survive into the KDF input`, () => {
        eq(parseVaultKey(vec.vault_key).passphrase, vec.passphrase, 'passphrase');
    });
}

test('a passphrase that genuinely starts with a prefix is recoverable', () => {
    const { passphrase } = parseVaultKey('sgit_private_vault_odd:a1b2c3d4', { stripSgitPrefix: false });
    eq(passphrase, 'sgit_private_vault_odd', 'passphrase with opt-out');
});

// ── Result ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.log(
        '\nA failure here means the browser modules and sgit have drifted apart. See\n' +
        '  team/explorer/dev/reviews/v0.2.92__dev-review__sgit-0.16-browser-vault-interop.md\n' +
        'for what each check protects.\n');
}
process.exit(failed === 0 ? 0 : 1);
