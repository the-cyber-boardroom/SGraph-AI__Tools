"""Round-trip tests for /file/{read,write,delete,list}."""

from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient


# ---------------------------------------------------------------------------
# Write → Read round-trip
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_write_and_read_file(client: AsyncClient) -> None:
    """Writing then reading a file returns the same content."""
    content = "Hello, SGraph!\nLine 2."

    # Write
    wr = await client.post(
        "/file/write", json={"path": "hello.txt", "content": content}
    )
    assert wr.status_code == 200
    wd = wr.json()
    assert wd["path"] == "hello.txt"
    assert wd["bytes_written"] == len(content.encode())
    assert wd["created"] is True

    # Read
    rr = await client.post("/file/read", json={"path": "hello.txt"})
    assert rr.status_code == 200
    rd = rr.json()
    assert rd["content"] == content
    assert rd["is_text"] is True


@pytest.mark.asyncio
async def test_write_creates_dirs(client: AsyncClient) -> None:
    """create_dirs=True should create intermediate directories."""
    resp = await client.post(
        "/file/write",
        json={"path": "subdir/nested/file.txt", "content": "nested", "create_dirs": True},
    )
    assert resp.status_code == 200
    assert resp.json()["created"] is True


@pytest.mark.asyncio
async def test_overwrite_marks_created_false(
    client: AsyncClient, tmp_workspace: Path
) -> None:
    """Overwriting an existing file must set created=False."""
    (tmp_workspace / "existing.txt").write_text("original")
    resp = await client.post(
        "/file/write", json={"path": "existing.txt", "content": "updated"}
    )
    assert resp.status_code == 200
    assert resp.json()["created"] is False


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_file(client: AsyncClient, tmp_workspace: Path) -> None:
    """Deleting an existing file returns deleted=True and it's gone."""
    target = tmp_workspace / "todelete.txt"
    target.write_text("bye")

    resp = await client.post("/file/delete", json={"path": "todelete.txt"})
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    assert not target.exists()


@pytest.mark.asyncio
async def test_delete_missing_returns_404(client: AsyncClient) -> None:
    """Deleting a non-existent file returns 404."""
    resp = await client.post("/file/delete", json={"path": "ghost.txt"})
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "file_not_found"


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_directory(client: AsyncClient, tmp_workspace: Path) -> None:
    """Listing a directory returns all its entries."""
    (tmp_workspace / "a.txt").write_text("a")
    (tmp_workspace / "b.txt").write_text("b")
    (tmp_workspace / "subdir").mkdir()

    resp = await client.post("/file/list", json={"path": "."})
    assert resp.status_code == 200
    data = resp.json()
    names = {e["name"] for e in data["entries"]}
    assert "a.txt" in names
    assert "b.txt" in names
    assert "subdir" in names


@pytest.mark.asyncio
async def test_list_recursive(client: AsyncClient, tmp_workspace: Path) -> None:
    """Recursive listing includes files in sub-directories."""
    sub = tmp_workspace / "deep"
    sub.mkdir()
    (sub / "inner.txt").write_text("deep")

    resp = await client.post(
        "/file/list", json={"path": ".", "recursive": True}
    )
    assert resp.status_code == 200
    names = {e["name"] for e in resp.json()["entries"]}
    assert any("inner.txt" in n for n in names)


@pytest.mark.asyncio
async def test_list_missing_dir_returns_404(client: AsyncClient) -> None:
    """Listing a non-existent directory returns 404."""
    resp = await client.post("/file/list", json={"path": "no_such_dir"})
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "file_not_found"


# ---------------------------------------------------------------------------
# Binary detection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_read_binary_returns_415(
    client: AsyncClient, tmp_workspace: Path
) -> None:
    """Reading a binary file (with null bytes) returns 415."""
    binary_file = tmp_workspace / "binary.bin"
    binary_file.write_bytes(b"\x00\x01\x02\x03binary data")

    resp = await client.post("/file/read", json={"path": "binary.bin"})
    assert resp.status_code == 415
    assert resp.json()["error_code"] == "binary_file_not_supported_yet"


# ---------------------------------------------------------------------------
# 404 on read
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_read_missing_returns_404(client: AsyncClient) -> None:
    """Reading a non-existent file returns 404."""
    resp = await client.post("/file/read", json={"path": "missing.txt"})
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "file_not_found"
