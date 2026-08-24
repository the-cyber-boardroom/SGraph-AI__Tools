# sgit ↔ browser vault interop tests

These tests exist because the sgit CLI and the browser vault modules are two
independent implementations of one vault format, and nothing until now checked
that they still agreed. When they drift the symptom is silent: the browser
derives different file IDs, looks in different directories, and reports
*"Vault not found: named HEAD ref missing"* against a vault that is plainly
there.

Full analysis: `team/explorer/dev/reviews/v0.2.92__dev-review__sgit-0.16-browser-vault-interop.md`

---

## The fast one — derivation parity

Pure Node, no server, no Python, no sgit install. Runs in about a second and is
the one to put in CI.

```bash
node sgraph_ai_tools__static/tests/interop/sgit-derivation-parity.test.mjs
```

It checks the published browser modules against golden vectors produced by
sgit's own crypto: read key, write key, named HEAD ref ID, branch index ID and
branch ref IDs must match byte for byte, and `fileIdToPath()` must resolve each
object type to the directory sgit actually writes to.

**It currently fails 5 of 23 cases. Those failures are the point** — they pin
the two shipped defects the review documents. The suite goes green when those
are fixed, and stays green as a regression guard.

## The thorough one — full round trip

Creates a vault with the real CLI, opens it with the real browser modules, then
does the reverse. Needs Python and network access to install sgit once.

```bash
./sgraph_ai_tools__static/tests/interop/run-roundtrip.sh
```

| Variable | Default | Purpose |
|---|---|---|
| `SGIT` | — | Path to an existing sgit; skips the temp-venv install |
| `SGIT_VERSION` | `0.16.0` | Version to install when `SGIT` is unset |
| `KV_PORT` | `8899` | Port for the local KV store |
| `STRIP_PREFIX` | `1` | `0` reproduces the shipped bug — the run then fails as it should |

Direction 1 runs `sgit init && sgit commit && sgit push`, then opens the result
with `vault-write` + `vault-session` and decrypts every file. Direction 2 mints a
vault with `vault-init`, writes through `vault-mutations` and `session.push()`,
then `sgit clone`s it and compares the checked-out files.

## Files

| File | Role |
|---|---|
| `sgit-derivation-parity.test.mjs` | The fast test |
| `sgit-golden-vectors.json` | CLI-produced expectations — never hand-edit |
| `regenerate-vectors.py` | Rebuilds the vectors from sgit's own crypto |
| `run-roundtrip.sh` | Drives the full two-direction round trip |
| `roundtrip-cli-to-browser.mjs` | Opens a CLI-made vault with the browser modules |
| `roundtrip-browser-to-cli.mjs` | Mints and pushes a vault from the browser modules |
| `kv-server.py` | ~145-line SG/Send-compatible KV store, localhost only |
| `site-root-loader.mjs` | Maps `/core/…` imports onto the static root for Node |

## When sgit publishes a new version

```bash
pip install sgit-ai==<new-version>
python3 sgraph_ai_tools__static/tests/interop/regenerate-vectors.py > \
        sgraph_ai_tools__static/tests/interop/sgit-golden-vectors.json
git diff sgraph_ai_tools__static/tests/interop/sgit-golden-vectors.json
```

An empty diff means the format held. Any value that moved is a format change the
browser modules have to follow, and the parity test will say exactly which.
