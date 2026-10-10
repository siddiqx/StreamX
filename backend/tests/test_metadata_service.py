"""Comprehensive tests for MetadataService covering:
- Successful movie enrichment
- TV search routing for episodic files
- Anime classification via provider genres/language
- Updating an existing incomplete metadata entity (stale entity fix)
- Job enqueue on bot download completion
- Idempotent job creation (no duplicate active jobs)
- Backfill of records missing metadata or images
- Incorrectly matched records and locked records during backfill
- API serialization of canonical title/year/overview and poster/backdrop URLs
"""

from unittest.mock import AsyncMock, patch
import pytest
from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import (
    Media, MetadataEntity, MetadataJob, MetadataJobStatus, MetadataStatus, utc_now
)
from app.services.metadata_providers.base import CandidateMatch, CanonicalMetadata
from app.services.metadata_service import MetadataService
from app.utils.image_resolver import get_media_poster_url, get_media_backdrop_url


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
async def clean_db():
    """Wipe test tables before and after every test."""
    await init_db()
    async with AsyncSessionLocal() as session:
        for table in [MetadataJob, Media, MetadataEntity]:
            rows = (await session.execute(select(table))).scalars().all()
            for r in rows:
                await session.delete(r)
        await session.commit()
    yield
    async with AsyncSessionLocal() as session:
        for table in [MetadataJob, Media, MetadataEntity]:
            rows = (await session.execute(select(table))).scalars().all()
            for r in rows:
                await session.delete(r)
        await session.commit()


async def _make_media(filename: str, **kwargs) -> int:
    """Insert a Media row and return its id."""
    defaults = dict(
        drive_file_id=f"drv_{filename[:20]}",
        size=1_000_000,
        mime_type="video/mp4",
        category="Movies",
    )
    defaults.update(kwargs)
    async with AsyncSessionLocal() as session:
        m = Media(filename=filename, **defaults)
        session.add(m)
        await session.commit()
        await session.refresh(m)
        return m.id


def _movie_candidate(tmdb_id="157336", title="Interstellar", year=2014) -> CandidateMatch:
    return CandidateMatch(
        provider="tmdb", provider_id=tmdb_id,
        title=title, media_type="movie",
        original_title=title, release_date=f"{year}-11-05", release_year=year,
        overview="A film about wormholes.",
        poster_path="/poster.jpg", backdrop_path="/backdrop.jpg",
        rating=8.4, popularity=100.0,
    )


def _movie_details(tmdb_id="157336", title="Interstellar", year=2014) -> CanonicalMetadata:
    return CanonicalMetadata(
        provider="tmdb", provider_id=tmdb_id, media_type="movie",
        title=title, original_title=title,
        release_date=f"{year}-11-05", release_year=year,
        overview="A film about wormholes.",
        poster_path="/poster.jpg", backdrop_path="/backdrop.jpg",
        rating=8.4, runtime=169,
        genres=["Adventure", "Drama", "Science Fiction"],
        raw_metadata={"id": int(tmdb_id), "original_language": "en", "origin_country": ["US"]},
    )


def _tv_candidate(tmdb_id="1396", title="Breaking Bad", year=2008) -> CandidateMatch:
    return CandidateMatch(
        provider="tmdb", provider_id=tmdb_id,
        title=title, media_type="tv",
        release_date=f"{year}-01-20", release_year=year,
        poster_path="/tvposter.jpg", backdrop_path="/tvbackdrop.jpg",
        rating=9.5, popularity=90.0,
    )


def _tv_details(tmdb_id="1396", title="Breaking Bad", year=2008) -> CanonicalMetadata:
    return CanonicalMetadata(
        provider="tmdb", provider_id=tmdb_id, media_type="tv",
        title=title, original_title=title,
        release_date=f"{year}-01-20", release_year=year,
        overview="A high school chemistry teacher...",
        poster_path="/tvposter.jpg", backdrop_path="/tvbackdrop.jpg",
        rating=9.5, runtime=47,
        genres=["Drama", "Crime"],
        raw_metadata={"id": int(tmdb_id), "original_language": "en", "origin_country": ["US"]},
    )


