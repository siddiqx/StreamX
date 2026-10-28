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

            # 3. Test HEAD probe on stream endpoint (essential for VLC & browser preflight)
            res_head = await client.head(f"/media/{sample_media}/stream")
            assert res_head.status_code == 200
            assert res_head.headers["Accept-Ranges"] == "bytes"
            assert res_head.headers["Content-Length"] == "1048576"


@pytest.mark.asyncio
async def test_unicode_filename_stream_and_m3u():
    """Verify that filenames containing non-Latin1 characters (e.g. \u232f) stream and generate M3U without UnicodeEncodeError."""
    await init_db()
    async with AsyncSessionLocal() as session:
        m = Media(
            drive_file_id="test_unicode_drive_id",
            filename="[AH] Fragrant Flower S1-E07 [720p \u232f Sub] @Animes_Horizon.mkv",
            size=1048576,
            mime_type="video/x-matroska",
            category="Anime",
        )
        session.add(m)
        await session.commit()
        await session.refresh(m)
        media_id = m.id

    try:
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
                # 1. Stream endpoint should not crash with UnicodeEncodeError
                res_stream = await client.get(
                    f"/media/{media_id}/stream",
                    headers={"Range": "bytes=0-1023"},
                )
                assert res_stream.status_code == 206
                assert "inline" in res_stream.headers["Content-Disposition"]

                # 2. M3U playlist endpoint should succeed with 200 OK
                res_m3u = await client.get(f"/media/{media_id}/playlist.m3u")
                assert res_m3u.status_code == 200
                assert "attachment" in res_m3u.headers["Content-Disposition"]
                assert f"/media/{media_id}/stream" in res_m3u.text
    finally:
        async with AsyncSessionLocal() as session:
            item = await session.get(Media, media_id)
            if item:
                await session.delete(item)
                await session.commit()


@pytest.mark.asyncio
async def test_apostrophe_and_special_char_m3u_stream():
    """Verify that filenames containing apostrophes (e.g. Komi can't communicate) generate valid M3Us and stream headers."""
    await init_db()
    async with AsyncSessionLocal() as session:
        m = Media(
            drive_file_id="test_komi_drive_id",
            filename="S01_01_komi_can't_communicate_Dual_1080p_@XANIME_UNIVERSE.mkv",
            size=276617088,
            mime_type="video/x-matroska",
            category="Anime",
        )
        session.add(m)
        await session.commit()
        await session.refresh(m)
        media_id = m.id

    try:
        mock_client = AsyncMock()
        mock_res = AsyncMock()
        mock_res.status_code = 206
        mock_res.headers = {
            "Content-Range": "bytes 0-1023/276617088",
            "Content-Length": "1024",
        }

        async def fake_aiter(chunk_size=65536):
            yield b"K" * 1024

        mock_res.aiter_bytes = fake_aiter
        mock_res.aclose = AsyncMock()
        mock_client.aclose = AsyncMock()

        with patch(
            "app.api.media.drive_service.get_download_stream",
            return_value=(mock_client, mock_res),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                # 1. Stream endpoint
                res_stream = await client.get(
                    f"/media/{media_id}/stream",
                    headers={"Range": "bytes=0-1023"},
                )
                assert res_stream.status_code == 206
                # Header must strictly percent-encode apostrophes as %27 to prevent RFC 5987 triple-quote corruption
                cd = res_stream.headers["Content-Disposition"]
                assert "%27" in cd

                # 2. M3U playlist endpoint
                res_m3u = await client.get(f"/media/{media_id}/playlist.m3u")
                assert res_m3u.status_code == 200
                m3u_text = res_m3u.text
                # M3U stream URL must have %27 for apostrophe
                assert "%27" in m3u_text
                # Must contain low-latency caching hints for VLC
                assert "network-caching=3000" in m3u_text
                assert "demux=avformat" in m3u_text
                assert "http-reconnect=true" in m3u_text
    finally:
        async with AsyncSessionLocal() as session:
            item = await session.get(Media, media_id)
            if item:
                await session.delete(item)
                await session.commit()

