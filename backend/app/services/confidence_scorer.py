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
    # Normalize ampersands to 'and'
    s = re.sub(r"\s*&\s*", " and ", s)
    # Strip apostrophes so contractions match uncontracted words (He's -> hes, World's -> worlds)
    s = re.sub(r"['’`]", "", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Leading articles are not identity-bearing in provider titles.
    s = re.sub(r"^(?:the|a|an)\s+", "", s)
    return s


def compute_string_similarity(a: str, b: str) -> float:
    """Compute similarity ratio between 0.0 and 1.0 using SequenceMatcher and token prefix analysis."""
    norm_a = normalize_title_for_comparison(a)
    norm_b = normalize_title_for_comparison(b)
    if not norm_a or not norm_b:
        return 0.0
    if norm_a == norm_b:
        return 1.0

    ratio = SequenceMatcher(None, norm_a, norm_b).ratio()

    # Substring / leading prefix analysis
    words_a = norm_a.split()
    words_b = norm_b.split()
    orig_a = [re.sub(r"['’`]", "", w.lower()) for w in a.split()]
    orig_b = [re.sub(r"['’`]", "", w.lower()) for w in b.split()]
    set_a = set(words_a)
    set_b = set(words_b)

    shorter_words, longer_words = (words_a, words_b) if len(words_a) < len(words_b) else (words_b, words_a)
    shorter_orig, longer_orig = (orig_a, orig_b) if len(orig_a) < len(orig_b) else (orig_b, orig_a)

    # Check if the shorter title is a multi-word leading prefix of the longer title
    # (e.g. "Trapped in a Dating Sim" -> "Trapped in a Dating Sim: The World of Otome Games...",
    #       "The Daily Life" -> "The Daily Life of the Immortal King",
    #       "The Fragrant Flower" -> "The Fragrant Flower Blooms with Dignity",
    #       "The Promised" -> "The Promised Neverland")
    is_leading_prefix = (
        (len(shorter_words) >= 2 and longer_words[:len(shorter_words)] == shorter_words)
        or (len(shorter_orig) >= 2 and longer_orig[:len(shorter_orig)] == shorter_orig)
    )

    if is_leading_prefix:
        ratio = max(ratio, 0.92)
    elif norm_a in norm_b or norm_b in norm_a:
        ratio = max(ratio, 0.75)
    elif set_a and set_b:
        jaccard = len(set_a & set_b) / len(set_a | set_b)
        ratio = max(ratio, (ratio + jaccard) / 2)

    return min(1.0, max(0.0, ratio))


def calculate_match_confidence(parsed: ParsedMedia, candidate: CandidateMatch) -> float:
    """Deterministic multi-factor confidence scoring between 0.0 and 1.0.

    Identity Confidence is based on identity-bearing attributes (title,
    original/alternate title, release year, media type).

    Weights:
    - Primary or original/alternate title match: 75%
    - Year match: 15%
    - Media type match: 10%
    """
    # 1. Title Similarity (0.0 to 1.0) -> Weight 0.75
    title_sim = compute_string_similarity(parsed.clean_title, candidate.title)
    orig_sim = 0.0
    if candidate.original_title:
        orig_sim = compute_string_similarity(parsed.clean_title, candidate.original_title)
    best_title_factor = max(title_sim, orig_sim)

    # 2. Year Match -> Weight 0.15 (with penalty for major year discrepancy)
    year_score = 0.85  # Neutral default if year unknown in file
    year_penalty = 0.0
    if parsed.year and candidate.release_year:
        diff = abs(parsed.year - candidate.release_year)
        if diff == 0:
            year_score = 1.0
        elif diff == 1:
            year_score = 0.80
        elif diff <= 2:
            year_score = 0.40
        else:
            year_score = 0.0
            if diff > 3:
                year_penalty = 0.20
    elif not parsed.year and candidate.release_year:
        # File has no year, candidate has year - exact title match is strong identity
        year_score = 0.85

    # 3. Media Type Match -> Weight 0.10
    type_score = 1.0 if parsed.media_type == candidate.media_type else 0.20

    # Season discrepancy check:
    # If the file explicitly specifies a season (e.g. S01), and the candidate title
    # contains an explicit season marker (e.g. "Season 2", "Season 3", "Part 2"):
    season_penalty = 0.0
    if parsed.season is not None:
        cand_season_match = re.search(r"(?i)\b(?:Season|S|Part)\s*(\d{1,2})\b", candidate.title)
        if cand_season_match:
            cand_s = int(cand_season_match.group(1))
            if cand_s != parsed.season:
                season_penalty = 0.15

    # Total identity score calculation
    score = (
        (best_title_factor * 0.75)
        + (year_score * 0.15)
        + (type_score * 0.10)
        - year_penalty
        - season_penalty
    )

    # Strong identity boost for high title matches
    if best_title_factor >= 0.95 and type_score == 1.0 and year_penalty == 0.0 and season_penalty == 0.0:
        score = max(score, 0.94)
    elif best_title_factor >= 0.88 and type_score == 1.0 and year_penalty == 0.0 and season_penalty == 0.0:
        score = max(score, 0.88)

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
    parsed: ParsedMedia,
    candidates: list[CandidateMatch],
    high_threshold: float = 0.86,
    low_threshold: float = 0.35,
) -> Tuple[Optional[CandidateMatch], float, str]:
    """Score all candidates and return (best_candidate, best_score, status).

    Deduplicates candidates that represent the same work before evaluating ambiguity,
    preventing identical anime entries from TMDB and AniList from flagging each other as ambiguous.

    Status outcomes:
    - MATCHED: best_score >= high_threshold and no distinct competing work within calibrated margin
    - LOW_CONFIDENCE: best_score < high_threshold but >= low_threshold (or multiple close distinct works)
    - NOT_FOUND: no candidates or best_score < low_threshold
    """
    if not candidates:
        return None, 0.0, "NOT_FOUND"

    scored: list[Tuple[CandidateMatch, float]] = []
    for cand in candidates:
        s = calculate_match_confidence(parsed, cand)
        scored.append((cand, s))

    # Sort descending by score, tiebreak by available artwork and popularity
    scored.sort(
        key=lambda x: (
            x[1],
            bool(x[0].poster_path or x[0].backdrop_path),
            x[0].popularity or 0.0,
        ),
        reverse=True,
    )
    best_cand, best_score = scored[0]

    if best_score >= high_threshold:
        # Find the highest-scoring runner-up candidate that represents a DISTINCT work
        competing_work = None
        for cand, score in scored[1:]:
            if not is_same_work(best_cand, cand):
                best_pop = best_cand.popularity or 0.0
                cand_pop = cand.popularity or 0.0
                # Filter out obscure stubs with negligible popularity when best_cand is a major work
                if best_pop >= 5.0 and cand_pop < (best_pop * 0.20) and (best_pop - cand_pop) >= 10.0:
                    continue
                competing_work = (cand, score)
                break

        # Dynamic ambiguity margin: tighter for high-confidence exact matches, wider for borderline matches
        required_margin = 0.02 if best_score >= 0.92 else 0.04
        if getattr(parsed, "is_ambiguous", False) and best_score < 0.95:
            return best_cand, best_score, "LOW_CONFIDENCE"

        if competing_work and (best_score - competing_work[1]) < required_margin:
            return best_cand, best_score, "LOW_CONFIDENCE"
        return best_cand, best_score, "MATCHED"

    if best_score >= low_threshold:
        return best_cand, best_score, "LOW_CONFIDENCE"

    return best_cand, best_score, "NOT_FOUND"

