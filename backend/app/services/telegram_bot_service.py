"""Telegram Bot Ingestion Service for StreamX.

Provides asynchronous HTTP-based Telegram Bot polling, access control, command
handling (/start, /help, /status), and media ingestion directly into SQLite.

Important: the Bot API receives files from ANY allowed user, but the MTProto
transfer worker runs under a SINGLE user account (the owner). That account
cannot read messages sent to the bot by *other* users, so every accepted media
message is **forwarded** into a shared service channel (or the owner's DM) that
the MTProto account can read. The worker then downloads the forwarded copy.
"""

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
import httpx
from sqlalchemy import select

from app.config.settings import settings
from app.db.database import AsyncSessionLocal
from app.db.models import ErrorCategory, TelegramTransfer, TransferStatus
from app.utils.errors import StreamXError
from app.utils.filenames import format_bytes, sanitize_filename
from app.utils.logging import log_event, logger


# Maximum retry attempts for transient forward failures
MAX_FORWARD_RETRIES = 3
INITIAL_FORWARD_RETRY_DELAY = 2  # seconds


class TelegramBotService:
    def __init__(
        self,
        bot_token: Optional[str] = None,
        service_channel: Optional[str] = "DEFAULT",
        owner_user_id: Optional[int] = "DEFAULT",
    ):
        self.bot_token = bot_token or settings.TELEGRAM_BOT_TOKEN
        self.base_url = f"https://api.telegram.org/bot{self.bot_token}"
        self.running = False
        self.last_update_id = 0
        self.task: Optional[asyncio.Task] = None
        # Relay overrides (for testability / per-instance config).
        if service_channel == "DEFAULT":
            service_channel = settings.TELEGRAM_SERVICE_CHANNEL
        if owner_user_id == "DEFAULT":
            owner_user_id = settings.TELEGRAM_OWNER_USER_ID
        self.service_channel = service_channel
        self.owner_user_id = owner_user_id

    def is_configured(self) -> bool:
        return bool(self.bot_token and self.bot_token.strip())

    async def send_message(self, chat_id: int, text: str, reply_to_message_id: Optional[int] = None) -> bool:
        """Send a message to a Telegram chat."""
        if not self.is_configured():
            return False

        payload: Dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
        }
        if reply_to_message_id:
            payload["reply_to_message_id"] = reply_to_message_id

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.post(f"{self.base_url}/sendMessage", json=payload)
                return res.status_code == 200
        except Exception as e:
            logger.error(f"Failed to send Telegram message to {chat_id}: {e}")
            return False

    def resolve_forward_target(self) -> Optional[Any]:
        """Return the chat the bot should forward media into for MTProto pickup.

        Order: TELEGRAM_SERVICE_CHANNEL (preferred shared channel/group), then
        TELEGRAM_OWNER_USER_ID (owner DM fallback). Returns None if unset.
        """
        if self.service_channel:
            return self.service_channel
        if self.owner_user_id:
            return self.owner_user_id
        return None

    def is_forward_target_configured(self) -> bool:
        return self.resolve_forward_target() is not None

    async def validate_service_channel(self) -> Dict[str, Any]:
        """Validate that the service channel is reachable and bot has permissions.

        Returns a dict with health check results for startup/readiness probes.
        Does not expose secrets.
        """
        target = self.resolve_forward_target()
        if target is None:
            return {
                "configured": False,
                "error": "TELEGRAM_SERVICE_CHANNEL and TELEGRAM_OWNER_USER_ID are not set",
            }

        # Try to get chat info via Bot API to verify access
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(f"{self.base_url}/getChat", params={"chat_id": target})
        except Exception as e:
            logger.error(f"Service channel health check transport error: {e}")
            return {
                "configured": True,
                "target": str(target),
                "reachable": False,
                "error": f"Transport error: {type(e).__name__}",
            }

        if res.status_code == 200:
            chat_info = res.json().get("result", {})
            return {
                "configured": True,
                "target": str(target),
                "reachable": True,
                "chat_type": chat_info.get("type"),
                "chat_title": chat_info.get("title") or chat_info.get("username"),
                "bot_is_member": True,
            }
        else:
            error_text = res.text
            logger.warning(f"Service channel health check failed: HTTP {res.status_code}: {error_text}")
            return {
                "configured": True,
                "target": str(target),
                "reachable": False,
                "http_status": res.status_code,
                "error": error_text,
            }

    async def forward_media_to_service(
        self, from_chat_id: int, message_id: int
    ) -> Optional[Tuple[int, int]]:
        """Forward an incoming media message into the service channel.

        Returns (destination_chat_id, destination_message_id) on success.
        Returns None if no relay target is configured (owner-only legacy path).
        Raises StreamXError(TELEGRAM_FORWARD_FAILED) if a target IS configured
        but the Bot API forward call itself fails — this is a permanent
        configuration problem (bot not a member / not admin of the channel).

        Retries transient failures (network, FLOOD_WAIT) with exponential backoff.
        """
        target = self.resolve_forward_target()
        if target is None:
            return None

        payload: Dict[str, Any] = {
            "chat_id": target,
            "from_chat_id": from_chat_id,
            "message_id": message_id,
            "disable_notification": True,
        }

        last_exception = None
        for attempt in range(MAX_FORWARD_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    res = await client.post(f"{self.base_url}/forwardMessage", json=payload)
            except Exception as e:
                last_exception = e
                logger.warning(
                    f"Telegram forwardMessage transport error (attempt {attempt + 1}/{MAX_FORWARD_RETRIES + 1}): {e}"
                )
                if attempt < MAX_FORWARD_RETRIES:
                    delay = INITIAL_FORWARD_RETRY_DELAY * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                log_event(
                    "FORWARD_TRANSPORT_ERROR_EXHAUSTED",
                    from_chat_id=from_chat_id,
                    message_id=message_id,
                    target=str(target),
                    attempts=attempt + 1,
                    error=str(e),
                )
                raise StreamXError(
                    ErrorCategory.TELEGRAM_FORWARD_FAILED,
                    f"forwardMessage transport error after {MAX_FORWARD_RETRIES + 1} attempts: {e}",
                ) from e

            # Always parse JSON first to handle both HTTP errors and Telegram API errors (ok:false)
            data = {}
            try:
                data = res.json()
            except Exception:
                pass

            # Telegram Bot API returns HTTP 200 even for API errors.
            # The actual success/failure is indicated by the "ok" field in the JSON body.
            # Success: {"ok": true, "result": {...}}
            # Failure: {"ok": false, "error_code": 403, "description": "Forbidden: ..."}
            api_ok = data.get("ok")
            error_code = data.get("error_code")
            error_description = data.get("description", "")

            if res.status_code == 200 and api_ok is True:
                # Successful forward - extract destination chat/message IDs from result
                result = data.get("result", {})
                dest_chat = result.get("chat", {}).get("id")
                dest_msg = result.get("message_id")
                if not dest_chat or not dest_msg:
                    log_event(
                        "FORWARD_MISSING_IDS",
                        from_chat_id=from_chat_id,
                        message_id=message_id,
                        target=str(target),
                        response=data,
                    )
                    raise StreamXError(
                        ErrorCategory.TELEGRAM_FORWARD_FAILED,
                        "forwardMessage returned no chat/message id in result",
                    )
                return int(dest_chat), int(dest_msg)

            # Handle API error (ok: false) or HTTP error status
            # Use Telegram's error_code for classification when available, else fall back to HTTP status
            classification_code = error_code if error_code is not None else res.status_code
            error_text = error_description or res.text

            # Telegram Bot API error codes that are transient
            transient_codes = {429, 500, 502, 503, 504}
            # Permanent configuration errors
            permanent_codes = {400, 401, 403}

            is_transient = classification_code in transient_codes
            is_permanent = classification_code in permanent_codes

            # Also check for FLOOD_WAIT in error description
            if "FLOOD_WAIT" in error_text or "flood" in error_text.lower():
                is_transient = True

            log_event(
                "FORWARD_FAILED_ATTEMPT",
                attempt=attempt + 1,
                max_attempts=MAX_FORWARD_RETRIES + 1,
                from_chat_id=from_chat_id,
                message_id=message_id,
                target=str(target),
                http_status=res.status_code,
                telegram_error_code=error_code,
                error=error_text,
                is_transient=is_transient,
            )

            if is_permanent or attempt >= MAX_FORWARD_RETRIES:
                # Permanent error or retries exhausted
                raise StreamXError(
                    ErrorCategory.TELEGRAM_FORWARD_FAILED,
                    f"forwardMessage failed: Telegram error {classification_code} - {error_text}",
                )

            # Transient error - retry with backoff
            delay = INITIAL_FORWARD_RETRY_DELAY * (2 ** attempt)
            # If Telegram tells us to wait (FLOOD_WAIT), try to extract the wait time
            if classification_code == 429:
                try:
                    params = data.get("parameters", {})
                    retry_after = params.get("retry_after", delay)
                    delay = min(retry_after, 60)  # Cap at 60 seconds
                except Exception:
                    pass

            logger.warning(
                f"Forward transient error (attempt {attempt + 1}), retrying in {delay}s: {error_text}"
            )
            await asyncio.sleep(delay)


        # Should not reach here, but safety net
        raise StreamXError(
            ErrorCategory.TELEGRAM_FORWARD_FAILED,
            f"forwardMessage failed after {MAX_FORWARD_RETRIES + 1} attempts: {last_exception}",
        )

    def is_user_allowed(self, user_id: int) -> bool:
        """Check if user is authorized to use this bot."""
        allowed = settings.allowed_telegram_users
        if not allowed:
            # If no allowed users explicitly configured, allow (or default open for owner)
            return True
        return user_id in allowed

    async def process_update(self, update: Dict[str, Any]) -> None:
        """Process an individual Telegram update."""
        message = update.get("message")
        if not message:
            return

        chat = message.get("chat", {})
        chat_id = chat.get("id")
        user = message.get("from", {})
        user_id = user.get("id")
        message_id = message.get("message_id")

        if not chat_id or not user_id:
            return

        # Security check: User authorization
        if not self.is_user_allowed(user_id):
            log_event("UNAUTHORIZED_BOT_ACCESS", user_id=user_id, chat_id=chat_id)
            await self.send_message(
                chat_id=chat_id,
                text="⛔ <b>Access Denied</b>\nThis StreamX Bot instance is private.",
                reply_to_message_id=message_id,
            )
            return

        text = message.get("text", "").strip()

        # Handle Commands
        if text.startswith("/start"):
            await self._handle_start(chat_id, user.get("first_name", "there"))
            return
        elif text.startswith("/help"):
            await self._handle_help(chat_id)
            return
        elif text.startswith("/status"):
            await self._handle_status(chat_id)
            return

        # Check for media attachment
        media_info = self._extract_media_info(message)
        if media_info:
            file_id, filename, file_size = media_info
            await self._handle_media(chat_id, message_id, file_id, filename, file_size)
            return

        # Fallback for plain messages
        await self.send_message(
            chat_id=chat_id,
            text=(
                "💡 <b>Forward a media file to start</b>\n\n"
                "Send or forward any video, movie, episode, or document directly to this bot to transfer it to Google Drive.\n"
                "Type /help for instructions or /status for current queue."
            ),
            reply_to_message_id=message_id,
        )

    def _extract_media_info(self, message: Dict[str, Any]) -> Optional[Tuple[str, str, int]]:
        """Extract file_id, filename, and size from video, document, or audio messages."""
        if "document" in message:
            doc = message["document"]
            filename = sanitize_filename(doc.get("file_name", "document.bin"))
            return doc.get("file_id"), filename, doc.get("file_size", 0)

        if "video" in message:
            vid = message["video"]
            filename = sanitize_filename(vid.get("file_name", f"video_{int(datetime.now(timezone.utc).timestamp())}.mp4"))
            return vid.get("file_id"), filename, vid.get("file_size", 0)

        if "audio" in message:
            aud = message["audio"]
            filename = sanitize_filename(aud.get("file_name", f"audio_{int(datetime.now(timezone.utc).timestamp())}.mp3"))
            return aud.get("file_id"), filename, aud.get("file_size", 0)

        return None

    async def _handle_start(self, chat_id: int, user_first_name: str) -> None:
        msg = (
            f"👋 <b>Welcome to StreamX, {user_first_name}!</b>\n\n"
            "StreamX is your personal media pipeline connecting Telegram to Google Drive and offline Android playback.\n\n"
            "<b>How to use:</b>\n"
            "1. Forward any video, movie, or file to this bot.\n"
            "2. StreamX enqueues the transfer to your Google Drive master library.\n"
            "3. You can close Telegram immediately — transfers execute in the cloud.\n\n"
            "<b>Available Commands:</b>\n"
            "• /status — Check recent transfers and progress\n"
            "• /help — Detailed usage & instructions"
        )
        await self.send_message(chat_id, msg)

    async def _handle_help(self, chat_id: int) -> None:
        msg = (
            "📖 <b>StreamX Help & Usage Guide</b>\n\n"
            "• <b>Ingestion:</b> Forward large files (movies, series, media) to this bot.\n"
            "• <b>Cloud Transfer:</b> The worker streams chunks into Google Drive without using local device storage.\n"
            "• <b>Android App:</b> Browse your Google Drive media library in the StreamX app, download for offline use, or play locally.\n"
            "• <b>Queue Status:</b> Use /status at any time to monitor active and past transfers."
        )
        await self.send_message(chat_id, msg)

    async def _handle_status(self, chat_id: int) -> None:
        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).order_by(TelegramTransfer.id.desc()).limit(5)
            result = await session.execute(stmt)
            transfers = result.scalars().all()

        if not transfers:
            await self.send_message(chat_id, "ℹ️ No recent transfers in the queue.")
            return

        lines = ["📊 <b>Recent Cloud Transfers:</b>\n"]
        for t in transfers:
            status_emoji = {
                TransferStatus.QUEUED: "⏳",
                TransferStatus.FETCHING_TELEGRAM: "📥",
                TransferStatus.UPLOADING_DRIVE: "☁️",
                TransferStatus.VERIFYING: "🔍",
                TransferStatus.COMPLETED: "✅",
                TransferStatus.FAILED: "❌",
                TransferStatus.CANCELLED: "🚫",
                TransferStatus.RETRYING: "🔄",
            }.get(t.status, "•")

            pct = 0
            if t.size > 0 and t.bytes_transferred:
                pct = int((t.bytes_transferred / t.size) * 100)

            line = f"{status_emoji} <b>#{t.id}</b> {t.filename}\n   Status: <code>{t.status.value}</code> ({format_bytes(t.size)})"
            if t.status in (TransferStatus.UPLOADING_DRIVE, TransferStatus.FETCHING_TELEGRAM):
                line += f" — {pct}%"
            lines.append(line)

        await self.send_message(chat_id, "\n\n".join(lines))

    async def _handle_media(
        self, chat_id: int, message_id: int, file_id: str, filename: str, file_size: int
    ) -> None:
        log_event("TELEGRAM_MEDIA_RECEIVED", filename=filename, size=file_size, chat_id=chat_id)

        # Check if service channel is configured for non-owner uploads
        is_owner = self.owner_user_id and chat_id == self.owner_user_id
        if not is_owner and not self.is_forward_target_configured():
            # Non-owner upload but no relay target configured - reject early with clear message
            await self.send_message(
                chat_id=chat_id,
                text=(
                    "⚠️ <b>StreamX — Upload Not Supported</b>\n\n"
                    "This bot requires a Telegram service channel to be configured "
                    "for uploads from non-owner accounts.\n\n"
                    "Please contact the administrator to set up "
                    "<code>TELEGRAM_SERVICE_CHANNEL</code> or "
                    "<code>TELEGRAM_OWNER_USER_ID</code>."
                ),
                reply_to_message_id=message_id,
            )
            log_event(
                "UPLOAD_REJECTED_NO_RELAY_TARGET",
                chat_id=chat_id,
                user_id=chat_id,
                filename=filename,
            )
            return

        # Record in SQLite
        async with AsyncSessionLocal() as session:
            transfer = TelegramTransfer(
                telegram_chat_id=chat_id,
                telegram_message_id=message_id,
                telegram_file_id=file_id,
                filename=filename,
                size=file_size,
                status=TransferStatus.QUEUED,
                bytes_transferred=0,
            )
            session.add(transfer)
            await session.commit()
            await session.refresh(transfer)
            transfer_id = transfer.id

        log_event("TRANSFER_RECORD_CREATED", transfer_id=transfer_id, filename=filename)

        # Relay media into a location the MTProto worker can actually read.
        # The MTProto session is a single user account and cannot read messages
        # sent to the bot by OTHER users, so forwarding is required for friend
        # uploads. When no relay target is configured we fall back to the legacy
        # owner-only path (only the MTProto owner's own files will resolve).
        try:
            forwarded = await self.forward_media_to_service(chat_id, message_id)
        except StreamXError as e:
            await self._mark_transfer_failed(
                transfer_id, category=e.category, message=str(e)
            )
            log_event(
                "FORWARD_FAILED_PERMANENT",
                transfer_id=transfer_id,
                error_category=e.category.value,
                filename=filename,
            )
            await self.send_message(
                chat_id=chat_id,
                text=self._failure_message(
                    filename, transfer_id, e.category, "Upload could not be started."
                ),
                reply_to_message_id=message_id,
            )
            return

        if forwarded is not None:
            fwd_chat_id, fwd_msg_id = forwarded
            async with AsyncSessionLocal() as session:
                t = await session.get(TelegramTransfer, transfer_id)
                if t:
                    t.forwarded_chat_id = fwd_chat_id
                    t.forwarded_message_id = fwd_msg_id
                    await session.commit()
            log_event(
                "MEDIA_FORWARDED_TO_SERVICE_CHANNEL",
                transfer_id=transfer_id,
                forwarded_chat_id=fwd_chat_id,
            )

        # Immediate acknowledgement to user
        msg = (
            "🎬 <b>StreamX — Media Received</b>\n\n"
            f"📁 <b>File:</b> <code>{filename}</code>\n"
            f"📦 <b>Size:</b> {format_bytes(file_size)}\n"
            f"⚡ <b>Status:</b> <code>Queued for cloud transfer</code>\n"
            f"🏷️ <b>Transfer ID:</b> <code>#{transfer_id}</code>\n\n"
            "<i>You can now safely close Telegram. Your file will be processed in the background.</i>"
        )
        await self.send_message(chat_id, msg, reply_to_message_id=message_id)

    @staticmethod
    async def _mark_transfer_failed(transfer_id: int, category: ErrorCategory, message: str) -> None:
        """Persist a permanent failure on a transfer row."""
        async with AsyncSessionLocal() as session:
            t = await session.get(TelegramTransfer, transfer_id)
            if t:
                t.status = TransferStatus.FAILED
                t.error_category = category
                t.error_message = message
                t.completed_at = datetime.now(timezone.utc)
                await session.commit()

    @staticmethod
    def _failure_message(
        filename: str, transfer_id: int, category: ErrorCategory, detail: Optional[str] = None
    ) -> str:
        """Build an actionable, secret-free failure message for the end user."""
        from app.utils.errors import CATEGORY_USER_MESSAGE

        summary = CATEGORY_USER_MESSAGE.get(category, detail or "Upload failed.")
        return (
            "⚠️ <b>StreamX — Upload Failed</b>\n\n"
            f"📁 <b>File:</b> <code>{filename}</code>\n"
            f"🏷️ <b>Transfer ID:</b> <code>#{transfer_id}</code>\n"
            f"📋 <b>Reason:</b> <i>{category.value}</i>\n\n"
            f"{summary}"
        )

    async def start_polling(self) -> None:
        """Start polling loop for incoming Telegram updates."""
        if not self.is_configured():
            logger.warning("Telegram Bot Token is not configured. Polling not started.")
            return

        self.running = True
        log_event("TELEGRAM_POLLING_STARTED", forward_target_configured=self.is_forward_target_configured())

        async with httpx.AsyncClient(timeout=45.0) as client:
            while self.running:
                try:
                    params: Dict[str, Any] = {"timeout": 30}
                    if self.last_update_id:
                        params["offset"] = self.last_update_id + 1

                    res = await client.get(f"{self.base_url}/getUpdates", params=params)
                    if res.status_code == 200:
                        data = res.json()
                        updates = data.get("result", [])
                        for update in updates:
                            update_id = update.get("update_id")
                            if update_id:
                                self.last_update_id = max(self.last_update_id, update_id)
                            await self.process_update(update)
                    else:
                        logger.warning(f"Telegram getUpdates returned status {res.status_code}")
                        await asyncio.sleep(5)
                except httpx.TimeoutException:
                    # Normal long-polling timeout, continue loop
                    continue
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.error(f"Error in Telegram bot polling: {e}")
                    await asyncio.sleep(5)

        log_event("TELEGRAM_POLLING_STOPPED")

    def stop(self) -> None:
        """Signal polling to stop."""
        self.running = False
        if self.task:
            self.task.cancel()


bot_service = TelegramBotService()