def _anime_details(tmdb_id="12345", title="Elfen Lied", year=2004) -> CanonicalMetadata:
    return CanonicalMetadata(
        provider="tmdb", provider_id=tmdb_id, media_type="tv",
        title=title, original_title="エルフェンリート",
        release_date=f"{year}-07-25", release_year=year,
        overview="Lucy is a special breed of human...",
        poster_path="/elfenposter.jpg", backdrop_path="/elfenbackdrop.jpg",
        rating=7.9, runtime=23,
        genres=["Animation", "Drama", "Science Fiction"],
        raw_metadata={"id": int(tmdb_id), "original_language": "ja", "origin_country": ["JP"]},
    )


# ---------------------------------------------------------------------------
# Movie enrichment
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_enrich_movie_success():
    service = MetadataService()
    mid = await _make_media("Interstellar.2014.1080p.BluRay.x264.mkv")

    with patch.object(service.provider, "is_configured", return_value=True), \
         patch.object(service.provider, "search", new_callable=AsyncMock, return_value=[_movie_candidate()]), \
         patch.object(service.provider, "get_details", new_callable=AsyncMock, return_value=_movie_details()):

        result = await service.process_media_metadata(mid)

    assert result is True
    async with AsyncSessionLocal() as session:
        m = await session.get(Media, mid)
        assert m.metadata_status == MetadataStatus.MATCHED
        assert m.metadata_confidence >= 0.85
        assert m.metadata_entity_id is not None
        assert "poster.jpg" in (m.poster_url or "")

        entity = await session.get(MetadataEntity, m.metadata_entity_id)
        assert entity.title == "Interstellar"
        assert entity.release_year == 2014
        assert entity.runtime == 169
        assert entity.poster_path == "/poster.jpg"
        assert entity.backdrop_path == "/backdrop.jpg"


# ---------------------------------------------------------------------------
# TV search routing: episodic file must call /search/tv, not /search/movie
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tv_search_routing_for_episodic_file():
    """Files with season/episode must search the tv endpoint (media_type='tv')."""
    service = MetadataService()
    mid = await _make_media("Breaking.Bad.S01E01.1080p.WEB-DL.mkv")

    search_calls = []

    async def capture_search(query, year=None, media_type="movie"):
        search_calls.append(media_type)
        return [_tv_candidate()]

    with patch.object(service.provider, "is_configured", return_value=True), \
         patch.object(service.provider, "search", side_effect=capture_search), \
         patch.object(service.provider, "get_details", new_callable=AsyncMock, return_value=_tv_details()):

        await service.process_media_metadata(mid)

    assert search_calls, "search() was never called"
    assert search_calls[0] == "tv", f"Expected TV search, got {search_calls[0]!r}"


# ---------------------------------------------------------------------------
# Anime classification from provider evidence
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_anime_classification_from_provider_genres():
    """'[] [S 01] [EP 01] [] Elfen Lied.mkv' must be classified ANIME_EPISODE, not MOVIE."""
    service = MetadataService()
    mid = await _make_media("[] [S 01] [EP 01] [] Elfen Lied.mkv")

    with patch.object(service.provider, "is_configured", return_value=True), \
         patch.object(service.provider, "search", new_callable=AsyncMock,
                      return_value=[CandidateMatch(
                          provider="tmdb", provider_id="12345",
                          title="Elfen Lied", media_type="tv",
                          release_year=2004, poster_path="/ep.jpg",
                          backdrop_path="/eb.jpg", rating=7.9, popularity=50.0,
                      )]), \
         patch.object(service.provider, "get_details", new_callable=AsyncMock,
                      return_value=_anime_details()):

        result = await service.process_media_metadata(mid)

    assert result is True
    async with AsyncSessionLocal() as session:
        m = await session.get(Media, mid)
        assert m.category == "Anime", f"Expected 'Anime', got {m.category!r}"
        assert "ANIME" in (m.media_type or ""), f"Expected ANIME taxonomy, got {m.media_type!r}"


