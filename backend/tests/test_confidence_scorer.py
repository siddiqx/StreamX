"""Tests for deterministic confidence scoring algorithm."""

from app.services.confidence_scorer import calculate_match_confidence, rank_candidates
from app.services.metadata_providers.base import CandidateMatch
from app.utils.filename_parser import ParsedMedia


def test_exact_match_high_confidence():
    parsed = ParsedMedia(
        raw_filename="Interstellar.2014.1080p.mkv",
        clean_title="Interstellar",
        year=2014,
        media_type="movie",
    )
    cand = CandidateMatch(
        provider="tmdb",
        provider_id="157336",
        title="Interstellar",
        media_type="movie",
        release_year=2014,
        poster_path="/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
        overview="The adventures of a group of explorers...",
    )
    score = calculate_match_confidence(parsed, cand)
    assert score >= 0.90
    best_cand, best_score, status = rank_candidates(parsed, [cand])
    assert status == "MATCHED"
    assert best_score >= 0.90


def test_year_disambiguation_dune():
    parsed = ParsedMedia(
        raw_filename="Dune.2021.1080p.mkv",
        clean_title="Dune",
        year=2021,
        media_type="movie",
    )
    cand_1984 = CandidateMatch(
        provider="tmdb",
        provider_id="841",
        title="Dune",
        media_type="movie",
        release_year=1984,
        poster_path="/dune1984.jpg",
        overview="In the year 10191...",
    )
    cand_2021 = CandidateMatch(
        provider="tmdb",
        provider_id="438631",
        title="Dune",
        media_type="movie",
        release_year=2021,
        poster_path="/dune2021.jpg",
        overview="Paul Atreides, a brilliant and gifted young man...",
    )
    score_1984 = calculate_match_confidence(parsed, cand_1984)
    score_2021 = calculate_match_confidence(parsed, cand_2021)

    assert score_2021 > score_1984
    assert score_2021 >= 0.90
    assert score_1984 < 0.75

    best_cand, best_score, status = rank_candidates(parsed, [cand_1984, cand_2021])
    assert best_cand.provider_id == "438631"
    assert status == "MATCHED"


def test_low_confidence_and_not_found():
    parsed = ParsedMedia(
        raw_filename="Random.Unrelated.File.2025.mkv",
        clean_title="Random Unrelated File",
        year=2025,
        media_type="movie",
    )
    cand = CandidateMatch(
        provider="tmdb",
        provider_id="999",
        title="Something Else Entirely",
        media_type="movie",
        release_year=1990,
    )
    score = calculate_match_confidence(parsed, cand)
    assert score < 0.50
    _, _, status = rank_candidates(parsed, [cand])
    assert status == "NOT_FOUND"
