"""Unit tests for StreamX Deterministic Filename Parser.

Covers movies, TV series, anime episodes, anime movies, and the specific
bracketed/prefixed formats sent through the Telegram bot.
"""

import pytest
from app.utils.filename_parser import parse_filename


# ---------------------------------------------------------------------------
# Movies
# ---------------------------------------------------------------------------

def test_interstellar_movie():
    p = parse_filename("Interstellar.2014.1080p.BluRay.x264.mkv")
    assert p.clean_title == "Interstellar"
    assert p.year == 2014
    assert p.media_type == "movie"
    assert p.quality == "1080p"


def test_interstellar_with_release_group():
    p = parse_filename("Interstellar.2014.1080p.BluRay.x264-GROUP.mkv")
    assert p.clean_title == "Interstellar"
    assert p.year == 2014
    assert p.media_type == "movie"
    assert p.release_group == "GROUP"


def test_the_matrix():
    p = parse_filename("The.Matrix.1999.1080p.BluRay.mkv")
    assert p.clean_title == "The Matrix"
    assert p.year == 1999
    assert p.media_type == "movie"


def test_dune_part_two():
    p = parse_filename("Dune.Part.Two.2024.2160p.WEB-DL.mkv")
    assert p.clean_title == "Dune Part Two"
    assert p.year == 2024
    assert p.media_type == "movie"
    assert p.quality == "4K UHD"


def test_dune_part_two_underscores():
    p = parse_filename("Dune_Part_Two_2024.mkv")
    assert p.clean_title == "Dune Part Two"
    assert p.year == 2024
    assert p.media_type == "movie"


def test_dune_2021():
    p = parse_filename("Dune.2021.1080p.mkv")
    assert p.clean_title == "Dune"
    assert p.year == 2021
    assert p.media_type == "movie"


def test_channel_tagged_movie():
    p = parse_filename("@Hk.Your.Name.2016.720p.BluRay.Dual-Audio.x264.Esub.mkv")
    assert p.clean_title == "Your Name"
    assert p.year == 2016
    assert p.media_type == "movie"
    assert p.quality == "720p"


def test_future_year_unknown():
    p = parse_filename("Unknown.Movie.2026.1080p.mkv")
    assert p.clean_title == "Unknown Movie"
    assert p.year == 2026
    assert p.media_type == "movie"


# ---------------------------------------------------------------------------
# TV Series — standard S01E01 patterns
# ---------------------------------------------------------------------------

def test_breaking_bad_s01e01():
    p = parse_filename("Breaking.Bad.S01E01.1080p.WEB-DL.mkv")
    assert p.clean_title == "Breaking Bad"
    assert p.season == 1
    assert p.episode == 1
    assert p.media_type == "tv"


def test_breaking_bad_s05e16():
    p = parse_filename("Breaking.Bad.S05E16.1080p.mkv")
    assert p.clean_title == "Breaking Bad"
    assert p.season == 5
    assert p.episode == 16
    assert p.media_type == "tv"


def test_attack_on_titan_s04e28():
    p = parse_filename("Attack.on.Titan.S04E28.1080p.mkv")
    assert p.clean_title == "Attack on Titan"
    assert p.season == 4
    assert p.episode == 28
    assert p.media_type == "tv"


def test_one_piece_s01e1100():
    p = parse_filename("One.Piece.S01E1100.1080p.mkv")
    assert p.clean_title == "One Piece"
    assert p.season == 1
    assert p.episode == 1100
    assert p.media_type == "tv"


# ---------------------------------------------------------------------------
# TV Series — 1x01 format
# ---------------------------------------------------------------------------

def test_locke_and_key_1x01():
    """Regression test: '1x01 Locke and Key.mkv' must resolve as TV, not movie."""
    p = parse_filename("1x01 Locke and Key.mkv")
    assert p.clean_title == "Locke and Key"
    assert p.season == 1
    assert p.episode == 1
    assert p.media_type == "tv"


def test_1x01_prefix():
    p = parse_filename("2x05 The Witcher.mkv")
    assert p.clean_title == "The Witcher"
    assert p.season == 2
    assert p.episode == 5
    assert p.media_type == "tv"


# ---------------------------------------------------------------------------
# TV Series — Season N Episode N / S-01 EP-01 / [S 01] [EP 01]
# ---------------------------------------------------------------------------

def test_season_episode_keyword():
    p = parse_filename("Game.of.Thrones.Season.3.Episode.9.1080p.mkv")
    assert p.clean_title == "Game of Thrones"
    assert p.season == 3
    assert p.episode == 9
    assert p.media_type == "tv"


