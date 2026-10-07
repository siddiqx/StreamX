"""Unit tests for StreamX Deterministic Filename Parser."""

import pytest
from app.utils.filename_parser import parse_filename


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


def test_one_piece_numeric_ep():
    p = parse_filename("One.Piece.1100.1080p.mkv")
    assert p.clean_title == "One Piece"
    assert p.season == 1
    assert p.episode == 1100
    assert p.media_type == "tv"


def test_anime_fansub_brackets():
    p = parse_filename("[GROUP] Attack on Titan - 01 [1080p].mkv")
    assert p.clean_title == "Attack on Titan"
    assert p.season == 1
    assert p.episode == 1
    assert p.media_type == "tv"
    assert p.release_group == "GROUP"


def test_future_year_unknown():
    p = parse_filename("Unknown.Movie.2026.1080p.mkv")
    assert p.clean_title == "Unknown Movie"
    assert p.year == 2026
    assert p.media_type == "movie"


def test_channel_tagged_movie():
    p = parse_filename("@Hk.Your.Name.2016.720p.BluRay.Dual-Audio.x264.Esub.mkv")
    assert p.clean_title == "Your Name"
    assert p.year == 2016
    assert p.media_type == "movie"
    assert p.quality == "720p"


def test_leading_episode_with_uploader_suffix():
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


def test_numeric_movie_title_not_episode():
    p = parse_filename("Apollo.13.1995.1080p.BluRay.mkv")
    assert p.clean_title == "Apollo"
    assert p.year == 1995
    assert p.media_type == "movie"


def test_absolute_anime_episode_without_hardcoded_title():
    p = parse_filename("One.Piece.1100.1080p.mkv")
    assert p.clean_title == "One Piece"
    assert p.season == 1
    assert p.episode == 1100
    assert p.media_type == "tv"
