/**
 * Key-compatibility guard — the versions that fixed sgit interop must not have
 * changed how any PRE-EXISTING key derives.
 *
 * v1.2.3 taught parseVaultKey() to strip sgit key prefixes and importReadKey()
 * to accept hex. Both are additive by design; this asserts it, by deriving the
 * same inputs through the old and new modules and comparing. A key with no sgit
 * prefix, a simple token, and a base64url read key must all behave exactly as
 * they did before.
 *
 * Run:  node sgraph_ai_tools__static/tests/interop/key-compat.test.mjs
 */

import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE        = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = resolvePath(HERE, '../..');
register('./site-root-loader.mjs', import.meta.url, { data: { staticRoot: STATIC_ROOT } });

const old  = await import('/core/vault-write/v1/v1.1/v1.1.1/sg-vault-write.js');
const neu  = await import('/core/vault-write/v1/v1.1/v1.1.2/sg-vault-write.js');
const oldC = await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
const newC = await import('/core/vault-client/v1/v1.2/v1.2.3/sg-vault-client.js');

const hex = u => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('');
const sig = k => [hex(k.readKeyBytes), k.writeKey, k.refFileId, k.branchIndexFileId].join('|');
let bad = 0;
const row = (same, label, extra = '') => {
    console.log(`  ${same ? 'IDENTICAL ' : 'CHANGED !!'}  ${label}${extra}`);
    if (!same) bad++;
};

console.log('\npre-existing passphrase keys — vault-write v1.1.1 vs v1.1.2');
for (const [pass, id] of [['hunter2', 'a1b2c3d4'], ['pass:with:colons', 'deadbeef'],
                          ['a-very-long-one-!@#$%', 'q7zx2m4p'], ['x', 'abcd']]) {
    row(sig(await old.deriveWriteKeys(pass, id)) === sig(await neu.deriveWriteKeys(pass, id)), `${pass}:${id}`);
}

console.log('\nsimple tokens');
for (const t of ['amber-lantern-4417', 'quiet-river-0001']) {
    row(sig(await old.deriveWriteKeysFromSimpleToken(t)) === sig(await neu.deriveWriteKeysFromSimpleToken(t)), t);
}

console.log('\nparseVaultKey on keys with no sgit prefix — v1.2.2 vs v1.2.3');
for (const k of ['hunter2:a1b2c3d4', 'pass:with:colons:deadbeef',
                 'sgitlike_but_not_a_prefix:abcd1234', 'my_sgit_private_vault_x:abcd1234']) {
    const a = JSON.stringify(oldC.parseVaultKey(k));
    const b = JSON.stringify(newC.parseVaultKey(k));
    row(a === b, k, `  → ${b}`);
}

console.log('\nimportReadKey — base64url callers (embed stack) unchanged');
const keyHex = '16723923b3704c2aed24b1368f9f4d601e09543ae11eac04e14eb91ce848f118';
const b64u   = Buffer.from(keyHex, 'hex').toString('base64url');
row(!!(await oldC.importReadKey(b64u)) && !!(await newC.importReadKey(b64u)), 'base64url 32-byte key');

console.log(bad === 0
    ? '\n✓ No pre-existing key form, token or read key changed behaviour.\n'
    : `\n✗ ${bad} REGRESSION(S)\n`);
process.exit(bad === 0 ? 0 : 1);
