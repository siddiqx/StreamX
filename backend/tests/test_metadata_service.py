"""Unit and integration tests for MetadataService with mock TMDB provider."""

from unittest.mock import AsyncMock, patch
import pytest
from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import Media, MetadataEntity, MetadataStatus
from app.services.metadata_providers.base import CandidateMatch, CanonicalMetadata
from app.services.metadata_service import MetadataService


@pytest.fixture
async def setup_db():
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
async def test_enrich_movie_success(setup_db):
    service = MetadataService()

    # Create test media
    async with AsyncSessionLocal() as session:
        m = Media(
            drive_file_id="drive_test_interstellar_1",
            filename="Interstellar.2014.1080p.BluRay.x264.mkv",
            size=12345678,
            mime_type="video/mp4",
            category="Movies",
        )
        session.add(m)
        await session.commit()
        await session.refresh(m)
        m_id = m.id

    mock_candidate = CandidateMatch(
        provider="tmdb",
        provider_id="157336",
        title="Interstellar",
        media_type="movie",
        release_date="2014-11-05",
        release_year=2014,
        overview="A team of explorers travel through a wormhole in space...",
        poster_path="/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
        backdrop_path="/xJHokMbljvjADYdit5fK5VQsXEG.jpg",
        rating=8.4,
    )
    mock_details = CanonicalMetadata(
        provider="tmdb",
        provider_id="157336",
        media_type="movie",
        title="Interstellar",
        original_title="Interstellar",
        release_date="2014-11-05",
        release_year=2014,
        overview="A team of explorers travel through a wormhole in space...",
        poster_path="/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
        backdrop_path="/xJHokMbljvjADYdit5fK5VQsXEG.jpg",
        rating=8.4,
        runtime=169,
        genres=["Adventure", "Drama", "Science Fiction"],
    )

    with patch.object(service.provider, "is_configured", return_value=True), \
         patch.object(service.provider, "search", new_callable=AsyncMock) as mock_search, \
         patch.object(service.provider, "get_details", new_callable=AsyncMock) as mock_details_call:

        mock_search.return_value = [mock_candidate]
        mock_details_call.return_value = mock_details

        result = await service.process_media_metadata(m_id)
        assert result is True

    async with AsyncSessionLocal() as session:
        updated = await session.get(Media, m_id)
        assert updated.metadata_status == MetadataStatus.MATCHED
        assert updated.metadata_confidence >= 0.85
        assert updated.metadata_entity_id is not None
        assert "gEU2QniE6E77NI6lCU6MxlNBvIx.jpg" in (updated.poster_url or "")

        entity = await session.get(MetadataEntity, updated.metadata_entity_id)
        assert entity.title == "Interstellar"
        assert entity.release_year == 2014
        assert entity.runtime == 169


@pytest.mark.asyncio
async def test_entity_deduplication_and_caching(setup_db):
    service = MetadataService()

    # Create two media files representing same movie (1080p and 2160p)
    async with AsyncSessionLocal() as session:
        m1 = Media(
            drive_file_id="drive_test_1080p",
            filename="Interstellar.2014.1080p.mkv",
            size=1000,
            mime_type="video/mp4",
        )
        m2 = Media(
            drive_file_id="drive_test_2160p",
            filename="Interstellar.2014.2160p.mkv",
            size=2000,
            mime_type="video/mp4",
        )
        session.add_all([m1, m2])
        await session.commit()
        await session.refresh(m1)
        await session.refresh(m2)
        id1, id2 = m1.id, m2.id

    mock_candidate = CandidateMatch(
        provider="tmdb",
        provider_id="157336",
        title="Interstellar",
        media_type="movie",
        release_year=2014,
        poster_path="/poster.jpg",
    )
    mock_details = CanonicalMetadata(
        provider="tmdb",
        provider_id="157336",
        media_type="movie",
        title="Interstellar",
        release_year=2014,
        poster_path="/poster.jpg",
    )

    with patch.object(service.provider, "is_configured", return_value=True), \
         patch.object(service.provider, "search", new_callable=AsyncMock, return_value=[mock_candidate]), \
         patch.object(service.provider, "get_details", new_callable=AsyncMock, return_value=mock_details):

        await service.process_media_metadata(id1)
        await service.process_media_metadata(id2)

    async with AsyncSessionLocal() as session:
        item1 = await session.get(Media, id1)
        item2 = await session.get(Media, id2)

        # Both must link to the exact same MetadataEntity row!
        assert item1.metadata_entity_id == item2.metadata_entity_id

        # Total metadata_entities table count should be 1
        count = (await session.execute(select(MetadataEntity))).scalars().all()
        assert len(count) == 1


@pytest.mark.asyncio
async def test_manual_lock_prevents_overwrite(setup_db):
    service = MetadataService()

    async with AsyncSessionLocal() as session:
        m = Media(
            drive_file_id="drive_locked_test",
            filename="Custom.Title.2020.mkv",
            size=1000,
            mime_type="video/mp4",
            metadata_locked=True,
            metadata_status=MetadataStatus.MANUAL,
        )
        session.add(m)
        await session.commit()
        await session.refresh(m)
        m_id = m.id

    with patch.object(service.provider, "search", new_callable=AsyncMock) as mock_search:
        result = await service.process_media_metadata(m_id)
        assert result is True
        mock_search.assert_not_called()

    async with AsyncSessionLocal() as session:
        item = await session.get(Media, m_id)
        assert item.metadata_locked is True
        assert item.metadata_status == MetadataStatus.MANUAL
