"""Telegram MTProto Streaming Service for StreamX.

Uses Telethon and StringSession to stream arbitrary large files from Telegram
in memory-bounded chunks directly into the Google Drive upload pipeline.
Zero full-disk storage requirement.
"""

import asyncio
from typing import Any, AsyncGenerator, Optional, Tuple
from telethon import TelegramClient, errors
from telethon.sessions import StringSession
from telethon.tl.custom.message import Message

from app.config.settings import settings
from app.utils.logging import log_event, logger


class TelegramMTProtoService:
    def __init__(
        self,
        api_id: Optional[int] = None,
        api_hash: Optional[str] = None,
        session_string: Optional[str] = None,
    ):
        self.api_id = api_id or settings.TELEGRAM_API_ID
        self.api_hash = api_hash or settings.TELEGRAM_API_HASH
        self.session_string = session_string or settings.TELEGRAM_SESSION_STRING
        self.client: Optional[TelegramClient] = None
        self._lock = asyncio.Lock()

    def is_configured(self) -> bool:
        return bool(
            self.api_id
            and self.api_hash
            and self.session_string
            and self.session_string.strip()
        )

    async def get_client(self) -> TelegramClient:
        """Get or initialize the connected Telethon client."""
        async with self._lock:
            if self.client is None or not self.client.is_connected():
                if not self.is_configured():
                    raise ValueError(
                        "MTProto client is not configured. TELEGRAM_API_ID, "
                        "TELEGRAM_API_HASH, and TELEGRAM_SESSION_STRING are required."
                    )
                self.client = TelegramClient(
                    StringSession(self.session_string),
                    self.api_id,
                    self.api_hash,
                )
                await self.client.connect()
                if not await self.client.is_user_authorized():
                    raise PermissionError(
                        "The Telegram MTProto session is invalid or expired. "
                        "Please re-generate TELEGRAM_SESSION_STRING."
                    )
                log_event("MTPROTO_CLIENT_CONNECTED")
            return self.client

    async def disconnect(self) -> None:
        """Disconnect client if connected."""
        async with self._lock:
            if self.client and self.client.is_connected():
                await self.client.disconnect()
                log_event("MTPROTO_CLIENT_DISCONNECTED")
                self.client = None

    async def get_message_media_info(
        self, chat_id: int, message_id: int
    ) -> Tuple[Optional[str], int, Optional[Any]]:
        """Retrieve media filename, total size in bytes, and media object from a message."""
        client = await self.get_client()
        message: Optional[Message] = await client.get_messages(chat_id, ids=message_id)
        if not message or not message.media:
            return None, 0, None

        filename = getattr(message.file, "name", None) or "streamx_media.bin"
        size = getattr(message.file, "size", 0) or 0
        return filename, size, message.media

    async def iter_download_chunks(
        self,
        chat_id: int,
        message_id: int,
        chunk_size: int = 8 * 1024 * 1024,
        offset_bytes: int = 0,
    ) -> AsyncGenerator[bytes, None]:
        """Stream media from Telegram in chunk_size byte blocks.

        Yields raw bytes chunk by chunk directly into memory buffer.
        """
        client = await self.get_client()
        message: Optional[Message] = await client.get_messages(chat_id, ids=message_id)
        if not message or not message.media:
            raise ValueError(f"No media found in message {message_id} from chat {chat_id}")

        total_size = getattr(message.file, "size", 0)
        log_event(
            "MTPROTO_STREAM_START",
            chat_id=chat_id,
            message_id=message_id,
            total_size=total_size,
            offset=offset_bytes,
            chunk_size=chunk_size,
        )

        try:
            async for chunk in client.iter_download(
                message.media,
                offset=offset_bytes,
                chunk_size=chunk_size,
                request_size=chunk_size,
            ):
                yield chunk

            log_event("MTPROTO_STREAM_COMPLETE", chat_id=chat_id, message_id=message_id)

        except errors.FloodWaitError as e:
            logger.warning(f"Telegram FloodWait encountered: must wait {e.seconds} seconds")
            raise


mtproto_service = TelegramMTProtoService()
