"""Deterministic Confidence Scorer for Media Identification."""

from difflib import SequenceMatcher
import re
from typing import Optional, Tuple
from app.services.metadata_providers.base import CandidateMatch
from app.utils.filename_parser import ParsedMedia


def normalize_title_for_comparison(title: str) -> str:
    """Normalize string for fuzzy comparison: lowercased, punctuation stripped, single spaces."""
    s = title.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def compute_string_similarity(a: str, b: str) -> float:
    """Compute similarity ratio between 0.0 and 1.0 using SequenceMatcher."""
    norm_a = normalize_title_for_comparison(a)
    norm_b = normalize_title_for_comparison(b)
    if not norm_a or not norm_b:
        return 0.0
    if norm_a == norm_b:
        return 1.0

    ratio = SequenceMatcher(None, norm_a, norm_b).ratio()

    # Substring bonus: if one title is completely contained in the other
    words_a = set(norm_a.split())
    words_b = set(norm_b.split())
    if words_a and words_b:
        jaccard = len(words_a & words_b) / len(words_a | words_b)
        ratio = max(ratio, (ratio + jaccard) / 2)

    return min(1.0, max(0.0, ratio))


def calculate_match_confidence(parsed: ParsedMedia, candidate: CandidateMatch) -> float:
    """Deterministic multi-factor confidence scoring between 0.0 and 1.0.

    Weights:
    - Primary title similarity: 50%
    - Year match: 25%
    - Media type match: 10%
    - Alternative / Original title match: 10%
    - Artwork / Popularity signal: 5%
    """
    # 1. Title Similarity (0.0 to 1.0) -> Weight 0.50
    title_sim = compute_string_similarity(parsed.clean_title, candidate.title)

    # 2. Alternative / Original Title match -> Weight 0.10
    orig_sim = 0.0
    if candidate.original_title:
        orig_sim = compute_string_similarity(parsed.clean_title, candidate.original_title)
    best_title_factor = max(title_sim, orig_sim)

    # 3. Year Match -> Weight 0.25 (with penalty for major year discrepancy)
    year_score = 0.5  # Neutral default if year unknown in either
    year_penalty = 0.0
    if parsed.year and candidate.release_year:
        diff = abs(parsed.year - candidate.release_year)
        if diff == 0:
            year_score = 1.0
        elif diff == 1:
            year_score = 0.75
        elif diff <= 2:
            year_score = 0.3
        else:
            year_score = 0.0
            if diff > 3:
                year_penalty = 0.15
    elif not parsed.year and candidate.release_year:
        # File has no year, candidate has year
        year_score = 0.6

    # 4. Media Type Match -> Weight 0.10
    type_score = 1.0 if parsed.media_type == candidate.media_type else 0.2

    # 5. Artwork and Data Completeness -> Weight 0.05
    bonus = 0.0
    if candidate.poster_path:
        bonus += 0.03
    if candidate.overview:
        bonus += 0.02

    # Total score calculation
    score = (
        (best_title_factor * 0.50)
        + (year_score * 0.25)
        + (type_score * 0.10)
        + (max(orig_sim, title_sim) * 0.10)
        + bonus
        - year_penalty
    )

    return round(min(1.0, max(0.0, score)), 4)


def rank_candidates(
    parsed: ParsedMedia, candidates: list[CandidateMatch], high_threshold: float = 0.85, low_threshold: float = 0.65
) -> Tuple[Optional[CandidateMatch], float, str]:
    """Score all candidates and return (best_candidate, best_score, status).

    Status outcomes:
    - MATCHED: best_score >= high_threshold
    - LOW_CONFIDENCE: best_score < high_threshold but >= low_threshold (or multiple close candidates)
    - NOT_FOUND: no candidates or best_score < low_threshold
    """
    if not candidates:
        return None, 0.0, "NOT_FOUND"

    scored: list[Tuple[CandidateMatch, float]] = []
    for cand in candidates:
        s = calculate_match_confidence(parsed, cand)
        scored.append((cand, s))

    # Sort descending by score, tiebreak by popularity
    scored.sort(key=lambda x: (x[1], x[0].popularity or 0.0), reverse=True)
    best_cand, best_score = scored[0]

    if best_score >= high_threshold:
        # Check if 2nd candidate is virtually identical score but completely different ID
        if len(scored) > 1 and (best_score - scored[1][1]) < 0.02:
            return best_cand, best_score, "LOW_CONFIDENCE"
        return best_cand, best_score, "MATCHED"

    if best_score >= low_threshold:
        return best_cand, best_score, "LOW_CONFIDENCE"

    return best_cand, best_score, "NOT_FOUND"
