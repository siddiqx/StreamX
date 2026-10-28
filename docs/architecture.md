# StreamX System Architecture & Technical Specification

**Document Version:** 2.0.0  
**Updated:** October 2026  
**System:** StreamX Personal Media Platform

---

## 1. Architectural Vision & Topology

StreamX is an enterprise-grade personal media ecosystem designed to bridge platform silos, eliminate bandwidth/storage waste, and provide instant, high-definition streaming across all client devices.

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                           INGESTION TIER                               │
 │                                                                        │
 │   User forwards media on Telegram                                      │
 │               │                                                        │
 │               ▼                                                        │
 │   Telegram Bot (@Stream1_X_bot)                                        │
 │   - Access Control: Whitelisted User IDs                               │
 │   - Media Relay: Forward to Service Channel / Owner DM                 │
 └───────────────┬────────────────────────────────────────────────────────┘
                 │ Webhook / Asynchronous HTTP Polling
                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      CLOUD & LOCAL PROCESSING PIPELINE                 │
 │                                                                        │
 │   FastAPI Backend Engine (Render / Docker / Local Host)                │
 │   ├── Ingestion Queue: SQLite state machine (aiosqlite + SQLAlchemy)   │
 │   ├── MTProto Worker: Telethon 8MB sequential chunk streaming          │
 │   ├── RAM Ring Buffer: Bounded in-flight buffer (<= 32MB RAM, 0B disk) │
 │   ├── Drive Upload Engine: Resumable HTTP 308 streaming to Google Drive│
 │   └── Metadata Worker: TMDB v3 + AniList + Sibling Cascade Engine     │
 └───────────────┬────────────────────────────────────────────────────────┘
                 │ Committed Master Uploads
                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                     GOOGLE DRIVE MASTER STORAGE                        │
 │                                                                        │
 │   5.0 TB Sovereign Cloud Storage                                       │
 │   └── StreamX/                                                         │
 │       ├── Movies/      (Feature films)                                 │
 │       ├── TV Shows/    (Western / Live-action series)                  │
 │       ├── Anime/       (Japanese anime series & movies)                │
 │       └── Other/       (Unclassified media)                            │
 └───────────────┬────────────────────────────────────────────────────────┘
                 │ Authenticated Direct Stream & Range Headers
                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      EDGE PROXY & RESILIENCE LAYER                     │
 │                                                                        │
 │   Cloudflare Worker (streamx-worker.workers.dev)                       │
 │   ├── Active Tunnel Router: Proxies to local PC if online              │
 │   ├── 24/7 Edge Fallback: Operates autonomously when PC is offline     │
 │   ├── Direct Drive Streamer: HTTP 206 Partial Content video streaming │
 │   ├── Image Proxy: Caches TMDB & AniList posters across ISP blocks     │
 │   └── M3U Playlist Generator: Zero-latency streaming for VLC / IINA    │
 └───────────────┬────────────────────────────────────────────────────────┘
                 │
                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                         CONSUMPTION LAYER                              │
 │                                                                        │
 │   Vercel Edge Frontend (React 19, TypeScript, Vite 8)                  │
 │   ├── Netflix-Style Mobile-First UI (Carousels, Hero Spotlight)        │
 │   ├── Series Hub: Unified Season & Episode Selector                    │
 │   ├── Hardware Playback: Direct VLC Launching (Android Intent, iOS)    │
 │   ├── Watch Tracking: Authoritative WatchProgress server-sync          │
 │   └── Device Offline Storage: Storage Access Framework / PWA Storage   │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Ingestion Pipeline & Zero-Disk In-Flight Streaming

Traditional media transfer utilities download complete multi-gigabyte video files onto local disk storage before initiating cloud uploads. On resource-constrained free-tier cloud containers (512MB RAM, 1GB disk), handling a 15GB 4K BluRay rip triggers immediate out-of-disk crashes (`ENOSPC`).

### The Zero-Disk Streaming Mechanism
$$\text{Telegram MTProto (8MB Chunk)} \xrightarrow{\text{RAM Ring Buffer}} \text{Google Drive Resumable API} \xrightarrow{\text{HTTP 308 Resume}}$$

1. **Telegram Ingestion:** When an authorized user forwards a media file to the bot, `TelegramBotService` validates the sender ID against `TELEGRAM_ALLOWED_USER_IDS`.
2. **Media Relay Architecture:** Because the MTProto client runs under a single owner account, it cannot access messages sent to the bot by other users. The bot automatically forwards the message to a private `TELEGRAM_SERVICE_CHANNEL` or the owner's DM (`TELEGRAM_OWNER_USER_ID`), storing `forwarded_chat_id` and `forwarded_message_id` on the database record.
3. **Chunked Streaming:** The MTProto worker requests 8MB sequential byte slices via Telethon's MTProto client. Each slice is written directly to an in-memory buffer without touching disk.
4. **Resumable Drive Commits:** The chunk is uploaded to Google Drive's resumable session (`PUT` request with `Content-Range: bytes START-END/TOTAL`).
5. **Session Recovery:** If the container restarts midway through a 10GB transfer, `get_resumable_offset()` queries Google Drive with `bytes */TOTAL`, receives the last committed byte offset, and resumes without re-downloading earlier chunks.

