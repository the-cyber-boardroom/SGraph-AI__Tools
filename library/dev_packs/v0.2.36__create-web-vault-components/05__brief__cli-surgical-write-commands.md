# Dev Brief: CLI Surgical Vault Editing — Agent Support Commands

**Version:** v0.22.17 | **Date:** 26 April 2026
**Target team:** CLI Team (`SGit-AI__CLI`)
**Priority:** P1
**Anchor doc:** `SGraph-AI__App__Send/team/comms/briefs/04/26/v0.22.17__brief__vault-backed-website-content-workflow.md`
**Depends on:** Nothing — purely additive CLI changes

---

## Context

Claude Code agents use `sgit` as their primary interface to vaults. They need to:

1. **Read** specific files from large vaults without cloning gigabytes of blobs
2. **Write** single files and get back their `obj-cas-imm-*` blob ID immediately
3. **Inspect** which blob ID corresponds to which path (to build/update instructions JSON)

They do this across three vault patterns:
- Reading instructions/briefs from a vault (sparse clone + cat)
- Writing content to a Type A (website content) vault
- Communicating with other agents via shared comms vaults

The current CLI covers the full clone → edit → commit → push cycle well. Three thin additions make it surgical for agents.

---

## What Already Exists (Read Before Writing Any Code)

**`sparse_ls(directory, path)`** — returns `[{path, size, blob_id, fetched, large}]`. The `blob_id` is already there. `cmd_ls` just doesn't print it.

**`_get_head_flat_map(directory)`** — returns the full flat `{path: {blob_id, size, ...}}` map from HEAD. Zero network after sparse clone. Foundation for both `write` and `read --id`.

**`Sub_Tree.build_from_flat(flat_map, read_key)`** — builds new tree from a modified flat map. Already used by merge. The tree-building half of `write`.

**`Vault__Commit.create_commit(...)`** — creates and stores an encrypted commit. Already used by `commit`. The commit half of `write`.

**`sparse_cat(directory, path)`** — fetches and decrypts a single file on demand. Already used by `cat`.

**`Vault__Batch.build_push_operations(...)`** — skips blobs already on the server. A push after `sgit write` uploads only new blobs. The 8GB of existing photos and videos are never touched.

**`SG_SEND_PASSPHRASE` env var** — already supported in `CLI__Credential_Store`. Agents use this for non-interactive vault key resolution.

---

## The Three New Commands

### Command 1: `sgit write <path> [directory]`

**What it does:** Encrypt content from stdin or `--file`, add to the vault tree, commit, print the `obj-cas-imm-*` blob ID to stdout. Does not touch the working directory. Does not scan the filesystem. Works on sparse clones.

**This is the core agent primitive.** The blob ID on stdout is what gets written into the instructions JSON and the repo manifest.

```bash
# From stdin
echo "# New hero copy" | sgit write content/hero/v2.md ./vault
→ obj-cas-imm-xyz999

# From a file
sgit write content/hero/v2.md ./vault --file /tmp/new-hero.md
→ obj-cas-imm-xyz999

# Capture in a variable (the agent pattern)
NEW_ID=$(echo "# content" | sgit write content/hero/v2.md ./vault)

# With explicit commit message
echo "data" | sgit write content/data.json ./vault --message "update data"

# Full JSON output (for agent inspection)
echo "data" | sgit write content/data.json ./vault --json
→ { "blob_id": "obj-cas-imm-xyz999", "path": "content/data.json",
    "commit_id": "obj-cas-imm-commitabc", "message": "update content/data.json" }
```

**Default stdout:** only the `blob_id`. No noise. Clean capture with `$()`.

**Implementation — add to `Vault__Sync`:**

