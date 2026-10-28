# StreamX: Metadata Enrichment Pipeline & Intelligence System

**Document Version:** 1.0.0  
**Updated:** October 2026  
**System:** StreamX Media Intelligence Architecture

---

## 1. Pipeline Overview

The StreamX metadata pipeline transforms noisy, unstructured media filenames from Telegram channels, fansub groups, and web releases into canonical movie, television, and anime catalog entries.

```text
  Raw Filename:
  "[@Anime_Fury] S01-02 Komi Can't Communicate [Dual 1080p HEVC] @XANIME.mkv"
                         │
                         ▼
  1. Filename Normalization (filename_parser.py)
     - Strip channel handles (@XANIME, [@Anime_Fury])
     - Strip bracketed technical noise ([Dual 1080p HEVC])
     - Extract coordinates: Season 1, Episode 2, Quality 1080p
     - Clean Title: "Komi Can't Communicate"
                         │
                         ▼
  2. Sibling Prematch Check (metadata_service.py)
     - Scan library for existing sibling episodes
     - If sibling exists, adopt canonical entity immediately (0ms API calls)
                         │
                         ▼ (If no sibling match)
  3. Multi-Provider Search (tmdb.py & anilist.py)
     - Search clean title + deterministic variants
     - Query TMDB v3 API and AniList GraphQL API
                         │
                         ▼
  4. Multi-Factor Confidence Scoring (confidence_scorer.py)
     - Title similarity: 75%
     - Year match: 15%
     - Media type alignment: 10%
     - Season mismatch penalty: -15%
                         │
                         ▼
  5. Candidate Ranking & Ambiguity Resolution
     - MATCHED (Score >= 0.86): Attach canonical entity
     - LOW_CONFIDENCE (Score < 0.86): Preserve item, await user review
                         │
                         ▼
  6. Sibling Propagation
     - Cascade canonical metadata, artwork, and category to all sister episodes
```

---

## 2. Filename Parser (`app/utils/filename_parser.py`)

The parser is completely deterministic and dependency-free. It handles Western television, Hollywood releases, Japanese notation, and fansub anime conventions.

### Supported Episode Patterns
1. **Explicit S/E:** `S01E03`, `Season 3 Episode 9`, `S1-E07`, `S-01 EP-03`
2. **Numeric Separator:** `S01_01`, `S01-01`, `S01.01`, `S1 01`
3. **Cross Notation:** `1x03`, `2x05`
4. **Japanese Notation:** `第03話` (normalized to Season 1, Episode 3)
5. **Fansub Absolute Hyphen:** `Series Name - 01 [1080p].mkv` (normalized to Episode 1)
6. **Trailing Absolute Number:** `One.Piece.1100.1080p.mkv` (normalized to Episode 1100)
7. **Leading Episode Code:** `EP09 - The Fragrant Flower [1080p].mkv`

### Technical Noise Removal
The parser maintains a comprehensive token-boundary regular expression (`_NOISE_TERMS`) that strips release artifacts without modifying valid title words:
- **Resolutions:** `2160p`, `1080p`, `1080i`, `720p`, `576p`, `480p`, `4k`, `uhd`, `8k`
- **Sources:** `web-dl`, `webrip`, `bluray`, `bdrip`, `brrip`, `hdrip`, `hdtv`, `dvdrip`, `remux`
- **Codecs:** `x264`, `x265`, `h264`, `h265`, `hevc`, `av1`, `10bit`, `8bit`, `hi10p`
- **Audio:** `truehd`, `atmos`, `ddp5.1`, `ac3`, `aac`, `dts-hd`, `flac`, `opus`, `dual-audio`, `multi-audio`
- **Languages:** `eng-sub`, `english-sub`, `esub`, `subbed`, `dubbed`, `hardsub`, `softsub`
- **Editions:** `proper`, `repack`, `extended-cut`, `uncut`, `unrated`, `imax`, `theatrical`
- **Distributors:** `amzn`, `netflix`, `disney+`, `hulu`, `crunchyroll`, `funimation`
- **Fansub Groups:** `subsplease`, `erai-raws`, `horriblesubs`, `judas`, `animedynasty`, `animestation`

