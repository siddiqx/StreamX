"""Test suite for folder-driven series renaming and filename updating."""

import pytest
from app.utils.filename_parser import parse_filename, update_filename_title


def test_update_filename_title_alya_series():
    """Verify that renaming a series only replaces the title portion while preserving episode, quality, and tags."""
    orig = "S01-02 Alya [Dual] 1080p @XANIME_UNIVERSE.mkv"
    new_title = "Alya Sometimes Hides Her Feelings in Russian"
    updated = update_filename_title(orig, new_title)
    assert updated == "S01-02 Alya Sometimes Hides Her Feelings in Russian [Dual] 1080p @XANIME_UNIVERSE.mkv"

    # Also test S01-03 and S01-04
    assert update_filename_title("S01-03 Alya [Dual] 1080p @XANIME_UNIVERSE.mkv", new_title) == \
        "S01-03 Alya Sometimes Hides Her Feelings in Russian [Dual] 1080p @XANIME_UNIVERSE.mkv"
    assert update_filename_title("S01-04 Alya [Dual] 1080p @XANIME_UNIVERSE.mkv", new_title) == \
        "S01-04 Alya Sometimes Hides Her Feelings in Russian [Dual] 1080p @XANIME_UNIVERSE.mkv"


def test_update_filename_title_fansub_brackets():
    """Verify title replacement when fansub group brackets are present."""
    orig = "[SubsPlease] Alya - 02 (1080p) [12345678].mkv"
    new_title = "Alya Sometimes Hides Her Feelings in Russian"
    updated = update_filename_title(orig, new_title)
    assert updated == "[SubsPlease] Alya Sometimes Hides Her Feelings in Russian - 02 (1080p) [12345678].mkv"


def test_update_filename_title_standard_s01e01():
    """Verify title replacement with standard S01E01 notation."""
    orig = "Alya S01E02 1080p.mkv"
    new_title = "Alya Sometimes Hides Her Feelings in Russian"
    updated = update_filename_title(orig, new_title)
    assert updated == "Alya Sometimes Hides Her Feelings in Russian S01E02 1080p.mkv"


def test_anime_signals_with_xanime_universe():
    """Verify that @XANIME_UNIVERSE triggers anime detection."""
    from app.utils.media_classifier import has_anime_signals
    parsed = parse_filename("S01-02 Alya [Dual] 1080p @XANIME_UNIVERSE.mkv")
    assert has_anime_signals(parsed, raw_filename="S01-02 Alya [Dual] 1080p @XANIME_UNIVERSE.mkv") is True
