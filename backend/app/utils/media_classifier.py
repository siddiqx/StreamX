"""Deterministic Media Taxonomy & Classification Engine for StreamX.

Provides unambiguous classification of media assets into:
- MOVIE (Hollywood / Live-action / International feature films)
- TV_SERIES / TV_EPISODE (Live-action / Hollywood / Western episodic series)
- ANIME_SERIES / ANIME_EPISODE (Japanese episodic animation)
- ANIME_MOVIE (Japanese animated feature films)
- DOCUMENTARY / DOCUMENTARY_SERIES (Non-fiction documentaries)
- OTHER (Non-video or unrecognized files)

Classification uses multiple signals:
1. Provider canonical metadata (TMDB original_language, origin_country, genres, media_type)
2. Parsed filename structure (season, episode, year, release tags)
3. Strict isolation between Anime Movies, Anime Series, Hollywood Movies, and Hollywood TV.
"""

import enum
from typing import Any, Dict, List, Optional, Tuple
from app.services.metadata_providers.base import CanonicalMetadata
from app.utils.filename_parser import ParsedMedia, VIDEO_EXTENSIONS


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


NON_MEDIA_EXTENSIONS = {
    ".pdf", ".txt", ".zip", ".rar", ".7z", ".tar", ".gz",
    ".exe", ".apk", ".iso", ".doc", ".docx", ".epub", ".mobi",
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp3", ".flac", ".wav",
}

# Recognized anime fansub / release groups
ANIME_FANSUB_GROUPS = {
    "subsplease", "erai-raws", "horriblesubs", "judas", "asw",
    "golumpa", "animedynasty", "animestation", "aniwatch", "anime_maniaac",
    "commie", "coalgirls", "fff", "kametsu", "animeraws",
    "watchbox", "dynasty", "animes_horizon", "animeshorizon",
}


def is_media_file(filename: str, mime_type: Optional[str] = None) -> bool:
    """Return True if filename or mime_type represents a video media asset."""
    lower_name = filename.lower().strip()
    for ext in NON_MEDIA_EXTENSIONS:
        if lower_name.endswith(ext):
            return False

    if mime_type:
        mime_lower = mime_type.lower()
        if mime_lower.startswith("video/"):
            return True
        if mime_lower in ("application/x-matroska", "application/octet-stream"):
            return any(lower_name.endswith(ext) for ext in VIDEO_EXTENSIONS)
        if any(non in mime_lower for non in ["pdf", "zip", "text", "image", "audio"]):
            return False

    return any(lower_name.endswith(ext) for ext in VIDEO_EXTENSIONS)


def has_anime_signals(
    parsed: ParsedMedia,
    details: Optional[CanonicalMetadata] = None,
    raw_filename: Optional[str] = None,
) -> bool:
    """Multi-signal anime detection based on provider data and filename context."""
    filename_lower = (raw_filename or parsed.raw_filename).lower()

    # 1. Provider metadata signals (Highest fidelity)
    if details:
        if details.provider == "anilist":
            return True
        genres = [g.lower() for g in (details.genres or [])]
        is_animation = "animation" in genres

        # Extract origin country & language
        origin_countries = []
        if details.raw_metadata and isinstance(details.raw_metadata, dict):
            origin_countries = details.raw_metadata.get("origin_country", [])
            if not origin_countries:
                production_countries = details.raw_metadata.get("production_countries", [])
                if isinstance(production_countries, list):
                    origin_countries = [
                        c.get("iso_3166_1") or c.get("name")
                        for c in production_countries
                        if isinstance(c, dict)
                    ]
            if isinstance(origin_countries, str):
                origin_countries = [origin_countries]
        
        orig_lang = ""
        if details.raw_metadata and isinstance(details.raw_metadata, dict):
            orig_lang = (details.raw_metadata.get("original_language") or "").lower()

        # Primary Anime Rule: canonical animation + Japanese origin/language.
        # This handles both TV anime and anime films without relying on title hardcoding.
        if is_animation and (
            orig_lang == "ja"
            or any(str(c).upper() in {"JP", "JPN"} or str(c).lower() == "japan" for c in origin_countries)
        ):
            return True

        # Secondary provider-backed signal: known anime release group.
        if is_animation and parsed.release_group and parsed.release_group.lower() in ANIME_FANSUB_GROUPS:
            return True

    # 2. Filename signals (when provider details absent or matching)
    if parsed.release_group and parsed.release_group.lower() in ANIME_FANSUB_GROUPS:
        return True

    # Check for anime release markers as distinct tokens (NOT generic substring "sub")
    import re
    anime_tokens = [
        r"\banime\b",
        r"\banimedynasty\b",
        r"\banimestation\d*\b",
        r"\baniwatch\b",
        r"\bcrunchyroll\b",
        r"\bcr\b",
        r"\bhorriblesubs\b",
        r"\bsubsplease\b",
        r"\berai-raws\b",
        r"@[a-z0-9_]*anime[a-z0-9_]*",
        r"@[a-z0-9_]*watchbox[a-z0-9_]*",
        r"\bwatchbox\b",
        r"\bxanime\w*\b",
        r"\[(?:sub|dual|multi|esub|raw|dub)\]",
        r"\bdual[-_ ]?audio\b",
        r"@?animes?[_-]?horizon",
    ]
    for pattern in anime_tokens:
        if re.search(pattern, filename_lower):
            return True

    return False


