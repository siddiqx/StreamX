"""Telegram Webhook Receiver for StreamX."""

from typing import Any, Dict
from fastapi import APIRouter
from app.services.telegram_bot_service import bot_service

router = APIRouter(prefix="/telegram", tags=["Telegram"])


@router.post("/webhook")
async def telegram_webhook(update: Dict[str, Any]):
    """Receive and process webhook updates from Telegram or Cloudflare Worker."""
    try:
        await bot_service.process_update(update)
    except Exception:
        pass
    return {"ok": True}
