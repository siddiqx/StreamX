"""Test for StreamX Health Endpoint (Phase 1)."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    """Verify that GET /health returns status 200 and expected payload."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data == {
            "status": "ok",
            "service": "streamx",
        }
