"""Tests for POST /bash/exec."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_bash_echo(client: AsyncClient) -> None:
    """A simple echo command returns exit_code=0 and the expected stdout."""
    resp = await client.post(
        "/bash/exec", json={"command": "echo hello"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["exit_code"] == 0
    assert "hello" in data["stdout"]
    assert data["truncated"] is False


@pytest.mark.asyncio
async def test_bash_exit_code(client: AsyncClient) -> None:
    """A failing command returns a non-zero exit_code."""
    resp = await client.post(
        "/bash/exec", json={"command": "exit 42"}
    )
    assert resp.status_code == 200
    assert resp.json()["exit_code"] == 42


@pytest.mark.asyncio
async def test_bash_stderr(client: AsyncClient) -> None:
    """stderr output is captured separately from stdout."""
    resp = await client.post(
        "/bash/exec",
        json={"command": "echo out; echo err >&2"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "out" in data["stdout"]
    assert "err" in data["stderr"]


@pytest.mark.asyncio
async def test_bash_timeout(client: AsyncClient) -> None:
    """A command that exceeds timeout_s returns 408."""
    resp = await client.post(
        "/bash/exec",
        json={"command": "sleep 60", "timeout_s": 1},
        timeout=10.0,
    )
    assert resp.status_code == 408
    data = resp.json()
    assert data["error_code"] == "bash_timeout"


@pytest.mark.asyncio
async def test_bash_truncation(client: AsyncClient) -> None:
    """stdout larger than MAX_OUTPUT_BYTES is truncated and truncated=true."""
    # Generate ~210 KB of output (beyond the 200 KB cap).
    cmd = "python3 -c \"print('x' * 1024, end='')\" | " + \
          "python3 -c \"import sys; [print(sys.stdin.read()) for _ in range(210)]\""
    resp = await client.post(
        "/bash/exec",
        json={"command": "yes | head -c 220000"},
        timeout=30.0,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["truncated"] is True
    # stdout must be capped at 200 KB (204800 bytes, decoded as str).
    assert len(data["stdout"].encode()) <= 204800


@pytest.mark.asyncio
async def test_bash_duration_ms(client: AsyncClient) -> None:
    """duration_ms must be a non-negative integer."""
    resp = await client.post("/bash/exec", json={"command": "true"})
    assert resp.status_code == 200
    assert resp.json()["duration_ms"] >= 0
