"""Tests for POST /curl/fetch using httpx MockTransport."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from httpx import AsyncClient, Response


def _mock_response(
    status: int = 200,
    body: str = "hello",
    content_type: str = "text/plain",
) -> Response:
    """Return a synthetic httpx Response."""
    return Response(
        status_code=status,
        headers={"content-type": content_type},
        text=body,
    )


@pytest.mark.asyncio
async def test_curl_get_success(client: AsyncClient) -> None:
    """A successful GET returns status, headers, body."""
    mock_resp = _mock_response(200, "world", "text/plain")

    with patch("sgraph_bridge.routes.curl.httpx.AsyncClient") as MockClient:
        instance = MagicMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.request = AsyncMock(return_value=mock_resp)
        MockClient.return_value = instance

        resp = await client.post(
            "/curl/fetch", json={"url": "http://example.com/"}
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == 200
    assert data["body"] == "world"
    assert data["content_type"] == "text/plain"
    assert data["url"] == "http://example.com/"
    assert "duration_ms" in data


@pytest.mark.asyncio
async def test_curl_failure_returns_502(client: AsyncClient) -> None:
    """A network error returns 502 curl_failed."""
    with patch("sgraph_bridge.routes.curl.httpx.AsyncClient") as MockClient:
        instance = MagicMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.request = AsyncMock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        MockClient.return_value = instance

        resp = await client.post(
            "/curl/fetch", json={"url": "http://unreachable.invalid/"}
        )

    assert resp.status_code == 502
    data = resp.json()
    assert data["error_code"] == "curl_failed"


@pytest.mark.asyncio
async def test_curl_post_with_body(client: AsyncClient) -> None:
    """POST with a body is forwarded to the upstream."""
    mock_resp = _mock_response(201, '{"id":1}', "application/json")

    with patch("sgraph_bridge.routes.curl.httpx.AsyncClient") as MockClient:
        instance = MagicMock()
        instance.__aenter__ = AsyncMock(return_value=instance)
        instance.__aexit__ = AsyncMock(return_value=False)
        instance.request = AsyncMock(return_value=mock_resp)
        MockClient.return_value = instance

        resp = await client.post(
            "/curl/fetch",
            json={
                "url": "http://api.example.com/items",
                "method": "POST",
                "body": '{"name":"test"}',
                "headers": {"Content-Type": "application/json"},
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == 201
    assert data["content_type"] == "application/json"
