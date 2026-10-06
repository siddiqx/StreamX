# StreamX Automatic Media Metadata Enrichment System

## 1. Overview & Architecture

The StreamX metadata subsystem automatically enriches uploaded movies, TV shows, and anime into canonical media catalog entries. Files uploaded through the Telegram bot or synced from Google Drive are asynchronously identified, mapped against The Movie Database (TMDB), scored for confidence, and enriched with official artwork, synopsis, genres, release year, runtime, and ratings.

### Workflow Pipeline

```text
Upload Completed (Telegram -> Google Drive)
            ↓
Media Record Created in SQLite (status: PENDING)
            ↓
Metadata Job Enqueued (metadata_jobs)
            ↓
MetadataWorker picks job
            ↓
Deterministic Filename Parser
  • Noise removal (codecs, resolutions, release groups, audio/subs)
  • Media type detection (movie vs tv)
  • Season/Episode & Year extraction
            ↓
Metadata Entity Cache Check (Deduplication)
            ↓
TMDB API Search (Movie or TV endpoint)
            ↓
Multi-Factor Deterministic Confidence Scoring
            ↓
Threshold Evaluation:
  • >= 85%: MATCHED -> Fetch Details & Artwork
  • 65% - 84%: LOW_CONFIDENCE -> Fetch Details & Flag for Review
  • < 65% or No Result: NOT_FOUND
            ↓
Database Commit (metadata_entities & media)
            ↓
Real-Time Netflix-Style UI Presentation
```

---

## 2. Filename Parser (`app/utils/filename_parser.py`)

Deterministic parser recognizing common release artifacts and patterns:
- **Resolutions:** `2160p`, `4k`, `1080p`, `720p`, `480p`, `UHD`.
- **Sources:** `WEB-DL`, `WEBRip`, `BluRay`, `BDRip`, `BRRip`, `HDRip`, `HDTV`, `DVDRip`, `REMUX`.
- **Codecs:** `x264`, `x265`, `H264`, `H265`, `HEVC`, `AV1`, `10bit`, `8bit`.
- **Audio & Dubs:** `AAC`, `AC3`, `DTS`, `TrueHD`, `Atmos`, `Dual Audio`, `Multi-Audio`, `Eng Sub`, `Japanese Audio`.
- **TV / Series Patterns:** `S01E01`, `1x01`, `Season 1 Episode 2`, anime absolute numbering (`- 01` or `1100`).
- **Release Groups & Tags:** Strips `[Group]`, `@Channel`, `-GROUP`.
- **Separators:** Intelligently normalizes dots and underscores into spaces while preserving hyphenated words.

---

## 3. Confidence Scoring Algorithm (`app/services/confidence_scorer.py`)

Multi-factor deterministic score between 0.0 and 1.0:
1. **Title Similarity (50%):** Ratcliff/Obershelp gestalt token similarity + word overlap bonus.
2. **Release Year Match (25%):** Exact year match (+0.25), 1 year difference (+0.18), major difference (>3 years) applies a -0.15 penalty to prevent matching unrelated remakes.
3. **Media Type Match (10%):** Matches `movie` vs `tv`.
4. **Original / Alternative Title Match (10%):** Evaluates TMDB original titles (e.g. Japanese anime titles).
5. **Data Completeness (5%):** Bonus for presence of poster artwork and synopsis.

### Outcome Thresholds
- **`MATCHED`** (`>= 0.85`): Canonical metadata automatically assigned and displayed.
- **`LOW_CONFIDENCE`** (`0.65 - 0.84`): Assigned but flagged in UI as "Needs Review".
- **`NOT_FOUND`** (`< 0.65`): Remains with original title, awaiting manual correction.

---

## 4. Metadata Entity Model & Deduplication

Files referring to the same canonical movie or series share a single `MetadataEntity` row:

```text
Media A (1080p)  ───┐
Media B (2160p)  ───┼──> MetadataEntity (Interstellar - TMDB 157336)
Media C (Remux)  ───┘
```

Benefits:
- Zero redundant TMDB API requests for identical media.
- Consistent posters and metadata across different releases and resolutions.

---

## 5. Manual Correction & Locking

Automatic identification can be manually corrected at any time:
1. Open the media detail modal in StreamX.
2. Click **Change Match**.
3. Search TMDB with custom keywords.
4. Select the correct candidate match.
5. Item is flagged as `status: MANUAL` and `metadata_locked = True`.
6. Future automatic reprocessing or backfill will never overwrite manually locked items.
7. Click **Unlock** to allow automatic updates again.

---

## 6. Library Backfill & Maintenance

To process existing libraries or files added prior to TMDB configuration:
- Trigger via UI: **Settings -> Metadata Health -> Backfill Library**
- Or via API: `POST /metadata/backfill?force=false`
- Internal stats endpoint: `GET /metadata/stats`

---

## 7. TMDB Configuration & Security

- **Server-Side Only:** `TMDB_API_KEY` is never exposed to the frontend, browser bundles, API responses, or logs.
- Configure in `.env`:
  ```bash
  TMDB_API_KEY=your_tmdb_api_key_here
  ```
- Supports both TMDB v3 32-character API keys and TMDB v4 JWT Read Access Tokens.
