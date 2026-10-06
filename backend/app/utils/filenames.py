"""Filename sanitization and file size formatting utilities."""

import os
import re
from typing import Optional, Union

ILLEGAL_CHARS = re.compile(r'[\/\\:\*\?"<>\|]')
MULTIPLE_DOTS = re.compile(r"\.{2,}")


def sanitize_filename(filename: str, default_name: str = "streamx_file.bin") -> str:
    """Sanitize user-provided filename to prevent path traversal and illegal characters."""
    if not filename or not filename.strip():
        return default_name

    # Strip directory components (e.g., ../ or C:\)
    name = os.path.basename(filename.strip())

    # Replace illegal filesystem characters with underscores
    name = ILLEGAL_CHARS.sub("_", name)

    # Disallow path traversal via multiple dots
    name = MULTIPLE_DOTS.sub(".", name)

    # Trim leading/trailing whitespace, dots, and dashes
    name = name.strip(" .-")

    if not name:
        return default_name

    return name


def format_bytes(bytes_count: Union[int, float]) -> str:
    """Format byte count into human-readable representation."""
    if bytes_count < 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    unit_index = 0
    size = float(bytes_count)
    while size >= 1024 and unit_index < len(units) - 1:
        size /= 1024
        unit_index += 1
    return f"{size:.2f} {units[unit_index]}"


def resolve_mime_type(filename: str, fallback_mime: Optional[str] = None) -> str:
    """Accurately determine media container MIME type from filename extension."""
    if not filename:
        return fallback_mime or "video/mp4"
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "mkv":
        return "video/x-matroska"
    elif ext in ("mp4", "m4v"):
        return "video/mp4"
    elif ext == "webm":
        return "video/webm"
    elif ext == "avi":
        return "video/x-msvideo"
    elif ext == "mov":
        return "video/quicktime"
    return fallback_mime or "video/mp4"

