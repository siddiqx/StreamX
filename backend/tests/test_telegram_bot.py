"""Tests for Phase 2 Telegram Bot Ingestion and Transfers API."""

from unittest.mock import AsyncMock, patch
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import TelegramTransfer, TransferStatus, Media
from app.main import app
from app.services.telegram_bot_service import TelegramBotService
from app.utils.filenames import sanitize_filename


@pytest.fixture
async def clean_db():
    await init_db()
    async with AsyncSessionLocal() as session:
        for model in (TelegramTransfer, Media):
            rows = (await session.execute(select(model))).scalars().all()
            for r in rows:
                await session.delete(r)
        await session.commit()
    yield
    async with AsyncSessionLocal() as session:
        for model in (TelegramTransfer, Media):
            rows = (await session.execute(select(model))).scalars().all()
            for r in rows:
                await session.delete(r)
        await session.commit()


def test_sanitize_filename():
    assert sanitize_filename("../../Interstellar.2014.1080p.mkv") == "Interstellar.2014.1080p.mkv"
    assert sanitize_filename("..\\..\\secret.mkv") == "secret.mkv"
    assert sanitize_filename("bad:name?.mp4") == "bad_name_.mp4"
    assert sanitize_filename("") == "streamx_file.bin"


@pytest.mark.asyncio
async def test_bot_unauthorized_user(clean_db):
    bot = TelegramBotService(bot_token="test_token")
    with patch.object(bot, "send_message", new_callable=AsyncMock) as mock_send, \
         patch.object(bot, "is_user_allowed", return_value=False):
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
    bot = TelegramBotService(bot_token="test_token", owner_user_id=8142877259)

    # Mock the forwardMessage API call to succeed
    class _FakeResp:
        def __init__(self, status_code=200, payload=None, text=""):
            self.status_code = status_code
            self._payload = payload or {}
            self.text = text

        def json(self):
            return self._payload

    class _FakeAsyncClient:
        def __init__(self):
            self.forward_calls = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None, content=None, timeout=None):
            if url.endswith("/forwardMessage"):
                self.forward_calls.append(json)
                return _FakeResp(200, {"ok": True, "result": {"message_id": 999, "chat": {"id": 8142877259}}})
            return _FakeResp(404)

    fake = _FakeAsyncClient()
    with patch.object(bot, "send_message", new_callable=AsyncMock) as mock_send, \
         patch("app.services.telegram_bot_service.httpx.AsyncClient", lambda *a, **k: fake):
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


@pytest.mark.asyncio
async def test_bot_duplicate_media_ingestion_skipped(clean_db):
    """Sending the same file twice (or via automatic forward) must not create duplicate transfers."""
    from app.db.models import Media

    bot = TelegramBotService(bot_token="test_token", owner_user_id=8142877259)

    update1 = {
        "update_id": 10,
        "message": {
            "message_id": 501,
            "chat": {"id": 8142877259},
            "from": {"id": 8142877259, "first_name": "Siddiq"},
            "document": {
                "file_id": "file_alpha_1",
                "file_name": "What.If.S01E01.1080p.mkv",
                "file_size": 500000000,
            },
        },
    }

    update_forwarded_duplicate = {
        "update_id": 11,
        "message": {
            "message_id": 502,
            "chat": {"id": 8142877259},
            "from": {"id": 8142877259, "first_name": "Siddiq"},
            "document": {
                "file_id": "file_alpha_2",
                "file_name": "What.If.S01E01.1080p.mkv",
                "file_size": 500000000,
            },
        },
    }

    sent_messages = []
    async def mock_send(chat_id, text, reply_to_message_id=None):
        sent_messages.append((chat_id, text))
        return True

    with patch.object(bot, "send_message", side_effect=mock_send):
        # 1. Process first update
        await bot.process_update(update1)

        # 2. Process duplicate update (automatic forward)
        await bot.process_update(update_forwarded_duplicate)

    # Verify only ONE transfer was created in SQLite
    async with AsyncSessionLocal() as session:
        transfers = (await session.execute(select(TelegramTransfer))).scalars().all()
        assert len(transfers) == 1
        assert transfers[0].filename == "What.If.S01E01.1080p.mkv"

    # Verify the second response informed the user of duplicate / already active
    assert len(sent_messages) == 2
    assert "Media Received" in sent_messages[0][1]
    assert "Transfer Already in Progress" in sent_messages[1][1] or "Duplicate" in sent_messages[1][1]


@pytest.mark.asyncio
async def test_bot_rich_commands(clean_db):
    """Test all new interactive commands: /ping, /queue, /library, /retry, /cancel, and setMyCommands."""
    from app.db.models import Media

    bot = TelegramBotService(bot_token="test_token", owner_user_id=8142877259)

    # 1. Test register_bot_commands
    class _FakeResp:
        def __init__(self, status_code=200):
            self.status_code = status_code
            self.text = "ok"

    with patch("app.services.telegram_bot_service.httpx.AsyncClient.post", return_value=_FakeResp(200)):
        assert await bot.register_bot_commands() is True

    # 2. Add test media and transfers
    async with AsyncSessionLocal() as session:
        session.add(Media(
            drive_file_id="drive_test_123",
            filename="Show.S01E01.mkv",
            size=104857600,
            mime_type="video/x-matroska",
        ))
        t1 = TelegramTransfer(
            telegram_chat_id=8142877259,
            telegram_message_id=901,
            telegram_file_id="f_act_1",
            filename="Show.S01E02.mkv",
            size=209715200,
            bytes_transferred=104857600,
            status=TransferStatus.UPLOADING_DRIVE,
        )
        t2 = TelegramTransfer(
            telegram_chat_id=8142877259,
            telegram_message_id=902,
            telegram_file_id="f_fail_1",
            filename="Show.S01E03.mkv",
            size=314572800,
            status=TransferStatus.FAILED,
            error_message="Network timeout",
        )
        session.add_all([t1, t2])
        await session.commit()
        t1_id = t1.id
        t2_id = t2.id

    sent_replies = []
    async def mock_send(chat_id, text, reply_to_message_id=None):
        sent_replies.append(text)
        return True

    with patch.object(bot, "send_message", side_effect=mock_send):
        # /ping
        await bot.process_update({"update_id": 20, "message": {"message_id": 1, "chat": {"id": 8142877259}, "from": {"id": 8142877259}, "text": "/ping"}})
        assert "Pong" in sent_replies[-1]

        # /queue
        await bot.process_update({"update_id": 21, "message": {"message_id": 2, "chat": {"id": 8142877259}, "from": {"id": 8142877259}, "text": "/queue"}})
        assert "Show.S01E02.mkv" in sent_replies[-1]
        assert "50%" in sent_replies[-1]

        # /library
        await bot.process_update({"update_id": 22, "message": {"message_id": 3, "chat": {"id": 8142877259}, "from": {"id": 8142877259}, "text": "/library"}})
        assert "Show.S01E01.mkv" in sent_replies[-1]
        assert "Total Cataloged Media:</b> 1" in sent_replies[-1]

        # /cancel
        await bot.process_update({"update_id": 23, "message": {"message_id": 4, "chat": {"id": 8142877259}, "from": {"id": 8142877259}, "text": f"/cancel {t1_id}"}})
        assert f"Transfer #{t1_id} Cancelled" in sent_replies[-1]

        # /retry
        await bot.process_update({"update_id": 24, "message": {"message_id": 5, "chat": {"id": 8142877259}, "from": {"id": 8142877259}, "text": f"/retry {t2_id}"}})
        assert "Re-queued" in sent_replies[-1]
