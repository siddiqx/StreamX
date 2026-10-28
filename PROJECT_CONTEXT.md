# StreamX: Persistent Project Context & AI Development Reference

**Quick Reference for AI Pair Programmers & Developers**  
**Version:** 1.0.0 | **Updated:** October 2026

---

## 1. Project Purpose & Core Architecture

StreamX is a personal media streaming ecosystem and Netflix-inspired library that unifies media from Telegram, Google Drive, and local devices.

### Core Architectural Decisions
1. **Zero-Disk In-Flight Streaming:** 8MB chunks stream from Telegram MTProto directly into Google Drive Resumable Upload sessions in RAM. Local files are **never** written to disk during cloud transfer.
2. **Master Storage:** Google Drive (5.0 TB sovereign cloud) partitioned under `StreamX/` (`Movies/`, `TV Shows/`, `Anime/`, `Other/`).
3. **24/7 Edge Autonomous Fallback:** Cloudflare Worker (`scripts/cloudflare_worker.js`) at `https://streamx-worker.siddiqsiddiq00012.workers.dev` handles streaming, catalog reconciliation, and bot webhooks when the host PC is offline.
4. **Vercel Frontend:** React 19 SPA (`https://streamx7.vercel.app`) with PWA and Capacitor Android shell.
5. **Native VLC Playback:** Launches native VLC Media Player with hardware acceleration (Android Intent, iOS protocol, desktop M3U Range stream).

---

## 2. Actual Stack & Crucial File Paths

### Tech Stack
- **Backend:** Python 3.12, FastAPI, Uvicorn, SQLAlchemy 2.0 Async, `aiosqlite` (SQLite3), `httpx`, `telethon` 1.45, `google-api-python-client`.
- **Frontend:** React 19.2.8, TypeScript, Vite 8.3.0, Lucide Icons.
- **Edge:** Cloudflare Workers, Wrangler.

### Crucial File Paths
| Subsystem | Key File Paths |
| :--- | :--- |
| **Backend Entry & Lifespan** | `backend/app/main.py`, `run_server.py`, `app.py` |
| **Settings & Security** | `backend/app/config/settings.py`, `backend/app/api/auth.py` |
| **Database & Schema** | `backend/app/db/database.py`, `backend/app/db/models.py` |
| **Drive Integration** | `backend/app/services/drive_service.py` |
| **Telegram Ingestion** | `backend/app/services/telegram_bot_service.py`, `backend/app/services/telegram_mtproto_service.py` |
| **Transfer Worker** | `backend/app/workers/transfer_worker.py` |
| **Metadata Pipeline** | `backend/app/services/metadata_service.py`, `backend/app/utils/filename_parser.py`, `backend/app/services/confidence_scorer.py` |
| **Edge Worker** | `scripts/cloudflare_worker.js`, `scripts/catalog_snapshot.json`, `wrangler.toml` |
| **Frontend Root & Routing** | `frontend/src/App.tsx`, `frontend/src/api.ts`, `frontend/src/types.ts` |
| **Catalog Organizer** | `frontend/src/utils/mediaOrganizer.ts`, `frontend/src/utils/playerSettings.ts`, `frontend/src/utils/watchHistory.ts` |
| **Deployment Config** | `frontend/vercel.json`, `backend/Dockerfile` |

---

## 3. Metadata & Series Organization Rules

1. **Preserve Original Names:** Never discard `raw_filename` or original Drive metadata.
2. **Deterministic Token Stripping:** `filename_parser.py` strips channel tags (`@handle`), brackets (`[...]`), and technical quality markers before query generation.
3. **High Confidence Bar:** Candidates with confidence $< 0.86$ are marked `LOW_CONFIDENCE` and rejected from auto-enrichment to prevent bad artwork.
4. **Sibling Cascade:** When an episode matches a canonical work, `propagate_metadata_to_siblings()` propagates that canonical metadata to all sister episodes in the show.
5. **Locking Rule:** When `metadata_locked = True`, background enrichment workers and Drive sync must **never** overwrite or alter the metadata.
6. **Unified Series Card:** `mediaOrganizer.ts` groups all episodes with the same `series_key` or canonical entity ID into a single Series Card with season/episode selectors.

---

## 4. Development & Testing Commands

### Backend Commands
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/macOS
pip install -r requirements.txt
uvicorn app.main:app --port 8000 --reload
# Or run with 24/7 Power Lock:
python ../run_server.py
```

### Frontend Commands
```bash
cd frontend
npm install
npm run dev                    # Local dev at http://localhost:5173
npm run build                  # Production build (tsc -b && vite build)
```

### Automated Tests & Utilities
```bash
pytest -v                      # Run all backend integration & unit tests
pytest backend/tests/test_export_snapshot.py -v
pytest backend/tests/test_filename_parser.py -v
pytest backend/tests/test_confidence_scorer.py -v

# Export catalog snapshot manually (safe local write, zero git side-effects):
python scripts/export_snapshot.py
```

---

## 5. Critical AI Operating Guidelines

1. **Inspect before Modifying:** Always read relevant source files before editing.
2. **Preserve Working Pipelines:** Zero-disk MTProto-to-Drive streaming, Telegram media relay, and Cloudflare Worker fallback are verified working. Do not replace them with unverified architectures.
3. **Protect Credentials:** Never print, log, or commit `.env` secrets, bot tokens, or OAuth refresh tokens.
4. **Non-Destructive Migrations:** Never drop database tables. Use `_migrate_schema_sync()` in `database.py` with `PRAGMA table_info` for new columns.
5. **Deploy with Authorization Only:** Never push or trigger production deployments to Vercel or Cloudflare without explicit authorization.