def has_episodic_signals(
    parsed: ParsedMedia,
    raw_filename: Optional[str] = None,
) -> bool:
    """Return True if parsed media or raw filename contains definitive episodic indicators."""
    if parsed.episode is not None or parsed.season is not None or getattr(parsed, "media_type", None) == "tv":
        return True
    filename = (raw_filename or parsed.raw_filename or "").lower()
    import re
    episodic_patterns = [
        r"(?<![a-z0-9])(?:season|s)\s*0*\d{1,2}(?!\d)",
        r"(?<![a-z0-9])(?:episode|ep|e)\s*0*\d{1,4}(?!\d)",
        r"(?<!\d)\d{1,2}\s*x\s*\d{1,4}(?!\d)",
        r"第\s*\d{1,4}\s*話",
    ]
    return any(re.search(pat, filename, re.I) for pat in episodic_patterns)


def classify_media(
    parsed: ParsedMedia,
    details: Optional[CanonicalMetadata] = None,
    raw_filename: Optional[str] = None,
    mime_type: Optional[str] = None,
) -> Tuple[MediaTaxonomy, str]:
    """Deterministically classify media into taxonomy and UI display category.

    Returns:
        (taxonomy: MediaTaxonomy, ui_category: str)
        where ui_category is one of: "Movies", "TV Shows", "Anime", "Anime Movies", "Other"
    """
    filename = raw_filename or parsed.raw_filename
    if not is_media_file(filename, mime_type):
        return MediaTaxonomy.OTHER, "Other"

    is_anime = has_anime_signals(parsed, details, raw_filename=filename)
    is_episodic = has_episodic_signals(parsed, raw_filename=filename)

    # STRICT RULE: Episodic media (S1, EP1, season/episode markers) can NEVER be a Movie or Anime Movie.
    if is_episodic:
        if is_anime:
            return MediaTaxonomy.ANIME_EPISODE, "Anime"
        return MediaTaxonomy.TV_EPISODE, "TV Shows"

    if details:
        genres = [g.lower() for g in (details.genres or [])]
        is_doc = "documentary" in genres

        if is_anime:
            if details.media_type == "tv":
                return MediaTaxonomy.ANIME_SERIES, "Anime"
            return MediaTaxonomy.ANIME_MOVIE, "Anime Movies"

        if is_doc:
            if details.media_type == "tv":
                return MediaTaxonomy.DOCUMENTARY_SERIES, "TV Shows"
            return MediaTaxonomy.DOCUMENTARY, "Movies"

        if details.media_type == "tv":
            return MediaTaxonomy.TV_SERIES, "TV Shows"

        return MediaTaxonomy.MOVIE, "Movies"

    # Fallback when details not yet fetched and not episodic
    if is_anime:
        return MediaTaxonomy.ANIME_MOVIE, "Anime Movies"

    return MediaTaxonomy.MOVIE, "Movies"


def get_display_category(taxonomy: MediaTaxonomy) -> str:
    """Map canonical taxonomy to frontend shelf category."""
    if taxonomy in (MediaTaxonomy.ANIME_SERIES, MediaTaxonomy.ANIME_EPISODE):
        return "Anime"
    if taxonomy == MediaTaxonomy.ANIME_MOVIE:
        return "Anime Movies"
    if taxonomy in (MediaTaxonomy.TV_SERIES, MediaTaxonomy.TV_EPISODE, MediaTaxonomy.DOCUMENTARY_SERIES):
        return "TV Shows"
    if taxonomy in (MediaTaxonomy.MOVIE, MediaTaxonomy.DOCUMENTARY):
        return "Movies"
    return "Other"