```python
def write_file(self, directory: str, path: str, content: bytes,
               message: str = '') -> dict:
    """Write a single file to the vault without touching the working copy.

    Reads HEAD flat map, adds/replaces the entry for `path`, rebuilds
    tree, creates commit, updates clone branch ref.
    Returns {blob_id, path, commit_id, message}.
    Does NOT push. Does NOT touch the working directory.
    Works on both sparse and full clones.
    """
    import mimetypes
    c            = self._init_components(directory)
    read_key     = c.read_key
    obj_store    = c.obj_store
    ref_mgr      = c.ref_manager
    storage      = c.storage
    pki          = PKI__Crypto()
    key_mgr      = c.key_manager

    local_config = self._read_local_config(directory, storage)
    branch_id    = str(local_config.my_branch_id)
    index_id     = c.branch_index_file_id
    branch_index = c.branch_manager.load_branch_index(directory, index_id, read_key)
    branch_meta  = c.branch_manager.get_branch_by_id(branch_index, branch_id)
    ref_id       = str(branch_meta.head_ref_id)
    parent_id    = ref_mgr.read_ref(ref_id, read_key)

    sub_tree = Vault__Sub_Tree(crypto=self.crypto, obj_store=obj_store)
    vc       = Vault__Commit(crypto=self.crypto, pki=pki,
                              object_store=obj_store, ref_manager=ref_mgr)
    flat = {}
    if parent_id:
        old_commit = vc.load_commit(parent_id, read_key)
        flat       = sub_tree.flatten(str(old_commit.tree_id), read_key)

    # Encrypt and store the new blob
    file_hash    = self.crypto.content_hash(content)
    ciphertext   = self.crypto.encrypt(read_key, content)
    blob_id      = obj_store.store(ciphertext)
    content_type = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    is_large     = len(ciphertext) > LARGE_BLOB_THRESHOLD

    flat[path] = dict(blob_id      = blob_id,
                      size         = len(content),
                      content_hash = file_hash,
                      content_type = content_type,
                      large        = is_large)

    root_tree_id = sub_tree.build_from_flat(flat, read_key)

    signing_key = None
    try:
        signing_key = key_mgr.load_private_key_locally(
            str(branch_meta.public_key_id), storage.local_dir(directory))
    except Exception:
        pass

    auto_msg  = message or f'update {path}'
    commit_id = vc.create_commit(tree_id     = root_tree_id,
                                  read_key    = read_key,
                                  parent_ids  = [parent_id] if parent_id else [],
                                  message     = auto_msg,
                                  branch_id   = branch_id,
                                  signing_key = signing_key)
    ref_mgr.write_ref(ref_id, commit_id, read_key)

    return dict(blob_id   = blob_id,
                path      = path,
                commit_id = commit_id,
                message   = auto_msg)
```

**CLI wiring:**

```python
# CLI__Main
write_parser = subparsers.add_parser('write',
    help='Encrypt and write a file to the vault from stdin or --file')
write_parser.add_argument('path',
    help='Vault file path (e.g. content/hero.md, instructions/home.json)')
write_parser.add_argument('directory', nargs='?', default='.',
    help='Vault directory (default: .)')
write_parser.add_argument('--file', default=None, metavar='PATH',
    help='Read content from this file instead of stdin')
write_parser.add_argument('--message', '-m', default='',
    help='Commit message (auto-generated if omitted)')
write_parser.add_argument('--json', action='store_true', default=False,
    help='Output full JSON result instead of just the blob ID')
write_parser.set_defaults(func=self.vault.cmd_write)

# CLI__Vault
def cmd_write(self, args):
    import sys
    token    = self.token_store.resolve_token(getattr(args, 'token', None), args.directory)
    base_url = self.token_store.resolve_base_url(getattr(args, 'base_url', None), args.directory)

    if getattr(args, 'file', None):
        with open(args.file, 'rb') as f:
            content = f.read()
    else:
        content = sys.stdin.buffer.read()

    sync   = self.create_sync(base_url, token)
    result = sync.write_file(args.directory, args.path, content,
                             getattr(args, 'message', ''))

    if getattr(args, 'json', False):
        print(json.dumps(result, indent=2))
    else:
        print(result['blob_id'])
```

---

### Command 2: `sgit read <path> [directory] [--id | --json]`

**What it does:** Two modes.

- No flags: decrypts and prints file content to stdout. Same as `sgit cat`. Fetches from server if not cached.
- `--id`: prints only the `obj-cas-imm-*` blob ID. **Zero network calls.** Reads from the local flat map.
- `--json`: prints `{path, blob_id, size, content_type, fetched}` as JSON. Zero network.

```bash
# Get blob ID for a path — zero network, zero decrypt
sgit read instructions/home.json ./vault --id
→ obj-cas-imm-aaa111

# Get full metadata — zero network
sgit read instructions/home.json ./vault --json
→ { "path": "instructions/home.json", "blob_id": "obj-cas-imm-aaa111",
    "size": 312, "content_type": "application/json", "fetched": true }

# Read decrypted content — fetches blob if not cached
sgit read instructions/home.json ./vault
→ { "slots": { "hero": { "object_id": "obj-cas-imm-aaa111" } } }
```

**The agent pattern for reading then updating instructions:**

```bash
# Read current state
CURRENT=$(sgit read instructions/home.json ./vault)
# Patch with new blob ID
NEW_INSTRUCTIONS=$(echo "$CURRENT" | python3 -c "
import json, sys
m = json.load(sys.stdin)
m['slots']['hero']['object_id'] = '$NEW_HERO_ID'
print(json.dumps(m, indent=2))
")
# Write back
echo "$NEW_INSTRUCTIONS" | sgit write instructions/home.json ./vault
```

**CLI wiring:**

