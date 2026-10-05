"""Tests for StreamX Media Streaming and Download Endpoints."""

import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import Media
from app.main import app


@pytest.fixture
async def sample_media():
    await init_db()
    async with AsyncSessionLocal() as session:
        m = Media(
            drive_file_id="test_stream_file_id",
            filename="test_video.mp4",
            size=1048576,
            mime_type="video/mp4",
            category="Movies",
        )
        session.add(m)
        await session.commit()
        await session.refresh(m)
        media_id = m.id

    yield media_id

    async with AsyncSessionLocal() as session:
        item = await session.get(Media, media_id)
        if item:
            await session.delete(item)
            await session.commit()


@pytest.mark.asyncio
async def test_stream_and_download_endpoints(sample_media):
    mock_client = AsyncMock()
    mock_res = AsyncMock()
    mock_res.status_code = 206
    mock_res.headers = {
        "Content-Range": "bytes 0-1023/1048576",
        "Content-Length": "1024",
    }

    async def fake_aiter_bytes(chunk_size=65536):
        yield b"X" * 1024

    mock_res.aiter_bytes = fake_aiter_bytes
    mock_res.aclose = AsyncMock()
    mock_client.aclose = AsyncMock()

    with patch(
        "app.api.media.drive_service.get_download_stream",
        return_value=(mock_client, mock_res),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Test stream endpoint
            res_stream = await client.get(
                f"/media/{sample_media}/stream",
                headers={"Range": "bytes=0-1023"},
            )
            assert res_stream.status_code == 206
            assert res_stream.headers["Content-Range"] == "bytes 0-1023/1048576"
            assert res_stream.headers["Accept-Ranges"] == "bytes"
            assert len(res_stream.content) == 1024

            # 2. Test download endpoint
            res_download = await client.get(
                f"/media/{sample_media}/download",
                headers={"Range": "bytes=0-1023"},
            )
            assert res_download.status_code == 206
            assert "attachment" in res_download.headers["Content-Disposition"]
            assert len(res_download.content) == 1024