def test_bracketed_s01_ep01():
    """Regression test: '[] [S 01] [EP 01] [] Elfen Lied.mkv' must detect TV."""
    p = parse_filename("[] [S 01] [EP 01] [] Elfen Lied.mkv")
    assert p.clean_title == "Elfen Lied"
    assert p.season == 1
    assert p.episode == 1
    assert p.media_type == "tv"


def test_bracketed_s_ep_no_leading_bracket():
    p = parse_filename("[S 02] [EP 05] Demon Slayer.mkv")
    assert p.clean_title == "Demon Slayer"
    assert p.season == 2
    assert p.episode == 5
    assert p.media_type == "tv"


# ---------------------------------------------------------------------------
# Anime — fansub bracket / hyphen episode formats
# ---------------------------------------------------------------------------

def test_anime_fansub_brackets():
    p = parse_filename("[GROUP] Attack on Titan - 01 [1080p].mkv")
    assert p.clean_title == "Attack on Titan"
    assert p.season == 1
    assert p.episode == 1
    assert p.media_type == "tv"
    assert p.release_group == "GROUP"


def test_one_piece_numeric_ep():
    """Trailing bare number as episode (common anime pattern)."""
    p = parse_filename("One.Piece.1100.1080p.mkv")
    assert p.clean_title == "One Piece"
    assert p.season == 1
    assert p.episode == 1100
    assert p.media_type == "tv"


def test_anime_ep_leading():
    p = parse_filename("EP09 - The Fragrant Flower [1080p] AnimeDynasty.mkv")
    assert p.clean_title == "The Fragrant Flower"
    assert p.season == 1
    assert p.episode == 9
    assert p.media_type == "tv"
    assert p.quality == "1080p"


def test_standalone_episode_with_bracket_sub():
    p = parse_filename("Fragrant Flower E08 [1080p Sub].mkv")
    assert p.clean_title == "Fragrant Flower"
    assert p.season == 1
    assert p.episode == 8
    assert p.media_type == "tv"
    assert p.quality == "1080p"


def test_subsplease_style():
    """SubsPlease release: [SubsPlease] Title - 12 (1080p) [hash].mkv"""
    p = parse_filename("[SubsPlease] Spy x Family - 12 (1080p) [ABC123].mkv")
    assert p.clean_title == "Spy x Family"
    assert p.episode == 12
    assert p.season == 1
    assert p.media_type == "tv"


def test_horriblesubs_style():
    p = parse_filename("[HorribleSubs] My Hero Academia - 100 [720p].mkv")
    assert p.clean_title == "My Hero Academia"
    assert p.episode == 100
    assert p.season == 1
    assert p.media_type == "tv"


# ---------------------------------------------------------------------------
# Release group extraction
# ---------------------------------------------------------------------------

def test_trailing_group_hyphen():
    p = parse_filename("Interstellar.2014.1080p.BluRay.x264-GROUP.mkv")
    assert p.release_group == "GROUP"


def test_leading_bracket_group():
    p = parse_filename("[GROUP] Attack on Titan - 01 [1080p].mkv")
    assert p.release_group == "GROUP"


def test_no_release_group_plain_movie():
    p = parse_filename("The.Matrix.1999.1080p.BluRay.mkv")
    assert p.release_group is None


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_empty_leading_brackets_stripped():
    """Leading empty [] should not leave garbage in title."""
    p = parse_filename("[] Naruto - 01 [1080p].mkv")
    assert p.clean_title == "Naruto"
    assert p.episode == 1
    assert p.media_type == "tv"


def test_year_not_confused_with_episode():
    """A 4-digit year (e.g. 2024) must not be treated as an episode number."""
    p = parse_filename("Dune.2024.1080p.mkv")
    assert p.year == 2024
    assert p.episode is None
    assert p.media_type == "movie"


def test_no_false_positive_episode_on_movie():
    """Bit-depth or resolution numbers (264, 265, 1080) must not become episodes."""
    p = parse_filename("Avengers.Endgame.2019.2160p.HEVC.x265.mkv")
    assert p.clean_title == "Avengers Endgame"
    assert p.year == 2019
    assert p.episode is None
    assert p.media_type == "movie"


# ---------------------------------------------------------------------------
# @channel underscore-suffix leakage regressions
# ---------------------------------------------------------------------------

def test_channel_underscore_compound_stripped():
    """@Aniwatch_India_In must be fully stripped — not leave 'India In' in title."""
    p = parse_filename("@Aniwatch_India_In - Trapped in a Dating Sim S01 Episode.mkv")
    assert p.clean_title == "Trapped in a Dating Sim"
    assert p.season == 1
    assert p.media_type == "tv"
    # Episode keyword with no number — no episode extracted, but title clean
    assert p.episode is None


