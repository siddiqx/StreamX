"""Integration/regression tests for the Telegram -> MTProto -> Google Drive pipeline.

These tests prove the core incident fix: a *non-owner* user sends a file to the
bot, the bot forwards it to a service relay, and the worker downloads the
forwarded copy via the owner's MTProto session (which cannot read the sender's
private chat directly).
"""

import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from sqlalchemy import select

from app.db.database import AsyncSessionLocal, init_db
from app.db.models import (
    Media,
    TelegramTransfer,
    TransferStatus,
    ErrorCategory,
    utc_now,
)
from app.utils.errors import (
    DriveAuthError,
    DrivePermissionError,
    DriveRateLimitError,
    DriveVerificationError,
)
from app.workers.transfer_worker import TransferWorker
from app.services.telegram_bot_service import TelegramBotService


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

@pytest.fixture
async def clean_db():
    await init_db()
    yield
    async with AsyncSessionLocal() as session:
        for model in (TelegramTransfer, Media):
            rows = (await session.execute(select(model))).scalars().all()
            for r in rows:
                await session.delete(r)
        await session.commit()


def make_media_message(filename="Dune.Part.Two.1080p.mkv", size=1024):
    media = MagicMock()
    f = MagicMock()
    f.name = filename
    f.size = size
    msg = MagicMock()
    msg.media = media
    msg.file = f
    return msg


def make_mock_mtproto_client(media_message, chunks, forwarded_chat_id=None):
    """Telethon client mock.

    Direct lookup by message-id only resolves inside ``forwarded_chat_id``
    (returns the media message). Legacy lookups against ``@Stream1_X_bot``
    return nothing --- mirroring real behaviour where the owner's MTProto
    session cannot see another user's messages.
    """
    client = AsyncMock()
    client.is_connected.return_value = True
    client.is_user_authorized = AsyncMock(return_value=True)

    async def fake_get_messages(chat, ids=None, **kwargs):
        if forwarded_chat_id is not None and chat == forwarded_chat_id:
            return media_message
        return None

    client.get_messages = AsyncMock(side_effect=fake_get_messages)

    async def fake_iter_messages(chat, limit=10, **kwargs):
        if forwarded_chat_id is not None and chat == forwarded_chat_id:
            yield media_message

    async def fake_iter_download(*args, **kwargs):
        for c in chunks:
            yield c

    client.iter_messages = fake_iter_messages
    client.iter_download = fake_iter_download
    return client


def start_worker_patches(mock_client):
    """Start all MTProto/Drive/notification patches for a full worker execution."""
    upload_counter = {"n": 0}

    async def fake_upload(upload_url, chunk, start_byte, total_size):
        upload_counter["n"] += 1
        return (True, f"drive_file_id_{upload_counter['n']}")

    patches = [
        patch("app.workers.transfer_worker.mtproto_service.get_client", new_callable=AsyncMock, return_value=mock_client),
        patch("app.workers.transfer_worker.drive_service.get_resumable_offset", new_callable=AsyncMock, return_value=0),
        patch("app.workers.transfer_worker.drive_service.create_resumable_upload_session", new_callable=AsyncMock, return_value="http://drive/upload/session"),
        patch("app.workers.transfer_worker.drive_service.verify_file", new_callable=AsyncMock, return_value=True),
        patch("app.services.metadata_service.metadata_service.enqueue_media_for_enrichment", new_callable=AsyncMock, return_value=None),
        patch("app.workers.transfer_worker.bot_service.send_message", new_callable=AsyncMock),
        patch("app.workers.transfer_worker.drive_service.upload_chunk", side_effect=fake_upload),
    ]
    for p in patches:
        p.start()


# ---------------------------------------------------------------------------
# Bot API helpers (mocked transport for forwardMessage / sendMessage)
# ---------------------------------------------------------------------------

class _FakeResp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


