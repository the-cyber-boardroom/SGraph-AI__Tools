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

const { deriveWriteKeys }                      = await import('/core/vault-write/v1/v1.1/v1.1.1/sg-vault-write.js');
const { deriveBranchRefFileId, parseVaultKey } = await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
const { fileIdToPath }                         = await import('/core/vault-client/v1/v1.2/v1.2.2/vault-id-utils.js');

/**
 * Key prefixes sgit stamps onto credentials. `strip_key_prefix` in
 * sgit_ai/crypto/Vault__Crypto.py removes these before parsing; the browser
 * modules must do the same or every downstream derivation diverges.
 */
const SGIT_KEY_PREFIXES = [
    'sgit_private_vault_', 'sgit_private_read_', 'sgit_public_read_',
    'sgit_vk1_', 'sgit_rk1_',
];

/** Mirror of sgit's strip_key_prefix(). */
function stripSgitKeyPrefix(key) {
    key = (key || '').trim();
    for (const prefix of SGIT_KEY_PREFIXES) {
        if (key.startsWith(prefix)) return key.slice(prefix.length);
    }
    return key;
}

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

console.log('\nsgit ↔ browser derivation parity (sgit-ai 0.16.0 golden vectors)\n');
console.log('key parsing');

for (const vec of GOLDEN.vectors) {
    test(`${vec.name}: parseVaultKey() recovers the sgit passphrase`, () => {
        const { passphrase, vaultId } = parseVaultKey(stripSgitKeyPrefix(vec.vault_key));
        eq(passphrase, vec.passphrase, 'passphrase');
        eq(vaultId,    vec.vault_id,   'vault_id');
    });
}

// ── Derived key material ─────────────────────────────────────────────────────

console.log('\nderived key material');

for (const vec of GOLDEN.vectors) {
    await testAsync(`${vec.name}: read key, write key and file IDs match the CLI`, async () => {
        const { passphrase, vaultId } = parseVaultKey(stripSgitKeyPrefix(vec.vault_key));
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
        const { passphrase, vaultId } = parseVaultKey(stripSgitKeyPrefix(vec.vault_key));
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

// ── Module surface ───────────────────────────────────────────────────────────
// Everything above strips the sgit key prefix in the TEST before handing the key
// to a module — which proves the derivation maths agrees, but says nothing about
// what happens when a user pastes a real sgit key into a real component. These
// cases call the module surface with the key exactly as sgit prints it.

console.log('\nmodule surface: keys as sgit prints them');

for (const vec of GOLDEN.vectors) {
    if (stripSgitKeyPrefix(vec.vault_key) === vec.vault_key) continue;   // bare key, nothing to strip
    test(`${vec.name}: parseVaultKey() strips the sgit prefix itself`, () => {
        const { passphrase } = parseVaultKey(vec.vault_key);
        eq(passphrase, vec.passphrase, 'passphrase (prefix must not survive into the KDF input)');
    });
}

// ── Result ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.log(
        '\nFailures here are the interop gaps this suite exists to pin. See\n' +
        '  team/explorer/dev/reviews/v0.2.92__dev-review__sgit-0.16-browser-vault-interop.md\n' +
        'for what each one breaks and the change that closes it.\n');
}
process.exit(failed === 0 ? 0 : 1);
