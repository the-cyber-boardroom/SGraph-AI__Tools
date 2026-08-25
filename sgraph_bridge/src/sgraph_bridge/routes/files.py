"""File-system endpoints: read, write, delete, list."""

from __future__ import annotations

import os
import stat
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from sgraph_bridge.models import (
    FileDeleteRequest,
    FileDeleteResponse,
    FileEntry,
    FileListRequest,
    FileListResponse,
    FileReadRequest,
    FileReadResponse,
    FileWriteRequest,
    FileWriteResponse,
)
from sgraph_bridge.safety import PathOutsideWorkspaceError, resolve_in_workspace

router = APIRouter(prefix="/file")

_BINARY_SNIFF_BYTES = 8 * 1024  # detect binary in first 8 KB


def _workspace(request: Request) -> Path:
    return request.app.state.workspace


def _path_err(message: str) -> JSONResponse:
    return JSONResponse(
        status_code=403,
        content={"error_code": "path_outside_workspace", "message": message, "detail": None},
    )


def _not_found(path: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"error_code": "file_not_found", "message": f"No such file: {path}", "detail": None},
    )


@router.post("/read", response_model=FileReadResponse)
async def file_read(body: FileReadRequest, request: Request) -> JSONResponse:
    """Read a text file from the workspace.

    Returns 415 if the file contains binary data (null bytes in first 8 KB).
    Returns 403 for path-escape attempts, 404 if the file is absent.
    """
    try:
        resolved = resolve_in_workspace(body.path, _workspace(request))
    except PathOutsideWorkspaceError as exc:
        return _path_err(str(exc))

    if not resolved.exists():
        return _not_found(body.path)

    if not resolved.is_file():
        return JSONResponse(
            status_code=404,
            content={"error_code": "file_not_found", "message": f"Not a file: {body.path}", "detail": None},
        )

    raw = resolved.read_bytes()
    if b"\x00" in raw[:_BINARY_SNIFF_BYTES]:
        return JSONResponse(
            status_code=415,
            content={
                "error_code": "binary_file_not_supported_yet",
                "message": f"File '{body.path}' appears to be binary.",
                "detail": None,
            },
        )

    st = resolved.stat()
    return JSONResponse(
        content={
            "path": body.path,
            "content": raw.decode("utf-8", errors="replace"),
            "size": st.st_size,
            "mtime": st.st_mtime,
            "is_text": True,
        }
    )


@router.post("/write", response_model=FileWriteResponse)
async def file_write(body: FileWriteRequest, request: Request) -> JSONResponse:
    """Write (overwrite) a text file in the workspace."""
    try:
        resolved = resolve_in_workspace(body.path, _workspace(request))
    except PathOutsideWorkspaceError as exc:
        return _path_err(str(exc))

    created = not resolved.exists()
    if body.create_dirs:
        resolved.parent.mkdir(parents=True, exist_ok=True)

    encoded = body.content.encode("utf-8")
    resolved.write_bytes(encoded)

    return JSONResponse(
        content={
            "path": body.path,
            "bytes_written": len(encoded),
            "created": created,
        }
    )


@router.post("/delete", response_model=FileDeleteResponse)
async def file_delete(body: FileDeleteRequest, request: Request) -> JSONResponse:
    """Delete a file from the workspace."""
    try:
        resolved = resolve_in_workspace(body.path, _workspace(request))
    except PathOutsideWorkspaceError as exc:
        return _path_err(str(exc))

    if not resolved.exists():
        return _not_found(body.path)

    resolved.unlink()
    return JSONResponse(content={"path": body.path, "deleted": True})


@router.post("/list", response_model=FileListResponse)
async def file_list(body: FileListRequest, request: Request) -> JSONResponse:
    """List entries in a workspace folder."""
    try:
        resolved = resolve_in_workspace(body.path, _workspace(request))
    except PathOutsideWorkspaceError as exc:
        return _path_err(str(exc))

    if not resolved.exists():
        return _not_found(body.path)

    if not resolved.is_dir():
        return JSONResponse(
            status_code=404,
            content={"error_code": "file_not_found", "message": f"Not a directory: {body.path}", "detail": None},
        )

    entries: list[dict] = []
    if body.recursive:
        for root, dirs, files in os.walk(resolved):
            root_path = Path(root)
            for name in sorted(dirs + files):
                full = root_path / name
                st = full.stat()
                entries.append({
                    "name": str(full.relative_to(resolved)),
                    "type": "directory" if full.is_dir() else "file",
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                })
    else:
        for item in sorted(resolved.iterdir()):
            st = item.stat()
            entries.append({
                "name": item.name,
                "type": "directory" if item.is_dir() else "file",
                "size": st.st_size,
                "mtime": st.st_mtime,
            })

    return JSONResponse(content={"path": body.path, "entries": entries})
