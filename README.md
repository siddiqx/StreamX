<div align="center">

# StreamX

### Enterprise-Grade Personal Media Pipeline & Sovereign Cloud Cinema
*Seamlessly unifying Telegram ingestion, Google Drive master storage, and zero-disk streaming into an automated personal streaming ecosystem.*

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19_TypeScript-61DAFB.svg?style=flat&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF.svg?style=flat&logo=vite&logoColor=white)](https://vitejs.dev)
[![Python](https://img.shields.io/badge/Python-3.12_AsyncIO-3776AB.svg?style=flat&logo=python&logoColor=white)](https://python.org)
[![Vercel](https://img.shields.io/badge/Vercel-Production_Live-black.svg?style=flat&logo=vercel&logoColor=white)](https://streamx7.vercel.app)
[![Render](https://img.shields.io/badge/Render-Backend_Live-46E3B7.svg?style=flat&logo=render&logoColor=black)](https://streamx-backend-cqm0.onrender.com)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat)](LICENSE)

[Live Web Application](https://streamx7.vercel.app) • [Backend API Documentation](https://streamx-backend-cqm0.onrender.com/docs) • [Telegram Bot](https://t.me/Stream1_X_bot)

</div>

---

## 1. Executive Summary

Consumer media consumption faces an architectural trilemma:
1. **Bandwidth & Storage Waste:** Downloading multi-gigabyte media files locally requires keeping computers powered on, fills finite device storage, and causes bandwidth redundancy.
2. **Platform Silos:** Telegram channels contain vast collections of high-definition video, yet lack unified streaming, library indexing, and hardware-accelerated playback.
3. **Infrastructure Cost:** Self-hosting personal streaming solutions typically requires costly multi-terabyte dedicated servers ($30–$80/month) or power-hungry home NAS setups.

**StreamX** resolves this trilemma through an asynchronous, **zero-disk chunk-streaming engine**. By streaming bytes in-flight from Telegram's MTProto network directly into Google Drive's resumable upload API, StreamX transfers arbitrary 10GB–20GB files using only **16MB of active RAM** and **0 bytes of local disk space**. The catalog is indexed in real time, enhanced with metadata posters, and served through a mobile-first web app and native VLC media player integration.

---

## 2. High-Level Architecture & Data Flow

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                           INGESTION SOURCE                             │
 │                                                                        │
 │   User forwards MKV/MP4 files                                          │
 │               │                                                        │
 │               ▼                                                        │
 │   Telegram Bot (@Stream1_X_bot)                                        │
 │   [Access Control: Whitelisted Telegram User IDs]                     │
 └───────────────┬────────────────────────────────────────────────────────┘
                 │ Webhook / Asynchronous HTTP Long-Polling
                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      STREAMX CLOUD PIPELINE                            │
 │                                                                        │
 │   1. Ingestion Worker                                                  │
 │      - Enqueues transfer task in SQLite state machine                  │
 │      - Auto-categorizes (Movies, TV Shows, Anime)                      │
 │                                                                        │
 │   2. Telethon MTProto Client                                           │
 │      - Requests 8MB sequential chunks from Telegram DC                 │
 │                                                                        │
 │   3. Zero-Disk In-Memory Ring Buffer                                   │
 │      - 16MB bounded allocation                                         │
 │      - Never touches local disk / SSD                                  │
 │                                                                        │
 │   4. Google Drive Resumable Upload Engine                              │
 │      - Streams HTTP chunk ranges directly to Google Drive              │
 │      - Commits byte offsets to SQLite for crash resumption             │
 └───────────────┬────────────────────────────────────────────────────────┘
                 │ Completed Master Upload
                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                     GOOGLE DRIVE MASTER STORAGE                        │
 │                                                                        │
 │   5.0 TB Sovereign Cloud Storage                                       │
 │   ├── Movies/                                                          │
 │   ├── TV Shows/                                                        │
 │   └── Anime/                                                           │
 └───────────────┬────────────────────────────────────────────────────────┘
                 │ Authenticated Direct Stream & Range Headers
                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                         CONSUMPTION LAYER                              │
 │                                                                        │
 │   FastAPI Backend (Render) ───► Live H.264/AAC Transcode (FFmpeg)      │
 │            │                                                           │
 │            ├──► Vercel Edge Frontend (React 19, Netflix Mobile UI)     │
 │            ├──► Native VLC Player (Instant 10-bit MKV / Dual Audio)    │
 │            └──► Resumable Offline Download (Offline Storage)           │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Architectural Innovations

### 3.1 Zero-Disk In-Memory Streaming Pipeline
Traditional media transfer utilities download complete files onto local disks before uploading to cloud storage. On memory-constrained free-tier cloud containers (512MB RAM, 1GB disk), handling a 15GB 4K BluRay rip triggers immediate out-of-disk crashes (`ENOSPC`).

StreamX engineers an in-flight byte pipeline:
$$\text{Telegram MTProto (8MB Chunk)} \xrightarrow{\text{RAM Ring Buffer}} \text{Google Drive Resumable API} \xrightarrow{\text{HTTP 308 Resume}}$$

* **Memory Footprint:** Bounded to **$\le$ 32MB RAM** regardless of whether the video file is 100MB or 40GB.
* **Disk Footprint:** **0 bytes**. File systems are never touched during transfer.
* **Fault Tolerance:** If the container restarts midway through a 10GB transfer, the worker queries the Google Drive session offset and resumes from the exact committed byte without re-downloading earlier chunks.

### 3.2 Dynamic Dual-Path Video Delivery
Modern release formats (such as 10-bit HEVC x265 MKV with soft ASS/SSA anime subtitles) cannot be decoded natively by HTML5 browser engines. StreamX implements an intelligent dual-path delivery matrix:

1. **Path A (Browser Native):** Dynamic on-the-fly transmuxing/transcoding via FFmpeg:
   ```bash
   ffmpeg -ss {start} -i {drive_url} -map 0:v:0 -map 0:a:0? \
          -c:v libx264 -pix_fmt yuv420p -preset ultrafast -tune zerolatency \
          -c:a aac -b:a 160k -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1
   ```
   Provides universal playback across Safari iOS, Android Chrome, and Desktop browsers.
2. **Path B (Native Hardware Acceleration via VLC):** 
   * **Android Intent:** Launches the VLC app via `intent://...#Intent;package=org.videolan.vlc`.
   * **Desktop & Protocol:** Launches local VLC with direct HTTP Range streaming from Drive.
   * **M3U Playlist:** Live-generates `#EXTM3U` playlists for third-party media players (IINA, PotPlayer, MX Player).
   * **Result:** Zero CPU transcode load, instant seeking (100ms), multi-audio track switching, and full subtitle rendering.

### 3.3 State Machine Architecture
Every transfer transitions through strict transactional states within SQLite:
```text
  [QUEUED] ──► [FETCHING_TELEGRAM] ──► [UPLOADING_DRIVE] ──► [COMPLETED]
     │                   │                    │
     ▼                   ▼                    ▼
  [RETRYING] ◄────── [FAILED] ────────► [CANCELLED]
```
Transfers interrupted by server hibernation or deployments are reconciled automatically upon startup via `reconcile_incomplete_transfers()`.

---

## 4. Production Cloud Deployment Topology

StreamX operates across a hybrid cloud topology providing 24/7 continuous operation with **zero infrastructure cost**:

| Component | Host Platform | Specifications | Responsibilities |
| :--- | :--- | :--- | :--- |
| **Frontend Web App** | **Vercel** | Global Edge CDN, HTTPS, HTTP/2 | Netflix-style mobile UI, offline cache management, client settings |
| **Backend & Worker** | **Render** | Docker Container, Python 3.12, FFmpeg | Telegram long-polling, MTProto chunk pipeline, API, live transcoding |
| **Master Media Vault** | **Google Drive** | 5.0 TB Cloud Storage | Permanent master storage, high-speed resumable uploads |
| **Ingestion Bot** | **Telegram** | Bot API & MTProto Protocol | Command ingestion, file forwarding, status tracking |

* **Live Frontend:** [https://frontend-ebon-psi-82.vercel.app](https://frontend-ebon-psi-82.vercel.app)
* **Live API Backend:** `https://streamx-backend-cqm0.onrender.com`

---

## 5. Technology Stack

### Backend Infrastructure
* **Runtime:** Python 3.12 (AsyncIO, uvloop)
* **Framework:** FastAPI, Uvicorn, Starlette
* **Database & ORM:** SQLAlchemy 2.0 (Async), aiosqlite (SQLite3 engine)
* **Telegram Pipeline:** Telethon 1.45 (MTProto client), PyAES, RSA
* **Cloud API:** Google Drive API v3, Google OAuth 2.0 (Token auto-refresh)
* **Media Processing:** FFmpeg (libx264, aac, fragmented MP4 muxer)
* **Networking & HTTP:** HTTPX (async client with HTTP/2 support)

### Frontend Client
* **Framework:** React 19, TypeScript
* **Build System:** Vite 8.x
* **Styling:** Mobile-first Vanilla CSS design system with CSS custom properties & glassmorphism
* **Icons:** Lucide Icons
* **Offline Storage:** Browser Storage Access Framework & HTML5 Quota Storage API

---

## 6. Security, Hardening & Governance

* **Scoped Authorization:** The Telegram bot strictly enforces `TELEGRAM_ALLOWED_USER_IDS`. Unauthorized users are rejected and logged with `UNAUTHORIZED_BOT_ACCESS`.
* **Zero Credential Exposure:** `.env`, session strings, and database files are excluded from version control via `.gitignore`.
* **Header & Path Traversal Protection:** All user-provided filenames pass through `sanitize_filename()` before appearing in `Content-Disposition` headers or local paths, preventing path traversal (`../`) and HTTP header splitting.
* **CORS Governance:** Configured to support secure cross-origin requests from the Vercel frontend domain to the backend API.
* **Process Isolation:** VLC launches use non-blocking detached process wrappers (`subprocess.Popen` without `shell=True`), preventing shell command injection.

---

## 7. REST API Reference

### Health & System Status
* **`GET /health`**  
  Returns `{ "status": "ok", "service": "streamx" }`.
* **`GET /system/status`**  
  Returns real-time Google Drive storage quota (total limit, usage in bytes), Telegram bot connection status, VLC installation path, and host disk usage.

### Media Catalog
* **`GET /media?category={category}&limit={n}&offset={m}`**  
  Returns array of cataloged media files ordered by creation date descending.
* **`GET /media/search?q={keyword}`**  
  Searches titles and filenames across the media library.
* **`GET /media/categories`**  
  Returns catalog summaries grouped by category (Movies, TV Shows, Anime).

### Streaming & Playback
* **`GET /media/{id}/stream`**  
  Direct Google Drive stream with HTTP `Range: bytes=start-end` support for seeking.
* **`GET /media/{id}/stream/compatible?start={seconds}`**  
  Real-time fragmented H.264/AAC MP4 transcode stream for universal web browser playback.
* **`POST /media/{id}/open-vlc`**  
  Launches VLC Media Player on the host system with the media stream URL.
* **`GET /media/{id}/playlist.m3u`**  
  Generates an `#EXTM3U` playlist file for external media players.
* **`GET /media/{id}/download`**  
  Direct download endpoint with `Content-Disposition: attachment`.

### Ingestion Transfers
* **`GET /transfers?limit={n}`**  
  Lists active and recent file ingestion transfers.
* **`POST /transfers/{id}/retry`**  
  Re-queues a failed or interrupted transfer.
* **`POST /transfers/{id}/cancel`**  
  Cancels an active or pending transfer.

---

## 8. Local Setup & Verification Runbook

### Prerequisites
* Python 3.11+
* Node.js 20+ & npm
* FFmpeg installed and available on `PATH`
* Google Cloud OAuth 2.0 Credentials (Drive API enabled)
* Telegram Bot Token & API credentials from [my.telegram.org](https://my.telegram.org)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/siddiqx/StreamX.git
   cd StreamX
   ```

2. **Backend Setup:**
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   cp ../.env.example ../.env  # Configure your credentials
   uvicorn app.main:app --port 8000 --reload
   ```

3. **Frontend Setup:**
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```

4. **Run Automated Test Suite:**
   ```bash
   pytest -v
   cd frontend && npm run build
   ```

---

## 9. Verification & Automated Test Results

The backend contains integration test coverage across all pipeline layers:

```text
backend/tests/test_drive_service.py::test_drive_service_configuration PASSED  [ 7%]
backend/tests/test_drive_service.py::test_drive_unconfigured_error PASSED     [14%]
backend/tests/test_drive_service.py::test_upload_chunk_308_and_200 PASSED     [21%]
backend/tests/test_health.py::test_health_endpoint PASSED                     [28%]
backend/tests/test_media_api.py::test_media_catalog_and_search_api PASSED    [35%]
backend/tests/test_media_stream.py::test_stream_and_download_endpoints PASSED [42%]
backend/tests/test_mtproto_service.py::test_mtproto_configuration_check PASSED [50%]
backend/tests/test_mtproto_service.py::test_mtproto_unconfigured_error PASSED [57%]
backend/tests/test_mtproto_service.py::test_iter_download_chunks PASSED       [64%]
backend/tests/test_telegram_bot.py::test_sanitize_filename PASSED             [71%]
backend/tests/test_telegram_bot.py::test_bot_unauthorized_user PASSED         [78%]
backend/tests/test_telegram_bot.py::test_bot_media_ingestion_and_sqlite PASSED [85%]
backend/tests/test_telegram_bot.py::test_transfers_api PASSED                 [92%]
backend/tests/test_transfer_worker.py::test_worker_process_transfer PASSED    [100%]

============================= 14 passed in 5.30s ==============================
```

Frontend compilation audit:
```text
✓ 1908 modules transformed.
dist/index.html                   0.92 kB │ gzip: 0.50 kB
dist/assets/index-CcqXy1HT.css    8.74 kB │ gzip: 2.50 kB
dist/assets/index-CqJZ7gms.js   294.54 kB │ gzip: 86.45 kB
✓ built in 1.56s (0 TypeScript errors)
```

---

## 10. License

StreamX is released under the **MIT License**. Created by [Siddiq](https://github.com/siddiqx).
