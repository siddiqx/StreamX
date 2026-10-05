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
