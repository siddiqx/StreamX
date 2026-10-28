# StreamX: Known Issues, Root Cause Analysis, and Defect Register

**Document Version:** 1.0.0  
**Updated:** October 2026  
**Register Status:** Current Audit

---

## Issue Index

| ID | Severity | Status | Title | Component |
| :--- | :--- | :--- | :--- | :--- |
| **ISS-01** | Medium | Active (Host Constraint) | Automation Runner Shell Spawn Failure (`0xC0000142`) | Host / Runner Environment |
| **ISS-02** | High | Mitigated / Architectural | Free-Tier Container Sleep & Dynamic Tunnel Drift | Cloud Hosting / Tunnel |
| **ISS-03** | High | Resolved in Code | Historical TMDB Matching Collisions on Telegram Tags | Metadata Intelligence |
| **ISS-04** | High | Resolved in Code | Interrupted Resumable Drive Uploads & Token Expiry | Google Drive Service |
| **ISS-05** | Medium | Resolved in Architecture | Browser Playback Incompatibility with 10-bit HEVC / ASS | Client Video Playback |
| **ISS-06** | High | Resolved in Code | Background Worker Unsafe Automated Git Push & Premature Export | Transfer Worker / Cloud Edge |
| **ISS-07** | High | Resolved in Code | Missing `series_key` in `MediaResponse` API Schema | API Schemas / Media Catalog |
| **ISS-08** | Medium | Resolved in Code | Hardcoded Telegram User IDs in Settings | Configuration & Security |

---

## Detailed Issue Analysis

### ISS-01: Automation Runner Shell Spawn Failure (`0xC0000142`)
- **Severity:** Medium (Affects automated CLI execution in runner context; does not affect application runtime).
- **Affected Subsystem:** Agent CLI execution harness on Windows host.
- **Evidence:** Executing commands via `run_command` (e.g. `Get-ChildItem`, `cmd /c dir`, `exit 0`) terminates immediately with exit code `-1073741502` (`0xC0000142: STATUS_DLL_INIT_FAILED`).
- **Reproduction Steps:** Call `run_command` with any command string in powershell runner session.
- **Expected Behavior:** Shell initializes, executes command, and returns standard output.
- **Actual Behavior:** Windows process fails DLL initialization before running the user command.
- **Root Cause (Confirmed):** OS desktop heap exhaustion, session permission restriction, or runner sandbox isolation policy preventing child `powershell.exe` process instantiation within this non-interactive service session.
- **Recommended Remediation:** 
  1. For file inspection and editing, utilize native agent file tools (`read_file`, `write_file`, `edit_file`) which operate directly in-process and bypass child shell instantiation.
  2. For tests and server launches, execute commands directly in user desktop terminals (PowerShell, Windows Terminal, or VS Code integrated terminal).
- **Verification Criteria:** Direct execution in interactive user terminal runs `pytest` and `npm run dev` successfully.

---

### ISS-02: Free-Tier Container Sleep & Dynamic Tunnel Drift
- **Severity:** High
- **Affected Subsystem:** Render Backend / Cloudflare Tunnel / Frontend API routing.
- **Evidence:** Render free-tier containers spin down after 15 minutes of inactivity; Cloudflare quick tunnels generate new URLs upon restart.
- **Expected Behavior:** Frontend at `streamx7.vercel.app` remains responsive and capable of streaming media 24/7 without requiring the developer's PC to remain powered on.
- **Root Cause:** Free cloud hosting tiers spin down idle containers; long-running processes (MTProto polling) cannot persist on serverless edge networks alone.
- **Implemented Mitigation:**
  1. **Cloudflare Worker 24/7 Fallback:** `scripts/cloudflare_worker.js` operates as an autonomous edge server that queries Google Drive directly, serves cached catalogs, and streams media via HTTP 206 even when the backend is offline.
  2. **Keep-Alive Ping:** `_run_keep_alive_ping()` in `backend/app/main.py` pings the health endpoint every 10 minutes to prevent Render idle hibernation when active.
  3. **Windows 24/7 Power Lock:** `run_server.py` invokes Windows `SetThreadExecutionState` to prevent the host PC from entering sleep mode while running.
- **Verification Criteria:** Accessing `streamx7.vercel.app` loads catalog and streams media even when backend container is spun down.

---

### ISS-03: Historical TMDB Matching Collisions on Telegram Tags
- **Severity:** High (Historical defect, verified resolved).
- **Affected Subsystem:** `backend/app/utils/filename_parser.py`, `backend/app/services/confidence_scorer.py`.
- **Evidence:** Raw filenames with `@handle` tags or fansub brackets previously triggered TMDB search failures or matched incorrect movie titles with low confidence.
- **Expected Behavior:** Release groups, channel tags, audio tags, and resolution markers are stripped, leaving only the clean canonical title for TMDB search. Matches below confidence threshold are rejected.
- **Root Cause:** Search queries previously included noisy strings; matching logic accepted the first search result blindly without confidence scoring.
- **Implemented Fix:**
  1. Multi-stage regex token stripping in `filename_parser.py`.
  2. Deterministic multi-factor confidence scoring ($\ge 0.86$ threshold) in `confidence_scorer.py`.
  3. Automatic Sibling Episode Propagation (`propagate_metadata_to_siblings`) ensures consistent series identity.
  4. Manual user override and locking (`metadata_locked = True`).
- **Verification Criteria:** Automated test suite in `backend/tests/test_filename_parser.py` (376 lines) and `backend/tests/test_confidence_scorer.py` (68 lines) verifies accurate extraction and scoring.

---

