# sgraph_bridge

FastAPI service that exposes six host-side tools to browser-based agents at
[tools.sgraph.ai](https://tools.sgraph.ai). Runs in Docker on your laptop or EC2.

## Quick start (Docker)

```bash
cd sgraph_bridge
docker compose up --build
```

The workspace directory `./_sgraph-workspace` is created automatically in the
directory where you run `docker compose up`. All file paths the LLM sends are
resolved relative to this workspace.

Check the service is up:

```bash
curl http://localhost:8000/ping
# {"ok":true,"version":"0.1.0","workspace":"/workspace","started_at":"..."}
```

## Run locally (no Docker)

```bash
cd sgraph_bridge
pip install -e ".[dev]"
bash scripts/run-local.sh
```

The workspace defaults to `./_sgraph-workspace` relative to your current
directory. Override with the `SGRAPH_WORKSPACE` environment variable:

```bash
SGRAPH_WORKSPACE=/tmp/my-workspace bash scripts/run-local.sh
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/ping` | Health check — returns version, workspace, started_at |
| POST | `/file/read` | Read a text file from the workspace |
| POST | `/file/write` | Write (overwrite) a file; creates parent dirs by default |
| POST | `/file/delete` | Delete a file |
| POST | `/file/list` | List directory entries (optional recursive) |
| POST | `/bash/exec` | Run a bash command in the workspace container |
| POST | `/curl/fetch` | Fetch a URL via httpx |

All POST endpoints accept and return JSON. Errors use the envelope:
`{ "error_code": str, "message": str, "detail": any }`.

## Run tests

```bash
cd sgraph_bridge
pip install -e ".[dev]"
python -m pytest tests/ -v
```

## Security note

**The container is the security boundary.**

`sgraph_bridge` enforces path safety — all file paths are resolved inside the
workspace and symlink traversal outside is rejected with 403. However, bash
commands run with the permissions of the container user. **Do not expose port
8000 to the public internet.** Run the bridge on localhost or a private network
only.

The CORS policy allows `https://tools.sgraph.ai` and any `http://localhost:*`
or `http://127.0.0.1:*` origin. Requests from other origins are rejected by the
browser before they reach the service.
