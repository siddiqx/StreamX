"""Health and System Status API router."""

import shutil
from typing import Any, Dict
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import Media
from app.schemas.health import HealthResponse
from app.services.drive_service import drive_service
from app.services.telegram_bot_service import bot_service
from app.services.telegram_mtproto_service import mtproto_service
from app.api.media import find_vlc_executable

router = APIRouter(tags=["Health & System"])


@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    """Return health status of StreamX service."""
    return HealthResponse(status="ok", service="streamx")


@router.get("/system/status")
async def get_system_status(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Return real live Google Drive quota, Telegram bot state, VLC installation, and host storage."""
    drive_info = await drive_service.get_storage_and_user_info()

    # Host disk
    tot, used, free = shutil.disk_usage(".")

    # Media library stats
    res = await db.execute(select(func.count(Media.id), func.coalesce(func.sum(Media.size), 0)))
    media_count, media_total_size = res.one()

    vlc_path = find_vlc_executable()

    # Telegram service channel health
    relay_health = {}
    if bot_service.is_configured() and bot_service.is_forward_target_configured():
        relay_health = await bot_service.validate_service_channel()

    return {
        "status": "ok",
        "drive": drive_info,
        "bot": {
            "configured": bot_service.is_configured(),
            "username": "Stream1_X_bot",
            "forward_target_configured": bot_service.is_forward_target_configured(),
            "service_channel": relay_health,
        },
        "mtproto": {
            "configured": mtproto_service.is_configured(),
        },
        "vlc": {
            "installed": bool(vlc_path),
            "path": vlc_path,
        },
        "host_storage": {
            "total_bytes": tot,
            "used_bytes": used,
            "free_bytes": free,
        },
        "library": {
            "total_items": media_count,
            "total_size_bytes": media_total_size,
        },
    }
