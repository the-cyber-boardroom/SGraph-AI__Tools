"""Regenerate sgit-golden-vectors.json from sgit's own crypto.

The vectors are the CLI's answer, not ours — never hand-edit them. Regenerate
when sgit ships a new version, then run sgit-derivation-parity.test.mjs: any
value that moves is a format change the browser modules have to follow.

    pip install sgit-ai==0.16.0
    python3 sgraph_ai_tools__static/tests/interop/regenerate-vectors.py > \
        sgraph_ai_tools__static/tests/interop/sgit-golden-vectors.json
"""
import json

from sgit_ai.crypto.Vault__Crypto import Vault__Crypto

CASES = [
    ('prefixed-vault-key',            'sgit_private_vault_correct-horse-battery:k8hbjt8x'),
    ('bare-key',                      'correct-horse-battery:k8hbjt8x'),
    ('legacy-vk1-prefix',             'sgit_vk1_correct-horse-battery:k8hbjt8x'),
    ('passphrase-containing-colons',  'sgit_private_vault_pass:with:colons:deadbeef'),
    ('long-passphrase-with-symbols',  'sgit_private_vault_a-much-longer-passphrase-with-symbols-!@#$%:q7zx2m4p'),
]


def vector(name: str, vault_key: str) -> dict:
    crypto               = Vault__Crypto()
    passphrase, vault_id = crypto.parse_vault_key(vault_key)
    keys                 = crypto.derive_keys(passphrase, vault_id)
    read_key             = keys['read_key_bytes']
    branch_ref           = lambda b: 'ref-pid-muw-' + crypto.derive_branch_ref_file_id(read_key, vault_id, b)

    return dict(name                 = name,
                vault_key            = vault_key,
                passphrase           = passphrase,
                vault_id             = vault_id,
                read_key_hex         = keys['read_key'],
                write_key_hex        = keys['write_key'],
                ref_file_id          = keys['ref_file_id'],
                branch_index_file_id = keys['branch_index_file_id'],
                branch_ref_main      = branch_ref('main'),
                branch_ref_web_ui    = branch_ref('web-ui'))


if __name__ == '__main__':
    import sgit_ai.storage.Vault__Storage as storage

    document = {
        '_source'    : 'sgit-ai — sgit_ai.crypto.Vault__Crypto.derive_keys()',
        '_note'      : 'Golden values produced by the CLI itself. The browser modules must '
                       'reproduce them byte for byte from the same vault key. Every case uses a '
                       "self-identifying sgit key prefix except 'bare-key', which is the "
                       'historical form.',
        '_regenerate': 'pip install sgit-ai && python3 tests/interop/regenerate-vectors.py',
        'vectors'    : [vector(name, key) for name, key in CASES],
        'layout'     : {
            '_note': 'Where sgit stores each object type on the server, read from its own '
                     'storage constants.',
            'obj'  : f'{storage.BARE_DIR}/{storage.BARE_DATA}',
            'ref'  : f'{storage.BARE_DIR}/{storage.BARE_REFS}',
            'key'  : f'{storage.BARE_DIR}/{storage.BARE_KEYS}',
            'idx'  : f'{storage.BARE_DIR}/{storage.BARE_INDEXES}',
        },
    }
    print(json.dumps(document, indent=2))