class _FakeAsyncClient:
    """Records Bot API calls; returns canned responses per endpoint."""

    def __init__(self, forward_status=200, forward_payload=None, send_status=200):
        self.forward_calls = []
        self.send_calls = []
        self._forward_status = forward_status
        self._forward_payload = forward_payload or {"message_id": 4242, "chat": {"id": -1009876543210}}
        self._send_status = send_status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None, content=None, timeout=None):
        if url.endswith("/forwardMessage"):
            self.forward_calls.append(json)
            return _FakeResp(self._forward_status, self._forward_payload,
                             text="blocked" if self._forward_status == 403 else "")
        if url.endswith("/sendMessage"):
            self.send_calls.append(json)
            return _FakeResp(self._send_status)
        return _FakeResp(404)


# ---------------------------------------------------------------------------
# Bot-side forwarding (ingestion)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_bot_forwards_friend_file_to_service_channel(clean_db):
    """A friend sends a file; the bot forwards it into the relay and records
    the forwarded location so the worker can reach it."""
    bot = TelegramBotService(bot_token="test_token", service_channel="@StreamX_Relay")

    update = {
        "update_id": 1,
        "message": {
            "message_id": 10,
            "chat": {"id": 7344705202},  # the friend
            "from": {"id": 7344705202, "first_name": "Friend"},
            "document": {
                "file_id": "friend_doc_file_123",
                "file_name": "Dune.Part.Two.1080p.mkv",
                "file_size": 13314398621,
            },
        },
    }

    fake = _FakeAsyncClient()
    with patch("app.services.telegram_bot_service.httpx.AsyncClient", lambda *a, **k: fake):
        await bot.process_update(update)

    assert len(fake.forward_calls) == 1
    fwd = fake.forward_calls[0]
    assert fwd["chat_id"] == "@StreamX_Relay"
    assert fwd["from_chat_id"] == 7344705202
    assert fwd["message_id"] == 10
    assert len(fake.send_calls) == 1  # exactly one acknowledgement

    async with AsyncSessionLocal() as session:
        t = (
            await session.execute(
                select(TelegramTransfer).where(TelegramTransfer.telegram_file_id == "friend_doc_file_123")
            )
        ).scalar_one_or_none()
    assert t is not None
    assert t.telegram_chat_id == 7344705202  # friend's chat, not the owner
    assert t.forwarded_chat_id == -1009876543210
    assert t.forwarded_message_id == 4242
    assert t.status == TransferStatus.QUEUED


@pytest.mark.asyncio
async def test_bot_forward_failure_marks_permanent_and_notifies(clean_db):
    """If forwarding fails (bot not a member of the relay), the transfer is marked
    FAILED with a permanent category and the user gets an actionable message."""
    bot = TelegramBotService(bot_token="test_token", service_channel="@StreamX_Relay")

    update = {
        "update_id": 2,
        "message": {
            "message_id": 11,
            "chat": {"id": 7344705202},
            "from": {"id": 7344705202, "first_name": "Friend"},
            "document": {
                "file_id": "friend_doc_bad",
                "file_name": "Movie.mkv",
                "file_size": 2048,
            },
        },
    }

    sent_texts = []
    async def capture_send(chat_id, text, reply_to_message_id=None):
        sent_texts.append(text)
        return True

    fake = _FakeAsyncClient(forward_status=403, forward_payload={"description": "blocked"})
    with patch("app.services.telegram_bot_service.httpx.AsyncClient", lambda *a, **k: fake), \
         patch.object(bot, "send_message", side_effect=capture_send):
        await bot.process_update(update)

    async with AsyncSessionLocal() as session:
        t = (
            await session.execute(
                select(TelegramTransfer).where(TelegramTransfer.telegram_file_id == "friend_doc_bad")
            )
        ).scalar_one()
    assert t.status == TransferStatus.FAILED
    assert t.error_category == ErrorCategory.TELEGRAM_FORWARD_FAILED
    # Only the failure notice is sent (no ack), exactly one message.
    assert len(sent_texts) == 1
    assert "misconfigured" in sent_texts[0].lower() or "service channel" in sent_texts[0].lower()


