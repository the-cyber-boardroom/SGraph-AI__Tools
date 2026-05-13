"""FastAPI application entry-point for sgraph_bridge."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sgraph_bridge.config import VERSION, WORKSPACE
from sgraph_bridge.routes import bash, curl, files, ping

# ---------------------------------------------------------------------------
# CORS — whitelist tools.sgraph.ai + localhost variants.
# Wildcard on port for localhost/127.0.0.1 is handled by allow_origin_regex.
# ---------------------------------------------------------------------------

_CORS_ORIGINS = [
    "https://tools.sgraph.ai",
]

_CORS_REGEX = r"http://(localhost|127\.0\.0\.1)(:\d+)?"


# ---------------------------------------------------------------------------
# Lifespan — sets up workspace directory and app.state
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create workspace dir if absent; populate app.state."""
    ws = Path(os.environ.get("SGRAPH_WORKSPACE", str(WORKSPACE)))
    ws.mkdir(parents=True, exist_ok=True)

    app.state.workspace = ws
    app.state.started_at = datetime.now(timezone.utc).isoformat()

    yield  # serve requests

    # Clean-up (none needed in v0.1.0)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SGraph Local Bridge",
    version=VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_origin_regex=_CORS_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

app.include_router(ping.router)
app.include_router(files.router)
app.include_router(bash.router)
app.include_router(curl.router)