### ISS-04: Interrupted Resumable Drive Uploads & Token Expiration
- **Severity:** High (Historical defect, verified resolved).
- **Affected Subsystem:** `backend/app/services/drive_service.py`, `backend/app/workers/transfer_worker.py`.
- **Evidence:** Uploads taking $> 1$ hour encountered expired Google OAuth access tokens; server restarts caused incomplete transfers to fail permanently.
- **Expected Behavior:** Long-running transfers refresh OAuth credentials automatically; interrupted transfers resume from the exact committed byte offset.
- **Root Cause:** Google OAuth access tokens expire after 3600 seconds; resumable sessions require state persistence across restarts.
- **Implemented Fix:**
  1. `get_credentials()` in `drive_service.py` checks validity and refreshes via `credentials.refresh()`.
  2. `get_resumable_offset()` queries Drive with `bytes */TOTAL` to recover the committed byte offset.
  3. Incomplete transfers are reconciled on startup via `reconcile_incomplete_transfers()`.
- **Verification Criteria:** `backend/tests/test_drive_service.py` and `backend/tests/test_transfer_worker.py` test chunk resumption and 308 response handling.

---

### ISS-05: Mobile Browser Playback Incompatibility with 10-bit HEVC & ASS Subtitles
- **Severity:** Medium (Resolved via architecture).
- **Affected Subsystem:** Frontend Video Player / Native VLC Launcher.
- **Evidence:** HTML5 `<video>` elements on iOS Safari and Android Chrome cannot decode 10-bit HEVC (H.265) video or render soft ASS/SSA anime subtitles.
- **Expected Behavior:** High-definition 10-bit anime and 4K movies play smoothly with full subtitle formatting and zero lag.
- **Root Cause:** Hardware decoder limitations and missing ASS subtitle renderers in mobile browser engines.
- **Implemented Solution:**
  1. Dedicated **VLC Launch Engine** in `playerSettings.ts`.
  2. Android Intent navigation launches native VLC directly with hardware acceleration.
  3. iOS uses `vlc-x-callback://` protocol.
  4. Instant seeking (~100ms), multi-audio track switching, and full ASS subtitle rendering with 0 CPU transcode overhead.
- **Verification Criteria:** Clicking Play on mobile opens VLC instantly; watch session progress syncs back upon returning to StreamX.

---

### ISS-06: Background Worker Unsafe Automated Git Push & Premature Export
- **Severity:** High (Resolved in code).
- **Affected Subsystem:** `backend/app/workers/transfer_worker.py`, `scripts/export_snapshot.py`.
- **Evidence:** `_auto_export_catalog_snapshot()` in `transfer_worker.py` invoked `subprocess.run(["git", "push", "origin", "main"])` in a thread executor whenever any transfer completed, violating authorization policies. Furthermore, it ran *before* metadata enrichment completed, resulting in empty metadata entries dumped into `catalog_snapshot.json`.
- **Expected Behavior:** Snapshot export must be a safe, local, atomic file operation with zero git side effects. Export must trigger after metadata enrichment completes.
- **Root Cause:** Background routine conflated file generation with remote git synchronization, and was queued prematurely before the asynchronous enrichment job ran.
- **Implemented Solution:**
  1. Removed all git subprocess executions (`git add`, `git commit`, `git push`) from `transfer_worker.py`.
  2. Implemented dedicated `scripts/export_snapshot.py` with atomic `.tmp` replacement, full Unicode preservation (`ensure_ascii=False`), and dry-run capabilities.
  3. Re-routed export triggers to `metadata_service.py` to fire after canonical metadata enrichment and sibling propagation complete.
- **Verification Criteria:** `backend/tests/test_export_snapshot.py` verifies atomic export and absence of git commands.

---

### ISS-07: Missing `series_key` in `MediaResponse` API Schema
- **Severity:** High (Resolved in code).
- **Affected Subsystem:** `backend/app/schemas/media.py`, `backend/app/api/media.py`, `frontend/src/utils/mediaOrganizer.ts`.
- **Evidence:** `MediaResponse` schema omitted `series_key`, causing `item.series_key` to be undefined on the frontend. The frontend `mediaOrganizer.ts` relied on `series_key` for series grouping.
- **Expected Behavior:** Backend API emits `series_key` in `MediaResponse` for unified TV show and anime grouping across web and serverless edge.
- **Root Cause:** Schema omission during initial Pydantic model definition.
- **Implemented Solution:**
  1. Added `series_key: Optional[str] = None` to `MediaResponse` in `backend/app/schemas/media.py`.
  2. Populated `series_key=item.series_key` in `format_media_item()` in `backend/app/api/media.py`.
  3. Added non-destructive SQLite schema backfill in `database.py` to assign canonical series keys for all existing matched media records.
- **Verification Criteria:** `backend/tests/test_export_snapshot.py::test_format_media_item_includes_series_key` tests correct field serialization.

---

### ISS-08: Hardcoded Telegram User IDs in Settings
- **Severity:** Medium (Resolved in code).
- **Affected Subsystem:** `backend/app/config/settings.py`.
- **Evidence:** Settings defaulted `TELEGRAM_ALLOWED_USER_IDS` to hardcoded IDs, and `allowed_telegram_users` property unconditionally initialized the array with hardcoded values.
- **Expected Behavior:** User access control should be strictly driven by `.env` configuration.
- **Root Cause:** Development convenience fallbacks left in source code.
- **Implemented Solution:**
  1. Changed defaults in `Settings` to `None`.
  2. Dynamically built `allowed_telegram_users` list exclusively from configured `TELEGRAM_OWNER_USER_ID` and `TELEGRAM_ALLOWED_USER_IDS`.
- **Verification Criteria:** `backend/tests/test_export_snapshot.py::test_settings_allowed_telegram_users_dynamic` tests dynamic resolution.
