"""Transfer background worker for StreamX.

Polls SQLite for QUEUED/RETRYING transfers, streams media chunks via the owner's
MTProto session, pipes chunks directly into Google Drive resumable upload
sessions, and catalogs completed files in SQLite. Zero full-disk requirements:
all chunk processing is handled in-flight in RAM.

Media relay note:
  The MTProto session is a SINGLE user account (the owner). It cannot read
  messages sent to the bot by *other* users, so the bot forwards every accepted
  file into a service channel (or the owner's DM) and stores the forwarded
  location on the transfer row. The worker downloads that forwarded copy.

Error model:
  Every failure is classified (see app/utils/errors.py). Permanent config errors
  are marked FAILED immediately without burning retries; transient errors are
  retried with bounded exponential backoff and remain durable across restarts.
"""

import asyncio
import time
from datetime import timedelta
from typing import Optional
import httpx
from sqlalchemy import or_, select

from app.config.settings import settings
from app.db.database import AsyncSessionLocal
from app.db.models import (
    Media,
    TelegramTransfer,
    TransferStatus,
    utc_now,
)
from app.services.drive_service import drive_service
from app.services.telegram_bot_service import bot_service
from app.services.telegram_mtproto_service import mtproto_service
from app.utils.errors import (
    DriveUploadError,
    ErrorCategory,
    classify_error,
)
from app.utils.filenames import format_bytes, resolve_mime_type, sanitize_filename
from app.utils.logging import log_event, logger


from app.utils.filename_parser import parse_filename
from app.utils.media_classifier import (
    classify_media,
    has_anime_signals,
    has_episodic_signals,
    is_media_file,
    MediaTaxonomy,
)


# How far back the worker scans a channel when a direct message-id lookup fails.
# Generous bound so batch uploads (which are queued in order) are reliably found
# even if Bot-API and MTProto disagree on the message id for a forwarded copy.
FORWARDED_SEARCH_LIMIT = 50


def detect_category(filename: str) -> str:
    """Classify media into Movies, TV Shows, Anime, Anime Movies, or Other using multi-signal classifier."""
    parsed = parse_filename(filename)
    _, cat = classify_media(parsed, raw_filename=filename)
    return cat


db_claim_lock = asyncio.Lock()


