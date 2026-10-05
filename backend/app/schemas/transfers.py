"""Transfer request and response schemas."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict

from app.db.models import TransferStatus


class TransferBase(BaseModel):
    filename: str
    size: int
    telegram_chat_id: int
    telegram_message_id: int
    telegram_file_id: str


class TransferCreate(TransferBase):
    pass


class TransferResponse(TransferBase):
    id: int
    status: TransferStatus
    bytes_transferred: int = 0
    error_message: Optional[str] = None
    retry_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
