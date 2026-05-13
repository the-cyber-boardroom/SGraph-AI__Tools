"""Tests for GET /ping."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_ping_ok(client: AsyncClient) -> None:
    """GET /ping should return ok=true with version and workspace."""
    resp = await client.get("/ping")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["version"] == "0.1.0"
    assert "workspace" in data
    assert "started_at" in data


@pytest.mark.asyncio
async def test_ping_workspace_path(client: AsyncClient, tmp_workspace) -> None:
    """GET /ping should reflect the app.state.workspace path."""
    resp = await client.get("/ping")
    data = resp.json()
    assert str(tmp_workspace) in data["workspace"]
