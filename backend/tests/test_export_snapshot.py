"""Unit tests for StreamX Catalog Snapshot Exporter and Series Key Serialization."""

import asyncio
import json
import os
from pathlib import Path
import tempfile
import pytest
from sqlalchemy import select

from app.api.media import format_media_item
from app.config.settings import Settings
from app.db.database import AsyncSessionLocal, init_db
from app.db.models import Media, MetadataEntity, MetadataStatus, utc_now
from scripts.export_snapshot import export_catalog_snapshot


@pytest.fixture
async def setup_test_media():
    """Seed test media entity with Unicode metadata and series key."""
    await init_db()
    async with AsyncSessionLocal() as session:
        # Create canonical entity
        entity = MetadataEntity(
            provider="anilist",
            provider_id="133965",
            media_type="tv",
            category="ANIME_EPISODE",
            title="Komi Can't Communicate",
            original_title="古見さんは、コミュ症です。",
            release_date="2021-10-07",
            release_year=2021,
            overview="An introverted high school girl seeks to make 100 friends.",
            poster_path="https://s4.anilist.co/poster.jpg",
            backdrop_path="https://s4.anilist.co/banner.jpg",
            rating=8.2,
            genres_json=json.dumps(["Comedy", "Romance", "Slice of Life"]),
            original_language="ja",
            origin_country="JP",
        )
        session.add(entity)
        await session.flush()

        media = Media(
            drive_file_id="test_drive_file_komi_01",
            filename="S01_01_komi_can't_communicate_1080p.mkv",
            size=500_000_000,
            mime_type="video/x-matroska",
            category="Anime",
            media_type="ANIME_EPISODE",
            season=1,
            episode=1,
            quality="1080p",
            series_key="canonical_anilist_133965",
            metadata_entity_id=entity.id,
            metadata_status=MetadataStatus.MATCHED,
            metadata_confidence=0.99,
        )
        session.add(media)
        await session.commit()
        await session.refresh(media)
        media_id = media.id
        entity_id = entity.id

    yield media_id, entity_id

    # Teardown
    async with AsyncSessionLocal() as session:
        m = await session.get(Media, media_id)
        if m:
            await session.delete(m)
        e = await session.get(MetadataEntity, entity_id)
        if e:
            await session.delete(e)
        await session.commit()


@pytest.mark.asyncio
async def test_format_media_item_includes_series_key(setup_test_media):
    """Verify format_media_item outputs series_key in MediaResponse."""
    media_id, _ = setup_test_media
    async with AsyncSessionLocal() as session:
        from sqlalchemy.orm import selectinload
        stmt = select(Media).options(selectinload(Media.metadata_entity)).where(Media.id == media_id)
        item = (await session.execute(stmt)).scalar_one()

        res = format_media_item(item)
        data = res.model_dump(mode="json")

        assert data["series_key"] == "canonical_anilist_133965"
        assert data["canonical_metadata"] is not None
        assert data["canonical_metadata"]["original_title"] == "古見さんは、コミュ症です。"
        assert data["season"] == 1
        assert data["episode"] == 1


@pytest.mark.asyncio
async def test_export_catalog_snapshot_atomic_and_unicode(setup_test_media):
    """Verify export_catalog_snapshot exports cleanly with UTF-8 and atomic temp replacement."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        target_path = Path(tmp_dir) / "catalog_snapshot.json"
        tmp_path = target_path.with_suffix(".json.tmp")

        count, path_str = await export_catalog_snapshot(output_path=str(target_path))

        assert count >= 1
        assert target_path.exists()
        # Ensure temporary file was cleanly replaced and does not linger
        assert not tmp_path.exists()

        # Read back with utf-8
        with open(target_path, "r", encoding="utf-8") as f:
            snapshot = json.load(f)

        assert isinstance(snapshot, list)
        assert len(snapshot) == count

        # Find our test item
        test_item = next((x for x in snapshot if x.get("drive_file_id") == "test_drive_file_komi_01"), None)
        assert test_item is not None
        assert test_item["series_key"] == "canonical_anilist_133965"
        assert test_item["canonical_metadata"]["original_title"] == "古見さんは、コミュ症です。"


@pytest.mark.asyncio
async def test_export_catalog_snapshot_dry_run():
    """Verify dry_run=True does not create or overwrite the destination file."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        target_path = Path(tmp_dir) / "catalog_snapshot.json"

        count, path_str = await export_catalog_snapshot(output_path=str(target_path), dry_run=True)

        assert count >= 0
        assert not target_path.exists()


def test_settings_allowed_telegram_users_dynamic():
    """Verify allowed_telegram_users is dynamically resolved from configured env without hardcoding."""
    # When both are None
    s = Settings(
        STREAMX_ENV="testing",
        TELEGRAM_ALLOWED_USER_IDS=None,
        TELEGRAM_OWNER_USER_ID=None,
    )
    assert s.allowed_telegram_users == []

    # When owner ID is specified
    s2 = Settings(
        STREAMX_ENV="testing",
        TELEGRAM_ALLOWED_USER_IDS=None,
        TELEGRAM_OWNER_USER_ID=111222333,
    )
    assert s2.allowed_telegram_users == [111222333]

    # When allowed list is specified
    s3 = Settings(
        STREAMX_ENV="testing",
        TELEGRAM_ALLOWED_USER_IDS="111222333, 444555666, 777888999",
        TELEGRAM_OWNER_USER_ID=111222333,
    )
    assert s3.allowed_telegram_users == [111222333, 444555666, 777888999]