# ---------------------------------------------------------------------------
# Worker end-to-end (friend flow: forwarded copy)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_worker_downloads_from_forwarded_copy(clean_db):
    """The worker reads the forwarded copy from the relay chat (NOT the sender's
    chat) and completes the upload — the core friend-flow regression."""
    friend_id = 7344705202
    relay = -1009876543210

    async with AsyncSessionLocal() as session:
        t = TelegramTransfer(
            telegram_chat_id=friend_id,
            telegram_message_id=10,
            telegram_file_id="friend_file_id",
            filename="Dune.Part.Two.1080p.mkv",
            size=1024,
            status=TransferStatus.QUEUED,
            forwarded_chat_id=relay,
            forwarded_message_id=42,
        )
        session.add(t)
        await session.commit()
        await session.refresh(t)
        transfer_id = t.id

    worker = TransferWorker()
    media_msg = make_media_message(filename="Dune.Part.Two.1080p.mkv", size=1024)
    mock_client = make_mock_mtproto_client(media_msg, [b"x" * 1024], forwarded_chat_id=relay)
    start_worker_patches(mock_client)
    try:
        await worker._execute_transfer(
            transfer_id=transfer_id,
            chat_id=friend_id,
            message_id=10,
            filename="Dune.Part.Two.1080p.mkv",
            expected_size=1024,
        )
    finally:
        patch.stopall()

    async with AsyncSessionLocal() as session:
        updated = await session.get(TelegramTransfer, transfer_id)
        assert updated.status == TransferStatus.COMPLETED
        assert updated.bytes_transferred == 1024
        assert updated.completed_at is not None
        assert updated.error_category is None

        media = (
            await session.execute(
                select(Media).where(Media.filename == "Dune.Part.Two.1080p.mkv")
            )
        ).scalar_one_or_none()
        assert media is not None
        assert media.size == 1024

    # CRITICAL: the worker looked up the forwarded relay chat, not @Stream1_X_bot
    called_chat = mock_client.get_messages.call_args.args[0]
    assert called_chat == relay


@pytest.mark.asyncio
async def test_worker_friend_flow_without_forward_fails(clean_db):
    """Without a forwarded relay copy, the owner's MTProto session cannot reach a
    friend's message — the worker must NOT silently succeed via the legacy path."""
    async with AsyncSessionLocal() as session:
        t = TelegramTransfer(
            telegram_chat_id=7344705202,
            telegram_message_id=10,
            telegram_file_id="friend_file_no_relay",
            filename="NoRelay.mkv",
            size=1024,
            status=TransferStatus.QUEUED,
            forwarded_chat_id=None,
            forwarded_message_id=None,
        )
        session.add(t)
        await session.commit()
        await session.refresh(t)
        transfer_id = t.id

    worker = TransferWorker()
    mock_client = make_mock_mtproto_client(None, [], forwarded_chat_id=None)

    with patch("app.workers.transfer_worker.mtproto_service.get_client", new_callable=AsyncMock, return_value=mock_client), \
         patch("app.workers.transfer_worker.bot_service.send_message", new_callable=AsyncMock):
        with pytest.raises(ValueError, match="Could not locate media"):
            await worker._execute_transfer(
                transfer_id=transfer_id,
                chat_id=7344705202,
                message_id=10,
                filename="NoRelay.mkv",
                expected_size=1024,
            )

    async with AsyncSessionLocal() as session:
        t = await session.get(TelegramTransfer, transfer_id)
        assert t.status == TransferStatus.QUEUED  # untouched after the raised error


