"""Transfers API router for StreamX."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import require_auth
from app.db.database import get_db
from app.db.models import TelegramTransfer
from app.schemas.transfers import TransferResponse

router = APIRouter(prefix="/transfers", tags=["Transfers"])


@router.get("", response_model=List[TransferResponse])
async def list_transfers(
    limit: int = 50,
    offset: int = 0,
    include_deleted: bool = False,
    db: AsyncSession = Depends(get_db),
) -> List[TransferResponse]:
    """List cloud media transfers ordered by creation time descending."""
    stmt = select(TelegramTransfer)
    if not include_deleted:
        stmt = stmt.where(TelegramTransfer.is_deleted.is_(False))
    stmt = stmt.order_by(TelegramTransfer.id.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{transfer_id}", response_model=TransferResponse)
async def get_transfer(
    transfer_id: int,
    db: AsyncSession = Depends(get_db),
) -> TransferResponse:
    """Retrieve transfer details by ID."""
    stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
    result = await db.execute(stmt)
    transfer = result.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return transfer


@router.post("/{transfer_id}/retry", response_model=TransferResponse)
async def retry_transfer(
    transfer_id: int,
    db: AsyncSession = Depends(get_db),
    _authorized: bool = Depends(require_auth),
) -> TransferResponse:
    """Retry or resume a queued, failed, or cancelled transfer."""
    stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
    result = await db.execute(stmt)
    transfer = result.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    from app.db.models import TransferStatus
    transfer.status = TransferStatus.QUEUED
    transfer.is_deleted = False
    transfer.scheduled_retry_at = None
    transfer.error_message = None
    transfer.error_category = None
    transfer.retry_count = 0
    await db.commit()
    await db.refresh(transfer)
    return transfer


@router.delete("/{transfer_id}")
async def delete_transfer(
    transfer_id: int,
    db: AsyncSession = Depends(get_db),
    _authorized: bool = Depends(require_auth),
):
    """Cancel and delete a transfer record from the transfer queue."""
    stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
    result = await db.execute(stmt)
    transfer = result.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    # 1. Stop any in-flight active transfer task in the worker immediately
    from app.workers.transfer_worker import transfer_worker
    transfer_worker.cancel_transfer(transfer_id)

    # 2. Soft-delete and mark as CANCELLED so the file is removed from the UI
    # while retaining its message ID to prevent re-enqueueing by sync.
    from app.db.models import TransferStatus
    transfer.status = TransferStatus.CANCELLED
    transfer.is_deleted = True
    transfer.error_message = "Cancelled and deleted by user"
    transfer.scheduled_retry_at = None
    await db.commit()
    return {"ok": True, "message": f"Transfer {transfer_id} cancelled and deleted", "id": transfer_id}


@router.post("/sync")
async def sync_transfers(
    _authorized: bool = Depends(require_auth),
):
    """Trigger on-demand sync for queued Telegram media messages."""
    from app.services.telegram_bot_service import bot_service
    count = await bot_service.sync_forwarded_messages()
    return {"ok": True, "new_transfers_enqueued": count}

