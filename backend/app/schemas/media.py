"""Media schemas for StreamX API."""

from datetime import datetime
import json
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, field_validator


class MetadataEntityResponse(BaseModel):
    id: int
    provider: str
    provider_id: str
    media_type: str
    category: Optional[str] = None
    title: str
    original_title: Optional[str] = None
    release_date: Optional[str] = None
    release_year: Optional[int] = None
    overview: Optional[str] = None
    poster_path: Optional[str] = None
    backdrop_path: Optional[str] = None
    rating: Optional[float] = None
    runtime: Optional[int] = None
    genres: List[str] = []
    original_language: Optional[str] = None
    origin_country: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("genres", mode="before")
    @classmethod
    def parse_genres(cls, v: Any, info) -> List[str]:
        if isinstance(v, list):
            return v
        if isinstance(v, str) and v.startswith("["):
            try:
                return json.loads(v)
            except Exception:
                return []
        return []


class MediaResponse(BaseModel):
    id: int
    drive_file_id: str
    filename: str
    size: int
    mime_type: str
    category: str
    media_type: Optional[str] = "MOVIE"
    poster_url: Optional[str] = None
    poster_override: Optional[str] = None
    backdrop_override: Optional[str] = None
    metadata_json: Optional[str] = None

    # Technical metadata parsed from file
    season: Optional[int] = None
    episode: Optional[int] = None
    quality: Optional[str] = None
    release_group: Optional[str] = None

    # Enriched metadata fields
    metadata_entity_id: Optional[int] = None
    metadata_status: str = "PENDING"
    metadata_confidence: Optional[float] = None
    metadata_locked: bool = False
    canonical_metadata: Optional[MetadataEntityResponse] = None

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_validator("metadata_status", mode="before")
    @classmethod
    def parse_status(cls, v: Any) -> str:
        return v.value if hasattr(v, "value") else str(v)


class MetadataSelectRequest(BaseModel):
    provider_id: str
    media_type: str = "movie"
    apply_to_series: bool = True


class MetadataPatchRequest(BaseModel):
    title: Optional[str] = None
    year: Optional[int] = None
    category: Optional[str] = None
    overview: Optional[str] = None
    poster_override: Optional[str] = None
    backdrop_override: Optional[str] = None


MediaPatchRequest = MetadataPatchRequest


class PosterOverrideRequest(BaseModel):
    poster_url: Optional[str] = None


class BackdropOverrideRequest(BaseModel):
    backdrop_url: Optional[str] = None
