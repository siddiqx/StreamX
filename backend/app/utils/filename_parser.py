"""StreamX Deterministic Filename Parser.

Extracts canonical title, release year, media type (movie vs tv), season,
episode, quality, and strips release noise, codec tags, and fansub prefixes.
"""

from dataclasses import dataclass
import re
from typing import Optional, Tuple


@dataclass
class ParsedMedia:
    raw_filename: str
    clean_title: str
    year: Optional[int] = None
    media_type: str = "movie"  # "movie" or "tv"
    season: Optional[int] = None
    episode: Optional[int] = None
    quality: Optional[str] = None
    release_group: Optional[str] = None


# Common video file extensions
VIDEO_EXTENSIONS = {
    ".mkv", ".mp4", ".avi", ".mov", ".m4v", ".webm", ".ts", ".flv", ".wmv", ".iso"
}

# Tokens representing audio, video quality, codecs, source, etc.
NOISE_TOKENS = [
    # Resolution
    r"2160p", r"4k", r"uhd", r"1080p", r"1080i", r"720p", r"576p", r"480p", r"sd", r"hd",
    # Source
    r"web-?dl", r"webrip", r"bluray", r"blu-ray", r"bdrip", r"brrip", r"hdrip",
    r"hdtv", r"dvdrip", r"dvd", r"remux",
    # Video codecs
    r"x264", r"x265", r"h264", r"h\.264", r"h265", r"h\.265", r"hevc", r"av1",
    r"10bit", r"8bit", r"hi10p",
    # Audio codecs & specs
    r"truehd", r"atmos", r"ddp\d*(\.\d+)?", r"dd\+?\d*(\.\d+)?", r"ac3", r"aac\d*(\.\d+)?",
    r"dts-hd(\s*ma)?", r"dts", r"flac", r"opus", r"mp3",
    # Audio channels & dubs
    r"dual[\s\-_]?audio", r"multi[\s\-_]?audio", r"dual", r"multi",
    r"eng[\s\-_]?sub", r"english[\s\-_]?sub", r"esub", r"subbed", r"dubbed",
    r"japanese[\s\-_]?audio", r"jap[\s\-_]?audio",
    # HDR
    r"hdr10\+", r"hdr10", r"hdr", r"dolby[\s\-_]?vision", r"dovi", r"dv",
    # Modifiers / Editions
    r"proper", r"repack", r"extended(\s+cut)?", r"uncut", r"unrated", r"imax",
    r"theatrical", r"directors(\s+cut)?", r"criterion",
]

NOISE_REGEX = re.compile(
    r"\b(" + "|".join(NOISE_TOKENS) + r")\b",
    re.IGNORECASE,
)


