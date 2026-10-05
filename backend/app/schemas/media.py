"""Media schemas for StreamX API."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class MediaResponse(BaseModel):
    id: int
    drive_file_id: str
    filename: str
    size: int
    mime_type: str
    category: str
    poster_url: Optional[str] = None
    metadata_json: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
