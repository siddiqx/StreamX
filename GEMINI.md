# StreamX: Repository Engineering Instructions & Development Rules

**Applies to:** StreamX Repository (`d:\02_Projects\StreamX`)  
**Scope:** Universal Workspace Rules (Always Active)

---

## 1. Project Identity & Architecture Boundaries

1. **System Identity:** StreamX is an existing, Netflix-inspired personal media streaming ecosystem and library. It connects Telegram ingestion to Google Drive master storage (5.0 TB) via an asynchronous, zero-disk in-memory streaming pipeline, serving media to a mobile-first React 19 web app and native hardware VLC players.
2. **Zero-Disk Streaming Invariant:** Media transfers between Telegram's MTProto network and Google Drive stream sequential 8MB chunks through an in-memory RAM ring buffer ($\le 32\text{ MB}$). Media files are **never** written to local SSD/disk storage. Never replace this pipeline with full-file disk downloads.
3. **24/7 Edge Autonomous Fallback:** The Cloudflare Worker (`scripts/cloudflare_worker.js`) at `https://streamx-worker.siddiqsiddiq00012.workers.dev` is an autonomous edge gateway. When the developer's PC/backend is offline or sleeping, the edge worker directly queries Google Drive, accepts Telegram webhooks, and streams video with HTTP 206 Partial Content. Never break edge compatibility.
4. **Master Media Vault:** Google Drive is the permanent master storage. It maintains a strict hierarchy: `StreamX/` $\to$ `Movies/`, `TV Shows/`, `Anime/`, `Other/` $\to$ dedicated show folders.

---

## 2. Standard Development Workflow

Before undertaking any substantial coding task:
1. **Consult Persistent Context:** Read `PROJECT_CONTEXT.md` and the relevant specification in `docs/`.
2. **Inspect Before Modifying:** Read the exact files involved. Trace imports, data flow, and database models.
3. **Preserve Working Implementations:** Do not rewrite functioning modules (e.g. `transfer_worker.py`, `drive_service.py`, `filename_parser.py`, `mediaOrganizer.ts`).
4. **Identify the Smallest Safe Change:** Prefer targeted, incremental bug fixes over architectural overhauls.
5. **Protect Credentials:** Never print, log, or commit `.env` values, API keys, Telegram bot tokens, or Google OAuth refresh tokens.
6. **Non-Destructive Database Updates:** Never drop or reset database tables. Use `_migrate_schema_sync()` in `app/db/database.py` with `PRAGMA table_info` for adding columns.

---

## 3. Metadata & Series Organization Rules

1. **Preserve Original Names:** Never discard `raw_filename` or original Drive metadata. Keep normalized titles and extracted episode fields in separate columns.
2. **Deterministic Token Stripping:** `filename_parser.py` must strip channel tags (`@handle`), brackets (`[...]`), and technical quality markers before generating search queries.
3. **High Confidence Threshold:** External TMDB/AniList candidates must achieve a match score $\ge 0.86$ in `confidence_scorer.py` to be marked `MATCHED`. Lower scores must be marked `LOW_CONFIDENCE` and rejected from automatic attachment to prevent wrong artwork.
4. **Multi-Episode Sibling Cascade:** When an episode matches a canonical entity, invoke `propagate_metadata_to_siblings()` so all sister episodes in the season adopt the canonical title, poster, and backdrop.
5. **Honor User Locks:** When `metadata_locked = True`, automated background workers and Drive sync tasks are strictly forbidden from modifying or overriding the metadata.
6. **Unified Series Card:** The frontend (`mediaOrganizer.ts`) must group all episodes sharing a canonical metadata ID or `series_key` into a single Series Card with season and episode selectors.
7. **Version Support:** Movies with multiple resolutions (e.g. 1080p and 4K) are represented as separate rows in `media` but grouped into a single card with version switchers in the UI.

---

## 4. Playback & Video Delivery Invariants

1. **Hardware VLC First:** Desktop and mobile players launch native VLC via Android Intent (`intent://...`), iOS protocol (`vlc-x-callback://`), or dynamic `#EXTM3U` playlist with HTTP 206 Range headers. This eliminates server CPU transcode load and guarantees 100ms seeking and soft ASS anime subtitle rendering.
2. **RFC 5987 Filenames:** All media streaming endpoints must emit RFC 5987 compliant `Content-Disposition` headers (`filename*=UTF-8''...`) to prevent corruption of Japanese and Unicode titles.
3. **Fast HEAD Probe:** Video streaming endpoints must handle HTTP `HEAD` requests instantly with `Accept-Ranges: bytes` and `Content-Length` so media players probe headers without delay.

---

## 5. Deployment & Production Boundaries

1. **Vercel Frontend:** Deployed at `https://streamx7.vercel.app` from `frontend/`. Build command: `npm run build` (`tsc -b && vite build`).
2. **Cloudflare Worker:** Deployed at `streamx-worker.siddiqsiddiq00012.workers.dev` via `scripts/cloudflare_worker.js`.
3. **No Unauthorized Deployments:** Do not push to remote Git repositories or trigger production deployments without explicit authorization.
