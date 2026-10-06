"""Abstract base class and data structures for StreamX metadata providers."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class CandidateMatch:
    provider: str
    provider_id: str
    title: str
    media_type: str  # "movie" or "tv"
    original_title: Optional[str] = None
    release_date: Optional[str] = None
    release_year: Optional[int] = None
    overview: Optional[str] = None
    poster_path: Optional[str] = None
    backdrop_path: Optional[str] = None
    rating: Optional[float] = None
    genres: List[str] = field(default_factory=list)
    popularity: Optional[float] = None


@dataclass
class CanonicalMetadata:
    provider: str
    provider_id: str
    media_type: str  # "movie" or "tv"
    title: str
    original_title: Optional[str] = None
    release_date: Optional[str] = None
    release_year: Optional[int] = None
    overview: Optional[str] = None
    poster_path: Optional[str] = None
    backdrop_path: Optional[str] = None
    rating: Optional[float] = None
    runtime: Optional[int] = None
    genres: List[str] = field(default_factory=list)
    raw_metadata: Dict[str, Any] = field(default_factory=dict)

    def full_poster_url(self, size: str = "w500") -> Optional[str]:
        if not self.poster_path:
            return None
        if self.poster_path.startswith("http://") or self.poster_path.startswith("https://"):
            return self.poster_path
        clean_path = self.poster_path.lstrip("/")
        return f"https://image.tmdb.org/t/p/{size}/{clean_path}"

    def full_backdrop_url(self, size: str = "w1280") -> Optional[str]:
        if not self.backdrop_path:
            return None
        if self.backdrop_path.startswith("http://") or self.backdrop_path.startswith("https://"):
            return self.backdrop_path
        clean_path = self.backdrop_path.lstrip("/")
        return f"https://image.tmdb.org/t/p/{size}/{clean_path}"


class MetadataProvider(ABC):
    """Abstract interface for external media metadata providers."""

    @abstractmethod
    def is_configured(self) -> bool:
        """Return True if required API credentials exist."""
        pass

    @abstractmethod
    async def search(
        self, query: str, year: Optional[int] = None, media_type: str = "movie"
    ) -> List[CandidateMatch]:
        """Search for candidates by title, optional year, and media type."""
        pass

    @abstractmethod
    async def get_details(
        self, provider_id: str, media_type: str = "movie"
    ) -> Optional[CanonicalMetadata]:
        """Retrieve full canonical details by provider identifier."""
        pass
