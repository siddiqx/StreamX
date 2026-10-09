"""Structured filename normalization and parsing for StreamX media.

The parser intentionally separates title identity from release noise and episode
coordinates. It is deterministic, dependency-free, and tolerant of Telegram
channel prefixes/suffixes and common anime fansub naming conventions.
"""
from dataclasses import dataclass
import os
import re
from typing import Optional


@dataclass
class ParsedMedia:
    raw_filename: str
    clean_title: str
    year: Optional[int] = None
    media_type: str = "movie"
    season: Optional[int] = None
    episode: Optional[int] = None
    quality: Optional[str] = None
    release_group: Optional[str] = None


VIDEO_EXTENSIONS = {
    ".mkv", ".mp4", ".avi", ".mov", ".m4v", ".webm", ".ts", ".flv", ".wmv", ".iso"
}

# Tags are removed as complete tokens, never as arbitrary substrings in a title.
_NOISE_TERMS = (
    r"2160p|1080p|1080i|720p|576p|480p|4k|uhd|8k|"
    r"web[ ._-]?dl|web[ ._-]?rip|webrip|bluray|blu[ ._-]?ray|bdrip|brrip|hdrip|hdtv|dvdrip|dvd|remux|"
    r"xvid|x264|x265|h[ ._-]?264|h[ ._-]?265|hevc|av1|10[ ._-]?bit|8[ ._-]?bit|hi10p|"
    r"truehd|atmos|ddp[ ._-]?\d*(?:[._]\d+)?|dd[ ._-]?\+?\d*(?:[._]\d+)?|ac3|aac[ ._-]?\d*(?:[._]\d+)?|"
    r"dts[ ._-]?hd(?:[ ._-]?ma)?|dts|flac|opus|mp3|"
    r"dual[ ._-]?audio|multi[ ._-]?audio|dual|multi|eng[ ._-]?sub|english[ ._-]?sub|esub|subbed|dubbed|hardsub|softsub|"
    r"hdr10[ ._-]?\+?|hdr|dolby[ ._-]?vision|dovi|"
    r"proper|repack|rerip|extended(?:[ ._-]?cut)?|uncut|unrated|imax|theatrical|director[ ._-]?s[ ._-]?cut|criterion|"
    r"amzn|amazon|nf|netflix|dsnp|disney[ ._-]?\+?|hulu|atvp|hmax|crunchyroll|funimation|"
    r"subsplease|erai[ ._-]?raws|horriblesubs|judas|golumpa|animedynasty|animestation\d*|aniwatch|anime[ ._-]?maniaac|"
    r"index[ ._-]?station|commie|coalgirls|kametsu|animeraws|aegir|"
    r"1080|720|480|2160"
)
_NOISE_RE = re.compile(r"(?<![A-Za-z0-9])(?:" + _NOISE_TERMS + r")(?![A-Za-z0-9])", re.I)
_YEAR_RE = re.compile(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)")
_EP_PATTERNS = (
    re.compile(r"(?<![A-Za-z0-9])S\s*(\d{1,2})\s*[._ -]*E\s*(\d{1,4})(?:v\d+)?(?!\d)", re.I),
    re.compile(r"(?<![A-Za-z0-9])(?:Season)\s*(\d{1,2})\s*[._ -]*(?:Episode|Ep)\s*(\d{1,4})(?!\d)", re.I),
    re.compile(r"(?<!\d)(\d{1,2})\s*x\s*(\d{1,4})(?!\d)", re.I),
)


def _remove_extension(value: str) -> str:
    value = os.path.basename(value.strip())
    lower = value.lower()
    for ext in VIDEO_EXTENSIONS:
        if lower.endswith(ext):
            return value[:-len(ext)]
    # Telegram filenames sometimes use an uncommon video extension.
    return re.sub(r"\.[A-Za-z0-9]{2,5}$", "", value)


def _strip_channel_tags(value: str) -> str:
    # Telegram handles are metadata, wherever they occur. Remove the entire
    # handle before underscores are converted to spaces.
    value = re.sub(r"(?<!\w)@[A-Za-z0-9_]{2,}", " ", value)
    value = re.sub(r"(?i)\b(?:https?://)?(?:t\.me|telegram\.me)/[A-Za-z0-9_]+", " ", value)
    return value


def _strip_bracket_noise(value: str) -> str:
    def replace_bracket(match: re.Match) -> str:
        inner = match.group(1).strip()
        compact = re.sub(r"[\s._-]+", "", inner).lower()
        # Keep meaningful bracketed text; remove technical tags, checksums,
        # and short release-group labels. Episode/year tokens are parsed first.
        if (
            _NOISE_RE.search(inner)
            or re.fullmatch(r"[0-9a-f]{8}", compact, re.I)
            or re.fullmatch(r"(?:crc32|dual|multi|sub|subbed|dubbed|eng|jpn|raw|batch|proper|repack)", compact, re.I)
            or len(inner) <= 2
        ):
            return " "
        return " " + inner + " "
    return re.sub(r"[\[(]([^\]\)]{1,100})[\])]", replace_bracket, value)


