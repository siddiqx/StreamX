"""Metadata and Poster Artwork Resolver for StreamX.

Fetches official high-resolution posters and backdrops for Movies, TV Shows, and Anime
using public APIs (AniList, TVMaze, OMDb) with zero user API key requirements.
"""

import asyncio
import json
import re
import urllib.parse
from typing import Dict, Optional, Tuple
import httpx

from app.utils.logging import log_event, logger

ANILIST_GRAPHQL_URL = "https://graphql.anilist.co"
ANILIST_QUERY = """
query ($search: String) {
  Media (search: $search, type: ANIME) {
    title {
      romaji
      english
    }
    coverImage {
      extraLarge
      large
    }
    bannerImage
    seasonYear
  }
}
"""

OMDB_URL = "http://www.omdbapi.com/"
TVMAZE_URL = "https://api.tvmaze.com/singlesearch/shows"


def extract_searchable_title(filename: str) -> Tuple[str, Optional[int]]:
  """Extracts clean searchable title and optional year from filename."""
  clean = filename.rsplit(".", 1)[0] if "." in filename else filename
  clean = re.sub(r"@\w+", "", clean)  # remove @channel tags
  clean = re.sub(r"\[.*?\]", "", clean)  # remove [bracketed tags]
  clean = re.sub(r"\(.*?\)", "", clean)  # remove (parenthesized tags)

  # Check for 4-digit year (1950 - 2030)
  year_match = re.search(r"\b(19\d\d|20\d\d)\b", clean)
  year = int(year_match.group(1)) if year_match else None
  if year:
    clean = re.sub(r"\b(19\d\d|20\d\d)\b", "", clean)

  # Clean common codec / quality tokens
  clean = re.sub(
      r"\b(2160p|1080p|720p|480p|BluRay|BRRip|BDRip|WEB-DL|WEBRip|x264|x265|HEVC|AAC|Dual-Audio|Esub|Dual)\b",
      "",
      clean,
      flags=re.IGNORECASE,
  )
  clean = re.sub(r"S\d+\s*[-_]?\s*E\d+", "", clean, flags=re.IGNORECASE)
  clean = re.sub(r"[\._\-]+", " ", clean).strip()
  # Remove extra whitespace
  clean = re.sub(r"\s+", " ", clean).strip()

  return clean, year


class MetadataService:

  def __init__(self):
    self._cache: Dict[str, Dict[str, Optional[str]]] = {}

  async def fetch_poster_and_backdrop(
      self, filename: str, category: str
  ) -> Tuple[Optional[str], Optional[str]]:
    """Resolves high-resolution official poster and horizontal backdrop artwork."""
    clean_title, year = extract_searchable_title(filename)
    cache_key = f"{category}:{clean_title}:{year}"

    if cache_key in self._cache:
      c = self._cache[cache_key]
      return c.get("poster_url"), c.get("backdrop_url")

    poster_url = None
    backdrop_url = None

    cat_lower = category.lower()

    # 1. Try Anime resolver (AniList)
    if cat_lower == "anime" or "anime" in filename.lower():
      poster_url, backdrop_url = await self._search_anilist(clean_title)

    # 2. Try TV Shows resolver (TVMaze)
    if not poster_url and (cat_lower == "tv shows" or "s0" in filename.lower()):
      poster_url, backdrop_url = await self._search_tvmaze(clean_title)

    # 3. Try Movie resolver (OMDb)
    if not poster_url:
      poster_url, backdrop_url = await self._search_omdb(clean_title, year)

    # 4. Fallback search AniList if not found
    if not poster_url:
      poster_url, backdrop_url = await self._search_anilist(clean_title)

    self._cache[cache_key] = {
        "poster_url": poster_url,
        "backdrop_url": backdrop_url,
    }
    if poster_url:
      log_event(
          "POSTER_RESOLVED",
          filename=filename,
          title=clean_title,
          poster=poster_url,
      )

    return poster_url, backdrop_url

  async def _search_anilist(
      self, query: str
  ) -> Tuple[Optional[str], Optional[str]]:
    try:
      async with httpx.AsyncClient(timeout=8.0) as client:
        payload = {"query": ANILIST_QUERY, "variables": {"search": query}}
        res = await client.post(
            ANILIST_GRAPHQL_URL,
            json=payload,
            headers={"User-Agent": "StreamX/1.0"},
        )
        if res.status_code == 200:
          data = res.json().get("data", {}).get("Media")
          if data:
            cover = data.get("coverImage", {})
            poster = cover.get("extraLarge") or cover.get("large")
            banner = data.get("bannerImage")
            return poster, banner
    except Exception as e:
      logger.debug(f"AniList search error for '{query}': {e}")
    return None, None

  async def _search_omdb(
      self, query: str, year: Optional[int]
  ) -> Tuple[Optional[str], Optional[str]]:
    try:
      params = {"t": query, "apikey": "trilogy"}
      if year:
        params["y"] = str(year)
      async with httpx.AsyncClient(timeout=8.0) as client:
        res = await client.get(
            OMDB_URL, params=params, headers={"User-Agent": "StreamX/1.0"}
        )
        if res.status_code == 200:
          data = res.json()
          if data.get("Response") == "True":
            poster = data.get("Poster")
            if poster and poster != "N/A":
              return poster, None
    except Exception as e:
      logger.debug(f"OMDb search error for '{query}': {e}")
    return None, None

  async def _search_tvmaze(
      self, query: str
  ) -> Tuple[Optional[str], Optional[str]]:
    try:
      params = {"q": query}
      async with httpx.AsyncClient(timeout=8.0) as client:
        res = await client.get(
            TVMAZE_URL, params=params, headers={"User-Agent": "StreamX/1.0"}
        )
        if res.status_code == 200:
          data = res.json()
          images = data.get("image", {})
          poster = images.get("original") or images.get("medium")
          return poster, None
    except Exception as e:
      logger.debug(f"TVMaze search error for '{query}': {e}")
    return None, None


metadata_service = MetadataService()
