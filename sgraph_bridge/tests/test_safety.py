"""Tests for path-safety enforcement across all file endpoints.

Every test that supplies a path designed to escape the workspace must
receive a 403 response with error_code 'path_outside_workspace'.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Helper — POST /file/read with a crafted path
# ---------------------------------------------------------------------------

async def _read(client: AsyncClient, path: str) -> dict:
    resp = await client.post("/file/read", json={"path": path})
    return resp.status_code, resp.json()


# ---------------------------------------------------------------------------
# Basic traversal
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_dotdot_traversal_returns_403(client: AsyncClient) -> None:
    """'../escape' must be rejected with 403."""
    status, data = await _read(client, "../escape")
    assert status == 403
    assert data["error_code"] == "path_outside_workspace"


@pytest.mark.asyncio
async def test_deep_dotdot_returns_403(client: AsyncClient) -> None:
    """'../../etc/passwd' must be rejected."""
    status, data = await _read(client, "../../etc/passwd")
    assert status == 403
    assert data["error_code"] == "path_outside_workspace"


@pytest.mark.asyncio
async def test_absolute_escape_returns_403(client: AsyncClient) -> None:
    """/etc/passwd (absolute path outside workspace) must be rejected."""
    status, data = await _read(client, "/etc/passwd")
    assert status == 403
    assert data["error_code"] == "path_outside_workspace"


# ---------------------------------------------------------------------------
# NUL byte
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_nul_byte_in_path_returns_403(client: AsyncClient) -> None:
    """A path containing a NUL byte must be rejected."""
    status, data = await _read(client, "foo\x00bar")
    assert status == 403
    assert data["error_code"] == "path_outside_workspace"


# ---------------------------------------------------------------------------
# Symlink escape
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_symlink_escape_returns_403(
    client: AsyncClient, tmp_workspace: Path
) -> None:
    """A symlink pointing outside the workspace must be rejected."""
    secret = tmp_workspace.parent / "secret.txt"
    secret.write_text("secret content")

    link = tmp_workspace / "link_to_secret"
    link.symlink_to(secret)

    status, data = await _read(client, "link_to_secret")
    # The symlink resolves outside the workspace → 403.
    assert status == 403
    assert data["error_code"] == "path_outside_workspace"


# ---------------------------------------------------------------------------
# Bash cwd escape
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_bash_cwd_escape_returns_403(client: AsyncClient) -> None:
    """A cwd of '../..' in /bash/exec must be rejected."""
    resp = await client.post(
        "/bash/exec", json={"command": "pwd", "cwd": "../.."}
    )
    assert resp.status_code == 403
    assert resp.json()["error_code"] == "path_outside_workspace"


# ---------------------------------------------------------------------------
# Write / delete path escape
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_write_escape_returns_403(client: AsyncClient) -> None:
    """Attempt to write outside workspace via /file/write must be rejected."""
    resp = await client.post(
        "/file/write", json={"path": "../../injected.txt", "content": "evil"}
    )
    assert resp.status_code == 403
    assert resp.json()["error_code"] == "path_outside_workspace"


@pytest.mark.asyncio
async def test_delete_escape_returns_403(client: AsyncClient) -> None:
    """Attempt to delete outside workspace via /file/delete must be rejected."""
    resp = await client.post(
        "/file/delete", json={"path": "../../something"}
    )
    assert resp.status_code == 403
    assert resp.json()["error_code"] == "path_outside_workspace"
