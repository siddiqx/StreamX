"""StreamX Backend Application Entrypoint."""

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.media import router as media_router
from app.api.transfers import router as transfers_router
from app.config.settings import settings
from app.db.database import init_db
from app.services.telegram_bot_service import bot_service
from app.services.telegram_mtproto_service import mtproto_service
from app.utils.logging import log_event, logger
from app.workers.transfer_worker import transfer_worker


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown lifecycle."""
    log_event("STARTUP", environment=settings.STREAMX_ENV)
    await init_db()
    log_event("DATABASE_INITIALIZED")

    # Start Telegram bot polling
    bot_task = None
    if bot_service.is_configured():
        log_event("TELEGRAM_BOT_CONFIGURED", allowed_users=len(settings.allowed_telegram_users))
        bot_task = asyncio.create_task(bot_service.start_polling())
    else:
        logger.warning("TELEGRAM_BOT_TOKEN not provided. Bot polling skipped.")

    # Start MTProto transfer worker
    worker_task = None
    if mtproto_service.is_configured():
        log_event("MTPROTO_WORKER_CONFIGURED")
        worker_task = asyncio.create_task(transfer_worker.start())
    else:
        logger.warning("MTProto credentials incomplete. Transfer worker skipped.")

    yield

    # Graceful shutdown
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

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health_router)
app.include_router(transfers_router)
app.include_router(media_router)
