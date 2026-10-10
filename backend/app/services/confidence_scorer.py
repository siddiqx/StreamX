"""Deterministic Confidence Scorer for Media Identification."""

from difflib import SequenceMatcher
import re
from typing import Optional, Tuple
from app.services.metadata_providers.base import CandidateMatch
from app.utils.filename_parser import ParsedMedia


def normalize_title_for_comparison(title: str) -> str:
    """Normalize string for fuzzy comparison: lowercased, punctuation stripped, single spaces."""
    if not title:
        return ""
    s = title.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Leading articles are not identity-bearing in provider titles.
    s = re.sub(r"^(?:the|a|an)\s+", "", s)
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
        overlap = len(words_a & words_b) / min(len(words_a), len(words_b))
        if norm_a in norm_b or norm_b in norm_a or overlap >= 0.99:
            # A contained title is not automatically the same work: "Naruto"
            # and "Naruto Shippuden" are distinct TMDB entities. Article-only
            # differences were already normalized above; keep other partial
            # matches below the automatic-match threshold.
            ratio = max(ratio, 0.75)
        else:
            ratio = max(ratio, (ratio + jaccard) / 2)

    return min(1.0, max(0.0, ratio))


def calculate_match_confidence(parsed: ParsedMedia, candidate: CandidateMatch) -> float:
    """Deterministic multi-factor confidence scoring between 0.0 and 1.0.

    Identity Confidence is based solely on identity-bearing attributes (title,
    original/alternate title, release year, media type). It must NOT depend on
    whether artwork or overview already exists on the search candidate.

    Weights:
    - Primary title similarity: 60%
    - Alternative / Original title match: 15%
    - Year match: 15%
    - Media type match: 10%
    """
    # 1. Title Similarity (0.0 to 1.0) -> Weight 0.60
    title_sim = compute_string_similarity(parsed.clean_title, candidate.title)

    # 2. Alternative / Original Title match -> Weight 0.15
    orig_sim = 0.0
    if candidate.original_title:
        orig_sim = compute_string_similarity(parsed.clean_title, candidate.original_title)
    best_title_factor = max(title_sim, orig_sim)

    # 3. Year Match -> Weight 0.15 (with penalty for major year discrepancy)
    year_score = 0.8  # Neutral default if year unknown in file
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
                year_penalty = 0.20
    elif not parsed.year and candidate.release_year:
        # File has no year, candidate has year - exact title match is strong identity
        year_score = 0.85

    # 4. Media Type Match -> Weight 0.10
    type_score = 1.0 if parsed.media_type == candidate.media_type else 0.2

    # Total identity score calculation
    score = (
        (title_sim * 0.60)
        + (orig_sim * 0.15)
        + (year_score * 0.15)
        + (type_score * 0.10)
        - year_penalty
    )

    # If title match is exact (or orig_title match is exact) and media types align,
    # ensure score reflects strong identity match even if file has no year.
    if best_title_factor == 1.0 and type_score == 1.0 and year_penalty == 0.0:
        score = max(score, 0.92)

    return round(min(1.0, max(0.0, score)), 4)


def is_same_work(c1: CandidateMatch, c2: CandidateMatch) -> bool:
    """Check if two search candidates represent the same underlying creative work across providers or entries."""
    if c1.provider == c2.provider and str(c1.provider_id) == str(c2.provider_id):
        return True

    t1 = normalize_title_for_comparison(c1.title)
    t2 = normalize_title_for_comparison(c2.title)
    if t1 and t1 == t2:
        return True

    ot1 = normalize_title_for_comparison(c1.original_title) if c1.original_title else ""
    ot2 = normalize_title_for_comparison(c2.original_title) if c2.original_title else ""
    if ot1 and ot2 and ot1 == ot2:
        return True

    if (t1 and ot2 and t1 == ot2) or (ot1 and t2 and ot1 == t2):
        return True

    return False


def rank_candidates(
    parsed: ParsedMedia, candidates: list[CandidateMatch], high_threshold: float = 0.86, low_threshold: float = 0.35
) -> Tuple[Optional[CandidateMatch], float, str]:
    """Score all candidates and return (best_candidate, best_score, status).

    Deduplicates candidates that represent the same work before evaluating ambiguity,
    preventing identical anime entries from TMDB and AniList from flagging each other as ambiguous.

    Status outcomes:
    - MATCHED: best_score >= high_threshold and no distinct competing work within 0.02
    - LOW_CONFIDENCE: best_score < high_threshold but >= low_threshold (or multiple close distinct works)
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
        # Find the highest-scoring runner-up candidate that represents a DISTINCT work
        competing_work = None
        for cand, score in scored[1:]:
            if not is_same_work(best_cand, cand):
                competing_work = (cand, score)
                break

        if competing_work and (best_score - competing_work[1]) < 0.02:
            return best_cand, best_score, "LOW_CONFIDENCE"
        return best_cand, best_score, "MATCHED"

    if best_score >= low_threshold:
        return best_cand, best_score, "LOW_CONFIDENCE"

    return best_cand, best_score, "NOT_FOUND"
