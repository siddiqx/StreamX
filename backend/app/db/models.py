"""SQLAlchemy models for StreamX persistent storage."""

from datetime import datetime, timezone
import enum
from sqlalchemy import BigInteger, Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.db.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TransferStatus(str, enum.Enum):
    QUEUED = "QUEUED"
    FETCHING_TELEGRAM = "FETCHING_TELEGRAM"
    UPLOADING_DRIVE = "UPLOADING_DRIVE"
    VERIFYING = "VERIFYING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    RETRYING = "RETRYING"
    CANCELLED = "CANCELLED"


class DownloadStatus(str, enum.Enum):
    QUEUED = "QUEUED"
    DOWNLOADING = "DOWNLOADING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class MetadataStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    MATCHED = "MATCHED"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    NOT_FOUND = "NOT_FOUND"
    MANUAL = "MANUAL"
    FAILED = "FAILED"
    RETRYING = "RETRYING"


class MetadataJobStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    RETRYING = "RETRYING"


class MediaTaxonomy(str, enum.Enum):
    MOVIE = "MOVIE"
    TV_SERIES = "TV_SERIES"
    TV_EPISODE = "TV_EPISODE"
    ANIME_SERIES = "ANIME_SERIES"
    ANIME_EPISODE = "ANIME_EPISODE"
    ANIME_MOVIE = "ANIME_MOVIE"
    DOCUMENTARY = "DOCUMENTARY"
    DOCUMENTARY_SERIES = "DOCUMENTARY_SERIES"
    OTHER = "OTHER"


class MetadataEntity(Base):
    __tablename__ = "metadata_entities"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(64), default="tmdb", nullable=False, index=True)
    provider_id = Column(String(128), nullable=False, index=True)
    media_type = Column(String(32), nullable=False, index=True)  # "movie", "tv"
    category = Column(String(64), nullable=True, index=True)  # MOVIE, TV_SERIES, ANIME_SERIES, ANIME_MOVIE
    title = Column(String(512), nullable=False, index=True)
    original_title = Column(String(512), nullable=True)
    release_date = Column(String(32), nullable=True)
    release_year = Column(Integer, nullable=True, index=True)
    overview = Column(Text, nullable=True)
    poster_path = Column(String(512), nullable=True)
    backdrop_path = Column(String(512), nullable=True)
    rating = Column(Float, nullable=True)
    runtime = Column(Integer, nullable=True)
    genres_json = Column(Text, nullable=True)  # JSON array string e.g. ["Action", "Sci-Fi"]
    original_language = Column(String(32), nullable=True)
    origin_country = Column(String(64), nullable=True)
    metadata_json = Column(Text, nullable=True)  # JSON string for provider-specific extras
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    media_items = relationship("Media", back_populates="metadata_entity")


class Media(Base):
    __tablename__ = "media"

    id = Column(Integer, primary_key=True, index=True)
    drive_file_id = Column(String(255), unique=True, nullable=False, index=True)
    filename = Column(String(512), nullable=False, index=True)
    size = Column(BigInteger, nullable=False)
    mime_type = Column(String(128), nullable=False)
    category = Column(String(64), default="Other", index=True)  # Display shelf category (Movies, TV Shows, Anime, Anime Movies, Other)
    media_type = Column(String(32), default="MOVIE", nullable=True, index=True)  # MediaTaxonomy enum value
    poster_url = Column(String(1024), nullable=True)
    poster_override = Column(String(1024), nullable=True)
    backdrop_override = Column(String(1024), nullable=True)
    metadata_json = Column(Text, nullable=True)

    # Technical metadata parsed from file
    season = Column(Integer, nullable=True, index=True)
    episode = Column(Integer, nullable=True, index=True)
    quality = Column(String(64), nullable=True)
    release_group = Column(String(128), nullable=True)

    # Metadata enrichment columns
    metadata_entity_id = Column(
        Integer, ForeignKey("metadata_entities.id", ondelete="SET NULL"), nullable=True, index=True
    )
    metadata_status = Column(
        Enum(MetadataStatus), default=MetadataStatus.PENDING, nullable=False, index=True
    )
    metadata_confidence = Column(Float, nullable=True)
    metadata_locked = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    downloads = relationship("DeviceDownload", back_populates="media", cascade="all, delete-orphan")
    metadata_entity = relationship("MetadataEntity", back_populates="media_items")
    metadata_jobs = relationship("MetadataJob", back_populates="media", cascade="all, delete-orphan")


class MetadataJob(Base):
    __tablename__ = "metadata_jobs"

    id = Column(Integer, primary_key=True, index=True)
    media_id = Column(Integer, ForeignKey("media.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(
        Enum(MetadataJobStatus), default=MetadataJobStatus.PENDING, nullable=False, index=True
    )
    attempt_count = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)
    scheduled_at = Column(DateTime(timezone=True), default=utc_now)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    media = relationship("Media", back_populates="metadata_jobs")


class TelegramTransfer(Base):
    __tablename__ = "telegram_transfers"

    id = Column(Integer, primary_key=True, index=True)
    telegram_chat_id = Column(BigInteger, nullable=False, index=True)
    telegram_message_id = Column(BigInteger, nullable=False)
    telegram_file_id = Column(String(512), nullable=False, index=True)
    filename = Column(String(512), nullable=False)
    size = Column(BigInteger, nullable=False)
    status = Column(Enum(TransferStatus), default=TransferStatus.QUEUED, nullable=False, index=True)
    bytes_transferred = Column(BigInteger, default=0)
    resumable_upload_url = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class DeviceDownload(Base):
    __tablename__ = "device_downloads"

    id = Column(Integer, primary_key=True, index=True)
    media_id = Column(Integer, ForeignKey("media.id", ondelete="CASCADE"), nullable=False, index=True)
    device_identifier = Column(String(255), nullable=False, index=True)
    status = Column(Enum(DownloadStatus), default=DownloadStatus.QUEUED, nullable=False, index=True)
    bytes_downloaded = Column(BigInteger, default=0)
    total_bytes = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    media = relationship("Media", back_populates="downloads")


class Setting(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(128), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
