"""Transfers API router for StreamX."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import TelegramTransfer
from app.schemas.transfers import TransferResponse

router = APIRouter(prefix="/transfers", tags=["Transfers"])


@router.get("", response_model=List[TransferResponse])
async def list_transfers(
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
) -> List[TransferResponse]:
    """List cloud media transfers ordered by creation time descending."""
    stmt = (
        select(TelegramTransfer)
        .order_by(TelegramTransfer.id.desc())
        .limit(limit)
        .offset(offset)
    )
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
) -> TransferResponse:
    """Retry or resume a queued, failed, or cancelled transfer."""
    stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
    result = await db.execute(stmt)
    transfer = result.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    from app.db.models import TransferStatus
    transfer.status = TransferStatus.QUEUED
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
):
    """Delete a transfer record from the transfer queue."""
    stmt = select(TelegramTransfer).where(TelegramTransfer.id == transfer_id)
    result = await db.execute(stmt)
    transfer = result.scalar_one_or_none()
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")

    await db.delete(transfer)
    await db.commit()
    return {"ok": True, "message": f"Transfer {transfer_id} deleted", "id": transfer_id}

