"""AniList anime-only metadata provider.

Uses AniList's public GraphQL API and returns absolute cover URLs, so anime
posters are sourced from an anime catalogue rather than generic TV search.
No API key is required for public catalogue queries.
"""
from typing import Any, Dict, List, Optional
import httpx

from app.services.metadata_providers.base import CandidateMatch, CanonicalMetadata, MetadataProvider

ANILIST_URL = "https://graphql.anilist.co"


class AniListProvider(MetadataProvider):
    def is_configured(self) -> bool:
        return True

    async def _query(self, query: str, variables: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                response = await client.post(
                    ANILIST_URL,
                    json={"query": query, "variables": variables},
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                )
                if response.status_code != 200:
                    return None
                payload = response.json()
                if payload.get("errors"):
                    return None
                return payload.get("data")
        except (httpx.HTTPError, ValueError):
            return None

    async def search(
        self, query: str, year: Optional[int] = None, media_type: str = "tv"
    ) -> List[CandidateMatch]:
        clean_query = query.strip()
        if not clean_query:
            return []
        gql = """
        query ($search: String!) {
          Page(page: 1, perPage: 10) {
            media(search: $search, type: ANIME, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
              id
              title { romaji english native }
              format
              startDate { year month day }
              description(asHtml: false)
              coverImage { extraLarge large }
              bannerImage
              averageScore
              popularity
              genres
              episodes
            }
          }
        }
        """
        data = await self._query(gql, {"search": clean_query})
        items = ((data or {}).get("Page") or {}).get("media") or []
        candidates: List[CandidateMatch] = []
        for item in items:
            title_data = item.get("title") or {}
            title = title_data.get("english") or title_data.get("romaji") or title_data.get("native")
            if not title:
                continue
            start_year = (item.get("startDate") or {}).get("year")
            cover = item.get("coverImage") or {}
            candidates.append(CandidateMatch(
                provider="anilist",
                provider_id=str(item["id"]),
                title=title,
                original_title=title_data.get("romaji") or title_data.get("native"),
                media_type="movie" if item.get("format") in ("MOVIE", "SPECIAL") and item.get("episodes") in (None, 1) else "tv",
                release_year=start_year,
                overview=item.get("description"),
                poster_path=cover.get("extraLarge") or cover.get("large"),
                backdrop_path=item.get("bannerImage"),
                rating=(item.get("averageScore") / 10) if item.get("averageScore") is not None else None,
                genres=item.get("genres") or [],
                popularity=float(item.get("popularity") or 0),
            ))
        return candidates

    async def get_details(
        self, provider_id: str, media_type: str = "tv"
    ) -> Optional[CanonicalMetadata]:
        gql = """
        query ($id: Int!) {
          Media(id: $id, type: ANIME) {
            id
            title { romaji english native }
            format
            startDate { year month day }
            description(asHtml: false)
            coverImage { extraLarge large }
            bannerImage
            averageScore
            genres
            episodes
            duration
            countryOfOrigin
          }
        }
        """
        try:
            ani_id = int(provider_id)
        except (TypeError, ValueError):
            return None
        data = await self._query(gql, {"id": ani_id})
        item = (data or {}).get("Media")
        if not item:
            return None
        title_data = item.get("title") or {}
        title = title_data.get("english") or title_data.get("romaji") or title_data.get("native") or "Unknown"
        start_date = item.get("startDate") or {}
        year = start_date.get("year")
        release_date = None
        if year:
            release_date = f"{year:04d}-{(start_date.get('month') or 1):02d}-{(start_date.get('day') or 1):02d}"
        cover = item.get("coverImage") or {}
        format_name = item.get("format")
        resolved_type = "movie" if format_name == "MOVIE" else "tv"
        score = item.get("averageScore")
        return CanonicalMetadata(
            provider="anilist",
            provider_id=str(item.get("id", provider_id)),
            media_type=resolved_type,
            title=title,
            original_title=title_data.get("romaji") or title_data.get("native"),
            release_date=release_date,
            release_year=year,
            overview=item.get("description"),
            poster_path=cover.get("extraLarge") or cover.get("large"),
            backdrop_path=item.get("bannerImage"),
            rating=(score / 10) if score is not None else None,
            runtime=item.get("duration"),
            genres=item.get("genres") or [],
            raw_metadata={
                "id": item.get("id"),
                "original_language": "ja",
                "origin_country": ["JP"],
                "format": format_name,
                "episodes": item.get("episodes"),
                "source": "AniList",
            },
        )


anilist_provider = AniListProvider()
