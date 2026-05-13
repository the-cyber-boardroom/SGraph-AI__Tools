"""GET /ping — health-check endpoint."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from sgraph_bridge.config import VERSION
from sgraph_bridge.models import PingResponse

router = APIRouter()


@router.get("/ping", response_model=PingResponse)
async def ping(request: Request) -> JSONResponse:
    """Return service health, version, workspace path, and start time."""
    return JSONResponse(
        content={
            "ok": True,
            "version": VERSION,
            "workspace": str(request.app.state.workspace),
            "started_at": request.app.state.started_at,
        }
    )
