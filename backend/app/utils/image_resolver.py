"""Canonical Media Image Resolver for StreamX.

Ensures reliable resolution and priority for posters and backdrops:
1. Manual user override (poster_override / backdrop_override)
2. Provider metadata (TMDB CDN path)
3. Direct stored URL
4. Graceful fallback placeholder
"""

import json
from typing import Optional
from app.db.models import Media, MetadataEntity


TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"


def get_media_poster_url(media: Media, entity: Optional[MetadataEntity] = None, size: str = "w500") -> Optional[str]:
    """Resolve canonical poster URL following strict priority."""
    # 1. Manual override has absolute precedence
    if getattr(media, "poster_override", None):
        return media.poster_override.strip()

    # 2. Canonical provider entity
    ent = entity or getattr(media, "metadata_entity", None)
    if ent and getattr(ent, "poster_path", None):
        path = ent.poster_path.lstrip("/")
        if path.startswith("http://") or path.startswith("https://"):
            return path
        return f"{TMDB_IMAGE_BASE}/{size}/{path}"

    # 3. Direct poster_url stored on media
    if getattr(media, "poster_url", None):
        return media.poster_url.strip()

    # 4. Check metadata_json for custom poster
    if getattr(media, "metadata_json", None):
        try:
            data = json.loads(media.metadata_json)
            if isinstance(data, dict) and data.get("poster_url"):
                return str(data["poster_url"]).strip()
        except Exception:
            pass

    return None


def get_media_backdrop_url(media: Media, entity: Optional[MetadataEntity] = None, size: str = "w1280") -> Optional[str]:
    """Resolve canonical backdrop URL following strict priority."""
    # 1. Manual override has absolute precedence
    if getattr(media, "backdrop_override", None):
        return media.backdrop_override.strip()

    # 2. Canonical provider entity
    ent = entity or getattr(media, "metadata_entity", None)
    if ent and getattr(ent, "backdrop_path", None):
        path = ent.backdrop_path.lstrip("/")
        if path.startswith("http://") or path.startswith("https://"):
            return path
        return f"{TMDB_IMAGE_BASE}/{size}/{path}"

    # 3. Check metadata_json for backdrop_url
    if getattr(media, "metadata_json", None):
        try:
            data = json.loads(media.metadata_json)
            if isinstance(data, dict) and data.get("backdrop_url"):
                return str(data["backdrop_url"]).strip()
        except Exception:
            pass

    return None
