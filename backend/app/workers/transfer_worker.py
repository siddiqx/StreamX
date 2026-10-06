"""Transfer background worker for StreamX.

Polls SQLite for QUEUED/RETRYING transfers, streams media chunks via MTProto,
pipes chunks directly into Google Drive resumable upload sessions, and catalogs
completed files in SQLite.
Zero full-disk requirements: all chunk processing is handled in-flight in RAM.
"""

import asyncio
import mimetypes
import time
from typing import Optional
from sqlalchemy import select

from app.config.settings import settings
from app.db.database import AsyncSessionLocal
from app.db.models import Media, TelegramTransfer, TransferStatus
from app.services.drive_service import drive_service
from app.services.telegram_bot_service import bot_service
from app.services.telegram_mtproto_service import mtproto_service
from app.utils.filenames import format_bytes
from app.utils.logging import log_event, logger


def detect_category(filename: str) -> str:
    """Classify media into Movies, TV Shows, Anime, or Other."""
    name_lower = filename.lower()
    if any(
        term in name_lower
        for term in [
            "s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09",
            "season", "episode", "ep0", "ep1", "e01", "e02", "e03", "e04",
        ]
    ):
        return "TV Shows"
    if any(
        term in name_lower
        for term in [
            "anime", "sub", "dub", "crunchyroll", "horriblesubs", "judas",
        ]
    ):
        return "Anime"
    if any(
        ext in name_lower
        for ext in [".mkv", ".mp4", ".avi", ".mov", ".m4v", ".webm"]
    ):
        return "Movies"
    return "Other"


class TransferWorker:
    def __init__(self):
        self.running = False
        self.task: Optional[asyncio.Task] = None

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
            if incomplete:
                await session.commit()

    async def start(self) -> None:
        """Start worker loop with crash/restart state reconciliation."""
        self.running = True
        log_event("TRANSFER_WORKER_STARTED")
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
        """Find and process the oldest QUEUED or RETRYING transfer."""
        async with AsyncSessionLocal() as session:
            stmt = (
                select(TelegramTransfer)
                .where(
                    TelegramTransfer.status.in_(
                        [TransferStatus.QUEUED, TransferStatus.RETRYING]
                    )
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

            # Mark status as FETCHING_TELEGRAM
            transfer.status = TransferStatus.FETCHING_TELEGRAM
            await session.commit()

        log_event(
            "TRANSFER_PROCESSING_START",
            transfer_id=transfer_id,
            filename=filename,
            size=expected_size,
        )

        try:
            await self._execute_transfer(
                transfer_id=transfer_id,
                chat_id=chat_id,
                message_id=message_id,
                filename=filename,
                expected_size=expected_size,
            )
            return True
        except Exception as e:
            logger.error(f"Transfer #{transfer_id} failed: {e}", exc_info=True)
            async with AsyncSessionLocal() as session:
                stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                res = await session.execute(stmt)
                t = res.scalar_one_or_none()
                if t:
                    t.retry_count += 1
                    t.error_message = str(e)
                    if t.retry_count < settings.MAX_RETRIES:
                        t.status = TransferStatus.RETRYING
                    else:
                        t.status = TransferStatus.FAILED
                    await session.commit()

            await bot_service.send_message(
                chat_id=chat_id,
                text=(
                    f"⚠️ <b>Transfer #{transfer_id} Error</b>\n\n"
                    f"File: <code>{filename}</code>\n"
                    f"Reason: <i>{str(e)[:200]}</i>\n"
                    f"Status: <code>{TransferStatus.RETRYING if t and t.status == TransferStatus.RETRYING else TransferStatus.FAILED}</code>"
                ),
            )
            return True

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
                # Link and complete transfer immediately without redundant upload
                stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
                t = (await session.execute(stmt)).scalar_one_or_none()
                if t:
                    t.status = TransferStatus.COMPLETED
                    t.bytes_transferred = expected_size
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

        # 2. Locate Telegram Message via MTProto
        client = await mtproto_service.get_client()
        bot_entity = "Stream1_X_bot"
        target_message = None

        try:
            msg = await client.get_messages(bot_entity, ids=message_id)
            if msg and msg.media:
                target_message = msg
        except Exception as e:
            logger.debug(f"Direct message lookup failed, will search recent messages: {e}")

        if not target_message:
            async for msg in client.iter_messages(bot_entity, limit=10):
                if msg.media:
                    name = getattr(msg.file, "name", None)
                    size = getattr(msg.file, "size", 0)
                    if name == filename or (expected_size and size == expected_size):
                        target_message = msg
                        break

        if not target_message:
            raise ValueError(
                f"Could not locate media message for '{filename}' in dialog with @Stream1_X_bot"
            )

        actual_size = getattr(target_message.file, "size", expected_size)
        mime_type, _ = mimetypes.guess_type(filename)
        mime_type = mime_type or "video/mp4"
        category = detect_category(filename)
        chunk_size = settings.CHUNK_BUFFER_SIZE_BYTES  # 8MB chunk buffer

        # 3. Check / Initialize Google Drive Resumable Session
        upload_url = None
        start_offset = 0

        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
            t = (await session.execute(stmt)).scalar_one_or_none()
            if t and t.resumable_upload_url:
                upload_url = t.resumable_upload_url
                # Server restart recovery: Check how many bytes Drive already acknowledged
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
        )

        start_time = time.time()
        current_offset = start_offset
        drive_file_id = None
        buffer = bytearray()
        target_chunk_size = settings.CHUNK_BUFFER_SIZE_BYTES  # 8MB chunk buffer

        async for raw_slice in client.iter_download(
            target_message.media,
            offset=start_offset,
            chunk_size=target_chunk_size,
            request_size=target_chunk_size,
        ):
            buffer.extend(raw_slice)

            # When buffer reaches target chunk size or file end, upload chunk to Google Drive
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

                # Update transfer progress in SQLite
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
            raise RuntimeError("Streaming ended without Google Drive confirming file completion.")

        elapsed = max(time.time() - start_time, 0.001)
        speed_mbps = (current_offset / (1024 * 1024)) / elapsed

        log_event(
            "PIPELINE_STREAMING_COMPLETE",
            transfer_id=transfer_id,
            drive_file_id=drive_file_id,
            elapsed_sec=round(elapsed, 2),
            speed_mbps=round(speed_mbps, 2),
        )

        # 5. Catalog in Media Table & Update State to COMPLETED
        media_id = None
        async with AsyncSessionLocal() as session:
            # Add to permanent Media catalog
            media = Media(
                drive_file_id=drive_file_id,
                filename=filename,
                size=actual_size,
                mime_type=mime_type,
                category=category,
            )
            session.add(media)

            # Update transfer state
            stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
            t = (await session.execute(stmt)).scalar_one_or_none()
            if t:
                t.status = TransferStatus.COMPLETED
                t.bytes_transferred = actual_size
                t.error_message = None

            await session.commit()
            await session.refresh(media)
            media_id = media.id

        # Automatically enqueue metadata enrichment job
        if media_id:
            try:
                from app.services.metadata_service import metadata_service
                await metadata_service.enqueue_media_for_enrichment(media_id)
            except Exception as e:
                logger.warning(f"Failed to enqueue metadata job for media #{media_id}: {e}")


        # 6. Send Notification Card to Telegram
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