---

## 3. Metadata Intelligence Architecture

Metadata enrichment is completely decoupled from media transfer, ensuring that external API delays or rate limits never block ingestion or playback.

```text
  Raw Filename
       │
       ▼
  Deterministic Parser (filename_parser.py)
  - Strips channel tags (@handle, [Channel])
  - Strips bracket noise & checksums
  - Extracts season, episode, quality, year
       │
       ▼
  Series Sibling Pre-Check (metadata_service.py)
  - Checks if sibling episode in library already established canonical entity
  - If match found, adopts canonical entity immediately (0ms API calls)
       │
       ▼ (If no sibling prematch)
  Multi-Variant Candidate Search
  - Queries TMDB v3 API and/or AniList GraphQL API
  - Searches clean title + normalized query variants
       │
       ▼
  Deterministic Confidence Scorer (confidence_scorer.py)
  - Title similarity ratio (75% weight)
  - Release year match (15% weight)
  - Media type alignment (10% weight)
  - Season/Part mismatch penalties
       │
       ├─────────────────────────────────┐
       ▼ (Score >= 0.86)                 ▼ (Score < 0.86)
  MATCHED Status                    LOW_CONFIDENCE Status
  - Attach Canonical Metadata       - Fallback to clean title
  - Cache MetadataEntity            - Await manual correction
  - Cascade to all sister episodes
```

---

## 4. Playback & Video Delivery Matrix

| Delivery Path | Protocol / Technology | Decode Mode | Latency / Seeking | Audio & Subtitles |
| :--- | :--- | :--- | :--- | :--- |
| **Path A: Native VLC (Android)** | Android Intent (`intent://...#Intent;package=org.videolan.vlc`) | Hardware Accelerated | Instant (~100ms) | Multi-audio tracks, ASS/SSA soft anime subtitles, 10-bit HEVC |
| **Path B: Native VLC (Desktop / iOS)** | Direct HTTP 206 Range Stream or dynamic `#EXTM3U` playlist | Hardware Accelerated | Instant (~100ms) | Full native subtitle rendering, zero host CPU transcoding load |
| **Path C: Web Browser** | HTML5 Video Element / H.264 MP4 Range Stream | Browser Native | Fast (~200ms) | WebVTT subtitles, AAC stereo |
| **Path D: Live Transcode** | Dynamic on-the-fly FFmpeg transmuxer | Software Transcode | Bounded (~2s buffer) | Transmuxes soft subtitles and multi-channel audio for web compatibility |

---

## 5. Storage Hierarchy & Organization

All media in Google Drive is structured into a clean directory tree:
```text
StreamX/
├── Movies/
│   └── Interstellar (2014)/
│       └── Interstellar.2014.1080p.BluRay.x264.mkv
├── TV Shows/
│   └── Breaking Bad/
│       ├── Breaking.Bad.S01E01.1080p.mkv
│       └── Breaking.Bad.S01E02.1080p.mkv
├── Anime/
│   └── Komi Can't Communicate/
│       ├── S01_01_komi_can't_communicate_Dual_1080p.mkv
│       └── S01_02_komi_can't_communicate_Dual_1080p.mkv
└── Other/
    └── uncategorized_document.bin
```

### Automatic Folder Maintenance
- `sync_library_to_db()`: Automatically scans Google Drive on startup and every 120s to catalog new uploads.
- `organize_existing_drive_media()`: Moves loose files in Google Drive into their dedicated show folders.
- `sync_folder_renames_and_reorganize()`: Detects if the user renames a folder in Google Drive (e.g. `Komi` $\to$ `Komi Can't Communicate`), cascades the rename to all contained video files, updates database records, and re-triggers metadata enrichment.
- `cleanup_empty_drive_folders()`: Safely trashes orphaned empty folders while protecting folders created within the last 2 hours.

---

## 6. Authentication & API Security

1. **Client Authorization:** Mutating endpoints (`/metadata/select`, `/metadata/backfill`, `/transfers/{id}/retry`, etc.) enforce `require_auth` verifying `STREAMX_API_KEY` with `hmac.compare_digest()`.
2. **CORS Governance:** Configured with strict origin regex allowing production domains (`streamx7.vercel.app`, `*.workers.dev`, `*.trycloudflare.com`) and local development loopback (`localhost:5173`, `localhost:8000`).
3. **SSRF Guard:** Image proxy endpoint strictly validates upstream image hostnames against an allowlist (`image.tmdb.org`, `s4.anilist.co`, `anilist.co`) and disables HTTP redirect following.
4. **Filename Sanitization:** All filenames in HTTP `Content-Disposition` headers and local filesystem calls pass through `sanitize_filename()`, preventing directory traversal (`../`) and HTTP header injection attacks.
