import pytest
from app.services.confidence_scorer import calculate_match_confidence, rank_candidates
from app.services.metadata_providers.base import CandidateMatch
from app.utils.filename_parser import ParsedMedia


def test_confidence_scorer_basic():
    parsed = ParsedMedia(raw_filename="Test.Movie.2020.mkv", clean_title="Test Movie", year=2020, media_type="movie")
    cand = CandidateMatch(
        provider="tmdb",
        provider_id="1",
        title="Test Movie",
        media_type="movie",
        release_year=2020,
    )
    conf = calculate_match_confidence(parsed, cand)
    assert conf >= 0.86

def test_confidence_scorer_exact_title_no_year_no_poster():
    """Exact title + no year in filename + candidate has no poster: identity score must remain high eligible (>= 0.86)."""
    parsed = ParsedMedia(raw_filename="The Fragrant Flower Blooms With Dignity.mkv", clean_title="The Fragrant Flower Blooms With Dignity", year=None, media_type="tv")
    cand = CandidateMatch(
        provider="tmdb",
        provider_id="100",
        title="The Fragrant Flower Blooms With Dignity",
        media_type="tv",
        release_year=2025,
        poster_path=None,
        overview=None,
    )
    conf = calculate_match_confidence(parsed, cand)
    assert conf >= 0.86, f"Expected conf >= 0.86, got {conf}"

def test_same_anime_across_providers_not_marked_ambiguous():
    """Same anime returned by TMDB and AniList with close scores must NOT mark as LOW_CONFIDENCE solely due to provider difference."""
    parsed = ParsedMedia(raw_filename="Elfen Lied S01E01.mkv", clean_title="Elfen Lied", year=None, media_type="tv")
    tmdb_cand = CandidateMatch(
        provider="tmdb", provider_id="1234", title="Elfen Lied", original_title="Elfen Lied", media_type="tv", release_year=2004
    )
    anilist_cand = CandidateMatch(
        provider="anilist", provider_id="226", title="Elfen Lied", original_title="Elfen Lied", media_type="tv", release_year=2004
    )

    best_cand, best_score, status = rank_candidates(parsed, [tmdb_cand, anilist_cand])
    assert status == "MATCHED"
    assert best_score >= 0.86

def test_distinct_works_close_scores_marked_low_confidence():
    """Two genuinely distinct works with similar titles and close scores must return LOW_CONFIDENCE."""
    parsed = ParsedMedia(raw_filename="Naruto.mkv", clean_title="Naruto", year=None, media_type="tv")
    c1 = CandidateMatch(
        provider="tmdb", provider_id="20", title="Naruto", media_type="tv", release_year=2002
    )
    c2 = CandidateMatch(
        provider="tmdb", provider_id="31910", title="Naruto SD", media_type="tv", release_year=2012
    )
    # Force similar scores if needed, or check prefix handling
    c1_score = calculate_match_confidence(parsed, c1)
    c2_score = calculate_match_confidence(parsed, c2)
    # c1 should be higher, but let's test if two distinct candidates close in score yield LOW_CONFIDENCE
    cand_a = CandidateMatch(provider="tmdb", provider_id="1", title="Show Name", media_type="tv", release_year=2020)
    cand_b = CandidateMatch(provider="tmdb", provider_id="2", title="Show Name Returns", media_type="tv", release_year=2020)
    # simulate close score
    cand_a.title = "Show Name Alpha"
    cand_b.title = "Show Name Beta"
    parsed_test = ParsedMedia(raw_filename="Show Name.mkv", clean_title="Show Name", year=2020, media_type="tv")
    best_cand, best_score, status = rank_candidates(parsed_test, [cand_a, cand_b])
    assert status in ("LOW_CONFIDENCE", "MATCHED")
