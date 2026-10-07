"""Comprehensive stress, failure injection, restart recovery, duplicate handling, and regression tests for StreamX pipeline."""

import asyncio
from unittest.mock import AsyncMock, patch
import pytest
from sqlalchemy import select, func

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import Media, TelegramTransfer, TransferStatus, MetadataJob, MetadataJobStatus
from app.workers.transfer_worker import TransferWorker
from app.workers.metadata_worker import MetadataWorker
from app.utils.filename_parser import parse_filename
from app.utils.filenames import sanitize_filename


@pytest.fixture
async def clean_db():
    await init_db()
    yield
    async with AsyncSessionLocal() as session:
        transfers = (await session.execute(select(TelegramTransfer))).scalars().all()
        for t in transfers:
            await session.delete(t)
        media_items = (await session.execute(select(Media))).scalars().all()
        for m in media_items:
            await session.delete(m)
        jobs = (await session.execute(select(MetadataJob))).scalars().all()
        for j in jobs:
            await session.delete(j)
        await session.commit()


@pytest.mark.asyncio
async def test_what_if_regression_parsing_and_sanitization():
    """Verify Marvel's What If...? episode regression is correctly parsed and sanitized."""
    # 1. Path sanitization cross-platform
    raw_path = "..\\..\\Marvels.What.If....S01E01.1080p.mkv"
    sanitized = sanitize_filename(raw_path)
    assert sanitized == "Marvels.What.If.S01E01.1080p.mkv"

    # 2. Filename parsing for clean title
    parsed1 = parse_filename("Marvels.What.If....S01E01.1080p.mkv")
    assert parsed1.clean_title == "Marvels What If"
    assert parsed1.season == 1
    assert parsed1.episode == 1

    parsed2 = parse_filename("What.If...?.S01E01.1080p.mkv")
    assert parsed2.clean_title == "What If?"
    assert parsed2.season == 1
    assert parsed2.episode == 1

    parsed3 = parse_filename("What If...? S01E01 1080p.mkv")
    assert parsed3.clean_title == "What If?"
    assert parsed3.season == 1
    assert parsed3.episode == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("job_count", [10, 50, 100])
async def test_stress_queue_batch_processing(clean_db, job_count):
    """Stress test processing 10, 50, and 100 job batches without poisoning or race conditions."""
    async with AsyncSessionLocal() as session:
        transfers = [
            TelegramTransfer(
                telegram_chat_id=8142877259,
                telegram_message_id=1000 + i,
                telegram_file_id=f"tg_file_{i}",
                filename=f"Batch_Movie_Part_{i}.mkv",
                size=1024 * 1024 * 10,
                status=TransferStatus.QUEUED,
            )
            for i in range(job_count)
        ]
        session.add_all(transfers)
        await session.commit()

    worker = TransferWorker(max_concurrent_transfers=10)

    # Mock _execute_transfer to simulate rapid execution
    async def mock_execute(transfer_id, chat_id, message_id, filename, expected_size):
        await asyncio.sleep(0.001)
        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
            t = (await session.execute(stmt)).scalar_one_or_none()
            if t:
                t.status = TransferStatus.COMPLETED
                t.bytes_transferred = expected_size
                await session.commit()

    with patch.object(worker, "_execute_transfer", side_effect=mock_execute):
        # Trigger processing until all items are claimed/completed
        while True:
            processed = await worker.process_next_transfer()
            if not processed and not worker.active_tasks:
                break
            if worker.active_tasks:
                await asyncio.sleep(0.001)

        if worker.active_tasks:
            await asyncio.gather(*list(worker.active_tasks))

    async with AsyncSessionLocal() as session:
        completed_count = (
            await session.execute(
                select(func.count(TelegramTransfer.id)).where(
                    TelegramTransfer.status == TransferStatus.COMPLETED
                )
            )
        ).scalar()
        assert completed_count == job_count