# ---------------------------------------------------------------------------
# Stale entity update (Bug 1 fix)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_stale_entity_gets_updated():
    """An entity missing poster/backdrop must be updated when a second media item links to it."""
    service = MetadataService()

    # Pre-create a stale entity with no poster or backdrop
    async with AsyncSessionLocal() as session:
        stale_entity = MetadataEntity(
            provider="tmdb", provider_id="157336",
            media_type="movie", category="MOVIE",
            title="Interstellar",
            release_year=2014,
            # poster_path and backdrop_path intentionally absent
        )
        session.add(stale_entity)
        await session.commit()
        await session.refresh(stale_entity)
        stale_id = stale_entity.id

    mid = await _make_media("Interstellar.2014.1080p.mkv")
    full_details = _movie_details()

    with patch.object(service.provider, "is_configured", return_value=True), \
         patch.object(service.provider, "search", new_callable=AsyncMock, return_value=[_movie_candidate()]), \
         patch.object(service.provider, "get_details", new_callable=AsyncMock, return_value=full_details):

        await service.process_media_metadata(mid)

    async with AsyncSessionLocal() as session:
        entity = await session.get(MetadataEntity, stale_id)
        # Entity must now have poster and backdrop filled in
        assert entity.poster_path == "/poster.jpg", "Stale entity poster_path was not updated"
        assert entity.backdrop_path == "/backdrop.jpg", "Stale entity backdrop_path was not updated"
        assert entity.overview is not None, "Stale entity overview was not updated"


# ---------------------------------------------------------------------------
# Entity deduplication
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_entity_deduplication_and_caching():
    service = MetadataService()
    id1 = await _make_media("Interstellar.2014.1080p.mkv", drive_file_id="drv_1080p")
    id2 = await _make_media("Interstellar.2014.2160p.mkv", drive_file_id="drv_2160p")

    with patch.object(service.provider, "is_configured", return_value=True), \
         patch.object(service.provider, "search", new_callable=AsyncMock, return_value=[_movie_candidate()]), \
         patch.object(service.provider, "get_details", new_callable=AsyncMock, return_value=_movie_details()):

        await service.process_media_metadata(id1)
        await service.process_media_metadata(id2)

    async with AsyncSessionLocal() as session:
        m1 = await session.get(Media, id1)
        m2 = await session.get(Media, id2)
        assert m1.metadata_entity_id == m2.metadata_entity_id, "Both media should share one entity"
        all_entities = (await session.execute(select(MetadataEntity))).scalars().all()
        assert len(all_entities) == 1, f"Expected 1 entity, got {len(all_entities)}"


# ---------------------------------------------------------------------------
# Manual lock prevents overwrite
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manual_lock_prevents_overwrite():
    service = MetadataService()
    mid = await _make_media(
        "Custom.Title.2020.mkv",
        metadata_locked=True,
        metadata_status=MetadataStatus.MANUAL,
    )

    with patch.object(service.provider, "search", new_callable=AsyncMock) as mock_search:
        result = await service.process_media_metadata(mid)
        mock_search.assert_not_called()

    assert result is True
    async with AsyncSessionLocal() as session:
        m = await session.get(Media, mid)
        assert m.metadata_locked is True
        assert m.metadata_status == MetadataStatus.MANUAL


# ---------------------------------------------------------------------------
# Job enqueue on download completion
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_enqueue_creates_job():
    """enqueue_media_for_enrichment must create a PENDING job."""
    service = MetadataService()
    mid = await _make_media("NewDownload.mkv")

    job = await service.enqueue_media_for_enrichment(mid)
    assert job.id is not None
    assert job.media_id == mid
    assert job.status == MetadataJobStatus.PENDING


@pytest.mark.asyncio
async def test_enqueue_idempotent():
    """Calling enqueue twice must not create a second active job."""
    service = MetadataService()
    mid = await _make_media("NewDownload2.mkv")

    job1 = await service.enqueue_media_for_enrichment(mid)
    job2 = await service.enqueue_media_for_enrichment(mid)

    # Both calls must return the same job
    assert job1.id == job2.id, "Duplicate job was created for the same media_id"

    async with AsyncSessionLocal() as session:
        active_jobs = (
            await session.execute(
                select(MetadataJob).where(
                    MetadataJob.media_id == mid,
                    MetadataJob.status.in_([MetadataJobStatus.PENDING, MetadataJobStatus.PROCESSING]),
                )
            )
        ).scalars().all()
    assert len(active_jobs) == 1, f"Expected 1 active job, found {len(active_jobs)}"


