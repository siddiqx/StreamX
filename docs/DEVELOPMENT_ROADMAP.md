# StreamX: Prioritized Development Roadmap & Acceptance Criteria

**Document Version:** 1.0.0  
**Updated:** October 2026  
**Status:** Engineering Roadmap

---

## 1. Roadmap Prioritization Framework

All engineering tasks are prioritized strictly by impact on correctness, reliability, and security before optional cosmetic enhancements:

```text
Tier 1: Correctness & Data Integrity ──► Tier 2: Security & Permissions
                     │                                   │
                     ▼                                   ▼
Tier 3: Core Pipeline Reliability    ──► Tier 4: Edge Autonomous Resilience
                     │                                   │
                     ▼                                   ▼
Tier 5: Playback & Sync Performance  ──► Tier 6: UI Polish & Feature Additions
```

---

## 2. Priority Phasing & Milestones

### Phase 1: Institutionalize Project Memory & Antigravity Rules (Current Milestone)
- **Goal:** Ensure all future AI coding sessions have persistent, accurate context and strict behavioral constraints.
- **Tasks:**
  - [x] Author comprehensive project documentation (`PROJECT_AUDIT.md`, `ARCHITECTURE.md`, `MEDIA_DATA_MODEL.md`, `METADATA_PIPELINE.md`, `INTEGRATIONS.md`, `DEPLOYMENT.md`, `KNOWN_ISSUES.md`, `DEVELOPMENT_ROADMAP.md`).
  - [x] Configure repository instruction file (`GEMINI.md` / `AGENTS.md`) at root.
  - [x] Configure workspace rules in `.agents/rules/streamx-rules.md`.
  - [x] Establish Level 3 `PROJECT_CONTEXT.md` persistent reference.
- **Acceptance Criteria:**
  - Future AI sessions discover rules automatically.
  - No secret credentials or sensitive tokens committed.

---

### Phase 2: Metadata Pipeline Hardening & Catalog Snapshot Automation
- **Goal:** Maintain 100% metadata accuracy and guarantee instantaneous (0ms) catalog availability on edge networks.
- **Tasks:**
  - [ ] **Task 2.1: Automated Snapshot Export Script**
    - Create a standalone Python maintenance utility (`scripts/export_snapshot.py`) that queries the SQLite database and exports canonical metadata to `scripts/catalog_snapshot.json`.
    - *Acceptance Criteria:* Running `python scripts/export_snapshot.py` outputs valid JSON containing all enriched media items, validating against `MediaResponse` schema.
  - [ ] **Task 2.2: Anime Season-Split Heuristic**
    - Enhance `filename_parser.py` to differentiate between continuous absolute numbering (e.g. `One Piece 1100`) and distinct seasons of seasonal anime (e.g. `Jujutsu Kaisen Season 2`).
    - *Acceptance Criteria:* Unit tests in `test_filename_parser.py` assert `season=2` for explicit season markers and preserve absolute episode numbers.
  - [ ] **Task 2.3: TMDB Rate Limit Exponential Backoff**
    - Wrap TMDB and AniList HTTP calls in `metadata_service.py` with standard exponential backoff on HTTP 429.
    - *Acceptance Criteria:* Rate-limited requests wait and retry without marking media items as permanently failed.

---

### Phase 3: Ingestion Worker Resilience & Failure Telemetry
- **Goal:** Guarantee zero dropped transfers and provide clear diagnostic feedback to Telegram users.
- **Tasks:**
  - [ ] **Task 3.1: Proactive Telegram Service Channel Validation**
    - At startup, test the bot's ability to post into `TELEGRAM_SERVICE_CHANNEL`. If unreachable, emit an alert via Telegram DM to `TELEGRAM_OWNER_USER_ID`.
    - *Acceptance Criteria:* Health status reflects `service_channel_reachable: true/false`.
  - [ ] **Task 3.2: Telegram Ingestion Progress Bar Updates**
    - Update the user's Telegram status message at 25%, 50%, 75%, and 100% of the MTProto-to-Drive transfer without hitting Telegram Bot API rate limits (limit edits to once per 5 seconds).
    - *Acceptance Criteria:* Ingestion progress visually updates on Telegram without triggering `429 Too Many Requests`.

---

### Phase 4: Cloudflare Worker 24/7 Edge Enhancement
- **Goal:** Maximize edge autonomy when the local PC is offline.
- **Tasks:**
  - [ ] **Task 4.1: Edge Watch Progress Sync**
    - Enable the Cloudflare Worker to store playback progress in Cloudflare KV or durable cache when the Python backend is sleeping, syncing to SQLite upon backend wake.
    - *Acceptance Criteria:* Continuing a video while the PC is off retains playback position on `streamx7.vercel.app`.
  - [ ] **Task 4.2: Direct Edge Search**
    - Implement fast in-memory search over the dynamic catalog in `scripts/cloudflare_worker.js`.
    - *Acceptance Criteria:* Searching in the web app returns instant results even during backend standby.

---

### Phase 5: Client Playback & Mobile Experience Polish
- **Goal:** Deliver an uncompromising, AAA cinema experience across all screens.
- **Tasks:**
  - [ ] **Task 5.1: Resume Playback Prompt**
    - In `MediaDetailModal.tsx`, display a prominent "Resume from X:XX" button alongside "Start Over" when existing watch history is present.
    - *Acceptance Criteria:* Tapping Resume opens VLC at the exact timestamp or launches web player with `?t=seconds`.
  - [ ] **Task 5.2: Up Next Episode Auto-Queue**
    - When an episode reaches $\ge 90\%$ completion, automatically elevate the next chronological episode in the series to the top of "Continue Watching".
    - *Acceptance Criteria:* Finishing S01E02 automatically displays S01E03 on the home carousel.

---

## 3. Definition of Ready for Major Refactoring

Before undertaking any substantial architectural refactoring:
1. Provide a written motivation and scope document.
2. Confirm that working modules (zero-disk streaming, Google Drive resumable upload, Telegram relay) are preserved.
3. Run and verify all existing unit and integration tests.
4. Obtain explicit authorization from the project owner.
