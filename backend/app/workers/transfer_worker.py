"""Transfer background worker for StreamX.

Polls SQLite for QUEUED/RETRYING transfers, streams media chunks via MTProto,
and coordinates transfer state transitions and verification.
"""

import asyncio
import time
from typing import Optional
from sqlalchemy import select

from app.config.settings import settings
from app.db.database import AsyncSessionLocal
from app.db.models import TelegramTransfer, TransferStatus
from app.services.telegram_bot_service import bot_service
from app.services.telegram_mtproto_service import mtproto_service
from app.utils.filenames import format_bytes
from app.utils.logging import log_event, logger


class TransferWorker:
    def __init__(self):
        self.running = False
        self.task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start worker loop."""
        self.running = True
        log_event("TRANSFER_WORKER_STARTED")
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
            await self._execute_telegram_transfer(
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

    async def _execute_telegram_transfer(
        self,
        transfer_id: int,
        chat_id: int,
        message_id: int,
        filename: str,
        expected_size: int,
    ) -> None:
        """Stream chunks from Telegram via MTProto and verify retrieval."""
        client = await mtproto_service.get_client()

        # Resolve bot entity by username or ID
        bot_entity = "Stream1_X_bot"
        target_message = None

        # 1. Try direct message ID in bot dialog
        try:
            msg = await client.get_messages(bot_entity, ids=message_id)
            if msg and msg.media:
                target_message = msg
        except Exception as e:
            logger.debug(f"Direct message lookup failed, will search recent messages: {e}")

        # 2. Search recent messages in bot dialog if direct ID didn't resolve
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
        start_time = time.time()
        bytes_retrieved = 0
        chunk_size = settings.CHUNK_BUFFER_SIZE_BYTES  # 8MB chunk buffer

        log_event(
            "MTPROTO_STREAMING_CHUNKS",
            transfer_id=transfer_id,
            total_size=actual_size,
            chunk_size=chunk_size,
        )

        async for chunk in client.iter_download(
            target_message.media,
            chunk_size=chunk_size,
            request_size=chunk_size,
        ):
            bytes_retrieved += len(chunk)
            # Memory safety: chunk is not written to disk; verified in-flight

        elapsed = max(time.time() - start_time, 0.001)
        speed_mbps = (bytes_retrieved / (1024 * 1024)) / elapsed

        log_event(
            "MTPROTO_STREAMING_COMPLETE",
            transfer_id=transfer_id,
            bytes_retrieved=bytes_retrieved,
            elapsed_sec=round(elapsed, 2),
            speed_mbps=round(speed_mbps, 2),
        )

        # Transition state: VERIFYING -> COMPLETED
        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
            res = await session.execute(stmt)
            t = res.scalar_one_or_none()
            if t:
                t.status = TransferStatus.VERIFYING
                t.bytes_transferred = bytes_retrieved
                await session.commit()

                # Verify byte count
                if expected_size > 0 and bytes_retrieved != expected_size:
                    raise ValueError(
                        f"Size mismatch: expected {expected_size} bytes, retrieved {bytes_retrieved} bytes"
                    )

                t.status = TransferStatus.COMPLETED
                t.error_message = None
                await session.commit()

        # Notify user of successful verification
        await bot_service.send_message(
            chat_id=chat_id,
            text=(
                "✅ <b>StreamX — Telegram Media Retrieval Verified!</b>\n\n"
                f"📁 <b>File:</b> <code>{filename}</code>\n"
                f"📦 <b>Size:</b> {format_bytes(bytes_retrieved)}\n"
                f"⚡ <b>Transferred:</b> 100% via MTProto chunk streaming\n"
                f"⏱️ <b>Throughput:</b> {speed_mbps:.2f} MB/s ({elapsed:.1f}s)\n"
                f"📊 <b>Transfer ID:</b> <code>#{transfer_id}</code>\n\n"
                "<i>Telegram → MTProto pipeline verified! Ready for Google Drive upload integration.</i>"
            ),
        )


transfer_worker = TransferWorker()
