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

    # 2. Extract Quality from raw filename
    quality = "1080p"
    if re.search(r"\b(2160p|4k|uhd)\b", raw, re.I):
        quality = "4K UHD"
    elif re.search(r"\b1080p\b", raw, re.I):
        quality = "1080p"
    elif re.search(r"\b720p\b", raw, re.I):
        quality = "720p"
    elif re.search(r"\b480p\b", raw, re.I):
        quality = "480p"

    # 3. Extract release group BEFORE bracket stripping
    # Pattern A: Leading [GroupName] at start of filename
    release_group: Optional[str] = None
    leading_group_match = re.match(r"^\[([^\[\]]+)\]", working)
    if leading_group_match:
        group_text = leading_group_match.group(1).strip()
        # Only treat as release group if it's not a noise token, season/ep marker, or resolution
        if group_text and not re.match(
            r"^(?:S\s*\d|EP\s*\d|\d+p|dual|multi|sub|esub|dubbed|1080|720|480|2160|4k|uhd|hd)$",
            group_text, re.I
        ) and group_text not in ("", " "):
            release_group = group_text

    # Pattern B: Trailing -GroupName before extension (e.g. "Title.2014.1080p.BluRay.x264-GROUP")
    if not release_group:
        trailing_group = re.search(r"-([A-Za-z][A-Za-z0-9]{1,20})$", working)
        if trailing_group:
            candidate = trailing_group.group(1)
            # Ensure it's not a known noise token
            if not re.match(
                r"^(?:dl|rip|ray|hd|dts|aac|ac3|sub|dub|raw|raws)$",
                candidate, re.I
            ):
                release_group = candidate
                working = working[:trailing_group.start()] + " "

    # 4. Strip pre-normalization noise tokens with dots/hyphens preserved
    pre_noise = [
        r"\b(2160p|4k|uhd|1080p|1080i|720p|576p|480p|sd|hd)\b",
        r"\b(web-?dl|webrip|bluray|blu-ray|bdrip|brrip|hdrip|hdtv|dvdrip|dvd|remux)\b",
        r"\b[hx]\.?26[45]\b",
        r"\b(hevc|av1|10bit|8bit|hi10p)\b",
        r"\b(truehd|atmos|ddp\d*(\.\d+)?|dd\+?\d*(\.\d+)?|ac3|aac\d*(\.\d+)?|6ch|dts-hd|dts|flac|opus|mp3)\b",
        r"\b(dual[\s\-_]?audio|multi[\s\-_]?audio|dual|multi|eng[\s\-_]?sub|english[\s\-_]?sub|esub|subbed|dubbed|sub)\b",
    ]
    for np in pre_noise:
        working = re.sub(np, " ", working, flags=re.I)

    # 5. NORMALIZE SEPARATORS (dots and underscores -> spaces)
    # This prevents @channel_with_underscores from swallowing adjacent title words
    working = working.replace(".", " ").replace("_", " ")

    # 6. Strip Telegram @channel tags and uploader symbols
    working = re.sub(r"@[a-zA-Z0-9™©®]+", " ", working)

    season: Optional[int] = None
    episode: Optional[int] = None
    media_type = "movie"

    # 7. Extract Season & Episode
    # Pattern 1: 1x01 or 01x02 or [1x01]
    match_x = re.search(r"(?:\[|\b)(\d{1,2})x(\d{1,4})(?:\]|\b)", working, re.I)
    if match_x:
        season = int(match_x.group(1))
        episode = int(match_x.group(2))
        media_type = "tv"
        working = working[:match_x.start()] + " " + working[match_x.end():]

    # Pattern 2: S01E01 or S1-E03 or S-01 EP-01 or Season 1 Episode 2
    #             Also handles [S 01] [EP 01] with spaces inside brackets
    if episode is None:
        se_match = re.search(
            r"(?:\[?\s*|\\b)(?:S|Season)\s*[\-_.]?\s*(\d{1,2})\s*\]?\s*[\-_.:]*\s*\[?\s*(?:EP|Episode|Ep|E)\s*[\-_.]?\s*(\d{1,4})\s*\]?",
            working,
            re.I
        )
        if se_match:
            season = int(se_match.group(1))
            episode = int(se_match.group(2))
            media_type = "tv"
            working = working[:se_match.start()] + " " + working[se_match.end():]

    # Pattern 3: S01 - 03 or S1 - 10
    if episode is None:
        s_hyphen_match = re.search(r"(?:\[|\b)S[\s\-_.]*(\\d{1,2})\s*-\s*(\d{1,4})(?:\]|\b)", working, re.I)
        if s_hyphen_match:
            season = int(s_hyphen_match.group(1))
            episode = int(s_hyphen_match.group(2))
            media_type = "tv"
            working = working[:s_hyphen_match.start()] + " " + working[s_hyphen_match.end():]

    # Pattern 4: Separate S-01 / Season 01 and EP-01 / Episode 01 anywhere (even inside brackets)
    if season is None:
        s_match = re.search(r"(?:\[?\s*)(?:S|Season)\s*[\-_.]?\s*(\d{1,2})(?:\s*\]|\b)", working, re.I)
        if s_match:
            season = int(s_match.group(1))
            media_type = "tv"
            working = working[:s_match.start()] + " " + working[s_match.end():]

    if episode is None:
        ep_match = re.search(r"(?:\[?\s*)(?:EP|Episode|Ep)\s*[\-_.]?\s*(\d{1,4})(?:\s*\]|\b)", working, re.I)
        if ep_match:
            if season is None:
                season = 1
            episode = int(ep_match.group(1))
            media_type = "tv"
            working = working[:ep_match.start()] + " " + working[ep_match.end():]

    # Pattern 4b: Standalone E01 (but not just any number)
    if episode is None:
        e_match = re.search(r"(?:\[|\b)E(\d{1,4})(?:\]|\b)", working)
        if e_match:
            if season is None:
                season = 1
            episode = int(e_match.group(1))
            media_type = "tv"
            working = working[:e_match.start()] + " " + working[e_match.end():]

    # Pattern 5: Anime hyphen episode "Title - 01"
    if episode is None:
        anime_ep = re.search(r"\s+-\s+(\d{1,4})(?:\s+|$)", working)
        if anime_ep:
            season = 1
            episode = int(anime_ep.group(1))
            media_type = "tv"
            working = working[:anime_ep.start()] + " " + working[anime_ep.end():]

    # Pattern 6: Trailing bare number for anime episodes (e.g. "One Piece 1100")
    # Only triggers when there's at least one word before the number, and the number
    # is at the end of the meaningful content (after noise removal).
    if episode is None:
        trailing_num = re.search(r"(\b[A-Za-z][\w\s]*?)\s+(\d{2,4})\s*$", working.strip())
        if trailing_num:
            potential_title = trailing_num.group(1).strip()
            num = int(trailing_num.group(2))
            # Heuristic: episode numbers are > 0 and ≤ 9999; exclude years
            if 1 <= num <= 9999 and not (1900 <= num <= 2099) and len(potential_title) >= 2:
                season = 1
                episode = num
                media_type = "tv"
                working = potential_title

    # 8. Extract Year (1900-2099)
    year: Optional[int] = None
    year_match = re.search(r"\b(19\d\d|20\d\d)\b", working)
    if year_match:
        year = int(year_match.group(1))
        working = working[:year_match.start()] + " " + working[year_match.end():]

    # 9. Strip brackets and parentheses content (e.g. [@Fansub], [Dual], [720p])
    working = re.sub(r"\[.*?\]", " ", working)
    working = re.sub(r"\(.*?\)", " ", working)

    # 10. Second pass on post-normalization noise tokens
    post_noise = [
        r"\b(2160p|4k|uhd|1080p|1080i|720p|576p|480p|sd|hd)\b",
        r"\b(web-?dl|webrip|bluray|blu-ray|bdrip|brrip|hdrip|hdtv|dvdrip|dvd|remux)\b",
        r"\b[hx]\s*26[45]\b",
        r"\b(hevc|av1|10bit|8bit|hi10p)\b",
        r"\b(truehd|atmos|ddp\d*|dd|ac3|aac\d*|6ch|dts-hd|dts|flac|opus|mp3)\b",
        r"\b(dual|multi|esub|subbed|dubbed|sub)\b",
        r"\b(proper|repack|extended|uncut|unrated|imax|theatrical)\b",
        r"\b(animedynasty|animestation\d*|aniwatch|anime_maniaac|index_station|aegir|horriblesubs|judas|subsplease|erai-raws|golumpa|asw|cr|nf)\b",
    ]
    for np in post_noise:
        working = re.sub(np, " ", working, flags=re.I)

    # 11. Final cleanup of punctuation and extra spaces
    clean_title = re.sub(r"[\(\[\{\s\-_]+", " ", working)
    clean_title = re.sub(r"[\)\]\}\s\-_]+", " ", clean_title)
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
