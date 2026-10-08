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
    ErrorCategory,
    classify_error,
)
from app.utils.filenames import format_bytes, resolve_mime_type
from app.utils.logging import log_event, logger


from app.utils.filename_parser import parse_filename
from app.utils.media_classifier import classify_media, is_media_file


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
    def __init__(self, max_concurrent_transfers: int = 5):
        self.running = False
        self.task: Optional[asyncio.Task] = None
        self.max_concurrent_transfers = max_concurrent_transfers
        self.semaphore = asyncio.Semaphore(max_concurrent_transfers)
        self.active_tasks = set()

    async def reconcile_incomplete_transfers(self) -> None:
        """Section 37: Reconcile transfers left incomplete by dead or restarted processes."""
        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(
                TelegramTransfer.status.in_(
                    [TransferStatus.FETCHING_TELEGRAM, TransferStatus.UPLOADING_DRIVE]
                )
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
        if self.semaphore.locked():
            return False

        now = utc_now()
        async with db_claim_lock:
            async with AsyncSessionLocal() as session:
                stmt = (
                    select(TelegramTransfer)
                    .where(
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
        async with self.semaphore:
            try:
                await self._execute_transfer(
                    transfer_id=transfer_id,
                    chat_id=chat_id,
                    message_id=message_id,
                    filename=filename,
                    expected_size=expected_size,
                )
            except asyncio.CancelledError:
                raise
            except Exception as e:
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
                t = None
                async with AsyncSessionLocal() as session:
                    stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                    t = (await session.execute(stmt)).scalar_one_or_none()
                    if t:
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

                # User-facing: actionable, secret-free.
                status_label = (
                    TransferStatus.RETRYING
                    if t and t.status == TransferStatus.RETRYING
                    else TransferStatus.FAILED
                )
                user_text = self._build_error_notification(
                    transfer_id, filename, category, status_label
                )
                await bot_service.send_message(chat_id=chat_id, text=user_text)

    def _build_error_notification(
        self, transfer_id: int, filename: str, category: ErrorCategory, status: TransferStatus
    ) -> str:
        from app.utils.errors import CATEGORY_USER_MESSAGE

        summary = CATEGORY_USER_MESSAGE.get(category, "The job has been queued for automatic retry.")
        return (
            f"⚠️ <b>StreamX — Transfer #{transfer_id} Error</b>\n\n"
            f"📁 <b>File:</b> <code>{filename}</code>\n"
            f"📋 <b>Reason:</b> <i>{category.value}</i>\n"
            f"🔄 <b>Status:</b> <code>{status.value}</code>\n\n"
            f"{summary}"
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

        # 1. Forwarded copy (modern path, required for non-owner senders).
        if transfer.forwarded_chat_id is not None:
            configured = self._resolve_relay_chat()
            chat = configured if configured is not None else transfer.forwarded_chat_id
            # Direct lookup by forwarded message id first.
            try:
                msg = await client.get_messages(chat, ids=transfer.forwarded_message_id)
                if msg and getattr(msg, "media", None):
                    return msg
            except Exception as e:
                logger.debug(f"Forwarded direct lookup failed for #{transfer.id}: {e}")

            # Robust fallback: scan the relay chat by filename/size.
            try:
                async for msg in client.iter_messages(chat, limit=FORWARDED_SEARCH_LIMIT):
                    if not getattr(msg, "media", None):
                        continue
                    name = getattr(getattr(msg, "file", None), "name", None)
                    size = getattr(getattr(msg, "file", None), "size", 0)
                    if name == filename or (expected_size and size == expected_size):
                        return msg
            except Exception as e:
                logger.warning(f"Forwarded chat scan failed for #{transfer.id}: {e}")

        # 2. Legacy owner-only path: owner's own message in the owner<->bot chat.
        bot_entity = "Stream1_X_bot"
        try:
            msg = await client.get_messages(bot_entity, ids=transfer.telegram_message_id)
            if msg and getattr(msg, "media", None):
                return msg
        except Exception as e:
            logger.debug(f"Legacy message lookup failed, will search recent: {e}")

        try:
            async for msg in client.iter_messages(bot_entity, limit=10):
                if not getattr(msg, "media", None):
                    continue
                name = getattr(getattr(msg, "file", None), "name", None)
                size = getattr(getattr(msg, "file", None), "size", 0)
                if name == filename or (expected_size and size == expected_size):
                    return msg
        except Exception as e:
            logger.warning(f"Legacy chat scan failed for #{transfer.id}: {e}")

        return None

    async def _execute_transfer(
        self,
        transfer_id: int,
        chat_id: int,
        message_id: int,
        filename: str,
        expected_size: int,
    ) -> None:
        """Stream chunks from Telegram via MTProto directly into Google Drive resumable upload."""
        # 1. Duplicate Detection (Section 23)
        async with AsyncSessionLocal() as session:
            existing_media = (
                await session.execute(
                    select(Media).where(
                        Media.filename == filename,
                        Media.size == expected_size,
                    )
                )
            ).scalar_one_or_none()

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

        # 2. Locate the media message via MTProto (forwarded copy for non-owners).
        client = await mtproto_service.get_client()
        async with AsyncSessionLocal() as session:
            transfer = await session.get(TelegramTransfer, transfer_id)
            if not transfer:
                raise ValueError(f"Transfer #{transfer_id} not found")

        target_message = await self._locate_target_message(client, transfer, expected_size)
        if not target_message:
            raise ValueError(
                f"Could not locate media message for '{filename}' in the relay channel. "
                "Ensure TELEGRAM_SERVICE_CHANNEL / TELEGRAM_OWNER_USER_ID is configured and "
                "the bot has forwarded the file into it."
            )

        actual_size = getattr(target_message.file, "size", expected_size)
        mime_type = resolve_mime_type(filename)
        category = detect_category(filename)

        # 3. Check / Initialize Google Drive Resumable Session
        upload_url = None
        start_offset = 0

        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
            t = (await session.execute(stmt)).scalar_one_or_none()
            if t and t.resumable_upload_url:
                upload_url = t.resumable_upload_url
                start_offset = await drive_service.get_resumable_offset(upload_url, actual_size)
                log_event("RECOVERY_OFFSET_RESUMED", transfer_id=transfer_id, start_offset=start_offset)

        if not upload_url:
            upload_url = await drive_service.create_resumable_upload_session(
                filename=filename,
                size=actual_size,
                mime_type=mime_type,
                category=category,
            )
            async with AsyncSessionLocal() as session:
                stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                t = (await session.execute(stmt)).scalar_one_or_none()
                if t:
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
        buffer = bytearray()
        target_chunk_size = settings.CHUNK_BUFFER_SIZE_BYTES  # 8MB chunk buffer for Drive
        mtproto_slice_size = 128 * 1024  # 128KB MTProto wire limit for Telegram

        async for raw_slice in client.iter_download(
            target_message.media,
            offset=start_offset,
            chunk_size=mtproto_slice_size,
            request_size=mtproto_slice_size,
        ):
            buffer.extend(raw_slice)

            if len(buffer) >= target_chunk_size or (current_offset + len(buffer)) >= actual_size:
                chunk_bytes = bytes(buffer)
                buffer.clear()

                completed, file_id = await drive_service.upload_chunk(
                    upload_url=upload_url,
                    chunk=chunk_bytes,
                    start_byte=current_offset,
                    total_size=actual_size,
                )
                current_offset += len(chunk_bytes)

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

                if completed:
                    drive_file_id = file_id
                    break

        # Flush any remaining buffer if file not yet completed
        if not drive_file_id and len(buffer) > 0:
            chunk_bytes = bytes(buffer)
            buffer.clear()
            completed, file_id = await drive_service.upload_chunk(
                upload_url=upload_url,
                chunk=chunk_bytes,
                start_byte=current_offset,
                total_size=actual_size,
            )
            current_offset += len(chunk_bytes)
            if completed:
                drive_file_id = file_id

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
        is_media = is_media_file(filename, mime_type)

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

        # Automatically enqueue metadata enrichment job ONLY for video media
        if media_id and is_media:
            try:
                from app.services.metadata_service import metadata_service

                await metadata_service.enqueue_media_for_enrichment(media_id)
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


transfer_worker = TransferWorker()