def parse_filename(filename: str) -> ParsedMedia:
    """Return a cleaned title and structured release metadata from a filename."""
    raw = (filename or "").strip()
    working = _remove_extension(raw)
    working = _strip_channel_tags(working)

    quality = None
    if re.search(r"(?i)(?:2160p|(?<!\w)4k(?!\w)|uhd|8k)", working):
        quality = "4K UHD"
    elif re.search(r"(?i)1080[pi]", working):
        quality = "1080p"
    elif re.search(r"(?i)720p", working):
        quality = "720p"
    elif re.search(r"(?i)576p", working):
        quality = "576p"
    elif re.search(r"(?i)480p", working):
        quality = "480p"

    release_group = None
    leading_group = re.match(r"^\s*\[([^\]]{1,35})\]\s*", working)
    if leading_group:
        label = leading_group.group(1).strip()
        if not _NOISE_RE.search(label) and not re.search(r"(?i)^(?:s\d|ep\d|episode\s*\d|\d{3,})", label):
            release_group = label
            working = working[leading_group.end():]

    # Strip a trailing release group only when it follows a known release marker.
    trailing_group = re.search(
        r"(?i)(?:[ .])(?:x264|x265|h[ .]?264|h[ .]?265|hevc|av1|bluray|webrip|web[ ._-]?dl)[ ._-]+([A-Za-z][A-Za-z0-9]{1,24})$",
        working,
    )
    if trailing_group and not release_group:
        release_group = trailing_group.group(1)

    working = _strip_bracket_noise(working)
    working = working.replace("_", " ").replace(".", " ")
    working = re.sub(r"(?i)\b(?:www\.[A-Za-z0-9.-]+|telegram)\b", " ", working)

    season = None
    episode = None
    media_type = "movie"

    # Some Telegram channels put the episode marker before the series title.
    leading_episode = re.match(
        r"^\s*(?:S\s*(\d{1,2})\s*[ ._-]*)?(?:EP|Episode|Ep|E)\s*(\d{1,4})(?:v\d+)?\s*[-:–— ]+\s*",
        working, re.I
    )
    if leading_episode:
        season = int(leading_episode.group(1) or 1)
        episode = int(leading_episode.group(2))
        media_type = "tv"
        working = working[leading_episode.end():]

    if episode is None:
        for pattern in _EP_PATTERNS:
            match = pattern.search(working)
            if match:
                season = int(match.group(1))
                episode = int(match.group(2))
                media_type = "tv"
                # For the common "Title S01E02 Episode Name" format, only the
                # title before the episode marker is identity-bearing. Prefix
                # markers such as "1x02 Title" keep the trailing title instead.
                if working[:match.start()].strip():
                    working = working[:match.start()]
                else:
                    working = working[match.end():]
                break

    if episode is None:
        # Fansub absolute numbering: "Series - 01", "Series - 001v2".
        match = re.search(r"\s+-\s+(\d{1,4})(?:v\d+)?(?=\s|$)", working, re.I)
        if match:
            number = int(match.group(1))
            if 1 <= number <= 9999 and not 1900 <= number <= 2099:
                season, episode, media_type = 1, number, "tv"
                working = working[:match.start()] + " " + working[match.end():]

    # Remove episode title/release annotations after the first technical marker.
    # This prevents uploader tags or codec names from contaminating the TMDB query.
    noise_boundary = _NOISE_RE.search(working)
    if noise_boundary:
        working = working[:noise_boundary.start()]

    year = None
    year_match = _YEAR_RE.search(working)
    if year_match:
        year = int(year_match.group(1))
        working = working[:year_match.start()] + " " + working[year_match.end():]

    working = re.sub(r"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}", " ", working)
    working = re.sub(r"(?i)\b(?:EP|Episode|Season)\b", " ", working)
    # Remove common leading separators left after stripping channel/group labels.
    working = re.sub(r"^[\s._\-–—:|]+|[\s._\-–—:|]+$", " ", working)
    working = re.sub(r"\s+", " ", working).strip(" -._|:")
    working = re.sub(r"\s+([!?])", r"\1", working)
    working = re.sub(r"^[\s\[\](){}]+|[\s\[\](){}]+$", "", working).strip()

    # Do not send an empty/noise-only title to the provider.
    if not working:
        fallback = _remove_extension(raw)
        fallback = _strip_channel_tags(fallback)
        working = re.sub(r"[\[\](){}]", " ", fallback)
        working = re.sub(r"[_\.]+", " ", working)
        working = re.sub(r"\s+", " ", working).strip(" -._|:")

    return ParsedMedia(
        raw_filename=raw,
        clean_title=working,
        year=year,
        media_type=media_type,
        season=season,
        episode=episode,
        quality=quality or "1080p",
        release_group=release_group,
    )
