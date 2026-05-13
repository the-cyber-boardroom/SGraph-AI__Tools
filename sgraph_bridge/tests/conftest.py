"""Shared pytest fixtures for sgraph_bridge tests."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from sgraph_bridge.main import app


@pytest.fixture
def tmp_workspace(tmp_path: Path) -> Path:
    """Return a temporary directory to use as the workspace."""
    ws = tmp_path / "workspace"
    ws.mkdir()
    return ws


@pytest_asyncio.fixture
async def client(tmp_workspace: Path):
    """Async HTTP client wired to the FastAPI app with a tmp workspace."""
    # Patch app.state before each test so routes see the temp workspace.
    app.state.workspace = tmp_workspace
    app.state.started_at = datetime.now(timezone.utc).isoformat()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
