"""Unit tests for watch progress persistence, sync, and security hardening."""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from datetime import datetime, timezone, timedelta
from sqlalchemy import select

from app.main import app
from app.db.database import init_db, AsyncSessionLocal
from app.db.models import Media, WatchProgress


@pytest_asyncio.fixture(autouse=True)
async def setup_test_db():
    await init_db()
    async with AsyncSessionLocal() as session:
        for model in (WatchProgress, Media):
            try:
                items = (await session.execute(select(model))).scalars().all()
                for it in items:
                    await session.delete(it)
            except Exception:
                pass
        await session.commit()
    yield
    async with AsyncSessionLocal() as session:
        for model in (WatchProgress, Media):
            try:
                items = (await session.execute(select(model))).scalars().all()
                for it in items:
                    await session.delete(it)
            except Exception:
                pass
        await session.commit()


@pytest.mark.asyncio
async def test_watch_progress_crud_and_bulk_sync():
    async with AsyncSessionLocal() as session:
        media1 = Media(
            drive_file_id="drive_file_001",
            filename="Inception.2010.1080p.mkv",
            size=1024 * 1024 * 500,
            mime_type="video/x-matroska",
            category="Movies",
        )
        media2 = Media(
            drive_file_id="drive_file_002",
            filename="Attack.on.Titan.S01E01.mkv",
            size=1024 * 1024 * 300,
            mime_type="video/x-matroska",
            category="Anime",
        )
        session.add_all([media1, media2])
        await session.commit()
        await session.refresh(media1)
        await session.refresh(media2)
        m1_id = media1.id
        m2_id = media2.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Save progress for media 1
        res = await client.post("/media/watch-progress", json={
            "media_id": m1_id,
            "progress_seconds": 1800,
            "duration_seconds": 7200,
            "progress_percentage": 25,
            "completed": False,
        })
        assert res.status_code == 200
        data = res.json()
        assert data["media_id"] == m1_id
        assert data["progress_seconds"] == 1800
        assert data["progress_percentage"] == 25
        assert data["completed"] is False

        # 2. Retrieve all watch progress
        res_get = await client.get("/media/watch-progress")
        assert res_get.status_code == 200
        records = res_get.json()
        assert len(records) == 1
        assert records[0]["media_id"] == m1_id

        # 3. Bulk sync with client
        now = datetime.now(timezone.utc)
        sync_payload = [
            {
                "media_id": m1_id,
                "progress_seconds": 7000,
                "duration_seconds": 7200,
                "progress_percentage": 97,
                "completed": True,
                "last_watched_at": now.isoformat(),
            },
            {
                "media_id": m2_id,
                "progress_seconds": 600,
                "duration_seconds": 1440,
                "progress_percentage": 42,
                "completed": False,
                "last_watched_at": (now - timedelta(minutes=5)).isoformat(),
            }
        ]
        res_sync = await client.post("/media/watch-progress/sync", json=sync_payload)
        assert res_sync.status_code == 200
        synced_records = res_sync.json()
        assert len(synced_records) == 2

        # Verify m1 is updated to completed
        m1_synced = next(r for r in synced_records if r["media_id"] == m1_id)
        assert m1_synced["completed"] is True
        assert m1_synced["progress_percentage"] == 97

        # 4. Delete / reset watch progress for media 1
        res_del = await client.delete(f"/media/{m1_id}/watch-progress")
        assert res_del.status_code == 200

        res_final = await client.get("/media/watch-progress")
        assert res_final.status_code == 200
        remaining = res_final.json()
        assert len(remaining) == 1
        assert remaining[0]["media_id"] == m2_id


@pytest.mark.asyncio
async def test_image_proxy_ssrf_protection():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Attacker tries arbitrary external domain
        res_evil = await client.get("/media/image-proxy?url=https://evil.com/malicious.jpg")
        assert res_evil.status_code == 400
        assert "Only official TMDB or AniList images" in res_evil.json()["detail"]

        # Attacker tries localhost / loopback SSRF
        res_local = await client.get("/media/image-proxy?url=http://127.0.0.1:8000/media")
        assert res_local.status_code == 400

        # Attacker tries AWS metadata service IP
        res_aws = await client.get("/media/image-proxy?url=http://169.254.169.254/latest/meta-data/")
        assert res_aws.status_code == 400

        # Attacker tries subdomain spoofing
        res_spoof = await client.get("/media/image-proxy?url=https://image.tmdb.org.attacker.com/evil.jpg")
        assert res_spoof.status_code == 400

        # Attacker tries file scheme
        res_file = await client.get("/media/image-proxy?url=file:///etc/passwd")
        assert res_file.status_code == 400
