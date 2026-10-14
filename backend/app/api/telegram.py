import hmac
from typing import Any, Dict, Optional
from fastapi import APIRouter, Header, HTTPException, status
from app.services.telegram_bot_service import bot_service
from app.config.settings import settings
from app.utils.logging import logger

router = APIRouter(prefix="/telegram", tags=["Telegram"])


@router.post("/webhook")
async def telegram_webhook(
    update: Dict[str, Any],
    x_telegram_bot_api_secret_token: Optional[str] = Header(
        None, alias="X-Telegram-Bot-Api-Secret-Token"
    ),
):
    """Receive and process webhook updates from Telegram or Cloudflare Worker."""
    if settings.TELEGRAM_WEBHOOK_SECRET:
        if not x_telegram_bot_api_secret_token or not hmac.compare_digest(
            x_telegram_bot_api_secret_token, settings.TELEGRAM_WEBHOOK_SECRET
        ):
            logger.warning(
                "Rejected Telegram webhook update: invalid or missing secret token"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid webhook secret token",
            )
    try:
        await bot_service.process_update(update)
    except Exception as e:
        logger.error(f"Error handling Telegram webhook update: {e}", exc_info=True)
    return {"ok": True}