# ---------------------------------------------------------------------------
# Backfill logic
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_backfill_enqueues_missing_metadata():
    """PENDING/NOT_FOUND items must be enqueued by backfill."""
    service = MetadataService()
    mid = await _make_media("UnmatchedMovie.mkv", metadata_status=MetadataStatus.NOT_FOUND)

    result = await service.backfill_library(force=False)
    assert result["enqueued"] >= 1

    async with AsyncSessionLocal() as session:
        jobs = (
            await session.execute(select(MetadataJob).where(MetadataJob.media_id == mid))
        ).scalars().all()
    assert len(jobs) >= 1


@pytest.mark.asyncio
async def test_backfill_skips_complete_items_with_images():
    """MATCHED items that already have a complete entity must be skipped."""
    service = MetadataService()

    # Create a complete entity
    async with AsyncSessionLocal() as session:
        entity = MetadataEntity(
            provider="tmdb", provider_id="complete_1",
            media_type="movie", category="MOVIE",
            title="Complete Movie", release_year=2020,
            poster_path="/poster.jpg", backdrop_path="/backdrop.jpg",
        )
        session.add(entity)
        await session.commit()
        await session.refresh(entity)
        entity_id = entity.id

    mid = await _make_media(
        "CompleteMovie.2020.mkv",
        metadata_status=MetadataStatus.MATCHED,
        metadata_entity_id=entity_id,
    )

    result = await service.backfill_library(force=False)
    # This item should be skipped (already complete)
    assert result["skipped_complete"] >= 1

    async with AsyncSessionLocal() as session:
        jobs = (
            await session.execute(select(MetadataJob).where(MetadataJob.media_id == mid))
        ).scalars().all()
    assert len(jobs) == 0, "Complete items should not have been enqueued"


@pytest.mark.asyncio
async def test_backfill_reenqueues_matched_with_missing_poster():
    """MATCHED item linked to an entity without poster_path must be re-enqueued."""
    service = MetadataService()

    async with AsyncSessionLocal() as session:
        entity = MetadataEntity(
            provider="tmdb", provider_id="stale_2",
            media_type="movie", category="MOVIE",
            title="Stale Movie", release_year=2019,
            # poster_path intentionally None
            backdrop_path="/backdrop.jpg",
        )
        session.add(entity)
        await session.commit()
        await session.refresh(entity)
        entity_id = entity.id

    mid = await _make_media(
        "StaleMovie.2019.mkv",
        metadata_status=MetadataStatus.MATCHED,
        metadata_entity_id=entity_id,
    )

    result = await service.backfill_library(force=False)
    assert result["enqueued"] >= 1, "Item with missing poster should have been re-enqueued"


@pytest.mark.asyncio
async def test_backfill_respects_manual_lock():
    """Manually-locked items must be skipped during non-forced backfill."""
    service = MetadataService()
    mid = await _make_media(
        "LockedItem.mkv",
        metadata_status=MetadataStatus.MANUAL,
        metadata_locked=True,
    )

    result = await service.backfill_library(force=False)
    assert result["skipped_locked"] >= 1

    async with AsyncSessionLocal() as session:
        jobs = (await session.execute(select(MetadataJob).where(MetadataJob.media_id == mid))).scalars().all()
    assert len(jobs) == 0


@pytest.mark.asyncio
async def test_backfill_force_overrides_lock():
    """force=True must unlock and enqueue even manually-locked items."""
    service = MetadataService()
    mid = await _make_media(
        "ForceReprocess.mkv",
        metadata_status=MetadataStatus.MANUAL,
        metadata_locked=True,
    )

    result = await service.backfill_library(force=True)
    assert result["enqueued"] >= 1

    async with AsyncSessionLocal() as session:
        m = await session.get(Media, mid)
        assert m.metadata_locked is False, "Force backfill must unlock the item"


@pytest.mark.asyncio
async def test_backfill_no_duplicate_jobs():
    """Running backfill twice must not create duplicate active jobs."""
    service = MetadataService()
    mid = await _make_media("DuplicateTest.mkv", metadata_status=MetadataStatus.PENDING)

    await service.backfill_library(force=False)
    await service.backfill_library(force=False)

    async with AsyncSessionLocal() as session:
        active_jobs = (
            await session.execute(
                select(MetadataJob).where(
                    MetadataJob.media_id == mid,
                    MetadataJob.status.in_([MetadataJobStatus.PENDING, MetadataJobStatus.PROCESSING]),
                )
            )
        ).scalars().all()
    assert len(active_jobs) == 1, f"Expected exactly 1 active job, got {len(active_jobs)}"


