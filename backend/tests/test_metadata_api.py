"""Tests for Metadata API endpoints."""

from unittest.mock import AsyncMock, patch
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import Media, MetadataEntity, MetadataStatus
from app.main import app
from app.services.metadata_providers.base import CandidateMatch, CanonicalMetadata


@pytest.fixture
async def clean_db():
    await init_db()
    yield
    async with AsyncSessionLocal() as session:
        medias = (await session.execute(select(Media))).scalars().all()
        for m in medias:
            await session.delete(m)
        entities = (await session.execute(select(MetadataEntity))).scalars().all()
        for e in entities:
            await session.delete(e)
        await session.commit()


@pytest.mark.asyncio
async def test_get_media_with_canonical_metadata(clean_db):
    async with AsyncSessionLocal() as session:
        entity = MetadataEntity(
            provider="tmdb",
            provider_id="157336",
            media_type="movie",
            title="Interstellar",
            release_year=2014,
            rating=8.4,
            runtime=169,
            genres_json='["Science Fiction", "Drama"]',
        )
        session.add(entity)
        await session.flush()

        media = Media(
            drive_file_id="drive_api_test_1",
            filename="Interstellar.2014.1080p.mkv",
            size=1000,
            mime_type="video/mp4",
            metadata_entity_id=entity.id,
            metadata_status=MetadataStatus.MATCHED,
            metadata_confidence=0.98,
        )
        session.add(media)
        await session.commit()
        await session.refresh(media)
        media_id = media.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(f"/media/{media_id}")
        assert res.status_code == 200
        data = res.json()
        assert data["id"] == media_id
        assert data["metadata_status"] == "MATCHED"
        assert data["canonical_metadata"] is not None
        assert data["canonical_metadata"]["title"] == "Interstellar"
        assert data["canonical_metadata"]["release_year"] == 2014
        assert "Science Fiction" in data["canonical_metadata"]["genres"]


@pytest.mark.asyncio
async def test_search_media_by_canonical_title(clean_db):
    async with AsyncSessionLocal() as session:
        entity = MetadataEntity(
            provider="tmdb",
            provider_id="157336",
            media_type="movie",
            title="Interstellar",
            original_title="Interstellar",
        )
        session.add(entity)
        await session.flush()

        media = Media(
            drive_file_id="drive_raw_filename_test",
            filename="x264_scene_rls_001.mkv",  # raw filename doesn't contain interstellar
            size=1000,
            mime_type="video/mp4",
            metadata_entity_id=entity.id,
            metadata_status=MetadataStatus.MATCHED,
        )
        session.add(media)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Search by "Interstellar" should match even though filename is x264_scene_rls_001.mkv!
        res = await client.get("/media/search?q=Interstellar")
        assert res.status_code == 200
        results = res.json()
        assert len(results) >= 1
        assert results[0]["filename"] == "x264_scene_rls_001.mkv"
        assert results[0]["canonical_metadata"]["title"] == "Interstellar"


@pytest.mark.asyncio
async def test_metadata_stats_endpoint(clean_db):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/metadata/stats")
        assert res.status_code == 200
        stats = res.json()
        assert "total_media" in stats
        assert "match_percentage" in stats