### Security Safeguards (CWE-1333 Mitigation)
`_strip_bracket_noise()` operates with a bounded recursion depth (`max_depth=3`) and non-backtracking regular expressions, preventing catastrophic backtracking (ReDoS) when processing maliciously crafted filenames with unbalanced brackets.

---

## 3. Confidence Scorer (`app/services/confidence_scorer.py`)

Candidate matches from external APIs are never accepted blindly based on position. Instead, every candidate is scored against the parsed filename.

### Scoring Formula
$$\text{Score} = (S_{\text{title}} \times 0.75) + (S_{\text{year}} \times 0.15) + (S_{\text{type}} \times 0.10) - P_{\text{year}} - P_{\text{season}}$$

Where:
- $S_{\text{title}}$: Best token-normalized similarity across international title, original title, and synonyms using Python's `SequenceMatcher` and leading-prefix substring analysis.
- $S_{\text{year}}$:
  - Exact match: $1.0$
  - $\pm 1$ year: $0.80$
  - $\pm 2$ years: $0.40$
  - Unknown in file: $0.85$ (neutral default)
- $P_{\text{year}}$: $0.20$ penalty if release year differs by $> 3$ years.
- $P_{\text{season}}$: $0.15$ penalty if the file specifies Season 1 but candidate title contains "Season 2" or "Part 2".

### Decision Thresholds
- **`MATCHED` ($\text{Score} \ge 0.86$):** Confident match. Candidate is attached to media and cached in `metadata_entities`.
- **`LOW_CONFIDENCE` ($0.35 \le \text{Score} < 0.86$ or close competing work):** Candidate is recorded in diagnostics but **not attached**. Clean title is displayed to user to prevent showing misleading posters.
- **`NOT_FOUND` ($\text{Score} < 0.35$):** No viable candidates discovered.

---

## 4. Multi-Episode Sibling Propagation

Anime and TV series frequently feature filenames of varying quality (e.g. Episode 1 has the full title, while Episode 4 is truncated as `S01-04 Komi`).

StreamX resolves this through **Sibling Propagation**:
1. When Episode 1 is successfully matched to `Komi Can't Communicate` (TMDB ID `133965`), `propagate_metadata_to_siblings()` is invoked.
2. It queries all other media rows whose filename prefix or normalized title matches `Komi`.
3. It links all matching episodes to the same `metadata_entity_id`, updates their status to `MATCHED`, and assigns the canonical poster and backdrop.
4. Any active or pending background enrichment jobs for those sibling episodes are cancelled, eliminating duplicate external API calls.

---

## 5. Manual Overrides & Locking

Users can correct or search metadata directly from the application UI:
- **`POST /media/{id}/metadata/search?query=Custom+Title`:** Performs a live TMDB search for the specified title.
- **`POST /media/{id}/metadata/select`:** Links the media item to the selected TMDB ID. If `apply_to_series=True`, cascades the selection across all sibling episodes in the show.
- **`metadata_locked = True`:** When a user manually sets or locks metadata, automated background workers and periodic Drive sync tasks are strictly forbidden from modifying or overwriting the record.
- **`POST /media/{id}/metadata/unlock`:** Re-enables automated enrichment if desired.

---

## 6. Image Resolution & Proxies

Posters and backdrops are resolved dynamically through `app/utils/image_resolver.py`:
1. **User Overrides:** Checks `poster_override` and `backdrop_override` first.
2. **Canonical Entity:** Checks `MetadataEntity.poster_path`. Full URLs (AniList) are returned directly; TMDB relative paths (`/path.jpg`) are prepended with `https://image.tmdb.org/t/p/w500/` (posters) or `https://image.tmdb.org/t/p/w1280/` (backdrops).
3. **Edge Image Proxy:** To bypass ISP domain blocks or CORS issues, the Cloudflare Worker exposes `/media/image-proxy?url=...`, caching images at edge CDN nodes for 7 days (`max-age=604800`).
