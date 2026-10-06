"""Asynchronous background worker for processing metadata jobs from SQLite."""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import select

from app.config.settings import settings
from app.db.database import AsyncSessionLocal
from app.db.models import MetadataJob, MetadataJobStatus, utc_now
from app.services.metadata_service import metadata_service
from app.utils.logging import log_event, logger


class MetadataWorker:
    def __init__(self):
        self.running = False
        self.task: Optional[asyncio.Task] = None

    async def reconcile_incomplete_jobs(self) -> None:
        """Recover jobs left in PROCESSING from dead or restarted processes."""
        async with AsyncSessionLocal() as session:
            stmt = select(MetadataJob).where(MetadataJob.status == MetadataJobStatus.PROCESSING)
            res = await session.execute(stmt)
            jobs = res.scalars().all()
            for j in jobs:
                log_event("RECONCILING_METADATA_JOB", job_id=j.id, media_id=j.media_id)
                j.status = MetadataJobStatus.PENDING
                j.started_at = None
            if jobs:
                await session.commit()

    async def start(self) -> None:
        """Start metadata worker loop."""
        self.running = True
        log_event("METADATA_WORKER_STARTED")
        await self.reconcile_incomplete_jobs()

        while self.running:
            try:
                processed = await self.process_next_job()
                if processed:
                    # Gentle throttle between TMDB operations to honor rate limits
                    await asyncio.sleep(0.3)
                else:
                    await asyncio.sleep(3.0)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in metadata worker loop: {e}", exc_info=True)
                await asyncio.sleep(5.0)

        log_event("METADATA_WORKER_STOPPED")

    def stop(self) -> None:
        self.running = False
        if self.task:
            self.task.cancel()

    async def process_next_job(self) -> bool:
        """Pick up and execute the next scheduled PENDING or RETRYING metadata job."""
        now = utc_now()
        async with AsyncSessionLocal() as session:
            stmt = (
                select(MetadataJob)
                .where(
                    MetadataJob.status.in_([MetadataJobStatus.PENDING, MetadataJobStatus.RETRYING]),
                    MetadataJob.scheduled_at <= now,
                )
                .order_by(MetadataJob.id.asc())
                .limit(1)
            )
            res = await session.execute(stmt)
            job = res.scalar_one_or_none()
            if not job:
                return False

            job_id = job.id
            media_id = job.media_id
            job.status = MetadataJobStatus.PROCESSING
            job.started_at = now
            await session.commit()

        log_event("METADATA_JOB_STARTED", job_id=job_id, media_id=media_id)

        try:
            success = await metadata_service.process_media_metadata(media_id)
            async with AsyncSessionLocal() as session:
                j = await session.get(MetadataJob, job_id)
                if j:
                    if success:
                        j.status = MetadataJobStatus.COMPLETED
                        j.completed_at = utc_now()
                        j.last_error = None
                    else:
                        # Non-fatal issue (e.g. key missing or temporary)
                        j.attempt_count += 1
                        if j.attempt_count < settings.MAX_RETRIES:
                            j.status = MetadataJobStatus.RETRYING
                            j.scheduled_at = utc_now() + timedelta(seconds=2 ** j.attempt_count * 5)
                        else:
                            j.status = MetadataJobStatus.FAILED
                            j.completed_at = utc_now()
                    await session.commit()

            log_event("METADATA_JOB_FINISHED", job_id=job_id, success=success)
            return True

        except Exception as e:
            logger.error(f"Metadata job #{job_id} for media #{media_id} failed: {e}", exc_info=True)
            async with AsyncSessionLocal() as session:
                j = await session.get(MetadataJob, job_id)
                if j:
                    j.attempt_count += 1
                    j.last_error = str(e)
                    if j.attempt_count < settings.MAX_RETRIES:
                        j.status = MetadataJobStatus.RETRYING
                        j.scheduled_at = utc_now() + timedelta(seconds=2 ** j.attempt_count * 5)
                    else:
                        j.status = MetadataJobStatus.FAILED
                        j.completed_at = utc_now()
                    await session.commit()
            return True


metadata_worker = MetadataWorker()
