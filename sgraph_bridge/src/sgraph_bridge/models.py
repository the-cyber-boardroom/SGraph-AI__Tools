"""Pydantic request / response models for sgraph_bridge endpoints."""

from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Shared error envelope
# ---------------------------------------------------------------------------

class ErrorEnvelope(BaseModel):
    error_code: str
    message: str
    detail: Optional[Any] = None


# ---------------------------------------------------------------------------
# /ping
# ---------------------------------------------------------------------------

class PingResponse(BaseModel):
    ok: bool
    version: str
    workspace: str
    started_at: str


# ---------------------------------------------------------------------------
# /file/read
# ---------------------------------------------------------------------------

class FileReadRequest(BaseModel):
    path: str


class FileReadResponse(BaseModel):
    path: str
    content: str
    size: int
    mtime: float
    is_text: bool


# ---------------------------------------------------------------------------
# /file/write
# ---------------------------------------------------------------------------

class FileWriteRequest(BaseModel):
    path: str
    content: str
    create_dirs: bool = True


class FileWriteResponse(BaseModel):
    path: str
    bytes_written: int
    created: bool


# ---------------------------------------------------------------------------
# /file/delete
# ---------------------------------------------------------------------------

class FileDeleteRequest(BaseModel):
    path: str


class FileDeleteResponse(BaseModel):
    path: str
    deleted: bool


# ---------------------------------------------------------------------------
# /file/list
# ---------------------------------------------------------------------------

class FileListRequest(BaseModel):
    path: str
    recursive: bool = False


class FileEntry(BaseModel):
    name: str
    type: str   # "file" | "directory"
    size: int
    mtime: float


class FileListResponse(BaseModel):
    path: str
    entries: list[FileEntry]


# ---------------------------------------------------------------------------
# /bash/exec
# ---------------------------------------------------------------------------

class BashExecRequest(BaseModel):
    command: str
    cwd: Optional[str] = None
    timeout_s: int = 30


class BashExecResponse(BaseModel):
    command: str
    cwd: str
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    truncated: bool


# ---------------------------------------------------------------------------
# /curl/fetch
# ---------------------------------------------------------------------------

class CurlFetchRequest(BaseModel):
    url: str
    method: str = "GET"
    headers: Optional[dict[str, str]] = None
    body: Optional[str] = None


class CurlFetchResponse(BaseModel):
    url: str
    status: int
    headers: dict[str, str]
    body: str
    content_type: str
    duration_ms: int
