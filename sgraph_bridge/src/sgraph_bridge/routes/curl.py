"""POST /curl/fetch — fetch a URL via httpx."""

from __future__ import annotations

import time

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from sgraph_bridge.models import CurlFetchRequest, CurlFetchResponse

router = APIRouter(prefix="/curl")


@router.post("/fetch", response_model=CurlFetchResponse)
async def curl_fetch(body: CurlFetchRequest) -> JSONResponse:
    """Fetch *url* and return status, headers, and body text.

    Returns 502 ``curl_failed`` if the request cannot be completed
    (network error, DNS failure, SSL error, etc.).
    """
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            response = await client.request(
                method=body.method.upper(),
                url=body.url,
                headers=body.headers or {},
                content=body.body.encode() if body.body else None,
            )
    except httpx.HTTPError as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        return JSONResponse(
            status_code=502,
            content={
                "error_code": "curl_failed",
                "message": str(exc),
                "detail": {"duration_ms": duration_ms},
            },
        )

    duration_ms = int((time.monotonic() - t0) * 1000)
    content_type = response.headers.get("content-type", "")

    return JSONResponse(
        content={
            "url": body.url,
            "status": response.status_code,
            "headers": dict(response.headers),
            "body": response.text,
            "content_type": content_type,
            "duration_ms": duration_ms,
        }
    )