class TransferWorker:
    def __init__(self, max_concurrent_transfers: Optional[int] = None):
        self.running = False
        self.task: Optional[asyncio.Task] = None
        self.max_concurrent_transfers = (
            max_concurrent_transfers if max_concurrent_transfers is not None else settings.TRANSFER_MAX_CONCURRENT
        )
        self.semaphore = asyncio.Semaphore(self.max_concurrent_transfers)
        self.active_tasks = set()
        self.active_jobs = {}  # transfer_id -> (task, stop_event)

    def cancel_transfer(self, transfer_id: int) -> bool:
        """Cancel an in-flight transfer immediately without retry or failure notification."""
        job = self.active_jobs.get(transfer_id)
        if job:
            task, stop_event = job
            stop_event.set()
            task.cancel()
            log_event("TRANSFER_CANCELLED_BY_USER", transfer_id=transfer_id)
            return True
        return False

    _last_edge_sync: float = 0.0

    async def broadcast_transfers_to_edge(self) -> None:
        """Push real-time transfer progress to Cloudflare edge worker so Vercel production site reflects live downloads."""
        now = time.time()
        if now - TransferWorker._last_edge_sync < 1.5:
            return
        TransferWorker._last_edge_sync = now

        try:
            async with AsyncSessionLocal() as session:
                stmt = (
                    select(TelegramTransfer)
                    .where(TelegramTransfer.is_deleted.is_(False))
                    .order_by(TelegramTransfer.id.desc())
                    .limit(30)
                )
                rows = (await session.execute(stmt)).scalars().all()
                payload = [
                    {
                        "id": t.id,
                        "filename": t.filename,
                        "size": t.size,
                        "status": t.status.value,
                        "bytes_transferred": t.bytes_transferred or 0,
                        "error_message": t.error_message,
                        "telegram_chat_id": t.telegram_chat_id,
                        "telegram_message_id": t.telegram_message_id,
                        "created_at": t.created_at.isoformat() if t.created_at else None,
                        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
                    }
                    for t in rows
                ]

            worker_url = "https://streamx-worker.siddiqsiddiq00012.workers.dev/api/transfers/sync"
            headers = {"Content-Type": "application/json"}
            if settings.TELEGRAM_WEBHOOK_SECRET:
                headers["X-Telegram-Bot-Api-Secret-Token"] = settings.TELEGRAM_WEBHOOK_SECRET
            async with httpx.AsyncClient(timeout=3.0) as client:
                await client.post(worker_url, json={"transfers": payload}, headers=headers)
        except Exception as e:
            logger.debug(f"Edge transfer sync notice: {e}")

    async def resolve_transfer_category(self, filename: str, parsed) -> str:
        """Deterministically resolve category with sibling and Drive folder cascading."""
        cat = detect_category(filename)
        if cat in ("Anime", "Anime Movies") or not has_episodic_signals(parsed, raw_filename=filename):
            return cat

        clean_title = (parsed.clean_title or "").lower().strip()
        if not clean_title:
            return cat

        # Check 1: Do we already have an existing folder for this show in Anime on Drive?
        try:
            anime_folder_id = await drive_service.get_folder_id("Anime")
            if anime_folder_id:
                creds = await drive_service.get_credentials()
                service = drive_service._get_drive_client(creds)
                query = f"'{anime_folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                res = service.files().list(q=query, fields="files(name)").execute()
                for f in res.get("files", []):
                    fn = f.get("name", "").lower().strip()
                    if fn == clean_title or clean_title in fn or fn in clean_title:
                        return "Anime"
        except Exception as e:
            logger.debug(f"Drive folder category check warning: {e}")

        # Check 2: Does any other transfer in queue or media in library share this clean_title and is Anime?
        async with AsyncSessionLocal() as session:
            t_stmt = select(TelegramTransfer.filename).where(
                TelegramTransfer.is_deleted.is_(False),
                TelegramTransfer.status.notin_([TransferStatus.CANCELLED, TransferStatus.FAILED]),
            )
            t_rows = (await session.execute(t_stmt)).scalars().all()
            for fn in t_rows:
                p = parse_filename(fn)
                if p.clean_title.lower().strip() == clean_title:
                    if has_anime_signals(p, raw_filename=fn):
                        return "Anime"

            m_stmt = select(Media.filename, Media.category)
            if hasattr(Media, "is_deleted"):
                m_stmt = m_stmt.where(Media.is_deleted.is_(False))
            m_rows = (await session.execute(m_stmt)).all()
            for fn, m_cat in m_rows:
                p = parse_filename(fn)
                if p.clean_title.lower().strip() == clean_title:
                    if m_cat == "Anime" or has_anime_signals(p, raw_filename=fn):
                        return "Anime"

        return cat

    async def reconcile_incomplete_transfers(self) -> None:
        """Section 37: Reconcile transfers left incomplete by dead or restarted processes."""
        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(
                TelegramTransfer.status.in_(
                    [TransferStatus.FETCHING_TELEGRAM, TransferStatus.UPLOADING_DRIVE]
                ),
                TelegramTransfer.is_deleted.is_(False),
            )
            result = await session.execute(stmt)
            incomplete = result.scalars().all()
            for t in incomplete:
                log_event(
                    "RECONCILING_INCOMPLETE_TRANSFER",
                    transfer_id=t.id,
                    filename=t.filename,
                    previous_status=t.status.value,
                )
                t.status = TransferStatus.QUEUED
                # Clear transient progress markers so the job re-runs cleanly.
                t.started_at = None
                t.scheduled_retry_at = None
            if incomplete:
                await session.commit()

    async def start(self) -> None:
        """Start worker loop with crash/restart state reconciliation."""
        self.running = True
        log_event("TRANSFER_WORKER_STARTED", max_concurrent=self.max_concurrent_transfers)
        await self.reconcile_incomplete_transfers()
        while self.running:
            try:
                processed = await self.process_next_transfer()
                if not processed:
                    await asyncio.sleep(3)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in transfer worker loop: {e}", exc_info=True)
                await asyncio.sleep(5)

        log_event("TRANSFER_WORKER_STOPPED")

    def stop(self) -> None:
        self.running = False
        if self.task:
            self.task.cancel()

    async def process_next_transfer(self) -> bool:
        """Find and process the oldest ready QUEUED or RETRYING transfer.

        A RETRYING transfer is only claimed once its backoff `scheduled_retry_at`
        has elapsed, giving transient failures time to recover.
        """
        # Ensure a concurrency slot is free before claiming from the DB.
        if len(self.active_tasks) >= self.max_concurrent_transfers or self.semaphore.locked():
            return False

        now = utc_now()
        async with db_claim_lock:
            async with AsyncSessionLocal() as session:
                stmt = (
                    select(TelegramTransfer)
                    .where(
                        TelegramTransfer.is_deleted.is_(False),
                        TelegramTransfer.status.in_(
                            [TransferStatus.QUEUED, TransferStatus.RETRYING]
                        ),
                        or_(
                            TelegramTransfer.scheduled_retry_at.is_(None),
                            TelegramTransfer.scheduled_retry_at <= now,
                        ),
                    )
                    .order_by(TelegramTransfer.id.asc())
                    .limit(1)
                )
                result = await session.execute(stmt)
                transfer = result.scalar_one_or_none()

                if not transfer:
                    return False

                transfer_id = transfer.id
                chat_id = transfer.telegram_chat_id
                message_id = transfer.telegram_message_id
                filename = transfer.filename
                expected_size = transfer.size

                transfer.status = TransferStatus.FETCHING_TELEGRAM
                transfer.started_at = now
                await session.commit()

        log_event(
            "TRANSFER_PROCESSING_START",
            transfer_id=transfer_id,
            filename=filename,
            size=expected_size,
        )

        task = asyncio.create_task(
            self._run_job_with_semaphore(
                transfer_id=transfer_id,
                chat_id=chat_id,
                message_id=message_id,
                filename=filename,
                expected_size=expected_size,
            )
        )
        self.active_tasks.add(task)
        task.add_done_callback(self.active_tasks.discard)
        return True

    async def _run_job_with_semaphore(
        self,
        transfer_id: int,
        chat_id: int,
        message_id: int,
        filename: str,
        expected_size: int,
    ) -> None:
        stop_event = asyncio.Event()
        current_task = asyncio.current_task()
        self.active_jobs[transfer_id] = (current_task, stop_event)
        try:
            async with self.semaphore:
                # Check if transfer was cancelled or deleted before starting
                async with AsyncSessionLocal() as session:
                    stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                    t = (await session.execute(stmt)).scalar_one_or_none()
                    if not t or t.status == TransferStatus.CANCELLED or getattr(t, "is_deleted", False):
                        log_event("TRANSFER_JOB_SKIPPED_CANCELLED", transfer_id=transfer_id)
                        return

                try:
                    await self._execute_transfer(
                        transfer_id=transfer_id,
                        chat_id=chat_id,
                        message_id=message_id,
                        filename=filename,
                        expected_size=expected_size,
                        stop_event=stop_event,
                    )
                except asyncio.CancelledError:
                    log_event("TRANSFER_JOB_CANCELLED", transfer_id=transfer_id)
                    # Check if transfer was marked cancelled/deleted; if so, exit silently without error
                    async with AsyncSessionLocal() as session:
                        stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                        t = (await session.execute(stmt)).scalar_one_or_none()
                        if t and (t.status == TransferStatus.CANCELLED or getattr(t, "is_deleted", False)):
                            return
                    raise
                except Exception as e:
                    # Check if transfer was cancelled or soft-deleted while running
                    async with AsyncSessionLocal() as session:
                        stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                        t = (await session.execute(stmt)).scalar_one_or_none()
                        if not t or t.status == TransferStatus.CANCELLED or getattr(t, "is_deleted", False):
                            log_event("TRANSFER_JOB_CANCELLED_IGNORING_ERROR", transfer_id=transfer_id, error=str(e))
                            return

                    category = classify_error(e)
                    retryable = category not in {
                        ErrorCategory.TELEGRAM_FORWARD_FAILED,
                        ErrorCategory.DRIVE_AUTH_FAILED,
                        ErrorCategory.DRIVE_PERMISSION_DENIED,
                        ErrorCategory.DRIVE_QUOTA_EXCEEDED,
                    }
                    logger.error(
                        f"Transfer #{transfer_id} failed: {category.value}: {e}",
                        exc_info=True,
                    )
                    async with AsyncSessionLocal() as session:
                        stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                        t = (await session.execute(stmt)).scalar_one_or_none()
                        if t:
                            # Re-verify in case status changed concurrently
                            if t.status == TransferStatus.CANCELLED or getattr(t, "is_deleted", False):
                                return
                            t.retry_count += 1
                            t.error_message = str(e)
                            t.error_category = category
                            if retryable and t.retry_count < settings.MAX_RETRIES:
                                t.status = TransferStatus.RETRYING
                                delay = min(2 ** t.retry_count * 5, 60)
                                t.scheduled_retry_at = utc_now() + timedelta(seconds=delay)
                            else:
                                t.status = TransferStatus.FAILED
                                t.error_message = str(e)
                                t.completed_at = utc_now()
                            await session.commit()

                    # Only send failure notification on terminal failure (not on retries) and never in tests
                    is_test = settings.STREAMX_ENV == "testing" or bool(os.getenv("PYTEST_CURRENT_TEST"))
                    if not is_test and t and t.status == TransferStatus.FAILED and not getattr(t, "is_deleted", False):
                        user_text = self._build_error_notification(
                            transfer_id, filename, category, TransferStatus.FAILED
                        )
                        await bot_service.send_message(chat_id=chat_id, text=user_text)
        finally:
            self.active_jobs.pop(transfer_id, None)

    def _build_error_notification(
        self, transfer_id: int, filename: str, category: ErrorCategory, status: TransferStatus
    ) -> str:
        import html
        from app.utils.errors import CATEGORY_USER_MESSAGE

        summary = CATEGORY_USER_MESSAGE.get(category, "The job has been queued for automatic retry.")
        return (
            f"⚠️ <b>StreamX — Transfer #{transfer_id} Error</b>\n\n"
            f"📁 <b>File:</b> <code>{html.escape(filename)}</code>\n"
            f"📋 <b>Reason:</b> <i>{html.escape(category.value)}</i>\n"
            f"🔄 <b>Status:</b> <code>{html.escape(status.value)}</code>\n\n"
            f"{html.escape(summary)}"
        )

    def _resolve_relay_chat(self):
        """The chat entity the MTProto worker should read forwarded media from.

        Prefers the operator-configured relay target (a public channel username
        or the owner's user id) which Telethon resolves reliably. Bot-API channel
        ids (negative numbers) do not always resolve through MTProto, so we avoid
        depending on them for the primary lookup.
        """
        return bot_service.resolve_forward_target()

    async def _locate_target_message(self, client, transfer: TelegramTransfer, expected_size: int):
        """Resolve a media-bearing Telethon Message for download.

        Prefers the forwarded copy (the only way a non-owner sender's file is
        reachable by the owner's MTProto session). Falls back to a filename/size
        scan of the relay chat, then to the legacy owner-bot lookup for transfers
        created before forwarding was deployed.
        """
        filename = transfer.filename
        clean_filename = sanitize_filename(filename).lower()
        bot_entity = "Stream1_X_bot"

        # Build comprehensive list of chats to check for the media
        chats_to_try = []
        if transfer.forwarded_chat_id is not None:
            chats_to_try.append(transfer.forwarded_chat_id)
        configured = self._resolve_relay_chat()
        if configured is not None and configured not in chats_to_try:
            chats_to_try.append(configured)
        if bot_entity not in chats_to_try:
            chats_to_try.append(bot_entity)

        # 1. Direct lookup by forwarded message id or telegram message id across candidate chats
        ids_to_try = []
        if transfer.forwarded_message_id:
            ids_to_try.append(transfer.forwarded_message_id)
        if transfer.telegram_message_id and transfer.telegram_message_id not in ids_to_try:
            ids_to_try.append(transfer.telegram_message_id)

        for chat in chats_to_try:
            for mid in ids_to_try:
                try:
                    msg = await client.get_messages(chat, ids=mid)
                    if msg and getattr(msg, "media", None):
                        m_name = getattr(getattr(msg, "file", None), "name", None)
                        m_size = getattr(getattr(msg, "file", None), "size", 0)
                        if m_name == filename or (expected_size and m_size == expected_size):
                            return msg
                except Exception as e:
                    logger.debug(f"Direct lookup failed for chat {chat} id {mid}: {e}")

        # 2. Deep scan across chats (up to 250 recent messages) by filename/size
        for chat in chats_to_try:
            try:
                async for msg in client.iter_messages(chat, limit=250):
                    if not getattr(msg, "media", None):
                        continue
                    m_name = getattr(getattr(msg, "file", None), "name", None)
                    m_size = getattr(getattr(msg, "file", None), "size", 0)
                    if not m_name:
                        continue
                    if (
                        m_name == filename
                        or (expected_size and m_size == expected_size)
                        or sanitize_filename(m_name).lower() == clean_filename
                    ):
                        return msg
            except Exception as e:
                logger.warning(f"Chat scan failed for chat {chat} (#{transfer.id}): {e}")

        return None

    async def _execute_transfer(
        self,
        transfer_id: int,
        chat_id: int,
        message_id: int,
        filename: str,
        expected_size: int,
        stop_event: Optional[asyncio.Event] = None,
    ) -> None:
        """Stream chunks from Telegram via MTProto directly into Google Drive resumable upload."""
        # 1. Duplicate Detection (Section 23)
        async with AsyncSessionLocal() as session:
            existing_media = (
                await session.execute(
                    select(Media).where(
                        Media.filename == filename,
                        or_(Media.size == expected_size, expected_size == 0),
                    )
                )
            ).scalars().first()

            if existing_media:
                log_event("DUPLICATE_MEDIA_SKIPPED", filename=filename, size=expected_size)
                stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                t = (await session.execute(stmt)).scalar_one_or_none()
                if t:
                    t.status = TransferStatus.COMPLETED
                    t.bytes_transferred = expected_size
                    t.completed_at = utc_now()
                    t.error_message = None
                    await session.commit()

                await bot_service.send_message(
                    chat_id=chat_id,
                    text=(
                        "ℹ️ <b>StreamX — Duplicate Media Detected</b>\n\n"
                        f"📁 <b>File:</b> <code>{filename}</code>\n"
                        f"📦 <b>Size:</b> {format_bytes(expected_size)}\n"
                        f"☁️ <b>Location:</b> Already exists in Google Drive (<code>{existing_media.drive_file_id}</code>)\n\n"
                        "<i>Skipped re-upload to preserve Google Drive quota.</i>"
                    ),
                )
                return

            # Check if another transfer for the same file was already completed or is currently running
            sibling = (
                await session.execute(
                    select(TelegramTransfer).where(
                        TelegramTransfer.filename == filename,
                        or_(TelegramTransfer.size == expected_size, expected_size == 0),
                        TelegramTransfer.id < transfer_id,
                        TelegramTransfer.status.in_([
                            TransferStatus.FETCHING_TELEGRAM,
                            TransferStatus.UPLOADING_DRIVE,
                            TransferStatus.VERIFYING,
                            TransferStatus.COMPLETED,
                        ]),
                    )
                )
            ).scalars().first()

            if sibling:
                log_event("DUPLICATE_SIBLING_TRANSFER_SKIPPED", transfer_id=transfer_id, sibling_id=sibling.id)
                stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                t = (await session.execute(stmt)).scalar_one_or_none()
                if t:
                    is_completed = sibling.status == TransferStatus.COMPLETED
                    t.status = TransferStatus.COMPLETED if is_completed else TransferStatus.CANCELLED
                    t.bytes_transferred = expected_size if is_completed else 0
                    t.completed_at = utc_now()
                    t.error_message = f"Deduplicated against transfer #{sibling.id}"
                    await session.commit()
                return

        # 2. Locate the media message via MTProto (forwarded copy for non-owners).
        if stop_event and stop_event.is_set():
            return

        client = await mtproto_service.get_client()
        async with AsyncSessionLocal() as session:
            transfer = await session.get(TelegramTransfer, transfer_id)
            if not transfer:
                raise ValueError(f"Transfer #{transfer_id} not found")
            if transfer.status == TransferStatus.CANCELLED or getattr(transfer, "is_deleted", False):
                log_event("TRANSFER_ABORTED_ON_CANCEL", transfer_id=transfer_id)
                return

        target_message = await self._locate_target_message(client, transfer, expected_size)
        if not target_message:
            raise ValueError(
                f"Could not locate media message for '{filename}' in the relay channel. "
                "Ensure TELEGRAM_SERVICE_CHANNEL / TELEGRAM_OWNER_USER_ID is configured and "
                "the bot has forwarded the file into it."
            )

        actual_size = getattr(target_message.file, "size", expected_size)
        mime_type = resolve_mime_type(filename)
        parsed = parse_filename(filename)
        category = await self.resolve_transfer_category(filename, parsed)
        show_name = parsed.clean_title

        # 3. Check / Initialize Google Drive Resumable Session
        upload_url = None
        start_offset = 0

        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
            t = (await session.execute(stmt)).scalar_one_or_none()
            if t and t.resumable_upload_url:
                upload_url = t.resumable_upload_url
                start_offset = await drive_service.get_resumable_offset(upload_url, actual_size)
                if start_offset < 0:
                    log_event("RESUMABLE_SESSION_EXPIRED", transfer_id=transfer_id, url=upload_url)
                    upload_url = None
                    start_offset = 0
                    t.resumable_upload_url = None
                    t.bytes_transferred = 0
                    await session.commit()
                else:
                    log_event("RECOVERY_OFFSET_RESUMED", transfer_id=transfer_id, start_offset=start_offset)

        if not upload_url:
            upload_url = await drive_service.create_resumable_upload_session(
                filename=filename,
                size=actual_size,
                mime_type=mime_type,
                category=category,
                show_name=show_name,
            )
            async with AsyncSessionLocal() as session:
                stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                t = (await session.execute(stmt)).scalar_one_or_none()
                if t:
                    if t.status == TransferStatus.CANCELLED or getattr(t, "is_deleted", False):
                        log_event("TRANSFER_ABORTED_ON_CANCEL", transfer_id=transfer_id)
                        return
                    t.resumable_upload_url = upload_url
                    t.status = TransferStatus.UPLOADING_DRIVE
                    await session.commit()

        # 4. Stream Chunks: Telegram MTProto -> RAM Buffer -> Google Drive Resumable Upload
        log_event(
            "PIPELINE_STREAMING_START",
            transfer_id=transfer_id,
            filename=filename,
            total_size=actual_size,
            start_offset=start_offset,
            forwarded=transfer.forwarded_chat_id is not None,
        )

        start_time = time.time()
        current_offset = start_offset
        drive_file_id = None
        target_chunk_size = 4 * 1024 * 1024  # 4MB chunk buffer for Drive (16 * 256KB)
        mtproto_slice_size = 512 * 1024      # 512KB MTProto wire limit for Telegram

        # Concurrent Double-Buffered Queue (up to 2 chunks = 8MB in RAM)
        chunk_queue: asyncio.Queue = asyncio.Queue(maxsize=2)
        producer_error: Optional[Exception] = None
        consumer_error: Optional[Exception] = None
        stop_event = stop_event or asyncio.Event()

        async def download_producer():
            nonlocal producer_error
            try:
                buffer = bytearray()
                offset_cursor = start_offset
                async for raw_slice in client.iter_download(
                    target_message.media,
                    offset=start_offset,
                    chunk_size=mtproto_slice_size,
                    request_size=mtproto_slice_size,
                ):
                    if stop_event.is_set():
                        break
                    buffer.extend(raw_slice)
                    if len(buffer) >= target_chunk_size or (offset_cursor + len(buffer)) >= actual_size:
                        chunk_bytes = bytes(buffer)
                        buffer.clear()
                        while not stop_event.is_set():
                            try:
                                chunk_queue.put_nowait((chunk_bytes, offset_cursor))
                                break
                            except asyncio.QueueFull:
                                await asyncio.sleep(0.05)
                        offset_cursor += len(chunk_bytes)
                        if offset_cursor >= actual_size or stop_event.is_set():
                            break

                # Flush any remainder
                if len(buffer) > 0 and not stop_event.is_set():
                    chunk_bytes = bytes(buffer)
                    buffer.clear()
                    while not stop_event.is_set():
                        try:
                            chunk_queue.put_nowait((chunk_bytes, offset_cursor))
                            break
                        except asyncio.QueueFull:
                            await asyncio.sleep(0.05)
                    offset_cursor += len(chunk_bytes)

                # Signal EOF
                await chunk_queue.put(None)
            except Exception as e:
                logger.error(f"Download producer error for transfer #{transfer_id}: {e}", exc_info=True)
                producer_error = e
                stop_event.set()
                try:
                    chunk_queue.put_nowait(None)
                except asyncio.QueueFull:
                    pass

        async def upload_consumer():
            nonlocal consumer_error, drive_file_id, current_offset
            try:
                async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as http_client:
                    while not stop_event.is_set():
                        item = await chunk_queue.get()
                        if item is None:
                            chunk_queue.task_done()
                            break

                        chunk_bytes, chunk_start = item
                        try:
                            completed, file_id = await drive_service.upload_chunk(
                                upload_url=upload_url,
                                chunk=chunk_bytes,
                                start_byte=chunk_start,
                                total_size=actual_size,
                                client=http_client,
                            )
                        except DriveUploadError as e:
                            if "404" in str(e):
                                async with AsyncSessionLocal() as session:
                                    stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                                    t = (await session.execute(stmt)).scalar_one_or_none()
                                    if t:
                                        t.resumable_upload_url = None
                                        t.bytes_transferred = 0
                                        await session.commit()
                            raise

                        current_offset = chunk_start + len(chunk_bytes)
                        pct = int((current_offset / actual_size) * 100) if actual_size > 0 else 0
                        log_event(
                            "TRANSFER_CHUNK_UPLOADED",
                            transfer_id=transfer_id,
                            bytes_uploaded=current_offset,
                            total_bytes=actual_size,
                            progress_pct=pct,
                        )

                        async with AsyncSessionLocal() as session:
                            stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                            t = (await session.execute(stmt)).scalar_one_or_none()
                            if t:
                                t.bytes_transferred = current_offset
                                await session.commit()
                        asyncio.create_task(self.broadcast_transfers_to_edge())

                        if completed:
                            drive_file_id = file_id

                        chunk_queue.task_done()
            except Exception as e:
                logger.error(f"Upload consumer error for transfer #{transfer_id}: {e}", exc_info=True)
                consumer_error = e
                stop_event.set()

        # Concurrently stream from Telegram while streaming to Google Drive
        await asyncio.gather(download_producer(), upload_consumer())

        if stop_event.is_set():
            log_event("TRANSFER_STREAMING_STOPPED_BY_EVENT", transfer_id=transfer_id)
            return

        if producer_error:
            raise producer_error
        if consumer_error:
            raise consumer_error
        if not drive_file_id:
            raise RuntimeError(
                "Streaming ended without Google Drive confirming file completion."
            )

        elapsed = max(time.time() - start_time, 0.001)
        speed_mbps = (current_offset / (1024 * 1024)) / elapsed

        # 5. Verify the Drive artifact (never trust the HTTP response alone).
        await drive_service.verify_file(drive_file_id, actual_size, filename)
        log_event(
            "DRIVE_VERIFICATION_PASSED",
            transfer_id=transfer_id,
            drive_file_id=drive_file_id,
            size=actual_size,
        )

        log_event(
            "PIPELINE_STREAMING_COMPLETE",
            transfer_id=transfer_id,
            drive_file_id=drive_file_id,
            elapsed_sec=round(elapsed, 2),
            speed_mbps=round(speed_mbps, 2),
        )

        # 6. Catalog in Media Table & Update State to COMPLETED
        media_id = None
        parsed_tech = parse_filename(filename)
        taxonomy_type, shelf_cat = classify_media(parsed_tech, raw_filename=filename, mime_type=mime_type)
        if category in ("Anime", "Anime Movies") and shelf_cat not in ("Anime", "Anime Movies"):
            shelf_cat = "Anime"
            taxonomy_type = MediaTaxonomy.ANIME_EPISODE
        is_media = is_media_file(filename, mime_type)

        from app.services.metadata_service import metadata_service
        initial_series_key = metadata_service.get_series_key(filename)

        async with AsyncSessionLocal() as session:
            media = Media(
                drive_file_id=drive_file_id,
                filename=filename,
                size=actual_size,
                mime_type=mime_type,
                category=shelf_cat,
                media_type=taxonomy_type.value,
                season=parsed_tech.season,
                episode=parsed_tech.episode,
                quality=parsed_tech.quality,
                release_group=parsed_tech.release_group,
                series_key=initial_series_key,
            )
            session.add(media)

            stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
            t = (await session.execute(stmt)).scalar_one_or_none()
            if t:
                t.status = TransferStatus.COMPLETED
                t.bytes_transferred = actual_size
                t.error_message = None
                t.error_category = None
                t.completed_at = utc_now()
            await session.commit()
            await session.refresh(media)
            media_id = media.id
        asyncio.create_task(self.broadcast_transfers_to_edge())

        # For non-media files, export catalog immediately since no enrichment will run
        if not is_media:
            asyncio.create_task(self._auto_export_catalog_snapshot())

        # Automatically enqueue and IMMEDIATELY process metadata enrichment for video media
        if media_id and is_media:
            try:
                await metadata_service.enqueue_media_for_enrichment(media_id)
                # Immediately process metadata in background with zero delay so posters populate instantly
                asyncio.create_task(self._process_media_enrichment_immediate(media_id))
            except Exception as e:
                logger.warning(f"Failed to enqueue metadata job for media #{media_id}: {e}")

        # 7. Send Notification Card to Telegram
        await bot_service.send_message(
            chat_id=chat_id,
            text=(
                "🎬 <b>StreamX — Upload to Google Drive Complete!</b>\n\n"
                f"📁 <b>File:</b> <code>{filename}</code>\n"
                f"📦 <b>Size:</b> {format_bytes(actual_size)}\n"
                f"☁️ <b>Folder:</b> <code>StreamX/{category}/</code>\n"
                f"⚡ <b>Throughput:</b> {speed_mbps:.2f} MB/s ({elapsed:.1f}s)\n"
                f"🏷️ <b>Drive ID:</b> <code>{drive_file_id}</code>\n"
                f"📊 <b>Transfer ID:</b> <code>#{transfer_id}</code>\n\n"
                "<i>Master library copy is permanently secured. Ready to sync with StreamX app!</i>"
            ),
        )

    async def _process_media_enrichment_immediate(self, media_id: int) -> None:
        """Immediately processes metadata for newly ingested media, cascades siblings, and updates edge snapshot."""
        try:
            from app.services.metadata_service import metadata_service
            from app.db.models import MetadataJob, MetadataJobStatus
            log_event("IMMEDIATE_METADATA_ENRICHMENT_STARTED", media_id=media_id)
            success = await metadata_service.process_media_metadata(media_id)

            # Reconcile any pending MetadataJob records for this media
            async with AsyncSessionLocal() as session:
                stmt = select(MetadataJob).where(
                    MetadataJob.media_id == media_id,
                    MetadataJob.status.in_([MetadataJobStatus.PENDING, MetadataJobStatus.PROCESSING])
                )
                res = await session.execute(stmt)
                jobs = res.scalars().all()
                for j in jobs:
                    if success:
                        j.status = MetadataJobStatus.COMPLETED
                        j.completed_at = utc_now()
                        j.last_error = None
                await session.commit()

            log_event("IMMEDIATE_METADATA_ENRICHMENT_FINISHED", media_id=media_id, success=success)
            # Re-export and sync catalog to edge worker
            await self._auto_export_catalog_snapshot()
        except Exception as e:
            logger.warning(f"Immediate metadata enrichment error for media #{media_id}: {e}")

    async def broadcast_catalog_to_edge(self) -> None:
        """Push latest catalog snapshot to Cloudflare edge worker so edge has real-time posters & metadata."""
        try:
            repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            snapshot_path = os.path.join(repo_root, "scripts", "catalog_snapshot.json")
            if not os.path.exists(snapshot_path):
                return
            with open(snapshot_path, "r", encoding="utf-8") as f:
                catalog_data = json.load(f)

            worker_url = "https://streamx-worker.siddiqsiddiq00012.workers.dev/api/catalog/sync"
            headers = {"Content-Type": "application/json"}
            if settings.TELEGRAM_WEBHOOK_SECRET:
                headers["X-Telegram-Bot-Api-Secret-Token"] = settings.TELEGRAM_WEBHOOK_SECRET

            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.post(worker_url, json={"catalog": catalog_data}, headers=headers)
                log_event("EDGE_CATALOG_SYNC_RESULT", status_code=res.status_code, items_count=len(catalog_data))
        except Exception as e:
            logger.debug(f"Edge catalog sync notice: {e}")

    async def _auto_export_catalog_snapshot(self) -> None:
        """Atomically dumps updated library to scripts/catalog_snapshot.json and syncs edge worker."""
        try:
            repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            if repo_root not in sys.path:
                sys.path.insert(0, repo_root)
            from scripts.export_snapshot import export_catalog_snapshot

            await export_catalog_snapshot()
            await self.broadcast_catalog_to_edge()
        except Exception as e:
            logger.debug(f"Catalog auto-export note: {e}")


transfer_worker = TransferWorker()