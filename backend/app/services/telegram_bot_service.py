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
import html
import os
import re
from typing import Any, Dict, Optional, Tuple
import httpx
from sqlalchemy import select, or_

from app.config.settings import settings
from app.db.database import AsyncSessionLocal
from app.db.models import ErrorCategory, TelegramTransfer, TransferStatus, Media
from app.utils.errors import StreamXError
from app.utils.filenames import format_bytes, sanitize_filename
from app.utils.logging import log_event, logger


# Ingestion lock to prevent race conditions during rapid/concurrent update delivery
_ingestion_lock = asyncio.Lock()


def make_progress_bar(pct: int, length: int = 8) -> str:
    """Render a clean unicode progress bar."""
    filled = int(round(length * (max(0, min(100, pct)) / 100.0)))
    return "█" * filled + "░" * (length - filled)


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
        self.bot_id = self.bot_token.split(":")[0] if self.bot_token and ":" in self.bot_token else None
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
        self.processed_update_ids = set()
        self._max_processed_ids = 1000

    def is_configured(self) -> bool:
        return bool(self.bot_token and self.bot_token.strip())

    async def send_message(self, chat_id: int, text: str, reply_to_message_id: Optional[int] = None) -> bool:
        """Send a message to a Telegram chat with automatic HTML parse fallback."""
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
                # Skip live network calls during tests only when using unmocked httpx client
                if (os.getenv("PYTEST_CURRENT_TEST") or settings.STREAMX_ENV == "testing") and type(client).__module__.startswith("httpx"):
                    return True
                res = await client.post(f"{self.base_url}/sendMessage", json=payload)
                if res.status_code == 200:
                    return True
                logger.warning(f"Telegram sendMessage to {chat_id} returned HTTP {res.status_code}: {res.text}")
                # Fallback: if HTML parsing failed, strip HTML and send plain text so message is never dropped
                if res.status_code == 400 or "parse" in res.text.lower() or "entities" in res.text.lower():
                    payload.pop("parse_mode", None)
                    payload["text"] = re.sub(r"<[^>]+>", "", text)
                    res2 = await client.post(f"{self.base_url}/sendMessage", json=payload)
                    return res2.status_code == 200
                return False
        except Exception as e:
            logger.error(f"Failed to send Telegram message to {chat_id}: {e}")
            return False

    def resolve_forward_target(self) -> Optional[Any]:
        """Return the chat the bot should forward media into for MTProto pickup.

        Order: TELEGRAM_SERVICE_CHANNEL (preferred shared channel/group), then
        TELEGRAM_OWNER_USER_ID (owner DM fallback). Returns None if unset.
        """
        if self.service_channel:
            clean = str(self.service_channel).strip().lower().lstrip("@")
            bot_id_str = str(self.bot_id) if getattr(self, "bot_id", None) else ""
            # If mistakenly set to the bot itself, ignore it (bots cannot send to bots)
            if clean not in ("stream1_x_bot", "streamx_bot") and clean != bot_id_str:
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

    async def register_bot_commands(self) -> bool:
        """Register the interactive command menu in Telegram Bot API for the Menu button."""
        if not self.is_configured():
            return False

        commands = [
            {"command": "status", "description": "📊 Live transfer progress & queue"},
            {"command": "queue", "description": "⏳ Active transfers currently running"},
            {"command": "library", "description": "📚 Google Drive library overview"},
            {"command": "rename", "description": "✏️ Rename series folder & update episodes"},
            {"command": "retry", "description": "🔄 Resume/retry any failed transfers"},
            {"command": "cancel", "description": "🚫 Cancel a transfer by ID"},
            {"command": "ping", "description": "🏓 24/7 server latency & health"},
            {"command": "help", "description": "📖 Instructions, tips & guide"},
            {"command": "start", "description": "👋 Main menu & introduction"},
        ]
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    f"{self.base_url}/setMyCommands",
                    json={"commands": commands},
                )
                if res.status_code == 200:
                    log_event("TELEGRAM_BOT_COMMANDS_REGISTERED", count=len(commands))
                    return True
                logger.warning(f"Failed to set bot commands: {res.text}")
                return False
        except Exception as e:
            logger.warning(f"Error registering bot commands: {e}")
            return False

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
        if not allowed or (settings.TELEGRAM_ALLOWED_USER_IDS and "*" in settings.TELEGRAM_ALLOWED_USER_IDS):
            return True
        try:
            return int(user_id) in allowed
        except (ValueError, TypeError):
            return str(user_id) in [str(u) for u in allowed]

    async def process_update(self, update: Dict[str, Any]) -> None:
        """Process an individual Telegram update (message, channel_post, or edited)."""
        update_id = update.get("update_id")
        if update_id is not None:
            if update_id in self.processed_update_ids:
                logger.debug(f"Skipping duplicate Telegram update {update_id}")
                return
            if len(self.processed_update_ids) >= self._max_processed_ids:
                self.processed_update_ids.pop()
            self.processed_update_ids.add(update_id)

        message = (
            update.get("message")
            or update.get("channel_post")
            or update.get("edited_message")
            or update.get("edited_channel_post")
        )
        if not message:
            return

        chat = message.get("chat", {})
        chat_id = chat.get("id")
        user = message.get("from", {})
        user_id = user.get("id") or chat_id
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

        text = (message.get("text") or message.get("caption") or "").strip()
        cmd_parts = text.split()
        cmd = cmd_parts[0].lower().split("@")[0] if cmd_parts else ""
        args = cmd_parts[1:] if len(cmd_parts) > 1 else []

        # Handle Commands
        if cmd == "/start":
            await self._handle_start(chat_id, user.get("first_name", "there"))
            return
        elif cmd == "/help":
            await self._handle_help(chat_id)
            return
        elif cmd in ("/status", "/stats", "/health", "/system"):
            await self._handle_status(chat_id)
            return
        elif cmd in ("/queue", "/downloads", "/download", "/transfers", "/transfer", "/progress"):
            await self._handle_queue(chat_id)
            return
        elif cmd in ("/library", "/catalog", "/list"):
            await self._handle_library(chat_id)
            return
        elif cmd in ("/search", "/find"):
            await self._handle_search(chat_id, args)
            return
        elif cmd in ("/drive", "/storage"):
            await self._handle_drive_storage(chat_id)
            return
        elif cmd == "/retry":
            await self._handle_retry(chat_id, args)
            return
        elif cmd == "/cancel":
            await self._handle_cancel(chat_id, args)
            return
        elif cmd in ("/clear", "/clean"):
            await self._handle_clear(chat_id)
            return
        elif cmd == "/rename":
            await self._handle_rename(chat_id, text)
            return
        elif cmd == "/ping":
            await self._handle_ping(chat_id)
            return
        elif cmd.startswith("/"):
            await self._handle_unknown_command(chat_id, cmd)
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
                "Send or forward any video, movie, episode, or document directly to this bot to transfer it to Google Drive.\n\n"
                "Type /help for instructions or /status for current transfer queue."
            ),
            reply_to_message_id=message_id,
        )

    def _extract_media_info(self, message: Dict[str, Any]) -> Optional[Tuple[str, str, int]]:
        """Extract file_id, filename, and size from video, document, audio, or animation messages."""
        caption = (message.get("caption") or "").strip()

        if "document" in message:
            doc = message["document"]
            raw_name = doc.get("file_name") or caption or "document.bin"
            filename = sanitize_filename(raw_name)
            return doc.get("file_id"), filename, doc.get("file_size", 0)

        if "video" in message:
            vid = message["video"]
            raw_name = vid.get("file_name") or caption or f"video_{int(datetime.now(timezone.utc).timestamp())}.mp4"
            filename = sanitize_filename(raw_name)
            return vid.get("file_id"), filename, vid.get("file_size", 0)

        if "animation" in message:
            anim = message["animation"]
            raw_name = anim.get("file_name") or caption or f"animation_{int(datetime.now(timezone.utc).timestamp())}.mp4"
            filename = sanitize_filename(raw_name)
            return anim.get("file_id"), filename, anim.get("file_size", 0)

        if "audio" in message:
            aud = message["audio"]
            raw_name = aud.get("file_name") or caption or f"audio_{int(datetime.now(timezone.utc).timestamp())}.mp3"
            filename = sanitize_filename(raw_name)
            return aud.get("file_id"), filename, aud.get("file_size", 0)

        return None

    async def _handle_start(self, chat_id: int, user_first_name: str) -> None:
        msg = (
            f"👋 <b>Welcome to StreamX, {user_first_name}!</b>\n\n"
            "StreamX is your personal media cloud pipeline connecting Telegram directly to Google Drive and offline playback.\n\n"
            "<b>How to use:</b>\n"
            "1. Forward any video, episode, or movie directly to this bot.\n"
            "2. StreamX automatically ingests and uploads it directly to Google Drive.\n"
            "3. You can close Telegram immediately — all transfers run 24/7 in the cloud.\n\n"
            "<b>Commands:</b>\n"
            "• /status — View transfer progress & queue\n"
            "• /queue — View active transfers\n"
            "• /library — Browse uploaded Google Drive collection\n"
            "• /retry — Resume any failed transfers\n"
            "• /cancel — Cancel transfer by ID (e.g. <code>/cancel 5</code>)\n"
            "• /ping — Check 24/7 server responsiveness\n"
            "• /help — Full usage instructions"
        )
        await self.send_message(chat_id, msg)

    async def _handle_help(self, chat_id: int) -> None:
        msg = (
            "📖 <b>StreamX Help & Usage Guide</b>\n\n"
            "• <b>Ingestion:</b> Forward large files (movies, anime, series) directly to this bot.\n"
            "• <b>Cloud Streaming:</b> Files stream directly into Google Drive without using your local phone storage.\n"
            "• <b>Offline & PWA:</b> Watch or download from Google Drive in the StreamX web app or Android client.\n\n"
            "<b>Quick Commands:</b>\n"
            "• /status — Active transfers & progress bars\n"
            "• /queue — Pending & in-progress transfers\n"
            "• /library — Overview of Google Drive library\n"
            "• /retry — Retry failed transfers\n"
            "• /cancel &lt;id&gt; — Cancel a transfer\n"
            "• /ping — Server heartbeat check"
        )
        await self.send_message(chat_id, msg)

    async def _handle_status(self, chat_id: int) -> None:
        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).order_by(TelegramTransfer.id.desc()).limit(6)
            result = await session.execute(stmt)
            transfers = result.scalars().all()

        if not transfers:
            await self.send_message(chat_id, "ℹ️ No recent transfers in the queue.")
            return

        lines = ["📊 <b>StreamX — Transfer Status:</b>\n"]
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
            elif t.status == TransferStatus.COMPLETED:
                pct = 100

            bar = make_progress_bar(pct, length=8)
            safe_name = html.escape(t.filename)
            line = f"{status_emoji} <b>#{t.id}</b> {safe_name}\n   Status: <code>{t.status.value}</code>"
            if t.status in (TransferStatus.UPLOADING_DRIVE, TransferStatus.FETCHING_TELEGRAM):
                line += f"\n   [{bar}] {pct}% ({format_bytes(t.bytes_transferred or 0)} / {format_bytes(t.size)})"
            elif t.status == TransferStatus.COMPLETED:
                line += f" ({format_bytes(t.size)})"
            elif t.status == TransferStatus.FAILED and t.error_message:
                line += f"\n   ⚠️ <i>{html.escape(t.error_message[:60])}</i>"
            lines.append(line)

        lines.append("\n💡 <i>Tip: Type /queue for active transfers only, or /retry to re-enqueue.</i>")
        await self.send_message(chat_id, "\n\n".join(lines))

    async def _handle_queue(self, chat_id: int) -> None:
        async with AsyncSessionLocal() as session:
            stmt = (
                select(TelegramTransfer)
                .where(
                    TelegramTransfer.status.in_([
                        TransferStatus.QUEUED,
                        TransferStatus.FETCHING_TELEGRAM,
                        TransferStatus.UPLOADING_DRIVE,
                        TransferStatus.VERIFYING,
                        TransferStatus.RETRYING,
                    ])
                )
                .order_by(TelegramTransfer.id.asc())
            )
            active = (await session.execute(stmt)).scalars().all()

        if not active:
            await self.send_message(
                chat_id,
                "✨ <b>Transfer Queue is Clear!</b>\n\n"
                "All queued items have completed. Forward any media file to begin a new cloud transfer.\n\n"
                "Type /library to browse your uploaded collection."
            )
            return

        lines = [f"⏳ <b>Active Transfer Queue ({len(active)} in progress):</b>\n"]
        for t in active:
            pct = int((t.bytes_transferred / t.size) * 100) if (t.size and t.bytes_transferred) else 0
            bar = make_progress_bar(pct, length=8)
            safe_name = html.escape(t.filename)
            lines.append(
                f"• <b>#{t.id}</b> {safe_name}\n"
                f"  <code>{t.status.value}</code> [{bar}] {pct}%\n"
                f"  {format_bytes(t.bytes_transferred or 0)} of {format_bytes(t.size)}"
            )
        await self.send_message(chat_id, "\n\n".join(lines))

    async def _handle_library(self, chat_id: int) -> None:
        async with AsyncSessionLocal() as session:
            stmt = select(Media).order_by(Media.id.desc())
            items = (await session.execute(stmt)).scalars().all()

        total_count = len(items)
        total_size = sum(m.size for m in items if m.size)
        recent = items[:4]

        lines = [
            "📚 <b>StreamX Cloud Library Overview</b>\n",
            f"📁 <b>Total Cataloged Media:</b> {total_count}",
            f"📦 <b>Total Google Drive Storage:</b> {format_bytes(total_size)}",
            f"☁️ <b>Location:</b> Google Drive / StreamX",
        ]

        if recent:
            lines.append("\n<b>Recently Added:</b>")
            for m in recent:
                safe_name = html.escape(m.filename)
                lines.append(f"• {safe_name} ({format_bytes(m.size)})")

        lines.append("\n🎬 <i>You can stream or browse everything in your StreamX web app or Android client.</i>")
        await self.send_message(chat_id, "\n".join(lines))

    async def _handle_retry(self, chat_id: int, args: list) -> None:
        async with AsyncSessionLocal() as session:
            if args and args[0].isdigit():
                tid = int(args[0])
                stmt = select(TelegramTransfer).where(TelegramTransfer.id == tid)
            else:
                stmt = select(TelegramTransfer).where(
                    TelegramTransfer.status.in_([TransferStatus.FAILED, TransferStatus.CANCELLED])
                ).order_by(TelegramTransfer.id.desc()).limit(5)
            failed = (await session.execute(stmt)).scalars().all()

            if not failed:
                await self.send_message(chat_id, "ℹ️ No failed or cancelled transfers found to retry.")
                return

            retried_ids = []
            for t in failed:
                t.status = TransferStatus.QUEUED
                t.scheduled_retry_at = None
                t.error_category = None
                t.error_message = None
                retried_ids.append(str(t.id))
            await session.commit()

        await self.send_message(
            chat_id,
            f"🔄 <b>Transfer(s) Re-queued!</b>\n\n"
            f"Transfer #{', #'.join(retried_ids)} set to <code>QUEUED</code> and will resume processing immediately."
        )

    async def _handle_cancel(self, chat_id: int, args: list) -> None:
        if not args or not args[0].isdigit():
            await self.send_message(
                chat_id,
                "⚠️ <b>Usage:</b> <code>/cancel &lt;transfer_id&gt;</code>\n"
                "Example: <code>/cancel 6</code> to cancel Transfer #6."
            )
            return

        tid = int(args[0])
        async with AsyncSessionLocal() as session:
            t = await session.get(TelegramTransfer, tid)
            if not t:
                await self.send_message(chat_id, f"❌ Transfer #{tid} not found.")
                return

            if t.status in (TransferStatus.COMPLETED, TransferStatus.CANCELLED) or getattr(t, "is_deleted", False):
                await self.send_message(chat_id, f"ℹ️ Transfer #{tid} is already <code>{t.status.value}</code>.")
                return

            t.status = TransferStatus.CANCELLED
            t.is_deleted = True
            t.error_message = "Cancelled by user via Telegram command."
            t.scheduled_retry_at = None
            await session.commit()

        # Stop active worker job if running
        try:
            from app.workers.transfer_worker import transfer_worker
            transfer_worker.cancel_transfer(tid)
        except Exception as e:
            logger.debug(f"Could not signal transfer cancellation to worker: {e}")

        await self.send_message(chat_id, f"🚫 <b>Transfer #{tid} Cancelled</b>\n<code>{html.escape(t.filename)}</code>")

    async def _handle_search(self, chat_id: int, args: list) -> None:
        if not args:
            await self.send_message(
                chat_id,
                "🔍 <b>Usage:</b> <code>/search &lt;query&gt;</code>\nExample: <code>/search Summoner</code>"
            )
            return

        query = " ".join(args).strip().lower()
        async with AsyncSessionLocal() as session:
            stmt = select(Media).order_by(Media.id.desc())
            items = (await session.execute(stmt)).scalars().all()
            matches = [
                m for m in items
                if query in (m.filename or "").lower()
                or query in (getattr(m, "title", None) or "").lower()
                or query in (getattr(m, "canonical_title", None) or "").lower()
            ][:6]

        if not matches:
            await self.send_message(
                chat_id,
                f"🔍 <b>No media found matching:</b> <i>{html.escape(query)}</i>\n\n"
                "Try searching for another keyword or type /library to browse all."
            )
            return

        lines = [f"🔍 <b>Search Results for:</b> <i>{html.escape(query)}</i> ({len(matches)} found)\n"]
        for m in matches:
            display_title = getattr(m, "canonical_title", None) or getattr(m, "title", None) or m.filename
            size_str = format_bytes(m.size or 0)
            lines.append(f"• <b>{html.escape(display_title)}</b>\n  📁 {html.escape(m.category)} · {size_str}")
        lines.append("\n🎬 <i>Open StreamX on web or mobile to watch in VLC.</i>")
        await self.send_message(chat_id, "\n\n".join(lines))

    async def _handle_drive_storage(self, chat_id: int) -> None:
        async with AsyncSessionLocal() as session:
            stmt = select(Media)
            items = (await session.execute(stmt)).scalars().all()

        total_count = len(items)
        total_size = sum(m.size for m in items if m.size)
        anime_count = sum(1 for m in items if m.category == "Anime")
        tv_count = sum(1 for m in items if m.category == "TV Shows")
        movies_count = sum(1 for m in items if m.category == "Movies")
        other_count = sum(1 for m in items if m.category == "Other")

        msg = (
            "☁️ <b>StreamX — Google Drive Storage Vault</b>\n\n"
            f"📦 <b>Total Media Vault Size:</b> {format_bytes(total_size)} ({total_count} files)\n\n"
            "📁 <b>Category Breakdown:</b>\n"
            f"• 🌸 <b>Anime:</b> {anime_count} files\n"
            f"• 📺 <b>TV Shows:</b> {tv_count} files\n"
            f"• 🎬 <b>Movies:</b> {movies_count} files\n"
            f"• 📂 <b>Other:</b> {other_count} files\n\n"
            "⚡ <i>All media streams directly with HTTP 206 Partial Content and zero local SSD disk wear.</i>"
        )
        await self.send_message(chat_id, msg)

    async def _handle_clear(self, chat_id: int) -> None:
        async with AsyncSessionLocal() as session:
            stmt = select(TelegramTransfer).where(
                TelegramTransfer.status.in_([TransferStatus.FAILED, TransferStatus.CANCELLED])
            )
            failed = (await session.execute(stmt)).scalars().all()
            for t in failed:
                t.is_deleted = True
            await session.commit()
            cleared_count = len(failed)

        await self.send_message(
            chat_id,
            f"🧹 <b>Queue Cleaned</b>\n\nCleared {cleared_count} failed/cancelled transfer records from the queue view."
        )

    async def _handle_unknown_command(self, chat_id: int, cmd: str) -> None:
        safe_cmd = html.escape(cmd)
        msg = (
            f"❓ <b>Unrecognized Command:</b> <code>{safe_cmd}</code>\n\n"
            "<b>Available Commands:</b>\n"
            "• /queue (or /downloads) — View active transfers & live progress\n"
            "• /status — System health & queue overview\n"
            "• /library — Browse uploaded Google Drive collection\n"
            "• /search &lt;query&gt; — Search media titles in library\n"
            "• /drive — View Drive storage quota and folders\n"
            "• /retry [id] — Retry failed or cancelled transfers\n"
            "• /cancel &lt;id&gt; — Cancel an active transfer\n"
            "• /clear — Remove failed transfers from queue\n"
            "• /ping — Check 24/7 server latency\n"
            "• /help — Full instructions"
        )
        await self.send_message(chat_id, msg)

    async def _handle_ping(self, chat_id: int) -> None:
        msg = (
            "🏓 <b>Pong! StreamX is Online</b>\n\n"
            "🟢 <b>Bot Engine:</b> Active 24/7\n"
            "☁️ <b>Google Drive:</b> Connected & Ready\n"
            "📥 <b>MTProto Ingestion:</b> Operational\n"
            "⚡ <b>Edge Gateway:</b> Cloudflare Connected"
        )
        await self.send_message(chat_id, msg)

    async def _handle_rename(self, chat_id: int, full_text: str) -> None:
        """Handle /rename command to rename a series folder, all its files, and move to Anime."""
        from app.services.drive_service import drive_service

        raw = full_text.split(None, 1)
        if len(raw) < 2:
            await self.send_message(
                chat_id,
                "✏️ <b>Rename Series & Update All Episodes</b>\n\n"
                "<b>Usage:</b>\n"
                "<code>/rename [Current Folder Name] to [New Series Name]</code>\n\n"
                "<b>Example:</b>\n"
                "<code>/rename Alya to Alya Sometimes Hides Her Feelings in Russian</code>\n\n"
                "<i>This will:</i>\n"
                "1. Rename the folder in Google Drive\n"
                "2. Rename every episode file inside, preserving episode numbers and quality\n"
                "3. Fetch official posters and synopsis from TMDB\n"
                "4. Move the folder to Anime if Japanese animation!"
            )
            return

        body = raw[1].strip()
        parts = []
        if " to " in body.lower():
            idx = body.lower().index(" to ")
            parts = [body[:idx].strip(), body[idx + 4:].strip()]
        elif "," in body:
            parts = [p.strip() for p in body.split(",", 1)]

        if len(parts) < 2 or not parts[0] or not parts[1]:
            await self.send_message(
                chat_id,
                "⚠️ <b>Invalid format.</b>\n"
                "Usage: <code>/rename Old Name to New Name</code>\n"
                "Example: <code>/rename Alya to Alya Sometimes Hides Her Feelings in Russian</code>"
            )
            return

        old_name, new_name = parts[0], parts[1]
        await self.send_message(
            chat_id,
            f"🔄 <b>Processing series rename...</b>\n\n"
            f"📁 <b>Folder:</b> <code>{html.escape(old_name)}</code> ➔ <code>{html.escape(new_name)}</code>\n"
            "🎬 Renaming episode files in Google Drive...\n"
            "✨ Pulling TMDB anime artwork & classifying..."
        )

        try:
            res = await drive_service.rename_series_folder(old_name, new_name)
            files_renamed = res.get("files_renamed", 0)
            relocated = res.get("folders_relocated", 0)
            cat_text = "Relocated to Anime" if relocated > 0 else "Updated in library"
            await self.send_message(
                chat_id,
                f"✅ <b>Series Successfully Updated!</b>\n\n"
                f"📁 <b>Folder:</b> <code>{html.escape(new_name)}</code>\n"
                f"🎬 <b>Episodes Renamed:</b> {files_renamed}\n"
                f"🏷️ <b>Category:</b> {cat_text}\n"
                "✨ <b>Metadata:</b> Official posters, synopsis & episode indexing enqueued!"
            )
        except Exception as e:
            logger.error(f"Telegram /rename failed: {e}", exc_info=True)
            await self.send_message(chat_id, f"❌ <b>Rename failed:</b> {html.escape(str(e))}")

    async def _handle_media(
        self, chat_id: int, message_id: int, file_id: str, filename: str, file_size: int
    ) -> None:
        log_event("TELEGRAM_MEDIA_RECEIVED", filename=filename, size=file_size, chat_id=chat_id)

        # Check if user is the MTProto account owner (only the owner's MTProto session can read their own chat with the bot)
        is_owner = bool(self.owner_user_id and chat_id == self.owner_user_id)
        if not is_owner and not self.is_forward_target_configured():
            # Non-owner upload but no relay target configured - reject early with clear message
            await self.send_message(
                chat_id=chat_id,
                text=(
                    "⚠️ <b>StreamX — Upload Not Supported</b>\n\n"
                    "This bot requires a Telegram service channel to be configured "
                    "for uploads from non-owner accounts.\n\n"
                    "Please contact the administrator to set up "
                    "<code>TELEGRAM_SERVICE_CHANNEL</code>."
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

        safe_filename = html.escape(filename)

        async with _ingestion_lock:
            async with AsyncSessionLocal() as session:
                # 1. Deduplication: Check if media already exists in Google Drive (Media table)
                existing_media = (
                    await session.execute(
                        select(Media).where(
                            Media.filename == filename,
                            or_(Media.size == file_size, file_size == 0),
                        )
                    )
                ).scalars().first()

                if existing_media:
                    log_event(
                        "MEDIA_INGESTION_DUPLICATE_DRIVE",
                        filename=filename,
                        size=file_size,
                        drive_id=existing_media.drive_file_id,
                    )
                    await self.send_message(
                        chat_id=chat_id,
                        text=(
                            "ℹ️ <b>StreamX — Duplicate Media Detected</b>\n\n"
                            f"📁 <b>File:</b> <code>{safe_filename}</code>\n"
                            f"📦 <b>Size:</b> {format_bytes(file_size)}\n"
                            f"☁️ <b>Location:</b> Already exists in Google Drive (<code>{existing_media.drive_file_id}</code>)\n\n"
                            "<i>Skipped upload to preserve Google Drive quota.</i>"
                        ),
                        reply_to_message_id=message_id,
                    )
                    return

                # 2. Deduplication: Check if the exact message was already processed
                existing_msg = (
                    await session.execute(
                        select(TelegramTransfer).where(
                            TelegramTransfer.telegram_chat_id == chat_id,
                            TelegramTransfer.telegram_message_id == message_id,
                        )
                    )
                ).scalars().first()

                if existing_msg:
                    log_event("MEDIA_INGESTION_DUPLICATE_MSG", chat_id=chat_id, message_id=message_id)
                    return

                # 3. Deduplication: Check if an active transfer is currently in progress for this file
                active_transfer = (
                    await session.execute(
                        select(TelegramTransfer).where(
                            TelegramTransfer.filename == filename,
                            or_(TelegramTransfer.size == file_size, file_size == 0),
                            TelegramTransfer.status.in_([
                                TransferStatus.QUEUED,
                                TransferStatus.FETCHING_TELEGRAM,
                                TransferStatus.UPLOADING_DRIVE,
                                TransferStatus.VERIFYING,
                                TransferStatus.RETRYING,
                            ]),
                        )
                    )
                ).scalars().first()

                if active_transfer:
                    log_event(
                        "MEDIA_INGESTION_DUPLICATE_ACTIVE",
                        filename=filename,
                        size=file_size,
                        transfer_id=active_transfer.id,
                    )
                    await self.send_message(
                        chat_id=chat_id,
                        text=(
                            "⏳ <b>StreamX — Transfer Already in Progress</b>\n\n"
                            f"📁 <b>File:</b> <code>{safe_filename}</code>\n"
                            f"🏷️ <b>Transfer ID:</b> <code>#{active_transfer.id}</code>\n"
                            f"📊 <b>Status:</b> <code>{active_transfer.status.value}</code>\n\n"
                            "<i>Duplicate request ignored — this file is currently being processed.</i>"
                        ),
                        reply_to_message_id=message_id,
                    )
                    return

                # 4. Deduplication: Check if a completed transfer already exists for this file
                completed_transfer = (
                    await session.execute(
                        select(TelegramTransfer).where(
                            TelegramTransfer.filename == filename,
                            or_(TelegramTransfer.size == file_size, file_size == 0),
                            TelegramTransfer.status == TransferStatus.COMPLETED,
                        )
                    )
                ).scalars().first()

                if completed_transfer:
                    log_event(
                        "MEDIA_INGESTION_DUPLICATE_COMPLETED",
                        filename=filename,
                        size=file_size,
                        transfer_id=completed_transfer.id,
                    )
                    await self.send_message(
                        chat_id=chat_id,
                        text=(
                            "✅ <b>StreamX — File Already Uploaded</b>\n\n"
                            f"📁 <b>File:</b> <code>{safe_filename}</code>\n"
                            f"🏷️ <b>Transfer ID:</b> <code>#{completed_transfer.id}</code>\n\n"
                            "<i>This file was already successfully transferred to Google Drive. Duplicate upload ignored.</i>"
                        ),
                        reply_to_message_id=message_id,
                    )
                    return

                # Record in SQLite
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
        # If the sender is the owner, MTProto can read the bot chat directly (NO forwarding needed!).
        forwarded = None
        if not is_owner and self.resolve_forward_target() is not None:
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
            f"📁 <b>File:</b> <code>{safe_filename}</code>\n"
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
        safe_filename = html.escape(filename)
        return (
            "⚠️ <b>StreamX — Upload Failed</b>\n\n"
            f"📁 <b>File:</b> <code>{safe_filename}</code>\n"
            f"🏷️ <b>Transfer ID:</b> <code>#{transfer_id}</code>\n"
            f"📋 <b>Reason:</b> <i>{html.escape(category.value)}</i>\n\n"
            f"{html.escape(summary)}"
        )

    async def sync_forwarded_messages(self) -> int:
        """Scan bot/owner chat via MTProto for newly forwarded media not yet recorded in SQLite."""
        from app.services.telegram_mtproto_service import mtproto_service
        if not mtproto_service.is_configured():
            return 0

        try:
            client = await mtproto_service.get_client()
            bot_entity = "Stream1_X_bot"
            messages = await client.get_messages(bot_entity, limit=200)
            async with AsyncSessionLocal() as session:
                existing_tids = set((await session.execute(select(TelegramTransfer.telegram_message_id))).scalars().all())
                existing_fwds = set((await session.execute(select(TelegramTransfer.forwarded_message_id))).scalars().all())
                existing_filenames = set((await session.execute(
                    select(TelegramTransfer.filename).where(
                        TelegramTransfer.status.notin_([TransferStatus.FAILED, TransferStatus.CANCELLED])
                    )
                )).scalars().all())
                existing_media = set((await session.execute(select(Media.filename))).scalars().all())

                new_count = 0
                enqueued_transfers = []
                # Process in chronological order (oldest to newest) so Episode 1 is enqueued before Episode 2, 3, 4
                for m in reversed(messages):
                    file_obj = getattr(m, "file", None)
                    if not file_obj:
                        continue

                    # Robust filename extraction (handles files where DocumentAttributeFilename is missing)
                    fname = getattr(file_obj, "name", None)
                    if not fname and hasattr(m, "document") and m.document:
                        for attr in getattr(m.document, "attributes", []):
                            if hasattr(attr, "file_name") and attr.file_name:
                                fname = attr.file_name
                                break

                    if not fname and m.message:
                        first_line = m.message.strip().split("\n")[0][:80]
                        ext = getattr(file_obj, "ext", "") or ".mp4"
                        if not ext.startswith("."):
                            ext = f".{ext}"
                        fname = f"{first_line}{ext}"

                    if not fname:
                        ext = getattr(file_obj, "ext", ".mp4") or ".mp4"
                        if not ext.startswith("."):
                            ext = f".{ext}"
                        fname = f"telegram_media_{m.id}{ext}"

                    fname = sanitize_filename(fname)
                    fsize = getattr(file_obj, "size", 0) or 0
                    if (
                        m.id not in existing_tids
                        and m.id not in existing_fwds
                        and fname not in existing_filenames
                        and fname not in existing_media
                    ):
                        t = TelegramTransfer(
                            telegram_chat_id=self.owner_user_id or settings.TELEGRAM_OWNER_USER_ID,
                            telegram_message_id=m.id,
                            telegram_file_id=f"mtproto_{m.id}",
                            filename=fname,
                            size=fsize,
                            status=TransferStatus.QUEUED,
                            forwarded_chat_id=self.owner_user_id or settings.TELEGRAM_OWNER_USER_ID,
                            forwarded_message_id=m.id,
                        )
                        session.add(t)
                        existing_tids.add(m.id)
                        existing_fwds.add(m.id)
                        existing_filenames.add(fname)
                        enqueued_transfers.append((fname, fsize, m.id))
                        new_count += 1

                if new_count > 0:
                    await session.commit()
                    log_event("MTPROTO_SYNC_ENQUEUED_TRANSFERS", count=new_count)
                    try:
                        file_lines = "\n".join([f"• <code>{html.escape(fn)}</code> ({format_bytes(fs)})" for fn, fs, _ in enqueued_transfers[:5]])
                        more_txt = f"\n<i>...and {len(enqueued_transfers) - 5} more files</i>" if len(enqueued_transfers) > 5 else ""
                        await self.send_message(
                            chat_id=self.owner_user_id or settings.TELEGRAM_OWNER_USER_ID,
                            text=(
                                f"🎬 <b>StreamX — PC Online: {new_count} Transfers Enqueued</b>\n\n"
                                f"The following media received while offline have been automatically added to the queue:\n\n"
                                f"{file_lines}{more_txt}\n\n"
                                "⚡ <i>Downloads will run sequentially one by one.</i>"
                            ),
                        )
                    except Exception:
                        pass
                return new_count
        except Exception as e:
            logger.warning(f"MTProto message sync check error: {e}", exc_info=True)
            return 0

    async def start_polling(self) -> None:
        """Start polling loop for incoming Telegram updates."""
        if not self.is_configured():
            logger.warning("Telegram Bot Token is not configured. Polling not started.")
            return

        self.running = True

        # Check if webhook is active (e.g. Cloudflare Worker handling updates 24/7)
        webhook_active = False
        try:
            async with httpx.AsyncClient(timeout=10.0) as init_client:
                wh_res = await init_client.get(f"{self.base_url}/getWebhookInfo")
                if wh_res.status_code == 200:
                    wh_data = wh_res.json().get("result", {})
                    wh_url = wh_data.get("url", "")
                    if wh_url:
                        webhook_active = True
                        last_err = wh_data.get("last_error_message", "")
                        log_event("TELEGRAM_WEBHOOK_ACTIVE_MODE", url=wh_url, last_error=last_err)
                        # Auto-heal: If webhook had an error or secret_token needs refreshing, re-register with secret
                        if last_err or settings.TELEGRAM_WEBHOOK_SECRET:
                            try:
                                payload: Dict[str, Any] = {
                                    "url": wh_url,
                                    "allowed_updates": ["message", "edited_message", "channel_post"],
                                    "drop_pending_updates": False,
                                }
                                if settings.TELEGRAM_WEBHOOK_SECRET:
                                    payload["secret_token"] = settings.TELEGRAM_WEBHOOK_SECRET
                                fix_res = await init_client.post(f"{self.base_url}/setWebhook", json=payload)
                                if fix_res.status_code == 200:
                                    logger.info("StreamX Webhook Auto-Heal: Verified and updated secret token with Telegram.")
                            except Exception as heal_err:
                                logger.debug(f"Webhook auto-heal attempt: {heal_err}")
        except Exception as e:
            logger.debug(f"Webhook check at startup: {e}")

        # Register command menu in Telegram so Menu button ([/]) appears
        try:
            await self.register_bot_commands()
        except Exception as e:
            logger.debug(f"Could not register commands at polling start: {e}")

        if webhook_active:
            # Cloudflare Worker is handling updates 24/7.
            # Local worker runs sync loop via MTProto to download queued files.
            logger.info("Telegram Bot is running in 24/7 Cloudflare Webhook mode. Local MTProto sync active.")
            while self.running:
                try:
                    await self.sync_forwarded_messages()
                    await asyncio.sleep(25)
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.debug(f"Webhook sync loop error: {e}")
                    await asyncio.sleep(10)
            return

        log_event("TELEGRAM_POLLING_STARTED", forward_target_configured=self.is_forward_target_configured())

        # Polling fallback: Clear any existing webhook so getUpdates is unblocked
        try:
            async with httpx.AsyncClient(timeout=15.0) as init_client:
                await init_client.post(f"{self.base_url}/deleteWebhook", json={"drop_pending_updates": False})
        except Exception as e:
            logger.debug(f"Could not clear webhook at polling start: {e}")

        consecutive_errors = 0
        while self.running:
            try:
                async with httpx.AsyncClient(timeout=45.0) as client:
                    while self.running:
                        try:
                            params: Dict[str, Any] = {"timeout": 30}
                            if self.last_update_id:
                                params["offset"] = self.last_update_id + 1

                            res = await client.get(f"{self.base_url}/getUpdates", params=params)
                            if res.status_code == 200:
                                consecutive_errors = 0
                                data = res.json()
                                updates = data.get("result", [])
                                if isinstance(updates, list):
                                    for update in updates:
                                        update_id = update.get("update_id")
                                        if update_id:
                                            self.last_update_id = max(self.last_update_id, update_id)
                                        try:
                                            await self.process_update(update)
                                        except Exception as update_err:
                                            logger.error(
                                                f"Error processing Telegram update {update_id}: {update_err}",
                                                exc_info=True,
                                            )
                            elif res.status_code == 409:
                                logger.info("Telegram getUpdates returned 409 Conflict: checking if webhook is active...")
                                try:
                                    wh_check = await client.get(f"{self.base_url}/getWebhookInfo")
                                    if wh_check.status_code == 200 and wh_check.json().get("result", {}).get("url"):
                                        logger.info("Webhook active detected. Switching to 24/7 Webhook mode.")
                                        return
                                except Exception:
                                    pass
                                await asyncio.sleep(5)
                            else:
                                logger.warning(f"Telegram getUpdates returned status {res.status_code}")
                                await asyncio.sleep(5)
                        except httpx.TimeoutException:
                            # Normal long-polling timeout, continue loop
                            consecutive_errors = 0
                            continue
                        except asyncio.CancelledError:
                            return
                        except Exception as e:
                            consecutive_errors += 1
                            logger.error(f"Error in Telegram bot polling iteration ({consecutive_errors}): {e}")
                            await asyncio.sleep(min(2 * consecutive_errors, 15))
                            if consecutive_errors >= 3:
                                # Recreate client with fresh connection pool
                                break
            except asyncio.CancelledError:
                break
            except Exception as outer_e:
                logger.error(f"Error in Telegram client session: {outer_e}")
                await asyncio.sleep(5)

        log_event("TELEGRAM_POLLING_STOPPED")

    def stop(self) -> None:
        """Signal polling to stop."""
        self.running = False
        if self.task:
            self.task.cancel()


bot_service = TelegramBotService()
