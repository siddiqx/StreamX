"""Structured filename normalization and parsing for StreamX media.

The parser intentionally separates title identity from release noise and episode
coordinates. It is deterministic, dependency-free, and tolerant of Telegram
channel prefixes/suffixes, Japanese notation, and common anime fansub conventions.
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
    is_ambiguous: bool = False
    is_truncated: bool = False
    parsing_confidence: float = 1.0


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
    # Explicit S01E03, Season 3 Episode 9, S1-E07, S-01 EP-03
    re.compile(r"(?<![A-Za-z0-9])(?:Season|S)\s*[._ ,-]?\s*0*(\d{1,2})\s*[._ ,-]*(?:Episode|Ep|E)\s*0*(\d{1,4})(?:v\d+)?(?!\d)", re.I),
    # S01_01, S01-01, S01 01, S1 01, S01.01 (Season + Episode with separator, no 'E')
    re.compile(r"(?<![A-Za-z0-9])(?:Season|S)\s*0*(\d{1,2})\s*[._ ,-]+\s*0*(\d{1,4})(?:v\d+)?(?!\d)", re.I),
    # 1x03 format
    re.compile(r"(?<!\d)(\d{1,2})\s*x\s*(\d{1,4})(?!\d)", re.I),
    # Japanese notation 第03話
    re.compile(r"第\s*(\d{1,4})\s*話", re.I),
)


def _remove_extension(value: str) -> str:
    value = os.path.basename(value.strip())
    lower = value.lower()
    for ext in VIDEO_EXTENSIONS:
        if lower.endswith(ext):
            return value[:-len(ext)]
    return re.sub(r"\.[A-Za-z0-9]{2,5}$", "", value)


def _strip_channel_tags(value: str) -> str:
    # Bracketed channel tag: [@Anime_Fury]
    value = re.sub(r"\[@[A-Za-z0-9_\u2122\u00AE\u00A9]+\]", " ", value)
    # Channel tag with trademark/copyright symbol: @SeriesArchiveX™ (do not greedily match subsequent words)
    value = re.sub(r"(?<![A-Za-z0-9])@[A-Za-z0-9_]*?[\u2122\u00AE\u00A9]+", " ", value)
    # Channel tag followed by space, delimiter (- : ~ |), brackets, or end of string
    value = re.sub(r"(?<![A-Za-z0-9])@[A-Za-z0-9_]+(?=\s*[-–—:|~]|\s+\[|\s+$)", " ", value)
    # Channel tag before trailing bracket or extension/end
    value = re.sub(r"(?<![A-Za-z0-9])@[A-Za-z0-9_]+(?=[._ -]*(?:\[|$))", " ", value)
    # Channel tag followed by an underscore or separator before a title word
    value = re.sub(r"(?<![A-Za-z0-9])@[A-Za-z0-9]+(?=[._ -])", " ", value)
    # General standalone @handle
    value = re.sub(r"(?<![A-Za-z0-9])@[A-Za-z0-9_]+", " ", value)
    value = re.sub(r"[\u2122\u00AE\u00A9]", " ", value)
    value = re.sub(r"(?i)\b(?:https?://)?(?:t\.me|telegram\.me)/[A-Za-z0-9_]+", " ", value)
    return value


MAX_PARSED_FILENAME_LENGTH = 512
_BRACKET_CONTENT_RE = re.compile(r"[\[({]([^\[({\]\)}]*)[\])}]")
_CLEAN_BRACKETS_RE = re.compile(r"\[[^\[\]]*\]|\([^()]*\)|\{[^{}]*\}")


def _strip_bracket_noise(value: str, max_depth: int = 3) -> str:
    """Strips technical tags, checksums, and release-group brackets in linear time

    without catastrophic backtracking on unmatched brackets (CWE-1333 mitigation).
    """
    if not value or not any(c in value for c in "[({") or not any(c in value for c in "])}"):
        return value

    def replace_bracket(match: re.Match) -> str:
        inner = match.group(1).strip()
        if not inner:
            return " "
        compact = re.sub(r"[\s._-]+", "", inner).lower()
        # Keep meaningful bracketed text; remove technical tags, checksums,
        # and short release-group labels. Episode/year tokens are parsed first.
        if (
            re.fullmatch(r"(?:S|Season)\s*\d{1,2}|(?:EP|Episode|E)\s*\d{1,4}", inner, re.I)
            or re.search(r"(?i)\b(?:S|Season)\s*\d{1,2}\s*[._ ,-]*\s*(?:EP|Episode|E)\s*\d{1,4}\b", inner)
        ):
            return " " + inner + " "
        if (
            _NOISE_RE.search(inner)
            or re.fullmatch(r"[0-9a-f]{8}", compact, re.I)
            or re.fullmatch(r"(?:crc32|dual|multi|sub|subbed|dubbed|eng|jpn|raw|batch|proper|repack)", compact, re.I)
            or len(inner) <= 2
        ):
            return " "
        return " " + inner + " "

    current = value
    for _ in range(max_depth):
        new_val, count = _BRACKET_CONTENT_RE.subn(replace_bracket, current)
        if count == 0:
            break
        current = new_val
    return current


def parse_filename(filename: str) -> ParsedMedia:
    """Return a cleaned title and structured release metadata from a filename."""
    raw = (filename or "").strip()
    if len(raw) > MAX_PARSED_FILENAME_LENGTH:
        raw = raw[:MAX_PARSED_FILENAME_LENGTH]
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
        is_ep_marker = bool(re.search(r"(?i)^(?:s\s*\d|ep\s*\d|episode\s*\d|season\s*\d|\d{3,})", label))
        if label and not _NOISE_RE.search(label) and not is_ep_marker:
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

    # Strip technical suffixes before episode parsing so absolute numbering
    # remains visible in names such as "One Piece 1100 1080p WEB-DL".
    noise_boundary = _NOISE_RE.search(working)
    if noise_boundary:
        working = working[:noise_boundary.start()]

    season = None
    episode = None
    media_type = "movie"

    # Japanese episode notation: 第03話
    jp_match = re.search(r"第\s*(\d{1,4})\s*話", working)
    if jp_match:
        season = 1
        episode = int(jp_match.group(1))
        media_type = "tv"
        working = working[:jp_match.start()] + " " + working[jp_match.end():]

    # Explicit combined season and episode formats: S01E03, Season 3 Episode 9, S1-E07, S-01 EP-03, S01_01, 1x03
    if episode is None:
        for pattern in _EP_PATTERNS:
            match = pattern.search(working)
            if match:
                if len(match.groups()) == 2:
                    season = int(match.group(1))
                    episode = int(match.group(2))
                elif len(match.groups()) == 1:
                    season = 1
                    episode = int(match.group(1))
                media_type = "tv"
                prefix = working[:match.start()].strip(" -._|:,")
                suffix = working[match.end():].strip(" -._|:,")
                if prefix and re.search(r"[A-Za-z0-9]", prefix):
                    working = prefix
                elif suffix and re.search(r"[A-Za-z0-9]", suffix):
                    working = suffix
                else:
                    working = prefix or suffix
                break

    # Separate season / episode parsing for noisy formats like "S1 - 10", "S01 ... EP03", etc.
    if episode is None:
        sep_s = re.search(r"(?<![A-Za-z0-9])(?:Season|S)\s*[-_.]?\s*0*(\d{1,2})(?!\d)", working, re.I)
        sep_ep = re.search(r"(?<![A-Za-z0-9])(?:EP|Episode|Ep|E)\s*[-_.]?\s*0*(\d{1,4})(?:v\d+)?(?!\d)", working, re.I)
        if sep_ep:
            season = int(sep_s.group(1)) if sep_s else (season or 1)
            episode = int(sep_ep.group(1))
            media_type = "tv"
            if sep_s:
                working = re.sub(r"(?i)(?<![A-Za-z0-9])(?:Season|S)\s*[-_.]?\s*0*\d{1,2}(?!\d)", " ", working)
            working = re.sub(r"(?i)(?<![A-Za-z0-9])(?:EP|Episode|Ep|E)\s*[-_.]?\s*0*\d{1,4}(?:v\d+)?(?!\d)", " ", working)

    if episode is None:
        # Some Telegram channels put the episode marker before the series title.
        leading_episode = re.match(
            r"^\s*(?:(?:Season|S)\s*0*(\d{1,2})\s*[ ._-]*)?(?:EP|Episode|Ep|E)\s*0*(\d{1,4})(?:v\d+)?\s*[-:–— ]*\s*",
            working, re.I
        )
        if leading_episode:
            season = int(leading_episode.group(1) or 1)
            episode = int(leading_episode.group(2))
            media_type = "tv"
            working = working[leading_episode.end():]

    if season is None and episode is None:
        leading_season = re.match(
            r"^\s*(?:Season|S)\s*0*(\d{1,2})\s*[-:–—._ ]+\s*",
            working, re.I
        )
        if leading_season:
            suffix = working[leading_season.end():].strip(" -._|:,")
            if re.search(r"[A-Za-z0-9]", suffix):
                season = int(leading_season.group(1))
                media_type = "tv"
                working = suffix

    if episode is None:
        # Season with bare hyphenated episode: "S1 - 10", "S01 - 05"
        hyphen_ep = re.search(r"(?<![A-Za-z0-9])(?:Season|S)\s*0*(\d{1,2})\s*-\s*0*(\d{1,4})(?:v\d+)?(?!\d)", working, re.I)
        if hyphen_ep:
            season = int(hyphen_ep.group(1))
            episode = int(hyphen_ep.group(2))
            media_type = "tv"
            prefix = working[:hyphen_ep.start()].strip(" -._|:,")
            suffix = working[hyphen_ep.end():].strip(" -._|:,")
            working = prefix if (prefix and re.search(r"[A-Za-z0-9]", prefix)) else suffix

    if episode is None:
        # Fansub absolute numbering: "Series - 01", "Series - 001v2".
        match = re.search(r"\s+-\s+0*(\d{1,4})(?:v\d+)?(?=\s|$)", working, re.I)
        if match:
            number = int(match.group(1))
            if 1 <= number <= 9999 and not 1900 <= number <= 2099:
                season = season or 1
                episode = number
                media_type = "tv"
                prefix = working[:match.start()].strip(" -._|:,")
                suffix = working[match.end():].strip(" -._|:,")
                working = prefix if (prefix and re.search(r"[A-Za-z0-9]", prefix)) else suffix

        # Long-running anime also uses a bare trailing absolute episode number.
        if episode is None:
            trailing = re.search(r"\s+0*(\d{2,4})(?:v\d+)?\s*$", working, re.I)
            if trailing:
                number = int(trailing.group(1))
                if 1 <= number <= 9999 and not 1900 <= number <= 2099:
                    season = season or 1
                    episode = number
                    media_type = "tv"
                    working = working[:trailing.start()]

    # Bare season marker with no episode (e.g. "... S01 Episode.mkv" or "... Season 2.mkv" or "Series S1")
    if episode is None and season is None:
        bare_s = re.search(r"(?<![A-Za-z0-9])(?:Season|S)\s*[-_.]?\s*0*(\d{1,2})(?!\d)", working, re.I)
        if bare_s:
            rem = (working[:bare_s.start()] + " " + working[bare_s.end():]).strip(" -._|:,")
            if re.search(r"[A-Za-z0-9]", rem):
                season = int(bare_s.group(1))
                media_type = "tv"
                working = rem

    # Remove episode title/release annotations after the first technical marker.
    noise_boundary = _NOISE_RE.search(working)
    if noise_boundary:
        working = working[:noise_boundary.start()]

    year = None
    year_match = _YEAR_RE.search(working)
    if year_match:
        year = int(year_match.group(1))
        working = working[:year_match.start()] + " " + working[year_match.end():]

    for _ in range(3):
        working, count = _CLEAN_BRACKETS_RE.subn(" ", working)
        if count == 0:
            break
    working = re.sub(r"(?i)\b(?:EP|Episode|Season)\b", " ", working)
    working = re.sub(r"(?i)\b(?:Season|S)\s*0*\d{1,2}\b", " ", working)
    working = re.sub(r"(?i)\b(?:Episode|Ep|E)\s*0*\d{1,4}\b", " ", working)
    # Remove common leading/trailing separators left after stripping tags.
    working = re.sub(r"^[\s._\-–—:|,]+|[\s._\-–—:|,]+$", " ", working)
    working = re.sub(r"\s+", " ", working).strip(" -._|:,")
    working = re.sub(r"\s+([!?])", r"\1", working)
    working = re.sub(r"^[\s\[\](){}]+|[\s\[\](){}]+$", "", working).strip()
    working = re.sub(r"[\s,._\-–—:|]+$", "", working).strip()

    # Do not send an empty/noise-only title to the provider.
    if not working:
        fallback = _remove_extension(raw)
        fallback = _strip_channel_tags(fallback)
        working = re.sub(r"[\[\](){}]", " ", fallback)
        working = re.sub(r"[_\.]+", " ", working)
        working = re.sub(r"\s+", " ", working).strip(" -._|:,")

    # Track parsing uncertainty
    is_truncated = bool(re.search(r"(?:\.\.\.|…|-|\b(?:and|the|of|in|to)\s*)$", working, re.I))
    is_ambiguous = len(working) <= 3 or working.isdigit()
    confidence = 1.0
    if is_truncated:
        confidence -= 0.35
    if is_ambiguous:
        confidence -= 0.40
    if not release_group and episode is None and year is None:
        confidence = min(confidence, 0.85)

    return ParsedMedia(
        raw_filename=raw,
        clean_title=working,
        year=year,
        media_type=media_type,
        season=season,
        episode=episode,
        quality=quality or "1080p",
        release_group=release_group,
        is_ambiguous=is_ambiguous,
        is_truncated=is_truncated,
        parsing_confidence=round(max(0.1, confidence), 2),
    )


def update_filename_title(original_filename: str, new_title: str) -> str:
    """Update only the title portion of a media filename, preserving season, episode, quality, and tags.
    
    Example:
        'S01-02 Alya [Dual] 1080p @XANIME_UNIVERSE.mkv'
        with new_title='Alya Sometimes Hides Her Feelings in Russian'
        becomes:
        'S01-02 Alya Sometimes Hides Her Feelings in Russian [Dual] 1080p @XANIME_UNIVERSE.mkv'
    """
    clean_new = (new_title or "").strip()
    if not clean_new:
        return original_filename

    # If the new title is already contained within the filename, do nothing
    if clean_new.casefold() in original_filename.casefold():
        return original_filename

    parsed = parse_filename(original_filename)
    old_title = (parsed.clean_title or "").strip()

    # 1. Match old_title with word boundary in original filename
    if old_title and len(old_title) >= 2:
        escaped = re.escape(old_title)
        pattern = re.compile(rf"(?<![A-Za-z0-9]){escaped}(?![A-Za-z0-9])", re.IGNORECASE)
        if pattern.search(original_filename):
            return pattern.sub(clean_new, original_filename, count=1)

        # 2. Try substring match if boundary fails
        pattern_sub = re.compile(escaped, re.IGNORECASE)
        if pattern_sub.search(original_filename):
            return pattern_sub.sub(clean_new, original_filename, count=1)

    # 3. If old_title is not in filename, preserve episode code and replace
    name_no_ext, ext = os.path.splitext(original_filename)
    ep_match = re.search(r"(?i)\b(?:S\d{1,2}\s*[-_ .]?\s*E\d{1,4}|S\d{1,2}-\d{1,4}|\d{1,2}x\d{1,4})\b", name_no_ext)
    if ep_match:
        if ep_match.start() == 0:
            rest = name_no_ext[ep_match.end():].strip(" ._-")
            return f"{ep_match.group(0)} {clean_new}" + (f" {rest}" if rest else "") + ext
        return f"{clean_new} {ep_match.group(0)}" + ext

    return f"{clean_new} - {original_filename}"

