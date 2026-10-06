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
    # Common channel / fansub uploader tags
    r"animedynasty", r"animestation\d*", r"aniwatch", r"anime_maniaac", r"index_station",
    r"horriblesubs", r"judas", r"subsplease", r"erai-raws", r"golumpa", r"asw",
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
        if "." in working and len(working.rsplit(".", 1)[-1]) in (2, 3, 4):
            working = working.rsplit(".", 1)[0]

    # 2. Extract release group if explicitly delimited by trailing dash
    release_group = None
    group_match = re.search(r"-([A-Za-z0-9_]+)$", working)
    if group_match:
        cand_group = group_match.group(1)
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

    # 4. Remove Telegram channel tags (@ChannelName) anywhere in string
    working = re.sub(r"@\w+[\.\s\-_]*", "", working)
    working = re.sub(r"[\.\s\-_]*@\w+", "", working)

    # 5. Handle leading bracketed release group e.g. "[Group] Title" or "[Fansub]"
    bracket_group_match = re.match(r"^\[([^\]]+)\]\s*", working)
    if bracket_group_match:
        if not release_group:
            release_group = bracket_group_match.group(1).strip()
        working = working[bracket_group_match.end():]

    season: Optional[int] = None
    episode: Optional[int] = None
    media_type = "movie"

    # 6. Check for LEADING Episode / Season pattern (e.g. "EP09 - The Fragrant Flower" or "Episode 09 - ...")
    leading_ep_match = re.match(
        r"^(?:S(\d{1,2})\s*[-_.]?\s*)?(?:EP|Episode|Ep|E)\s*(\d{1,4})\s*[-_.:\s]+",
        working,
        re.I,
    )
    if leading_ep_match:
        s_val = leading_ep_match.group(1)
        ep_val = leading_ep_match.group(2)
        season = int(s_val) if s_val else 1
        episode = int(ep_val)
        media_type = "tv"
        working = working[leading_ep_match.end():]

    # 7. Identify quality / codec boundary to isolate title area from uploader noise
    q_boundary = re.search(
        r"(\[?\b(2160p|4k|1080p|1080i|720p|480p|bluray|web-?dl|webrip|hdrip|hevc|x264|x265)\b\]?)",
        working,
        re.I,
    )
    if q_boundary:
        working_title_area = working[:q_boundary.start()]
    else:
        working_title_area = working

    # Remove remaining bracketed tags inside title area
    working_clean = re.sub(r"\[.*?\]", " ", working_title_area)
    working_clean = working_clean.replace(".", " ").replace("_", " ")

    # 8. Detect TV Season & Episode within title area (if not already extracted from leading prefix)
    title_part = working_clean
    if episode is None:
        # Pattern A: S01E01, S04E28, S01 - E03, S1 - 10, S1-10
        se_match = re.search(
            r"\bS(\d{1,2})\s*(?:[-_.]?\s*(?:E|Ep|Episode)|[-_.])\s*(\d{1,4})\b",
            working_clean,
            re.I,
        )
        if se_match:
            season = int(se_match.group(1))
            episode = int(se_match.group(2))
            media_type = "tv"
            title_part = working_clean[:se_match.start()]
        else:
            # Pattern B: Standalone E08, EP09, Ep 08, Episode 8 (without leading S)
            ep_match = re.search(r"\b(?:EP|Ep|Episode|E)\s*(\d{1,4})\b", working_clean, re.I)
            if ep_match:
                season = 1
                episode = int(ep_match.group(1))
                media_type = "tv"
                title_part = working_clean[:ep_match.start()]
            else:
                # Pattern C: 1x01 or 04x28
                se_x_match = re.search(r"\b(\d{1,2})x(\d{1,4})\b", working_clean, re.I)
                if se_x_match:
                    season = int(se_x_match.group(1))
                    episode = int(se_x_match.group(2))
                    media_type = "tv"
                    title_part = working_clean[:se_x_match.start()]
                else:
                    # Pattern D: Season 1 Episode 2
                    se_word_match = re.search(
                        r"\b(?:Season|S)\s*(\d{1,2})[\s\-_.]+(?:Episode|Ep|E)\s*(\d{1,4})\b",
                        working_clean,
                        re.I,
                    )
                    if se_word_match:
                        season = int(se_word_match.group(1))
                        episode = int(se_word_match.group(2))
                        media_type = "tv"
                        title_part = working_clean[:se_word_match.start()]
                    else:
                        # Pattern E: Standalone Season
                        s_only_match = re.search(
                            r"\b(?:S|Season)\s*(\d{1,2})\s*(?:Episode|Ep)?\b", working_clean, re.I
                        )
                        if s_only_match:
                            season = int(s_only_match.group(1))
                            media_type = "tv"
                            title_part = working_clean[:s_only_match.start()]
                        else:
                            # Pattern F: Anime hyphen episode numbering "Title - 01" or "Title - 10"
                            anime_ep_match = re.search(r"\s+-\s+(\d{1,4})(?:\s+|$)", working_clean)
                            if anime_ep_match:
                                season = 1
                                episode = int(anime_ep_match.group(1))
                                media_type = "tv"
                                title_part = working_clean[:anime_ep_match.start()]

    # 9. Extract Year (1900-2099)
    year: Optional[int] = None
    year_match = re.search(r"\b(19\d\d|20\d\d)\b", title_part)
    if year_match:
        year = int(year_match.group(1))
        title_part = title_part[:year_match.start()]
    elif media_type == "movie":
        year_match_rest = re.search(r"\b(19\d\d|20\d\d)\b", working_clean)
        if year_match_rest:
            year = int(year_match_rest.group(1))
            title_part = working_clean[:year_match_rest.start()]

    # Anime numeric episode number without hyphen e.g. "One.Piece.1100.1080p"
    if media_type == "movie" and not year:
        ep_num_match = re.search(r"\b(\d{2,4})\b", title_part)
        if ep_num_match:
            candidate_num = int(ep_num_match.group(1))
            if candidate_num not in range(1900, 2099):
                media_type = "tv"
                season = 1
                episode = candidate_num
                title_part = title_part[:ep_num_match.start()]

    # 10. Clean Noise Tokens from Title
    clean_title = NOISE_REGEX.sub(" ", title_part)

    # 11. Normalize Separators and trailing noise
    clean_title = clean_title.replace(".", " ").replace("_", " ")
    clean_title = re.sub(r"\s+-\s+", " ", clean_title)
    clean_title = re.sub(r"\s+-\s*$", "", clean_title)
    clean_title = re.sub(r"^\s*-\s+", "", clean_title)
    clean_title = re.sub(r"\(\s*\)", "", clean_title)
    clean_title = re.sub(r"\s+", " ", clean_title).strip()

    # Fallback if title became empty
    if not clean_title:
        clean_title = re.sub(r"\.(mkv|mp4|avi|mov)$", "", raw, flags=re.I).strip()

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
