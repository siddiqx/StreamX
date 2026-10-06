"""Unified Metadata Service for StreamX.

Coordinates filename parsing, provider searches, confidence scoring,
entity deduplication/caching, manual overrides, and backfill.
"""

import asyncio
import json
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal
from app.db.models import (
    Media,
    MetadataEntity,
    MetadataJob,
    MetadataJobStatus,
    MetadataStatus,
    utc_now,
)
from app.services.confidence_scorer import rank_candidates
from app.services.metadata_providers.base import CandidateMatch, CanonicalMetadata
from app.services.metadata_providers.tmdb import tmdb_provider
from app.utils.filename_parser import ParsedMedia, parse_filename
from app.utils.logging import log_event, logger


class MetadataService:
    def __init__(self):
        self.provider = tmdb_provider

    async def enqueue_media_for_enrichment(self, media_id: int, session: Optional[AsyncSession] = None) -> MetadataJob:
        """Create or schedule a metadata job for a given media row."""
        close_session = False
        if session is None:
            session = AsyncSessionLocal()
            close_session = True

        try:
            # Check if active job already exists
            stmt = select(MetadataJob).where(
                MetadataJob.media_id == media_id,
                MetadataJob.status.in_([MetadataJobStatus.PENDING, MetadataJobStatus.PROCESSING]),
            )
            res = await session.execute(stmt)
            existing_job = res.scalar_one_or_none()
            if existing_job:
                return existing_job

            job = MetadataJob(
                media_id=media_id,
                status=MetadataJobStatus.PENDING,
                attempt_count=0,
                scheduled_at=utc_now(),
            )
            session.add(job)
            await session.commit()
            await session.refresh(job)
            log_event("METADATA_JOB_ENQUEUED", media_id=media_id, job_id=job.id)
            return job
        finally:
            if close_session:
                await session.close()

    async def get_or_create_metadata_entity(
        self, details: CanonicalMetadata, session: AsyncSession
    ) -> MetadataEntity:
        """Deduplicate metadata entities: reuse existing entity if tmdb_id already cataloged."""
        stmt = select(MetadataEntity).where(
            MetadataEntity.provider == details.provider,
            MetadataEntity.provider_id == details.provider_id,
        )
        res = await session.execute(stmt)
        entity = res.scalar_one_or_none()
        if entity:
            return entity

        entity = MetadataEntity(
            provider=details.provider,
            provider_id=details.provider_id,
            media_type=details.media_type,
            title=details.title,
            original_title=details.original_title,
            release_date=details.release_date,
            release_year=details.release_year,
            overview=details.overview,
            poster_path=details.poster_path,
            backdrop_path=details.backdrop_path,
            rating=details.rating,
            runtime=details.runtime,
            genres_json=json.dumps(details.genres),
            metadata_json=json.dumps(details.raw_metadata),
        )
        session.add(entity)
        await session.flush()
        log_event(
            "METADATA_ENTITY_CREATED",
            provider_id=details.provider_id,
            title=details.title,
            entity_id=entity.id,
        )
        return entity

    async def process_media_metadata(self, media_id: int) -> bool:
        """Execute enrichment pipeline for a single media item."""
        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                logger.warning(f"Media #{media_id} not found for metadata processing.")
                return False

            if media.metadata_locked:
                log_event("METADATA_PROCESSING_SKIPPED_LOCKED", media_id=media_id)
                return True

            media.metadata_status = MetadataStatus.PROCESSING
            await session.commit()

        parsed = parse_filename(media.filename)
        log_event(
            "FILENAME_PARSED",
            media_id=media_id,
            raw=media.filename,
            title=parsed.clean_title,
            year=parsed.year,
            type=parsed.media_type,
        )

        if not self.provider.is_configured():
            logger.info("Metadata provider not configured. Marking media as PENDING/RETRYING.")
            async with AsyncSessionLocal() as session:
                m = await session.get(Media, media_id)
                if m and not m.metadata_locked:
                    m.metadata_status = MetadataStatus.RETRYING
                    await session.commit()
            return False

        try:
            candidates = await self.provider.search(
                query=parsed.clean_title,
                year=parsed.year,
                media_type=parsed.media_type,
            )

            best_cand, confidence, status_str = rank_candidates(parsed, candidates)

            async with AsyncSessionLocal() as session:
                m = await session.get(Media, media_id)
                if not m or m.metadata_locked:
                    return True

                if not best_cand or status_str == "NOT_FOUND":
                    m.metadata_status = MetadataStatus.NOT_FOUND
                    m.metadata_confidence = confidence
                    await session.commit()
                    log_event("METADATA_NOT_FOUND", media_id=media_id, title=parsed.clean_title)
                    return True

                # Fetch full canonical details for best candidate
                details = await self.provider.get_details(
                    provider_id=best_cand.provider_id,
                    media_type=best_cand.media_type,
                )
                if not details:
                    m.metadata_status = MetadataStatus.FAILED
                    await session.commit()
                    return False

                entity = await self.get_or_create_metadata_entity(details, session)

                m.metadata_entity_id = entity.id
                m.metadata_confidence = confidence
                m.metadata_status = (
                    MetadataStatus.MATCHED
                    if status_str == "MATCHED"
                    else MetadataStatus.LOW_CONFIDENCE
                )

                # Set backwards-compatible poster and backdrop urls
                if details.poster_path:
                    m.poster_url = details.full_poster_url()
                if details.backdrop_path:
                    meta = json.loads(m.metadata_json or "{}")
                    meta["backdrop_url"] = details.full_backdrop_url()
                    m.metadata_json = json.dumps(meta)

                # Refine media category if obvious
                if details.media_type == "tv" and m.category == "Other":
                    m.category = "TV Shows"

                await session.commit()
                log_event(
                    "METADATA_MATCHED",
                    media_id=media_id,
                    canonical_title=details.title,
                    status=m.metadata_status.value,
                    confidence=confidence,
                )
                return True

        except Exception as e:
            logger.error(f"Error enriching media #{media_id}: {e}", exc_info=True)
            async with AsyncSessionLocal() as session:
                m = await session.get(Media, media_id)
                if m and not m.metadata_locked:
                    m.metadata_status = MetadataStatus.FAILED
                    await session.commit()
            raise

    async def search_candidates_for_media(
        self, media_id: int, custom_query: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Search candidates for manual correction dialog in UI."""
        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return []
            filename = media.filename

        parsed = parse_filename(filename)
        query = custom_query.strip() if custom_query and custom_query.strip() else parsed.clean_title

        candidates = await self.provider.search(
            query=query,
            year=parsed.year if not custom_query else None,
            media_type=parsed.media_type,
        )

        results = []
        for c in candidates:
            conf = calculate_match_confidence_simple(parsed, c)
            results.append({
                "provider": c.provider,
                "provider_id": c.provider_id,
                "title": c.title,
                "original_title": c.original_title,
                "media_type": c.media_type,
                "release_year": c.release_year,
                "release_date": c.release_date,
                "overview": c.overview,
                "poster_url": (
                    f"https://image.tmdb.org/t/p/w342{c.poster_path}" if c.poster_path else None
                ),
                "backdrop_url": (
                    f"https://image.tmdb.org/t/p/w780{c.backdrop_path}" if c.backdrop_path else None
                ),
                "rating": c.rating,
                "confidence": conf,
            })
        results.sort(key=lambda x: x["confidence"], reverse=True)
        return results

    async def manually_select_metadata(
        self, media_id: int, provider_id: str, media_type: str = "movie"
    ) -> bool:
        """Manually link media to chosen entity, locking it against auto-enrichment."""
        details = await self.provider.get_details(provider_id=provider_id, media_type=media_type)
        if not details:
            return False

        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return False

            entity = await self.get_or_create_metadata_entity(details, session)
            media.metadata_entity_id = entity.id
            media.metadata_status = MetadataStatus.MANUAL
            media.metadata_confidence = 1.0
            media.metadata_locked = True

            if details.poster_path:
                media.poster_url = details.full_poster_url()
            if details.backdrop_path:
                meta = json.loads(media.metadata_json or "{}")
                meta["backdrop_url"] = details.full_backdrop_url()
                media.metadata_json = json.dumps(meta)

            await session.commit()
            log_event(
                "METADATA_MANUALLY_OVERRIDDEN",
                media_id=media_id,
                provider_id=provider_id,
                title=details.title,
            )
            return True

    async def unlock_metadata(self, media_id: int) -> bool:
        """Unlock media item so it can be reprocessed automatically."""
        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return False
            media.metadata_locked = False
            await session.commit()
            log_event("METADATA_UNLOCKED", media_id=media_id)
            return True

    async def reprocess_media(self, media_id: int, force: bool = False) -> bool:
        """Enqueue single media item for metadata reprocessing."""
        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return False
            if media.metadata_locked and not force:
                return False
            if force:
                media.metadata_locked = False
            media.metadata_status = MetadataStatus.PENDING
            await session.commit()

        await self.enqueue_media_for_enrichment(media_id)
        return True

    async def backfill_library(self, force: bool = False) -> Dict[str, int]:
        """Enqueue all unenriched or failed library items for metadata processing."""
        async with AsyncSessionLocal() as session:
            stmt = select(Media.id, Media.metadata_status, Media.metadata_locked)
            res = await session.execute(stmt)
            rows = res.all()

            enqueued = 0
            skipped = 0
            for row in rows:
                mid, status, locked = row[0], row[1], row[2]
                if locked and not force:
                    skipped += 1
                    continue
                if not force and status in (MetadataStatus.MATCHED, MetadataStatus.MANUAL):
                    continue

                # Reset to PENDING and enqueue
                m = await session.get(Media, mid)
                if m:
                    m.metadata_status = MetadataStatus.PENDING
                job = MetadataJob(
                    media_id=mid,
                    status=MetadataJobStatus.PENDING,
                    attempt_count=0,
                    scheduled_at=utc_now(),
                )
                session.add(job)
                enqueued += 1

            await session.commit()

        log_event("METADATA_BACKFILL_TRIGGERED", enqueued=enqueued, skipped=skipped)
        return {"enqueued": enqueued, "skipped_locked": skipped}

    async def get_metadata_stats(self) -> Dict[str, Any]:
        """Aggregate metadata library health metrics."""
        async with AsyncSessionLocal() as session:
            total = (await session.execute(select(func.count(Media.id)))).scalar() or 0
            stmt = select(Media.metadata_status, func.count(Media.id)).group_by(Media.metadata_status)
            res = await session.execute(stmt)
            counts = {str(k.value if hasattr(k, "value") else k): v for k, v in res.all()}

            matched = counts.get(MetadataStatus.MATCHED.value, 0)
            manual = counts.get(MetadataStatus.MANUAL.value, 0)
            low_conf = counts.get(MetadataStatus.LOW_CONFIDENCE.value, 0)
            not_found = counts.get(MetadataStatus.NOT_FOUND.value, 0)
            failed = counts.get(MetadataStatus.FAILED.value, 0)
            pending = counts.get(MetadataStatus.PENDING.value, 0)
            processing = counts.get(MetadataStatus.PROCESSING.value, 0)
            retrying = counts.get(MetadataStatus.RETRYING.value, 0)

            resolved = matched + manual
            match_pct = round((resolved / total * 100), 1) if total > 0 else 0.0

            return {
                "total_media": total,
                "matched": matched,
                "manual": manual,
                "low_confidence": low_conf,
                "not_found": not_found,
                "failed": failed,
                "pending": pending,
                "processing": processing,
                "retrying": retrying,
                "match_percentage": match_pct,
            }


def calculate_match_confidence_simple(parsed: ParsedMedia, cand: CandidateMatch) -> float:
    from app.services.confidence_scorer import calculate_match_confidence
    return calculate_match_confidence(parsed, cand)


metadata_service = MetadataService()
