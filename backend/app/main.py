"""StreamX Backend Application Entrypoint."""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.media import router as media_router
from app.api.metadata import router as metadata_router
from app.api.telegram import router as telegram_router
from app.api.transfers import router as transfers_router
from app.config.settings import settings
from app.db.database import init_db
import os
import httpx
from app.services.drive_service import drive_service
from app.services.telegram_bot_service import bot_service
from app.services.telegram_mtproto_service import mtproto_service
from app.services.tunnel_service import tunnel_service
from app.utils.logging import log_event, logger
from app.workers.transfer_worker import transfer_worker
from app.workers.metadata_worker import metadata_worker


async def _run_bot_supervisor() -> None:
    """Watchdog loop to keep the Telegram bot polling 24/7 with automatic restart."""
    while True:
        try:
            await bot_service.start_polling()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Telegram bot supervisor detected error: {e}. Restarting in 5s...", exc_info=True)
        await asyncio.sleep(5)


async def _run_transfer_worker_supervisor() -> None:
    """Watchdog loop to keep MTProto transfer worker running 24/7 with automatic restart."""
    while True:
        try:
            await transfer_worker.start()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Transfer worker supervisor detected error: {e}. Restarting in 5s...", exc_info=True)
        await asyncio.sleep(5)


async def _run_metadata_worker_supervisor() -> None:
    """Watchdog loop to keep metadata enrichment worker running 24/7 with automatic restart."""
    while True:
        try:
            await metadata_worker.start()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Metadata worker supervisor detected error: {e}. Restarting in 5s...", exc_info=True)
        await asyncio.sleep(5)


async def _run_telegram_sync_supervisor() -> None:
    """Watchdog loop to keep MTProto sync scanning for queued media every 30s."""
    await asyncio.sleep(5)
    while True:
        try:
            await bot_service.sync_forwarded_messages()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Telegram sync supervisor error: {e}")
        await asyncio.sleep(30)


async def _run_drive_sync_supervisor() -> None:
    """Periodic background sync to detect newly uploaded or renamed files on Google Drive."""
    await asyncio.sleep(60)
    while True:
        try:
            if drive_service.is_configured():
                await drive_service.sync_library_to_db()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Periodic Drive sync check error: {e}")
        await asyncio.sleep(120)


async def _run_keep_alive_ping() -> None:
    """Self-ping loop to prevent free-tier cloud containers (Render) from spinning down."""
    if not settings.KEEP_ALIVE_ENABLED:
        return


    target_url = settings.RENDER_EXTERNAL_URL or os.getenv("RENDER_EXTERNAL_URL")
    if not target_url:
        return

    health_url = f"{target_url.rstrip('/')}/health"
    # Delay initial ping by 90 seconds after boot
    await asyncio.sleep(90)
    while True:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.get(health_url)
                if res.status_code == 200:
                    log_event("KEEP_ALIVE_HEARTBEAT_OK", url=health_url)
                else:
                    logger.warning(f"Keep-alive heartbeat returned status {res.status_code}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.debug(f"Keep-alive heartbeat attempt skipped: {e}")
        # Ping every 10 minutes (free tier idle timeout is 15 minutes)
        await asyncio.sleep(600)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown lifecycle."""
    log_event("STARTUP", environment=settings.STREAMX_ENV)
    await init_db()
    log_event("DATABASE_INITIALIZED")

    # Sync existing master media files from Google Drive in the background
    if drive_service.is_configured():
        asyncio.create_task(drive_service.sync_library_to_db())

    # Start Telegram bot polling under watchdog supervisor
    bot_task = None
    if bot_service.is_configured():
        log_event("TELEGRAM_BOT_CONFIGURED", allowed_users=len(settings.allowed_telegram_users))

        # Validate service channel configuration at startup
        if bot_service.is_forward_target_configured():
            health = await bot_service.validate_service_channel()
            log_event("TELEGRAM_SERVICE_CHANNEL_HEALTH", **health)
            if not health.get("reachable"):
                logger.error(
                    f"TELEGRAM SERVICE CHANNEL UNREACHABLE: {health.get('error')}. "
                    "Non-owner uploads will fail. Fix TELEGRAM_SERVICE_CHANNEL or TELEGRAM_OWNER_USER_ID."
                )
        else:
            logger.warning(
                "TELEGRAM_SERVICE_CHANNEL / TELEGRAM_OWNER_USER_ID not set: "
                "only files sent by the MTProto account owner will download. "
                "Non-owner uploads will queue but fail at download time."
            )

        bot_task = asyncio.create_task(_run_bot_supervisor())
    else:
        logger.warning("TELEGRAM_BOT_TOKEN not provided. Bot polling skipped.")

    # Start MTProto transfer worker under watchdog supervisor
    worker_task = None
    if mtproto_service.is_configured():
        log_event("MTPROTO_WORKER_CONFIGURED")
        worker_task = asyncio.create_task(_run_transfer_worker_supervisor())
    else:
        logger.warning("MTProto credentials incomplete. Transfer worker skipped.")

    # Start Metadata Background Worker under watchdog supervisor
    metadata_task = asyncio.create_task(_run_metadata_worker_supervisor())

    # Start periodic Google Drive library synchronization
    drive_sync_task = asyncio.create_task(_run_drive_sync_supervisor())

    # Start periodic Telegram MTProto forwarded message sync
    telegram_sync_task = asyncio.create_task(_run_telegram_sync_supervisor())

    # Start 24/7 keep-alive background ping
    keep_alive_task = asyncio.create_task(_run_keep_alive_ping())

    # Auto-heal unenriched or failed library items on startup
    try:
        from app.services.metadata_service import metadata_service
        asyncio.create_task(metadata_service.backfill_library(force=False))
    except Exception as e:
        logger.warning(f"Metadata auto-healing schedule warning: {e}")

    # Start Cloudflare Tunnel supervisor if cloudflared is installed
    tunnel_task = None
    if tunnel_service.is_available():
        tunnel_task = asyncio.create_task(tunnel_service.start())

    yield

    # Graceful shutdown
    if tunnel_task:
        tunnel_service.stop()
        tunnel_task.cancel()
        try:
            await tunnel_task
        except asyncio.CancelledError:
            pass

    if drive_sync_task:
        drive_sync_task.cancel()
        try:
            await drive_sync_task
        except asyncio.CancelledError:
            pass

    if telegram_sync_task:
        telegram_sync_task.cancel()
        try:
            await telegram_sync_task
        except asyncio.CancelledError:
            pass

    if keep_alive_task:
        keep_alive_task.cancel()
        try:
            await keep_alive_task
        except asyncio.CancelledError:
            pass


    if metadata_task:
        metadata_worker.stop()
        metadata_task.cancel()
        try:
            await metadata_task
        except asyncio.CancelledError:
            pass

    if bot_task:
        bot_service.stop()
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass

    if worker_task:
        transfer_worker.stop()
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass

    await mtproto_service.disconnect()
    log_event("SHUTDOWN")


app = FastAPI(
    title="StreamX API",
    version="1.0.0",
    description="StreamX Personal Media Management & Transfer System",
    lifespan=lifespan,
)

# CORS configuration - restricted to whitelisted origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allow_headers=["*"],
)

# Routers
app.include_router(health_router)
app.include_router(transfers_router)
app.include_router(media_router)
app.include_router(metadata_router)
app.include_router(telegram_router)
