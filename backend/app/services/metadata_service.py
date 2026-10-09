"""Unified Metadata Service for StreamX.

Coordinates filename parsing, provider searches, confidence scoring,
entity deduplication/caching, taxonomy classification, manual overrides,
series-wide linking, and backfill.
"""

import asyncio
import json
import re
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal
from app.db.models import (
    Media,
    MediaTaxonomy,
    MetadataEntity,
    MetadataJob,
    MetadataJobStatus,
    MetadataStatus,
    utc_now,
)
from app.services.confidence_scorer import calculate_match_confidence, rank_candidates
from app.services.metadata_providers.base import CandidateMatch, CanonicalMetadata
from app.services.metadata_providers.tmdb import tmdb_provider
from app.utils.filename_parser import ParsedMedia, parse_filename
from app.utils.image_resolver import get_media_backdrop_url, get_media_poster_url
from app.utils.logging import log_event, logger
from app.utils.media_classifier import classify_media, is_media_file


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
        self, details: CanonicalMetadata, taxonomy: MediaTaxonomy, session: AsyncSession
    ) -> MetadataEntity:
        """Deduplicate metadata entities: reuse existing entity if tmdb_id already cataloged.

        If the existing entity has stale or missing fields (poster, backdrop, title, overview,
        genres, rating), update them from the fresh provider details so all media items
        linked to this entity immediately benefit from the corrected data.
        """
        stmt = select(MetadataEntity).where(
            MetadataEntity.provider == details.provider,
            MetadataEntity.provider_id == details.provider_id,
        )
        res = await session.execute(stmt)
        entity = res.scalar_one_or_none()

        orig_lang = None
        countries = []
        if details.raw_metadata and isinstance(details.raw_metadata, dict):
            orig_lang = details.raw_metadata.get("original_language")
            c = details.raw_metadata.get("origin_country", [])
            if isinstance(c, list):
                countries = c
            elif isinstance(c, str):
                countries = [c]

        if entity:
            # Update any stale or missing fields so existing entity stays canonical.
            updated = False
            if details.poster_path and not entity.poster_path:
                entity.poster_path = details.poster_path
                updated = True
            if details.backdrop_path and not entity.backdrop_path:
                entity.backdrop_path = details.backdrop_path
                updated = True
            if details.title and (not entity.title or entity.title == "Unknown"):
                entity.title = details.title
                updated = True
            if details.original_title and not entity.original_title:
                entity.original_title = details.original_title
                updated = True
            if details.overview and not entity.overview:
                entity.overview = details.overview
                updated = True
            if details.rating is not None and entity.rating is None:
                entity.rating = details.rating
                updated = True
            if details.runtime is not None and entity.runtime is None:
                entity.runtime = details.runtime
                updated = True
            if details.genres and not entity.genres_json:
                entity.genres_json = json.dumps(details.genres)
                updated = True
            if orig_lang and not entity.original_language:
                entity.original_language = orig_lang
                updated = True
            if countries and not entity.origin_country:
                entity.origin_country = ",".join(countries)
                updated = True
            if updated:
                log_event(
                    "METADATA_ENTITY_UPDATED",
                    provider_id=details.provider_id,
                    entity_id=entity.id,
                    title=entity.title,
                )
            return entity

        entity = MetadataEntity(
            provider=details.provider,
            provider_id=details.provider_id,
            media_type=details.media_type,
            category=taxonomy.value,
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
            original_language=orig_lang,
            origin_country=",".join(countries) if countries else None,
            metadata_json=json.dumps(details.raw_metadata),
        )
        session.add(entity)
        await session.flush()
        log_event(
            "METADATA_ENTITY_CREATED",
            provider_id=details.provider_id,
            title=details.title,
            entity_id=entity.id,
            taxonomy=taxonomy.value,
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

            # If not a media file (e.g. document, archive), skip enrichment
            if not is_media_file(media.filename, media.mime_type):
                media.category = "Other"
                media.media_type = MediaTaxonomy.OTHER.value
                media.metadata_status = MetadataStatus.NOT_FOUND
                await session.commit()
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
            season=parsed.season,
            episode=parsed.episode,
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
            # Search the parser's canonical title first. If that is not a clear
            # match, try a small set of deterministic variants and rank the combined
            # candidate pool once. Never let a noisy Telegram filename force a
            # single weak TMDB result into the library.
            query_variants = []
            for query in (
                parsed.clean_title,
                re.sub(r"[^\\w\\s]", " ", parsed.clean_title),
                re.sub(r"\\s+", " ", parsed.clean_title).strip(),
            ):
                query = query.strip()
                if query and query.casefold() not in {q.casefold() for q in query_variants}:
                    query_variants.append(query)

            candidates_by_id = {}
            best_cand, confidence, status_str = None, 0.0, "NOT_FOUND"
            for index, query in enumerate(query_variants[:3]):
                found = await self.provider.search(
                    query=query,
                    year=parsed.year,
                    media_type=parsed.media_type,
                )
                for candidate in found:
                    key = (candidate.media_type, str(candidate.provider_id))
                    existing = candidates_by_id.get(key)
                    if existing is None or calculate_match_confidence(parsed, candidate) > calculate_match_confidence(parsed, existing):
                        candidates_by_id[key] = candidate

                best_cand, confidence, status_str = rank_candidates(parsed, list(candidates_by_id.values()))
                # Only stop early for an unambiguous, high-confidence match.
                if status_str == "MATCHED" and confidence >= 0.88:
                    break
                # Avoid unnecessary API calls when the first search is clearly good.
                if index == 0 and status_str == "MATCHED":
                    break

            log_event(
                "METADATA_CANDIDATES_RANKED",
                media_id=media_id,
                query_count=min(len(query_variants), 3),
                candidate_count=len(candidates_by_id),
                best_title=best_cand.title if best_cand else None,
                confidence=confidence,
                match_status=status_str,
            )

            async with AsyncSessionLocal() as session:
                m = await session.get(Media, media_id)
                if not m or m.metadata_locked:
                    return True

                # Synchronize parsed technical fields if empty
                if m.season is None and parsed.season is not None:
                    m.season = parsed.season
                if m.episode is None and parsed.episode is not None:
                    m.episode = parsed.episode
                if not m.quality and parsed.quality:
                    m.quality = parsed.quality
                if not m.release_group and parsed.release_group:
                    m.release_group = parsed.release_group

                if not best_cand or status_str != "MATCHED":
                    # Do not attach a speculative TMDB entity: a wrong poster/title
                    # is worse than temporarily showing a clean filename fallback.
                    taxonomy, cat = classify_media(parsed, None, raw_filename=m.filename, mime_type=m.mime_type)
                    m.category = cat
                    m.media_type = taxonomy.value
                    m.metadata_status = (
                        MetadataStatus.LOW_CONFIDENCE
                        if best_cand is not None
                        else MetadataStatus.NOT_FOUND
                    )
                    m.metadata_confidence = confidence
                    await session.commit()
                    log_event(
                        "METADATA_MATCH_REJECTED",
                        media_id=media_id,
                        title=parsed.clean_title,
                        candidate_title=best_cand.title if best_cand else None,
                        confidence=confidence,
                        match_status=status_str,
                    )
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

                # Deterministic Taxonomy Classification using canonical provider evidence
                taxonomy, cat = classify_media(parsed, details, raw_filename=m.filename, mime_type=m.mime_type)
                entity = await self.get_or_create_metadata_entity(details, taxonomy, session)

                m.metadata_entity_id = entity.id
                m.metadata_confidence = confidence
                m.metadata_status = (
                    MetadataStatus.MATCHED
                    if status_str == "MATCHED"
                    else MetadataStatus.LOW_CONFIDENCE
                )
                m.category = cat
                m.media_type = taxonomy.value

                # Set backwards-compatible poster and backdrop urls
                if details.poster_path and not m.poster_url:
                    m.poster_url = details.full_poster_url()
                if details.backdrop_path:
                    meta = json.loads(m.metadata_json or "{}")
                    meta["backdrop_url"] = details.full_backdrop_url()
                    m.metadata_json = json.dumps(meta)

                await session.commit()
                log_event(
                    "METADATA_MATCHED",
                    media_id=media_id,
                    canonical_title=details.title,
                    status=m.metadata_status.value,
                    taxonomy=taxonomy.value,
                    category=m.category,
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
            conf = calculate_match_confidence(parsed, c)
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
        self, media_id: int, provider_id: str, media_type: str = "movie", apply_to_series: bool = True
    ) -> bool:
        """Manually link media to chosen entity, locking it against auto-enrichment.

        If apply_to_series is True and media is episodic, links all sibling episodes in the series.
        """
        details = await self.provider.get_details(provider_id=provider_id, media_type=media_type)
        if not details:
            return False

        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return False

            parsed = parse_filename(media.filename)
            taxonomy, cat = classify_media(parsed, details, raw_filename=media.filename)
            entity = await self.get_or_create_metadata_entity(details, taxonomy, session)

            media.metadata_entity_id = entity.id
            media.metadata_status = MetadataStatus.MANUAL
            media.metadata_confidence = 1.0
            media.metadata_locked = True
            media.category = cat
            media.media_type = taxonomy.value

            if details.poster_path and not media.poster_override:
                media.poster_url = details.full_poster_url()
            if details.backdrop_path and not media.backdrop_override:
                meta = json.loads(media.metadata_json or "{}")
                meta["backdrop_url"] = details.full_backdrop_url()
                media.metadata_json = json.dumps(meta)

            # Apply to sibling episodes if series
            if apply_to_series and taxonomy in (
                MediaTaxonomy.TV_SERIES,
                MediaTaxonomy.TV_EPISODE,
                MediaTaxonomy.ANIME_SERIES,
                MediaTaxonomy.ANIME_EPISODE,
            ):
                # Find sibling files matching clean title or same series
                series_query = parsed.clean_title
                stmt = select(Media).where(
                    Media.id != media_id,
                    Media.metadata_locked == False,
                )
                res = await session.execute(stmt)
                all_unlocked = res.scalars().all()
                for sibling in all_unlocked:
                    sib_parsed = parse_filename(sibling.filename)
                    if sib_parsed.clean_title.lower() == series_query.lower() or (
                        sib_parsed.episode is not None and sib_parsed.clean_title.lower().startswith(series_query.lower()[:8])
                    ):
                        sibling_tax, sibling_cat = classify_media(sib_parsed, details, raw_filename=sibling.filename)
                        sibling.metadata_entity_id = entity.id
                        sibling.metadata_status = MetadataStatus.MANUAL
                        sibling.metadata_confidence = 1.0
                        sibling.metadata_locked = True
                        sibling.category = sibling_cat
                        sibling.media_type = sibling_tax.value
                        if details.poster_path and not sibling.poster_override:
                            sibling.poster_url = details.full_poster_url()

            await session.commit()
            log_event(
                "METADATA_MANUALLY_OVERRIDDEN",
                media_id=media_id,
                provider_id=provider_id,
                title=details.title,
                taxonomy=taxonomy.value,
            )
            return True

    async def manual_update_metadata(
        self,
        media_id: int,
        title: Optional[str] = None,
        year: Optional[int] = None,
        category: Optional[str] = None,
        overview: Optional[str] = None,
        poster_override: Optional[str] = None,
        backdrop_override: Optional[str] = None,
    ) -> bool:
        """Allow explicit user edits for titles, categories, posters, and overviews."""
        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return False

            media.metadata_locked = True
            media.metadata_status = MetadataStatus.MANUAL

            if category:
                media.category = category
            if poster_override is not None:
                media.poster_override = poster_override.strip() if poster_override.strip() else None
            if backdrop_override is not None:
                media.backdrop_override = backdrop_override.strip() if backdrop_override.strip() else None

            # If user modified canonical entity fields (title, year, overview)
            if title or year or overview:
                if media.metadata_entity_id:
                    entity = await session.get(MetadataEntity, media.metadata_entity_id)
                    if entity:
                        if title:
                            entity.title = title.strip()
                        if year:
                            entity.release_year = year
                        if overview:
                            entity.overview = overview.strip()
                else:
                    # Create custom local entity
                    new_entity = MetadataEntity(
                        provider="custom",
                        provider_id=f"custom_{media.id}",
                        media_type="movie",
                        category=media.category or "Movies",
                        title=title.strip() if title else media.filename,
                        release_year=year,
                        overview=overview.strip() if overview else None,
                    )
                    session.add(new_entity)
                    await session.flush()
                    media.metadata_entity_id = new_entity.id

            await session.commit()
            log_event("METADATA_MANUALLY_PATCHED", media_id=media_id)
            return True

    async def set_poster_override(self, media_id: int, poster_url: Optional[str]) -> bool:
        """Set or clear manual poster override."""
        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return False
            media.poster_override = poster_url.strip() if (poster_url and poster_url.strip()) else None
            media.metadata_locked = True
            media.metadata_status = MetadataStatus.MANUAL
            await session.commit()
            log_event("POSTER_OVERRIDE_UPDATED", media_id=media_id, poster_url=media.poster_override)
            return True

    async def set_backdrop_override(self, media_id: int, backdrop_url: Optional[str]) -> bool:
        """Set or clear manual backdrop override."""
        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return False
            media.backdrop_override = backdrop_url.strip() if (backdrop_url and backdrop_url.strip()) else None
            media.metadata_locked = True
            media.metadata_status = MetadataStatus.MANUAL
            await session.commit()
            log_event("BACKDROP_OVERRIDE_UPDATED", media_id=media_id, backdrop_url=media.backdrop_override)
            return True

    async def unlock_metadata(self, media_id: int) -> bool:
        """Unlock media item and immediately return it to the automatic enrichment pipeline."""
        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return False
            media.metadata_locked = False
            media.metadata_status = MetadataStatus.PENDING
            await session.commit()

        await self.enqueue_media_for_enrichment(media_id)
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
        """Enqueue unenriched or failed library items for metadata processing.

        Also re-enqueues MATCHED items whose linked entity lacks poster_path or
        backdrop_path — these are incorrectly-matched records that would display
        blank posters in the UI.

        Avoids creating duplicate active (PENDING/PROCESSING) jobs by checking
        for existing active jobs before creating new ones.
        """
        async with AsyncSessionLocal() as session:
            # Fetch current active job media IDs to avoid duplicates
            active_jobs_stmt = select(MetadataJob.media_id).where(
                MetadataJob.status.in_([MetadataJobStatus.PENDING, MetadataJobStatus.PROCESSING])
            )
            active_res = await session.execute(active_jobs_stmt)
            active_job_media_ids = {row[0] for row in active_res.all()}

            stmt = select(
                Media.id, Media.metadata_status, Media.metadata_locked,
                Media.filename, Media.mime_type, Media.metadata_entity_id
            )
            res = await session.execute(stmt)
            rows = res.all()

            enqueued = 0
            skipped_locked = 0
            skipped_non_media = 0
            skipped_complete = 0

            for row in rows:
                mid, status, locked, fn, mime, entity_id = (
                    row[0], row[1], row[2], row[3], row[4], row[5]
                )
                if not is_media_file(fn, mime):
                    skipped_non_media += 1
                    continue
                if locked and not force:
                    skipped_locked += 1
                    continue

                # Skip already-active jobs to prevent duplicates
                if mid in active_job_media_ids:
                    continue

                # Determine if this item needs enrichment
                needs_enrichment = False
                if force:
                    needs_enrichment = True
                elif status not in (MetadataStatus.MATCHED, MetadataStatus.MANUAL):
                    # Any non-matched, non-manual item is a candidate
                    needs_enrichment = True
                else:
                    # MATCHED/MANUAL: still enqueue if entity has missing poster or backdrop
                    if entity_id:
                        entity = await session.get(MetadataEntity, entity_id)
                        if entity and (not entity.poster_path or not entity.backdrop_path):
                            needs_enrichment = True
                    elif status == MetadataStatus.MATCHED:
                        # Marked MATCHED but no entity — corrupted state, re-enqueue
                        needs_enrichment = True

                if not needs_enrichment:
                    skipped_complete += 1
                    continue

                # Reset to PENDING and enqueue
                m = await session.get(Media, mid)
                if m and not m.metadata_locked or force:
                    if m:
                        m.metadata_status = MetadataStatus.PENDING
                        if force:
                            m.metadata_locked = False
                    job = MetadataJob(
                        media_id=mid,
                        status=MetadataJobStatus.PENDING,
                        attempt_count=0,
                        scheduled_at=utc_now(),
                    )
                    session.add(job)
                    active_job_media_ids.add(mid)  # prevent double-add in this batch
                    enqueued += 1

            await session.commit()

        log_event(
            "METADATA_BACKFILL_TRIGGERED",
            enqueued=enqueued,
            skipped_locked=skipped_locked,
            skipped_non_media=skipped_non_media,
            skipped_complete=skipped_complete,
        )
        return {
            "enqueued": enqueued,
            "skipped_locked": skipped_locked,
            "skipped_non_media": skipped_non_media,
            "skipped_complete": skipped_complete,
        }

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

    async def get_metadata_diagnostics(self, media_id: int) -> Dict[str, Any]:
        """Section 44: Comprehensive diagnostic view for inspecting how a media item was resolved."""
        async with AsyncSessionLocal() as session:
            media = await session.get(Media, media_id)
            if not media:
                return {"error": "Media item not found"}

            parsed = parse_filename(media.filename)
            entity = None
            if media.metadata_entity_id:
                entity = await session.get(MetadataEntity, media.metadata_entity_id)

            candidates = []
            if self.provider.is_configured():
                try:
                    raw_cands = await self.provider.search(
                        query=parsed.clean_title,
                        year=parsed.year,
                        media_type=parsed.media_type,
                    )
                    for c in raw_cands:
                        conf = calculate_match_confidence(parsed, c)
                        candidates.append({
                            "provider_id": c.provider_id,
                            "title": c.title,
                            "media_type": c.media_type,
                            "year": c.release_year,
                            "confidence": conf,
                            "popularity": c.popularity,
                        })
                except Exception as e:
                    candidates = [{"error": str(e)}]

            resolved_poster = get_media_poster_url(media, entity)
            resolved_backdrop = get_media_backdrop_url(media, entity)

            return {
                "media_id": media.id,
                "original_filename": media.filename,
                "mime_type": media.mime_type,
                "is_media_file": is_media_file(media.filename, media.mime_type),
                "parsed": {
                    "clean_title": parsed.clean_title,
                    "year": parsed.year,
                    "media_type": parsed.media_type,
                    "season": parsed.season,
                    "episode": parsed.episode,
                    "quality": parsed.quality,
                    "release_group": parsed.release_group,
                },
                "category": media.category,
                "media_type": media.media_type,
                "metadata_status": media.metadata_status.value if hasattr(media.metadata_status, "value") else str(media.metadata_status),
                "metadata_confidence": media.metadata_confidence,
                "metadata_locked": media.metadata_locked,
                "poster_override": media.poster_override,
                "backdrop_override": media.backdrop_override,
                "resolved_poster_url": resolved_poster,
                "resolved_backdrop_url": resolved_backdrop,
                "canonical_entity": {
                    "id": entity.id,
                    "provider": entity.provider,
                    "provider_id": entity.provider_id,
                    "title": entity.title,
                    "year": entity.release_year,
                    "media_type": entity.media_type,
                    "category": entity.category,
                    "rating": entity.rating,
                    "origin_country": entity.origin_country,
                    "original_language": entity.original_language,
                } if entity else None,
                "candidates_scored": candidates,
            }


metadata_service = MetadataService()