```python
# CLI__Main
read_parser = subparsers.add_parser('read',
    help='Read a vault file: content (default), blob ID (--id), or metadata (--json)')
read_parser.add_argument('path', help='Vault file path')
read_parser.add_argument('directory', nargs='?', default='.',
    help='Vault directory (default: .)')
read_parser.add_argument('--id', action='store_true', default=False,
    help='Print only the blob ID (obj-cas-imm-*) — no network call')
read_parser.add_argument('--json', action='store_true', default=False,
    help='Print path + blob_id + size + content_type as JSON — no network call')
read_parser.set_defaults(func=self.vault.cmd_read)

# CLI__Vault
def cmd_read(self, args):
    import sys
    id_only = getattr(args, 'id', False)
    as_json = getattr(args, 'json', False)
    token    = self.token_store.resolve_token(getattr(args, 'token', None), args.directory)
    base_url = self.token_store.resolve_base_url(getattr(args, 'base_url', None), args.directory)
    sync     = self.create_sync(base_url, token)

    if id_only or as_json:
        # Zero-network path: flat map only
        entries = sync.sparse_ls(args.directory, path=args.path)
        match   = next((e for e in entries if e['path'] == args.path), None)
        if not match:
            print(f'error: path not found in vault: {args.path}', file=sys.stderr)
            sys.exit(1)
        if id_only:
            print(match['blob_id'])
        else:
            print(json.dumps(match, indent=2))
    else:
        # Full content: fetch + decrypt (same as cat)
        content = sync.sparse_cat(args.directory, args.path)
        sys.stdout.buffer.write(content)
```

---

### Command 3: `sgit ls --ids [--json]` (flag addition to existing command)

**What it does:** Adds `--ids` flag to expose the `obj-cas-imm-*` blob ID alongside each file listing. Agents use this to survey vault state and understand what's currently referenced.

```bash
# Current output
sgit ls instructions/ ./vault
→   ✓     312B  instructions/home.json
→   ✓     280B  instructions/pricing.json

# With --ids
sgit ls instructions/ ./vault --ids
→   ✓     312B  obj-cas-imm-aaa111  instructions/home.json
→   ✓     280B  obj-cas-imm-ddd444  instructions/pricing.json

# With --json (for agents parsing output)
sgit ls ./vault --json
→ [
    { "path": "instructions/home.json", "blob_id": "obj-cas-imm-aaa111",
      "size": 312, "fetched": true, "large": false },
    { "path": "content/hero/v1.md", "blob_id": "obj-cas-imm-bbb222",
      "size": 1024, "fetched": false, "large": false },
    { "path": "content/photos/hero.jpg", "blob_id": "obj-cas-imm-ccc333",
      "size": 8716288, "fetched": false, "large": true }
  ]
```

**Implementation — update `cmd_ls` and `ls_parser`:**

```python
# CLI__Main: add flags to ls_parser
ls_parser.add_argument('--ids',  action='store_true', default=False,
                       help='Show blob IDs (obj-cas-imm-*) alongside paths')
ls_parser.add_argument('--json', action='store_true', default=False,
                       help='Output as JSON array (includes all metadata)')

# CLI__Vault: update cmd_ls
def cmd_ls(self, args):
    ...
    show_ids = getattr(args, 'ids', False)
    as_json  = getattr(args, 'json', False)

    if as_json:
        print(json.dumps(entries, indent=2))
        return

    for e in entries:
        status  = '✓' if e['fetched'] else '·'
        size_str = f'{e["size"] / 1024:.1f}K' if e['size'] >= 1024 else f'{e["size"]}B'
        if show_ids:
            print(f'  {status}  {size_str:>8}  {e["blob_id"]}  {e["path"]}')
        else:
            print(f'  {status}  {size_str:>8}  {e["path"]}')
```

---

## The Complete Agent Script

This is the target UX. Should work as-is once the three commands are shipped:

