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


metadata_claim_lock = asyncio.Lock()


class MetadataWorker:
    def __init__(self, max_concurrent_jobs: int = 5):
        self.running = False
        self.task: Optional[asyncio.Task] = None
        self.max_concurrent_jobs = max_concurrent_jobs
        self.semaphore = asyncio.Semaphore(max_concurrent_jobs)
        self.active_tasks = set()

    async def reconcile_incomplete_jobs(self) -> None:
        """Recover jobs left in PROCESSING or RETRYING on process restart."""
        async with AsyncSessionLocal() as session:
            stmt = select(MetadataJob).where(
                MetadataJob.status.in_([MetadataJobStatus.PROCESSING, MetadataJobStatus.RETRYING])
            )
            res = await session.execute(stmt)
            jobs = res.scalars().all()
            for j in jobs:
                log_event("RECONCILING_METADATA_JOB", job_id=j.id, media_id=j.media_id)
                j.status = MetadataJobStatus.PENDING
                j.scheduled_at = utc_now()
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
        """Pick up and execute the next scheduled PENDING or RETRYING metadata job atomically."""
        if self.semaphore.locked():
            return False

        now = utc_now()
        async with metadata_claim_lock:
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

        task = asyncio.create_task(self._run_job_with_semaphore(job_id=job_id, media_id=media_id))
        self.active_tasks.add(task)
        task.add_done_callback(self.active_tasks.discard)
        return True

    async def _run_job_with_semaphore(self, job_id: int, media_id: int) -> None:
        async with self.semaphore:
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


metadata_worker = MetadataWorker()