def test_channel_index_station_stripped():
    """@Index_Station suffix must not bleed 'Station' into the title."""
    p = parse_filename("Kamui Hes Behind You S01 - E11 [Sub] 720p @Index_Station.mkv")
    assert p.clean_title == "Kamui Hes Behind You"
    assert p.season == 1
    assert p.episode == 11
    assert p.media_type == "tv"


def test_channel_animes_horizon_stripped():
    """@Animes_Horizon suffix must not bleed 'Horizon' into the title."""
    p = parse_filename("[AH] Fragrant Flower S1-E07 [720p ? Sub] @Animes_Horizon.mkv")
    assert p.clean_title == "Fragrant Flower"
    assert p.season == 1
    assert p.episode == 7
    assert p.media_type == "tv"


def test_channel_anime_maniaac_stripped():
    """@Anime_Maniaac suffix must be fully stripped."""
    p = parse_filename("World's End Harem S1 - 10 [720p] [Sub] @Anime_Maniaac.mkv")
    assert "Maniaac" not in p.clean_title
    assert p.season == 1
    assert p.episode == 10
    assert p.media_type == "tv"


def test_channel_prefix_with_bracket():
    """[@Anime_Fury] leading tag must be fully stripped, not leave residue."""
    p = parse_filename("[@Anime_Fury] [S-01] [EP-01] [720p] Elfen Lied [Dual].mkv")
    assert p.clean_title == "Elfen Lied"
    assert p.season == 1
    assert p.episode == 1
    assert p.media_type == "tv"


def test_channel_trademark_symbol_what_if_regression():
    """@SeriesArchiveX™ channel tag must not swallow underscore-separated TV show title."""
    p = parse_filename("@SeriesArchiveX\u2122_What_If_S01E01_1080p_10bit_WEBRip_6CH_x265_HEVC.mkv")
    assert p.clean_title == "What If"
    assert p.season == 1
    assert p.episode == 1
    assert p.media_type == "tv"
    assert p.quality == "1080p"



# ---------------------------------------------------------------------------
# Noisy Telegram / anime filename regressions
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("filename", "title", "season", "episode"),
    [
        ("[SubsPlease] The Fragrant Flower Blooms With Dignity - 07 (1080p) [A1B2C3D4].mkv",
         "The Fragrant Flower Blooms With Dignity", 1, 7),
        ("@Aniwatch_India_In - Trapped.in.a.Dating.Sim.S01E03.1080p.WEB-DL.x265.mkv",
         "Trapped in a Dating Sim", 1, 3),
        ("[AH] Fragrant_Flower_S1-E07_[720p_Sub]_@Animes_Horizon.mkv",
         "Fragrant Flower", 1, 7),
        ("One.Piece.1100.1080p.WEB-DL.AAC2.0.mkv", "One Piece", 1, 1100),
        ("[Group] Trapped in a Dating Sim S-01 EP-03 720p.mkv", "Trapped in a Dating Sim", 1, 3),
        ("1x01 Locke and Key.mkv", "Locke and Key", 1, 1),
    ],
)
def test_noisy_telegram_anime_titles_are_clean_and_episode_aware(filename, title, season, episode):
    parsed = parse_filename(filename)
    assert parsed.clean_title == title
    assert parsed.media_type == "tv"
    assert parsed.season == season
    assert parsed.episode == episode


def test_anime_series_title_does_not_include_episode_title_or_release_tags():
    parsed = parse_filename(
        "[SubsPlease] Frieren Beyond Journey's End S01E07 A Certain Someone 1080p WEB-DL.mkv"
    )
    assert parsed.clean_title == "Frieren Beyond Journey's End"
    assert parsed.episode == 7
    assert parsed.media_type == "tv"


def test_partial_series_title_is_not_treated_as_exact_tmdb_match():
    from app.services.confidence_scorer import calculate_match_confidence
    from app.services.metadata_providers.base import CandidateMatch

    parsed = parse_filename("Naruto.110.1080p.mkv")
    candidate = CandidateMatch(
        provider="tmdb", provider_id="999", title="Naruto Shippuden",
        media_type="tv", release_year=2007, poster_path="/wrong-poster.jpg",
        overview="Different series",
    )
    # The parser should identify the absolute episode and matching should not
    # mistake a franchise-prefix title for an exact match.
    assert parsed.clean_title == "Naruto"
    assert parsed.media_type == "tv"
    assert calculate_match_confidence(parsed, candidate) < 0.86
