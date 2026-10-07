"""The Movie Database (TMDB) metadata provider implementation for StreamX."""

import asyncio
from typing import Any, Dict, List, Optional
import httpx

from app.config.settings import settings
from app.services.metadata_providers.base import CandidateMatch, CanonicalMetadata, MetadataProvider
from app.utils.logging import log_event, logger

TMDB_BASE_URL = "https://api.tmdb.org/3"
TMDB_FALLBACK_URL = "https://api.themoviedb.org/3"



class TMDBProvider(MetadataProvider):
    """TMDB Provider communicating securely server-side with TMDB API v3."""

    def __init__(self, api_key: Optional[str] = None):
        self._api_key = api_key or settings.TMDB_API_KEY

    def is_configured(self) -> bool:
        key = self._get_key()
        return bool(key and key.strip())

    def _get_key(self) -> Optional[str]:
        return self._api_key or settings.TMDB_API_KEY

    def _get_headers_and_params(self, params: Optional[Dict[str, Any]] = None) -> (Dict[str, str], Dict[str, Any]):
        key = self._get_key()
        headers = {"User-Agent": "StreamX/1.0", "Accept": "application/json"}
        req_params = dict(params or {})

        if not key:
            return headers, req_params

        # If key is long (TMDB v4 Bearer Read Access Token)
        if len(key) > 50:
            headers["Authorization"] = f"Bearer {key}"
        else:
            req_params["api_key"] = key

        return headers, req_params

    async def _request(
        self, endpoint: str, params: Optional[Dict[str, Any]] = None, max_retries: int = 2
    ) -> Optional[Dict[str, Any]]:
        if not self.is_configured():
            logger.warning("TMDBProvider requested but TMDB_API_KEY is not configured.")
            return None

        url = f"{TMDB_BASE_URL}{endpoint}"
        headers, req_params = self._get_headers_and_params(params)

        for attempt in range(max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    res = await client.get(url, headers=headers, params=req_params)

                    if res.status_code == 200:
                        return res.json()

                    if res.status_code == 429:
                        retry_after = float(res.headers.get("Retry-After", 1.5))
                        log_event("TMDB_RATE_LIMITED", retry_after=retry_after, attempt=attempt)
                        if attempt < max_retries:
                            await asyncio.sleep(retry_after)
                            continue
                        return None

                    if res.status_code == 404:
                        return None

                    if res.status_code in (401, 403):
                        logger.error(f"TMDB authentication error (HTTP {res.status_code}): Invalid or inactive API key.")
                        return None

                    logger.warning(f"TMDB API error {res.status_code} for {endpoint}: {res.text[:200]}")
                    if attempt < max_retries and res.status_code >= 500:
                        await asyncio.sleep(1.0 * (attempt + 1))
                        continue
                    return None

            except (httpx.TimeoutException, httpx.NetworkError) as net_err:
                logger.warning(f"Network error querying TMDB {endpoint}: {net_err}")
                if attempt < max_retries:
                    await asyncio.sleep(1.0 * (attempt + 1))
                    continue
                return None
            except Exception as e:
                logger.error(f"Unexpected exception calling TMDB {endpoint}: {e}", exc_info=True)
                return None

        return None

    async def search(
        self, query: str, year: Optional[int] = None, media_type: str = "movie"
    ) -> List[CandidateMatch]:
        """Search TMDB for candidates by title, optional year, and media type."""
        clean_query = query.strip()
        if not clean_query:
            return []

        endpoint = "/search/movie" if media_type == "movie" else "/search/tv"
        params: Dict[str, Any] = {
            "query": clean_query,
            "include_adult": "false",
            "language": "en-US",
            "page": 1,
        }
        if year:
            if media_type == "movie":
                params["year"] = str(year)
            else:
                params["first_air_date_year"] = str(year)

        data = await self._request(endpoint, params=params)
        results = data.get("results", []) if data else []

        # If zero results with year, retry search without year constraint
        if not results and year:
            fallback_params = dict(params)
            fallback_params.pop("year", None)
            fallback_params.pop("first_air_date_year", None)
            data_fallback = await self._request(endpoint, params=fallback_params)
            results = data_fallback.get("results", []) if data_fallback else []

        # Normalize release-name punctuation before giving up on the directed search.
        if not results:
            normalized_query = re.sub(r"[._-]+", " ", clean_query)
            normalized_query = re.sub(r"\\s+", " ", normalized_query).strip()
            if normalized_query and normalized_query.casefold() != clean_query.casefold():
                normalized_params = {
                    "query": normalized_query,
                    "include_adult": "false",
                    "language": "en-US",
                    "page": 1,
                }
                if year:
                    if media_type == "movie":
                        normalized_params["year"] = str(year)
                    else:
                        normalized_params["first_air_date_year"] = str(year)
                normalized_data = await self._request(endpoint, params=normalized_params)
                results = normalized_data.get("results", []) if normalized_data else []

        # Rescue with multi-search whenever directed search produced too few candidates.
        if len(results) < 5:
            multi_params = {
                "query": clean_query,
                "include_adult": "false",
                "language": "en-US",
                "page": 1,
            }
            multi_data = await self._request("/search/multi", params=multi_params)
            if multi_data:
                existing = {
                    ((r.get("media_type") or media_type), str(r.get("id")))
                    for r in results
                    if r.get("id") is not None
                }
                for candidate in multi_data.get("results", []):
                    candidate_type = candidate.get("media_type")
                    candidate_id = candidate.get("id")
                    if candidate_type not in ("movie", "tv") or candidate_id is None:
                        continue
                    key = (candidate_type, str(candidate_id))
                    if key not in existing:
                        results.append(candidate)
                        existing.add(key)

        # If still zero results and query has multiple words, progressively trim trailing tokens
        if not results and len(clean_query.split()) > 1:
            words = clean_query.split()
            for drop_count in range(1, min(3, len(words))):
                sub_query = " ".join(words[:-drop_count]).strip()
                if len(sub_query) >= 3:
                    sub_data = await self._request("/search/multi", params={"query": sub_query, "include_adult": "false", "language": "en-US"})
                    if sub_data and sub_data.get("results"):
                        results = [r for r in sub_data.get("results", []) if r.get("media_type") in ("movie", "tv")]
                        if results:
                            break

        candidates: List[CandidateMatch] = []
        for item in results:
            cand_type = item.get("media_type") or media_type
            title = item.get("title") or item.get("name") or clean_query
            orig_title = item.get("original_title") or item.get("original_name")
            date_str = item.get("release_date") or item.get("first_air_date") or ""
            res_year = int(date_str[:4]) if date_str and len(date_str) >= 4 and date_str[:4].isdigit() else None
            vote = float(item.get("vote_average", 0)) if item.get("vote_average") else None

            candidates.append(
                CandidateMatch(
                    provider="tmdb",
                    provider_id=str(item.get("id")),
                    title=title,
                    media_type=cand_type,
                    original_title=orig_title,
                    release_date=date_str or None,
                    release_year=res_year,
                    overview=item.get("overview"),
                    poster_path=item.get("poster_path"),
                    backdrop_path=item.get("backdrop_path"),
                    rating=round(vote, 1) if vote is not None else None,
                    popularity=float(item.get("popularity", 0)),
                )
            )

        return candidates

    async def get_details(
        self, provider_id: str, media_type: str = "movie"
    ) -> Optional[CanonicalMetadata]:
        """Fetch full details from TMDB including genres, runtime, and ratings."""
        endpoint = f"/{media_type}/{provider_id}"
        data = await self._request(endpoint, params={"language": "en-US"})
        if not data:
            return None

        title = data.get("title") or data.get("name") or "Unknown"
        orig_title = data.get("original_title") or data.get("original_name")
        date_str = data.get("release_date") or data.get("first_air_date") or ""
        year = int(date_str[:4]) if date_str and len(date_str) >= 4 and date_str[:4].isdigit() else None

        genres = [g["name"] for g in data.get("genres", []) if "name" in g]

        # Extract runtime
        runtime = data.get("runtime")
        if not runtime and data.get("episode_run_time"):
            ep_runtimes = data.get("episode_run_time")
            if isinstance(ep_runtimes, list) and ep_runtimes:
                runtime = ep_runtimes[0]

        vote = float(data.get("vote_average", 0)) if data.get("vote_average") else None

        return CanonicalMetadata(
            provider="tmdb",
            provider_id=str(data.get("id", provider_id)),
            media_type=media_type,
            title=title,
            original_title=orig_title,
            release_date=date_str or None,
            release_year=year,
            overview=data.get("overview"),
            poster_path=data.get("poster_path"),
            backdrop_path=data.get("backdrop_path"),
            rating=round(vote, 1) if vote is not None else None,
            runtime=runtime,
            genres=genres,
            raw_metadata=data,
        )


tmdb_provider = TMDBProvider()
