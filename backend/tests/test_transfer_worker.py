"""Tests for StreamX Transfer Worker."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import TelegramTransfer, TransferStatus
from app.workers.transfer_worker import TransferWorker


@pytest.fixture
async def clean_db():
    await init_db()
    yield
    async with AsyncSessionLocal() as session:
        transfers = (await session.execute(select(TelegramTransfer))).scalars().all()
        for t in transfers:
            await session.delete(t)
        await session.commit()


@pytest.mark.asyncio
async def test_worker_process_transfer(clean_db):
    worker = TransferWorker()

    # Create a queued transfer in SQLite
    async with AsyncSessionLocal() as session:
        t = TelegramTransfer(
            telegram_chat_id=8142877259,
            telegram_message_id=999,
            telegram_file_id="worker_test_file",
            filename="Test_Worker_Video.mp4",
            size=1024,
            status=TransferStatus.QUEUED,
        )
        session.add(t)
        await session.commit()
        await session.refresh(t)
        t_id = t.id

    # Mock execution of _execute_transfer
    with patch.object(
        worker, "_execute_transfer", new_callable=AsyncMock
    ) as mock_exec:
        processed = await worker.process_next_transfer()
        assert processed is True
        # Wait for background task spawned by process_next_transfer to finish
        if worker.active_tasks:
            await asyncio.gather(*list(worker.active_tasks))
        mock_exec.assert_called_once()
        args, kwargs = mock_exec.call_args
        assert kwargs["transfer_id"] == t_id
        assert kwargs["filename"] == "Test_Worker_Video.mp4"
        assert kwargs["expected_size"] == 1024