```bash
#!/bin/bash
# Claude Code Agent: update hero copy on sgraph.ai
# Vault may be 8GB. We never touch existing blobs.

set -e

VAULT_KEY="${SGIT_VAULT_KEY}"   # from env var — never hardcoded
VAULT_DIR="/tmp/content-vault-$(date +%s)"
REPO_DIR="/repo"                 # mounted repo

# 1. Sparse clone — structure only
echo "Cloning vault (sparse)..."
sgit clone --sparse "$VAULT_KEY" "$VAULT_DIR"

# 2. Survey what's currently in instructions
echo "Current vault state:"
sgit ls instructions/ "$VAULT_DIR" --ids

# 3. Read current instructions
CURRENT_INSTRUCTIONS=$(sgit read instructions/home.json "$VAULT_DIR")
echo "Current hero blob: $(sgit read instructions/home.json "$VAULT_DIR" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['blob_id'])")"

# 4. Write new hero content, capture blob ID
echo "Writing new hero content..."
NEW_HERO_ID=$(cat <<'CONTENT' | sgit write content/hero/hero-v2.md "$VAULT_DIR" --message "hero copy v2"
# Version-controlled, client-encrypted vaults.
For humans and agents. Seven deployment targets. One codebase.
CONTENT
)
echo "New hero blob: $NEW_HERO_ID"

# 5. Update instructions in the vault
echo "Updating vault instructions..."
echo "$CURRENT_INSTRUCTIONS" | python3 -c "
import json, sys
m = json.load(sys.stdin)
m['slots']['hero']['object_id'] = '$NEW_HERO_ID'
print(json.dumps(m, indent=2))
" | sgit write instructions/home.json "$VAULT_DIR" --message "point hero at v2 [$NEW_HERO_ID]"

# 6. Push vault changes
echo "Pushing to vault..."
sgit push "$VAULT_DIR"

# 7. Update the repo manifest (the CI gate)
echo "Updating repo manifest..."
cd "$REPO_DIR"
python3 -c "
import json
with open('sgraph_ai__website/_common/manifests/home.json') as f:
    m = json.load(f)
m['slots']['hero']['object_id'] = '$NEW_HERO_ID'
with open('sgraph_ai__website/_common/manifests/home.json', 'w') as f:
    json.dump(m, f, indent=2)
"
git add sgraph_ai__website/_common/manifests/home.json
git commit -m "content: update hero copy [$NEW_HERO_ID]"
git push origin dev

echo "Done. CI will deploy. New content live within 1 day (manifest cache)."
echo "Blob ID committed to git history: $NEW_HERO_ID"
```

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC-1 | `echo "text" \| sgit write path/file.md ./vault` prints an `obj-cas-imm-*` ID and nothing else to stdout |
| AC-2 | `sgit write` works on a sparse clone — no full working copy required |
| AC-3 | `sgit write` does not scan the working directory — only the named file changes |
| AC-4 | `sgit push` after `sgit write` uploads only the new blob(s) — existing blobs untouched |
| AC-5 | `sgit read path/file.md ./vault --id` prints blob ID with zero network calls |
| AC-6 | `sgit read path/file.md ./vault` (no flags) prints decrypted content to stdout |
| AC-7 | `sgit read path/file.md ./vault --json` outputs valid JSON with path, blob_id, size, content_type, fetched |
| AC-8 | `sgit ls ./vault --ids` shows `obj-cas-imm-*` IDs alongside file paths |
| AC-9 | `sgit ls ./vault --json` outputs a valid JSON array with full metadata |
| AC-10 | All three commands work correctly on both sparse and full clones |
| AC-11 | `sgit write --json` outputs `{blob_id, path, commit_id, message}` |
| AC-12 | Non-interactive: `SG_SEND_PASSPHRASE` env var allows credential store access without prompts |

---

## Blast Radius

**New files:** None.

**Modified files:**
- `sgit_ai/cli/CLI__Main.py` — add parsers for `write` and `read`; add `--ids`/`--json` to `ls`
- `sgit_ai/cli/CLI__Vault.py` — add `cmd_write`, `cmd_read`; update `cmd_ls`
- `sgit_ai/sync/Vault__Sync.py` — add `write_file()` method

**Unchanged:** `Vault__Sub_Tree`, `Vault__Commit`, `Vault__Batch`, `Vault__API`, `Vault__Object_Store` — used as-is.

**Tests to add:**
- `tests/unit/cli/test_write.py` — write to sparse clone, verify blob_id returned, verify correct commit created, verify push uploads only new blob
- `tests/unit/cli/test_read.py` — `--id` returns correct blob_id with no network, `--json` valid, no-flag returns decrypted bytes
- Update `tests/unit/cli/test_ls.py` — `--ids` shows blob_ids, `--json` is valid JSON array

---

## Open Questions for CLI Team

| # | Question |
|---|----------|
| OQ-1 | Should `sgit write --push` push immediately after writing? Saves a separate `sgit push` step for simple single-file updates. |
| OQ-2 | Should `sgit write --delete` remove a file from the vault tree (tombstone entry)? Useful for cleaning up obsolete content from instructions. |
| OQ-3 | Should `sgit read --id` also work without a local clone — i.e. fetch the blob ID from a remote vault? Requires fetching the tree remotely. Complex but useful for agents that don't want to clone first. |
| OQ-4 | Should `sgit write` accept multiple `--also path:content` arguments to write several files in one commit atomically? Useful when agent updates both content and instructions together. |

---

*Explorer Team — Architect*
*CLI Team Dev Brief | v0.22.17 | 26 April 2026*
