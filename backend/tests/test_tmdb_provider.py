"""Regression tests for TMDB request routing and resilient title normalization."""

from unittest.mock import AsyncMock

import pytest

from app.services.metadata_providers.tmdb import TMDBProvider


@pytest.mark.asyncio
async def test_tmdb_request_uses_official_api_host(monkeypatch):
    requested = {}

    class FakeResponse:
        status_code = 200

        def json(self):
            return {"results": []}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, **kwargs):
            requested["url"] = url
            requested["kwargs"] = kwargs
            return FakeResponse()

    monkeypatch.setattr("app.services.metadata_providers.tmdb.httpx.AsyncClient", FakeClient)
    provider = TMDBProvider(api_key="test-key")

    response = await provider._request("/search/movie", {"query": "Example Feature"})

    assert response == {"results": []}
    assert requested["url"] == "https://api.themoviedb.org/3/search/movie"
    assert requested["kwargs"]["params"]["api_key"] == "test-key"


@pytest.mark.asyncio
async def test_search_retries_with_normalized_title_punctuation(monkeypatch):
    provider = TMDBProvider(api_key="test-key")
    candidate = {
        "id": 123,
        "media_type": "movie",
        "title": "Example Feature",
        "release_date": "2024-01-01",
        "overview": "An example feature film.",
        "poster_path": "/poster.jpg",
    }
    request = AsyncMock(side_effect=[None, {"results": [candidate]}, None])
    monkeypatch.setattr(provider, "_request", request)

    results = await provider.search("Example.Feature", media_type="movie")

    assert len(results) == 1
    assert results[0].provider_id == "123"
    assert request.await_args_list[1].kwargs["params"]["query"] == "Example Feature"