# ---------------------------------------------------------------------------
# API serialization of poster/backdrop URLs
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_poster_url_resolved_from_entity():
    """get_media_poster_url must build a valid TMDB URL from entity.poster_path."""
    async with AsyncSessionLocal() as session:
        entity = MetadataEntity(
            provider="tmdb", provider_id="url_test_1",
            media_type="movie", category="MOVIE",
            title="URL Test Movie", release_year=2021,
            poster_path="/urltest_poster.jpg",
            backdrop_path="/urltest_backdrop.jpg",
        )
        session.add(entity)
        await session.commit()
        await session.refresh(entity)

        media = Media(
            drive_file_id="drv_url_test",
            filename="URLTest.2021.mkv",
            size=100, mime_type="video/mp4",
            metadata_entity_id=entity.id,
            metadata_status=MetadataStatus.MATCHED,
        )
        session.add(media)
        await session.commit()
        await session.refresh(media)

        poster = get_media_poster_url(media, entity)
        backdrop = get_media_backdrop_url(media, entity)

    assert poster is not None, "Poster URL must not be None when entity has poster_path"
    assert "image.tmdb.org" in poster, f"Expected TMDB URL, got {poster!r}"
    assert "urltest_poster.jpg" in poster

    assert backdrop is not None, "Backdrop URL must not be None when entity has backdrop_path"
    assert "urltest_backdrop.jpg" in backdrop


@pytest.mark.asyncio
async def test_poster_override_takes_precedence():
    """poster_override on Media must take priority over entity poster_path."""
    async with AsyncSessionLocal() as session:
        entity = MetadataEntity(
            provider="tmdb", provider_id="override_test",
            media_type="movie", category="MOVIE",
            title="Override Test", release_year=2022,
            poster_path="/entity_poster.jpg",
        )
        session.add(entity)
        await session.commit()
        await session.refresh(entity)

        media = Media(
            drive_file_id="drv_override_test",
            filename="OverrideTest.2022.mkv",
            size=100, mime_type="video/mp4",
            metadata_entity_id=entity.id,
            poster_override="https://custom.example.com/my_poster.jpg",
        )
        session.add(media)
        await session.commit()
        await session.refresh(media)

        poster = get_media_poster_url(media, entity)

    assert poster == "https://custom.example.com/my_poster.jpg"


@pytest.mark.asyncio
async def test_no_poster_returns_none():
    """Media with no entity and no poster fields returns None."""
    async with AsyncSessionLocal() as session:
        media = Media(
            drive_file_id="drv_no_poster",
            filename="NoPoster.mkv",
            size=100, mime_type="video/mp4",
        )
        session.add(media)
        await session.commit()
        await session.refresh(media)

        poster = get_media_poster_url(media, None)
    assert poster is None


@pytest.mark.asyncio
async def test_ambiguous_franchise_prefix_does_not_attach_wrong_tmdb_poster():
    """A related franchise title must not become the episode's canonical entity."""
    service = MetadataService()
    mid = await _make_media("Naruto.110.1080p.mkv")
    wrong_candidate = CandidateMatch(
        provider="tmdb",
        provider_id="99999",
        title="Naruto Shippuden",
        media_type="tv",
        release_year=2007,
        poster_path="/wrong-poster.jpg",
        overview="A different series in the same franchise.",
        popularity=1000.0,
    )

    with patch.object(service.provider, "is_configured", return_value=True), \
         patch.object(service.provider, "search", new_callable=AsyncMock, return_value=[wrong_candidate]), \
         patch.object(service.provider, "get_details", new_callable=AsyncMock) as get_details:
        result = await service.process_media_metadata(mid)

    assert result is True
    get_details.assert_not_awaited()
    async with AsyncSessionLocal() as session:
        media = await session.get(Media, mid)
        assert media.metadata_entity_id is None
        assert media.metadata_status == MetadataStatus.LOW_CONFIDENCE
        assert media.poster_url is None
        assert media.episode == 110
        assert media.media_type == "ANIME_EPISODE" or media.media_type == "TV_EPISODE"
