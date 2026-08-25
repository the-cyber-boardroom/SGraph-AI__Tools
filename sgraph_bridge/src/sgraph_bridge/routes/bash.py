"""POST /bash/exec — run a bash command inside the workspace."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from sgraph_bridge.config import DEFAULT_TIMEOUT_S, MAX_OUTPUT_BYTES
from sgraph_bridge.models import BashExecRequest, BashExecResponse
from sgraph_bridge.safety import PathOutsideWorkspaceError, resolve_in_workspace

router = APIRouter(prefix="/bash")


def _workspace(request: Request) -> Path:
    return request.app.state.workspace


def _path_err(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={"error_code": "path_outside_workspace", "message": message, "detail": None},
    )


def _truncate(data: bytes) -> tuple[str, bool]:
    """Decode *data*, capping at MAX_OUTPUT_BYTES.

    Returns (text, was_truncated).
    """
    truncated = len(data) > MAX_OUTPUT_BYTES
    return data[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace"), truncated


@router.post("/exec", response_model=BashExecResponse)
async def bash_exec(body: BashExecRequest, request: Request) -> JSONResponse:
    """Execute *command* inside the workspace.

    The working directory defaults to the workspace root. An optional *cwd*
    (relative to workspace) may be supplied. Timeout defaults to 30 s.
    stdout/stderr are each capped at 200 KB; ``truncated`` is ``true`` if
    either stream was cut.

    Returns 408 on timeout, 403 on path escape.
    """
    ws = _workspace(request)
    timeout_s = body.timeout_s if body.timeout_s and body.timeout_s > 0 else DEFAULT_TIMEOUT_S

    if body.cwd:
        try:
            cwd_path = resolve_in_workspace(body.cwd, ws)
        except PathOutsideWorkspaceError as exc:
            return _path_err(str(exc))
    else:
        cwd_path = ws

    t0 = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_shell(
            body.command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(cwd_path),
        )
        stdout_raw, stderr_raw = await asyncio.wait_for(
            proc.communicate(), timeout=float(timeout_s)
        )
    except asyncio.TimeoutError:
        # Kill the process group on timeout.
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        duration_ms = int((time.monotonic() - t0) * 1000)
        return JSONResponse(
            status_code=408,
            content={
                "error_code": "bash_timeout",
                "message": f"Command timed out after {timeout_s}s.",
                "detail": {"duration_ms": duration_ms},
            },
        )

    duration_ms = int((time.monotonic() - t0) * 1000)
    stdout_text, trunc_out = _truncate(stdout_raw)
    stderr_text, trunc_err = _truncate(stderr_raw)

    return JSONResponse(
        content={
            "command": body.command,
            "cwd": str(cwd_path),
            "exit_code": proc.returncode,
            "stdout": stdout_text,
            "stderr": stderr_text,
            "duration_ms": duration_ms,
            "truncated": trunc_out or trunc_err,
        }
    )