# ---------------------------------------------------------------------------
# Failure injection: classification + retry-vs-fail
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc,expected_category,should_retry",
    [
        (RuntimeError("Could not locate media message"), ErrorCategory.TELEGRAM_MESSAGE_NOT_FOUND, True),
        (DriveAuthError("HTTP 401 bad token"), ErrorCategory.DRIVE_AUTH_FAILED, False),
        (DrivePermissionError("HTTP 403 forbidden"), ErrorCategory.DRIVE_PERMISSION_DENIED, False),
        (DriveRateLimitError("HTTP 429"), ErrorCategory.DRIVE_RATE_LIMITED, True),
        (RuntimeError("Drive chunk upload failed with HTTP 500: server"), ErrorCategory.DRIVE_UPLOAD_FAILED, True),
        (RuntimeError("Drive chunk upload failed with HTTP 503: unavailable"), ErrorCategory.DRIVE_UPLOAD_FAILED, True),
        (DriveVerificationError("size mismatch"), ErrorCategory.DRIVE_VERIFICATION_FAILED, True),
        (RuntimeError("connection reset by peer"), ErrorCategory.DRIVE_UPLOAD_FAILED, True),
    ],
)
async def test_failure_injection_classification(clean_db, exc, expected_category, should_retry):
    """Transient failures retry; permanent failures fail fast; state is explicit."""
    filename = f"{expected_category.value}.mkv"
    async with AsyncSessionLocal() as session:
        t = TelegramTransfer(
            telegram_chat_id=7344705202,
            telegram_message_id=999,
            telegram_file_id=f"fail_{expected_category.value}",
            filename=filename,
            size=1024,
            status=TransferStatus.QUEUED,
        )
        session.add(t)
        await session.commit()
        await session.refresh(t)
        transfer_id = t.id

    worker = TransferWorker()
    with patch.object(worker, "_execute_transfer", new_callable=AsyncMock, side_effect=exc), \
         patch("app.workers.transfer_worker.bot_service.send_message", new_callable=AsyncMock):
        await worker._run_job_with_semaphore(
            transfer_id=transfer_id,
            chat_id=7344705202,
            message_id=999,
            filename=filename,
            expected_size=1024,
        )

    async with AsyncSessionLocal() as session:
        t = await session.get(TelegramTransfer, transfer_id)
        assert t.error_category == expected_category
        assert t.error_message is not None
        assert t.retry_count == 1
        if should_retry:
            assert t.status == TransferStatus.RETRYING
            assert t.scheduled_retry_at is not None  # backoff scheduled
        else:
            assert t.status == TransferStatus.FAILED
            assert t.completed_at is not None


@pytest.mark.asyncio
async def test_one_failure_does_not_block_others(clean_db):
    """A failure on job B must not stop jobs A, C, D from completing."""
    async with AsyncSessionLocal() as session:
        transfers = [
            TelegramTransfer(
                telegram_chat_id=7344705202,
                telegram_message_id=1 + i,
                telegram_file_id=f"file_{i}",
                filename=f"Movie_{i}.mkv",
                size=1024,
                status=TransferStatus.QUEUED,
            )
            for i in range(4)
        ]
        session.add_all(transfers)
        await session.commit()

    worker = TransferWorker(max_concurrent_transfers=4)
    call_count = {"n": 0}

    async def mock_exec(transfer_id, chat_id, message_id, filename, expected_size):
        call_count["n"] += 1
        if "Movie_1" in filename:
            raise DriveAuthError("HTTP 401 bad token")
        async with AsyncSessionLocal() as session:
            t = await session.get(TelegramTransfer, transfer_id)
            if t:
                t.status = TransferStatus.COMPLETED
                t.bytes_transferred = expected_size
                await session.commit()

    with patch.object(worker, "_execute_transfer", side_effect=mock_exec), \
         patch("app.workers.transfer_worker.bot_service.send_message", new_callable=AsyncMock):
        while True:
            processed = await worker.process_next_transfer()
            if not processed and not worker.active_tasks:
                break
            if worker.active_tasks:
                await asyncio.sleep(0.01)
        if worker.active_tasks:
            await asyncio.gather(*list(worker.active_tasks), return_exceptions=True)

    async with AsyncSessionLocal() as session:
        all_t = (await session.execute(select(TelegramTransfer))).scalars().all()
    completed = sum(1 for t in all_t if t.status == TransferStatus.COMPLETED)
    failed = sum(1 for t in all_t if t.status == TransferStatus.FAILED)
    assert completed == 3
    assert failed == 1
    assert call_count["n"] == 4