def parse_filename(filename: str) -> ParsedMedia:
    """Deterministically parse raw media filenames into structured metadata."""
    raw = filename.strip()
    working = raw

    # 1. Strip file extension
    for ext in VIDEO_EXTENSIONS:
        if working.lower().endswith(ext):
            working = working[:-len(ext)]
            break
    else:
        # Generic dot extension if 3-4 chars
        if "." in working and len(working.rsplit(".", 1)[-1]) in (3, 4):
            working = working.rsplit(".", 1)[0]

    # 2. Extract release group if trailing (e.g. -GROUP or -YTS or -PSA)
    release_group = None
    group_match = re.search(r"-([A-Za-z0-9_]+)$", working)
    if group_match:
        cand_group = group_match.group(1)
        # Avoid treating Part-Two or 1080p as group
        if not re.match(r"^(1080p|720p|2160p|480p|x264|x265|HEVC)$", cand_group, re.I):
            release_group = cand_group
            working = working[:-len(group_match.group(0))]

    # 3. Detect Quality
    quality = "1080p"
    if re.search(r"\b(2160p|4k|uhd)\b", raw, re.I):
        quality = "4K UHD"
    elif re.search(r"\b1080p\b", raw, re.I):
        quality = "1080p"
    elif re.search(r"\b720p\b", raw, re.I):
        quality = "720p"
    elif re.search(r"\b480p\b", raw, re.I):
        quality = "480p"

    # 4. Remove leading Telegram channel tags (@ChannelName)
    working = re.sub(r"^@\w+[\.\s\-_]*", "", working)
    working = re.sub(r"[\.\s\-_]*@\w+", "", working)

    # 5. Handle leading bracketed release group e.g. "[Group] Title" or "[Fansub]"
    bracket_group_match = re.match(r"^\[([^\]]+)\]\s*", working)
    if bracket_group_match:
        if not release_group:
            release_group = bracket_group_match.group(1).strip()
        working = working[bracket_group_match.end():]

    # Remove all remaining bracketed text e.g. [1080p], [Dual], [HEVC]
    working = re.sub(r"\[.*?\]", " ", working)

    # Normalize dots and underscores to spaces early so regex word boundaries work accurately
    working = working.replace(".", " ").replace("_", " ")

    # 6. Detect TV Season & Episode
    season: Optional[int] = None
    episode: Optional[int] = None
    media_type = "movie"

    # Pattern A: S01E01 or S04E28 or S01 - E03 or s01e1100
    se_match = re.search(r"\bS(\d{1,2})\s*[-_]?\s*E(\d{1,4})\b", working, re.I)
    if se_match:
        season = int(se_match.group(1))
        episode = int(se_match.group(2))
        media_type = "tv"
        # Cut off working string at the season/episode token for title extraction
        title_part = working[:se_match.start()]
    else:
        # Pattern B: 1x01 or 04x28
        se_x_match = re.search(r"\b(\d{1,2})x(\d{1,4})\b", working, re.I)
        if se_x_match:
            season = int(se_x_match.group(1))
            episode = int(se_x_match.group(2))
            media_type = "tv"
            title_part = working[:se_x_match.start()]
        else:
            # Pattern C: Season 1 Episode 2
            se_word_match = re.search(
                r"\bSeason\s*(\d{1,2})[\s\-_]+(?:Episode|Ep)\s*(\d{1,4})\b", working, re.I
            )
            if se_word_match:
                season = int(se_word_match.group(1))
                episode = int(se_word_match.group(2))
                media_type = "tv"
                title_part = working[:se_word_match.start()]
            else:
                # Pattern D: Anime absolute episode numbering: "Title - 01" or "Title 1100"
                anime_ep_match = re.search(r"\s+-\s+(\d{1,4})(?:\s+|$)", working)
                if anime_ep_match:
                    season = 1
                    episode = int(anime_ep_match.group(1))
                    media_type = "tv"
                    title_part = working[:anime_ep_match.start()]
                else:
                    title_part = working

    # 7. Extract Year (1900-2099)
    # Be careful not to treat episode numbers or 1080 as year
    year: Optional[int] = None
    year_match = re.search(r"\b(19\d\d|20\d\d)\b", title_part)
    if year_match:
        year = int(year_match.group(1))
        # Title is everything before the year
        title_part = title_part[:year_match.start()]
    elif media_type == "movie":
        # Check if year is in the remaining part of working
        year_match_rest = re.search(r"\b(19\d\d|20\d\d)\b", working)
        if year_match_rest:
            year = int(year_match_rest.group(1))
            title_part = working[:year_match_rest.start()]

    # If Pattern E: Anime episode number without hyphen, e.g. "One.Piece.1100.1080p"
    if media_type == "movie" and not year:
        ep_num_match = re.search(r"[\.\s_](\d{2,4})[\.\s_]", title_part)
        if ep_num_match:
            candidate_num = int(ep_num_match.group(1))
            # Not a year (already checked above), treat as episode
            if candidate_num not in range(1900, 2099):
                media_type = "tv"
                season = 1
                episode = candidate_num
                title_part = title_part[:ep_num_match.start()]

    # 8. Clean Noise Tokens from Title
    clean_title = NOISE_REGEX.sub(" ", title_part)

    # 9. Normalize Separators (dots, underscores, excess dashes)
    # Replace dots and underscores with spaces
    clean_title = clean_title.replace(".", " ").replace("_", " ")

    # Remove isolated hyphens surrounded by spaces, while keeping words like "Spider-Man"
    clean_title = re.sub(r"\s+-\s+", " ", clean_title)
    clean_title = re.sub(r"\s+-", " ", clean_title)

    # Remove parenthesized residue e.g. (1080p) or ()
    clean_title = re.sub(r"\(\s*\)", "", clean_title)

    # Remove extra spaces and strip
    clean_title = re.sub(r"\s+", " ", clean_title).strip()

    # Fallback if title became empty
    if not clean_title:
        clean_title = raw

    return ParsedMedia(
        raw_filename=raw,
        clean_title=clean_title,
        year=year,
        media_type=media_type,
        season=season,
        episode=episode,
        quality=quality,
        release_group=release_group,
    )
