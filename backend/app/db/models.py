"""SQLAlchemy models for StreamX persistent storage."""

from datetime import datetime, timezone
import enum
from sqlalchemy import BigInteger, Column, DateTime, Enum, ForeignKey, Integer, String, Text
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


class Media(Base):
    __tablename__ = "media"

    id = Column(Integer, primary_key=True, index=True)
    drive_file_id = Column(String(255), unique=True, nullable=False, index=True)
    filename = Column(String(512), nullable=False, index=True)
    size = Column(BigInteger, nullable=False)
    mime_type = Column(String(128), nullable=False)
    category = Column(String(64), default="Other", index=True)
    poster_url = Column(String(1024), nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    downloads = relationship("DeviceDownload", back_populates="media", cascade="all, delete-orphan")


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