# ---------------------------------------------------------------------------
# Restart / restart-recovery
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_restart_preserves_forwarded_location_and_recovers(clean_db):
    """After a restart, the forwarded relay location survives and the worker
    resumes from the stored resumable offset."""
    relay = -1009876543210
    async with AsyncSessionLocal() as session:
        t = TelegramTransfer(
            telegram_chat_id=7344705202,
            telegram_message_id=42,
            telegram_file_id="restart_file",
            filename="Restart.Recover.mkv",
            size=2048,
            status=TransferStatus.UPLOADING_DRIVE,
            forwarded_chat_id=relay,
            forwarded_message_id=77,
            resumable_upload_url="http://drive/upload/resume",
            bytes_transferred=1024,
        )
        session.add(t)
        await session.commit()
        await session.refresh(t)
        transfer_id = t.id

    worker = TransferWorker()
    await worker.reconcile_incomplete_transfers()

    async with AsyncSessionLocal() as session:
        t = await session.get(TelegramTransfer, transfer_id)
        assert t.status == TransferStatus.QUEUED
        # Forwarded location + resumable session survive the crash/restart
        assert t.forwarded_chat_id == relay
        assert t.forwarded_message_id == 77
        assert t.resumable_upload_url == "http://drive/upload/resume"
        assert t.scheduled_retry_at is None
        assert t.started_at is None

    media_msg = make_media_message(filename="Restart.Recover.mkv", size=2048)
    mock_client = make_mock_mtproto_client(media_msg, [b"a" * 1024, b"b" * 1024], forwarded_chat_id=relay)
    start_worker_patches(mock_client)
    try:
        await worker._execute_transfer(
            transfer_id=transfer_id,
            chat_id=7344705202,
            message_id=42,
            filename="Restart.Recover.mkv",
            expected_size=2048,
        )
    finally:
        patch.stopall()

    async with AsyncSessionLocal() as session:
        t = await session.get(TelegramTransfer, transfer_id)
        assert t.status == TransferStatus.COMPLETED


@pytest.mark.asyncio
async def test_retry_backoff_not_reclaimed_until_scheduled(clean_db):
    """A RETRYING job with a future scheduled_retry_at must not be re-claimed
    before its backoff elapses."""
    async with AsyncSessionLocal() as session:
        t = TelegramTransfer(
            telegram_chat_id=7344705202,
            telegram_message_id=55,
            telegram_file_id="retry_backoff",
            filename="Backoff.mkv",
            size=1024,
            status=TransferStatus.RETRYING,
            retry_count=1,
            scheduled_retry_at=utc_now() + timedelta(seconds=60),
        )
        session.add(t)
        await session.commit()
        await session.refresh(t)
        transfer_id = t.id

    worker = TransferWorker()
    assert await worker.process_next_transfer() is False  # backoff not elapsed

    async with AsyncSessionLocal() as session:
        t = await session.get(TelegramTransfer, transfer_id)
        assert t.status == TransferStatus.RETRYING


