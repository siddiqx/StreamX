"""Tests for StreamX Media Library API."""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import Media
from app.main import app


@pytest.fixture
async def clean_media_db():
    await init_db()
    async with AsyncSessionLocal() as session:
        items = (await session.execute(select(Media).where(Media.drive_file_id.like("test_%")))).scalars().all()
        for item in items:
            await session.delete(item)
        await session.commit()
    yield
    async with AsyncSessionLocal() as session:
        items = (await session.execute(select(Media).where(Media.drive_file_id.like("test_%")))).scalars().all()
        for item in items:
            await session.delete(item)
        await session.commit()



@pytest.mark.asyncio
async def test_media_catalog_and_search_api(clean_media_db):
    # Insert test media items
    async with AsyncSessionLocal() as session:
        m1 = Media(
            drive_file_id="test_drive_file_interstellar",
            filename="Interstellar.2014.1080p.mkv",
            size=13314398621,
            mime_type="video/x-matroska",
            category="Movies",
        )
        m2 = Media(
            drive_file_id="test_drive_file_frieren",
            filename="Frieren.S01E01.1080p.mkv",
            size=1450000000,
            mime_type="video/x-matroska",
            category="Anime",
        )
        session.add_all([m1, m2])
        await session.commit()
        await session.refresh(m1)
        m1_id = m1.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Test listing all media
        res = await client.get("/media")
        assert res.status_code == 200
        data = res.json()
        assert len(data) >= 2

        # Test filtering by category
        res_movies = await client.get("/media?category=Movies")
        assert res_movies.status_code == 200
        movies_data = res_movies.json()
        assert len(movies_data) == 1
        assert movies_data[0]["filename"] == "Interstellar.2014.1080p.mkv"

        # Test searching
        res_search = await client.get("/media/search?q=Frieren")
        assert res_search.status_code == 200
        search_data = res_search.json()
        assert len(search_data) == 1
        assert search_data[0]["category"] == "Anime"

        # Test categories summary
        res_cat = await client.get("/media/categories")
        assert res_cat.status_code == 200
        categories = res_cat.json()
        assert any(c["category"] == "Movies" and c["count"] == 1 for c in categories)
        assert any(c["category"] == "Anime" and c["count"] == 1 for c in categories)

        # Test single item
        res_single = await client.get(f"/media/{m1_id}")
        assert res_single.status_code == 200
        assert res_single.json()["drive_file_id"] == "test_drive_file_interstellar"