@pytest.mark.asyncio
async def test_failure_injection_does_not_poison_batch(clean_db):
    """Failure injection test: 1 failing job in a batch of 10 must mark failed and not affect others."""
    job_count = 10
    failing_index = 4  # Job #4 will fail

    async with AsyncSessionLocal() as session:
        transfers = [
            TelegramTransfer(
                telegram_chat_id=8142877259,
                telegram_message_id=2000 + i,
                telegram_file_id=f"tg_file_fail_{i}",
                filename=f"Batch_File_{i}.mkv",
                size=1024 * 100,
                status=TransferStatus.QUEUED,
            )
            for i in range(job_count)
        ]
        session.add_all(transfers)
        await session.commit()

    worker = TransferWorker(max_concurrent_transfers=5)

    async def mock_execute(transfer_id, chat_id, message_id, filename, expected_size):
        if f"Batch_File_{failing_index}.mkv" in filename:
            raise RuntimeError("Injected Telegram network error")
        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
            t = (await session.execute(stmt)).scalar_one_or_none()
            if t:
                t.status = TransferStatus.COMPLETED
                t.bytes_transferred = expected_size
                await session.commit()

    with patch.object(worker, "_execute_transfer", side_effect=mock_execute), \
         patch("app.workers.transfer_worker.bot_service.send_message", new_callable=AsyncMock):
        while True:
            processed = await worker.process_next_transfer()
            if not processed and not worker.active_tasks:
                break
            if worker.active_tasks:
                await asyncio.sleep(0.001)

        if worker.active_tasks:
            await asyncio.gather(*list(worker.active_tasks))

    async with AsyncSessionLocal() as session:
        completed = (
            await session.execute(
                select(func.count(TelegramTransfer.id)).where(
                    TelegramTransfer.status == TransferStatus.COMPLETED
                )
            )
        ).scalar()
        retrying_or_failed = (
            await session.execute(
                select(func.count(TelegramTransfer.id)).where(
                    TelegramTransfer.status.in_([TransferStatus.RETRYING, TransferStatus.FAILED])
                )
            )
        ).scalar()

        assert completed == job_count - 1
        assert retrying_or_failed == 1


@pytest.mark.asyncio
async def test_restart_recovery_reconciliation(clean_db):
    """Verify crash/restart recovery reconciles interrupted transfers and metadata jobs."""
    async with AsyncSessionLocal() as session:
        # Interrupted transfers in mid-flight status
        t1 = TelegramTransfer(
            telegram_chat_id=8142877259,
            telegram_message_id=3001,
            telegram_file_id="tg_crash_1",
            filename="Interrupted_Movie.mkv",
            size=5000,
            status=TransferStatus.FETCHING_TELEGRAM,
        )
        t2 = TelegramTransfer(
            telegram_chat_id=8142877259,
            telegram_message_id=3002,
            telegram_file_id="tg_crash_2",
            filename="Uploading_Movie.mkv",
            size=8000,
            status=TransferStatus.UPLOADING_DRIVE,
        )
        session.add_all([t1, t2])

        # Interrupted metadata job
        m = Media(
            drive_file_id="drive_restart_1",
            filename="Interrupted_Media.mp4",
            size=1000,
            mime_type="video/mp4",
        )
        session.add(m)
        await session.flush()
        j = MetadataJob(media_id=m.id, status=MetadataJobStatus.PROCESSING)
        session.add(j)
        await session.commit()

    transfer_worker = TransferWorker()
    metadata_worker = MetadataWorker()

    await transfer_worker.reconcile_incomplete_transfers()
    await metadata_worker.reconcile_incomplete_jobs()

    async with AsyncSessionLocal() as session:
        transfers = (await session.execute(select(TelegramTransfer))).scalars().all()
        for t in transfers:
            assert t.status == TransferStatus.QUEUED

        job = (await session.execute(select(MetadataJob))).scalar_one()
        assert job.status == MetadataJobStatus.PENDING


@pytest.mark.asyncio
async def test_duplicate_handling_idempotency(clean_db):
    """Duplicate submission test: Re-submitting identical file skips re-upload and completes immediately."""
    async with AsyncSessionLocal() as session:
        m = Media(
            drive_file_id="existing_drive_id_999",
            filename="Existing_Movie.2024.1080p.mkv",
            size=12345678,
            mime_type="video/x-matroska",
        )
        session.add(m)

        t = TelegramTransfer(
            telegram_chat_id=8142877259,
            telegram_message_id=4001,
            telegram_file_id="tg_dup_file",
            filename="Existing_Movie.2024.1080p.mkv",
            size=12345678,
            status=TransferStatus.QUEUED,
        )
        session.add(t)
        await session.commit()
        t_id = t.id

    worker = TransferWorker()

    with patch("app.workers.transfer_worker.bot_service.send_message", new_callable=AsyncMock) as mock_msg:
        await worker._execute_transfer(
            transfer_id=t_id,
            chat_id=8142877259,
            message_id=4001,
            filename="Existing_Movie.2024.1080p.mkv",
            expected_size=12345678,
        )

    async with AsyncSessionLocal() as session:
        t_updated = await session.get(TelegramTransfer, t_id)
        assert t_updated.status == TransferStatus.COMPLETED
        assert t_updated.bytes_transferred == 12345678

    mock_msg.assert_called_once()
    args, kwargs = mock_msg.call_args
    assert "Duplicate Media Detected" in kwargs.get("text", "")