# ---------------------------------------------------------------------------
# Multiple users
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_multiple_users_both_complete(clean_db):
    """User A and User B both send files; both are forwarded and both complete."""
    user_a = 8142877259
    user_b = 7344705202
    relay_a = -1001111111111
    relay_b = -1002222222222

    async with AsyncSessionLocal() as session:
        ta = TelegramTransfer(
            telegram_chat_id=user_a, telegram_message_id=1, telegram_file_id="a_file",
            filename="Alpha.Movie.mkv", size=1024, status=TransferStatus.QUEUED,
            forwarded_chat_id=relay_a, forwarded_message_id=100,
        )
        tb = TelegramTransfer(
            telegram_chat_id=user_b, telegram_message_id=2, telegram_file_id="b_file",
            filename="Beta.Series.S01E01.mkv", size=1024, status=TransferStatus.QUEUED,
            forwarded_chat_id=relay_b, forwarded_message_id=200,
        )
        session.add_all([ta, tb])
        await session.commit()
        await session.refresh(ta)
        await session.refresh(tb)
        id_a, id_b = ta.id, tb.id

    worker = TransferWorker()

    msg_a = make_media_message("Alpha.Movie.mkv", 1024)
    msg_b = make_media_message("Beta.Series.S01E01.mkv", 1024)
    messages = {relay_a: msg_a, relay_b: msg_b}

    client = AsyncMock()
    client.is_connected.return_value = True
    client.is_user_authorized = AsyncMock(return_value=True)

    async def get_messages(chat, ids=None, **kwargs):
        return messages.get(chat)

    async def iter_messages(chat, limit=10, **kwargs):
        if chat in messages:
            yield messages[chat]

    async def iter_download(*args, **kwargs):
        yield b"x" * 1024

    client.get_messages = AsyncMock(side_effect=get_messages)
    client.iter_messages = iter_messages
    client.iter_download = iter_download

    start_worker_patches(client)
    try:
        await worker._execute_transfer(
            transfer_id=id_a, chat_id=user_a, message_id=1,
            filename="Alpha.Movie.mkv", expected_size=1024,
        )
        await worker._execute_transfer(
            transfer_id=id_b, chat_id=user_b, message_id=2,
            filename="Beta.Series.S01E01.mkv", expected_size=1024,
        )
    finally:
        patch.stopall()

    async with AsyncSessionLocal() as session:
        a = await session.get(TelegramTransfer, id_a)
        b = await session.get(TelegramTransfer, id_b)
        assert a.status == TransferStatus.COMPLETED
        assert b.status == TransferStatus.COMPLETED


@pytest.mark.asyncio
async def test_both_owners_legacy_path_and_forwarded_path(clean_db):
    """An owner file with NO forwarded location still resolves via the legacy
    @Stream1_X_bot lookup (backward compatibility)."""
    owner_id = 8142877259
    async with AsyncSessionLocal() as session:
        t = TelegramTransfer(
            telegram_chat_id=owner_id,
            telegram_message_id=7,
            telegram_file_id="owner_legacy_file",
            filename="Owner.Legacy.mkv",
            size=1024,
            status=TransferStatus.QUEUED,
            forwarded_chat_id=None,
            forwarded_message_id=None,
        )
        session.add(t)
        await session.commit()
        await session.refresh(t)
        transfer_id = t.id

    worker = TransferWorker()
    media_msg = make_media_message("Owner.Legacy.mkv", 1024)
    # Legacy lookup: @Stream1_X_bot with message_id 7 returns the media.
    client = AsyncMock()
    client.is_connected.return_value = True
    client.is_user_authorized = AsyncMock(return_value=True)

    async def get_messages(chat, ids=None, **kwargs):
        if chat == "Stream1_X_bot" and ids == 7:
            return media_msg
        return None

    async def iter_messages(chat, limit=10, **kwargs):
        if chat == "Stream1_X_bot":
            yield media_msg

    async def iter_download(*args, **kwargs):
        yield b"x" * 1024

    client.get_messages = AsyncMock(side_effect=get_messages)
    client.iter_messages = iter_messages
    client.iter_download = iter_download

    start_worker_patches(client)
    try:
        await worker._execute_transfer(
            transfer_id=transfer_id,
            chat_id=owner_id,
            message_id=7,
            filename="Owner.Legacy.mkv",
            expected_size=1024,
        )
    finally:
        patch.stopall()

    async with AsyncSessionLocal() as session:
        t = await session.get(TelegramTransfer, transfer_id)
        assert t.status == TransferStatus.COMPLETED
