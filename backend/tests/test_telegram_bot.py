"""Tests for Phase 2 Telegram Bot Ingestion and Transfers API."""

from unittest.mock import AsyncMock, patch
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import TelegramTransfer, TransferStatus
from app.main import app
from app.services.telegram_bot_service import TelegramBotService
from app.utils.filenames import sanitize_filename


@pytest.fixture
async def clean_db():
    await init_db()
    yield
    async with AsyncSessionLocal() as session:
        transfers = (await session.execute(select(TelegramTransfer))).scalars().all()
        for t in transfers:
            await session.delete(t)
        await session.commit()


def test_sanitize_filename():
    assert sanitize_filename("../../Interstellar.2014.1080p.mkv") == "Interstellar.2014.1080p.mkv"
    assert sanitize_filename("..\\..\\secret.mkv") == "secret.mkv"
    assert sanitize_filename("bad:name?.mp4") == "bad_name_.mp4"
    assert sanitize_filename("") == "streamx_file.bin"


@pytest.mark.asyncio
async def test_bot_unauthorized_user(clean_db):
    bot = TelegramBotService(bot_token="test_token")
    with patch.object(bot, "send_message", new_callable=AsyncMock) as mock_send:
        update = {
            "update_id": 1,
            "message": {
                "message_id": 10,
                "chat": {"id": 99999},
                "from": {"id": 99999, "first_name": "Stranger"},
                "text": "/start",
            },
        }
        await bot.process_update(update)
        mock_send.assert_called_once()
        args, kwargs = mock_send.call_args
        sent_text = kwargs.get("text", args[1] if len(args) > 1 else "")
        assert "Access Denied" in sent_text


@pytest.mark.asyncio
async def test_bot_media_ingestion_and_sqlite(clean_db):
    bot = TelegramBotService(bot_token="test_token")
    with patch.object(bot, "send_message", new_callable=AsyncMock) as mock_send:
        update = {
            "update_id": 2,
            "message": {
                "message_id": 101,
                "chat": {"id": 8142877259},
                "from": {"id": 8142877259, "first_name": "Siddiq"},
                "document": {
                    "file_id": "telegram_doc_file_12345",
                    "file_name": "../../Interstellar.2014.1080p.mkv",
                    "file_size": 13314398621,
                },
            },
        }
        await bot.process_update(update)

        # Verify acknowledgement sent to Telegram
        mock_send.assert_called_once()
        args, kwargs = mock_send.call_args
        sent_text = kwargs.get("text", args[1] if len(args) > 1 else "")
        assert "Media Received" in sent_text
        assert "Interstellar.2014.1080p.mkv" in sent_text
        assert "Queued for cloud transfer" in sent_text

        # Verify record in SQLite
        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(
                TelegramTransfer.telegram_file_id == "telegram_doc_file_12345"
            )
            result = await session.execute(stmt)
            transfer = result.scalar_one_or_none()
            assert transfer is not None
            assert transfer.filename == "Interstellar.2014.1080p.mkv"
            assert transfer.size == 13314398621
            assert transfer.status == TransferStatus.QUEUED
            assert transfer.telegram_chat_id == 8142877259


@pytest.mark.asyncio
async def test_transfers_api(clean_db):
    # Insert a test transfer in SQLite
    async with AsyncSessionLocal() as session:
        t = TelegramTransfer(
            telegram_chat_id=8142877259,
            telegram_message_id=202,
            telegram_file_id="tg_test_api_file",
            filename="Test_Episode_01.mkv",
            size=104857600,
            status=TransferStatus.QUEUED,
        )
        session.add(t)
        await session.commit()
        await session.refresh(t)
        t_id = t.id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Test listing transfers
        res = await client.get("/transfers")
        assert res.status_code == 200
        transfers = res.json()
        assert len(transfers) >= 1
        assert any(item["id"] == t_id for item in transfers)

        # Test single transfer
        res_single = await client.get(f"/transfers/{t_id}")
        assert res_single.status_code == 200
        data = res_single.json()
        assert data["filename"] == "Test_Episode_01.mkv"
        assert data["status"] == "QUEUED"
