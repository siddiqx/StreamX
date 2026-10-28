# StreamX: External Integrations & Service Architecture

**Document Version:** 1.0.0  
**Updated:** October 2026  
**System:** StreamX Integrations Reference

---

## 1. Telegram Ingestion Integration

StreamX combines the Telegram Bot API with Telethon's MTProto client to achieve secure, unconstrained media ingestion.

### 1.1 Architecture & Flow
- **Bot Ingestion:** Uses standard HTTP long-polling or webhook receiver (`/telegram/webhook`).
- **Authorization Enforcement:** Every incoming update is checked against `TELEGRAM_ALLOWED_USER_IDS`. Unauthorized requests receive a polite rejection and are logged.
- **Media Relay Mechanism:** Because the MTProto transfer worker operates under a single user session (`TELEGRAM_SESSION_STRING`), it cannot access files sent to the bot by third-party users. To resolve this:
  - When a non-owner uploads a file, the bot automatically forwards it to `TELEGRAM_SERVICE_CHANNEL` (or `TELEGRAM_OWNER_USER_ID` DM).
  - The forward destination is stored on `TelegramTransfer` (`forwarded_chat_id`, `forwarded_message_id`).
  - The MTProto worker reads the forwarded message directly.
- **Chunked Transfer:** Telethon iterates over document bytes in 8MB blocks (`iter_download_chunks`), streaming them directly into the Google Drive upload pipeline.

### Required Environment Variables
```ini
TELEGRAM_BOT_TOKEN=              # Bot API token from @BotFather
TELEGRAM_API_ID=                 # MTProto API ID from my.telegram.org
TELEGRAM_API_HASH=               # MTProto API Hash from my.telegram.org
TELEGRAM_SESSION_STRING=         # Telethon StringSession string
TELEGRAM_ALLOWED_USER_IDS=       # Comma-separated allowed Telegram user IDs
TELEGRAM_SERVICE_CHANNEL=        # Channel/group username or ID for media relay
TELEGRAM_OWNER_USER_ID=          # Telegram ID of the MTProto session owner
TELEGRAM_WEBHOOK_SECRET=         # Secret token for incoming webhook verification
```

---

## 2. Google Drive Master Storage Integration

Google Drive serves as the sovereign 5.0 TB permanent master vault for all media.

### 2.1 Resumable Upload Engine
- Rather than standard multipart uploads, StreamX creates a **Resumable Upload Session** via `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`.
- Chunks (8MB) are streamed via HTTP `PUT` with `Content-Range: bytes START-END/TOTAL`.
- Google Drive returns `HTTP 308 Resume Incomplete` after each chunk.
- When the container or process restarts, `get_resumable_offset()` issues `bytes */TOTAL` to retrieve the committed byte offset and resume the upload without data duplication.
- Upon completion, `verify_file()` checks the file's ID, existence, and byte size against Google Drive's API.

### 2.2 OAuth Token Lifecycle
- Uses Google OAuth 2.0 with the `https://www.googleapis.com/auth/drive` scope.
- `GoogleDriveService.get_credentials()` checks token validity and refreshes automatically in an asynchronous thread executor via `credentials.refresh(Request())`.

### 2.3 Automatic Folder Management
- Root directory: `StreamX/`
- Category partitions: `Movies/`, `TV Shows/`, `Anime/`, `Other/`
- Show folders: Automatically creates dedicated subfolders (e.g. `StreamX/Anime/Komi Can't Communicate/`) and moves incoming files inside.
- Empty folder cleanup: Periodically trashes empty folders that are older than 2 hours.

### Required Environment Variables
```ini
GOOGLE_CLIENT_ID=                # OAuth 2.0 Client ID from Google Cloud Console
GOOGLE_CLIENT_SECRET=            # OAuth 2.0 Client Secret
GOOGLE_REFRESH_TOKEN=            # OAuth 2.0 Refresh Token
GOOGLE_DRIVE_ROOT_FOLDER_ID=     # Optional root folder ID override
CHUNK_BUFFER_SIZE_BYTES=8388608  # In-memory chunk size (default: 8MB)
```

---

## 3. Metadata Providers (TMDB & AniList)

StreamX queries both The Movie Database (TMDB) and AniList to obtain comprehensive international metadata.

### 3.1 The Movie Database (TMDB v3 API)
- **Base URL:** `https://api.themoviedb.org/3`
- **Endpoints:**
  - Search: `/search/movie`, `/search/tv`
  - Details: `/movie/{id}`, `/tv/{id}`
- **Authentication:** `api_key` query parameter or Bearer token header.
- **Artwork Construction:**
  - Poster: `https://image.tmdb.org/t/p/w500/{poster_path}`
  - Backdrop: `https://image.tmdb.org/t/p/w1280/{backdrop_path}`

### 3.2 AniList (GraphQL API)
- **Base URL:** `https://graphql.anilist.co`
- **Method:** `POST` with GraphQL queries.
- **Usage:** Provides anime cover artwork, Japanese titles, synonyms, and episodic counts for anime series.
- **Artwork Construction:** Full absolute URLs stored on AniList's CDN (`s4.anilist.co`).

### Required Environment Variables
```ini
TMDB_API_KEY=                    # TMDB API v3 Key or v4 Read Access Token
```

---

## 4. Cloudflare Worker Edge Gateway

Located at `scripts/cloudflare_worker.js` and deployed to `https://streamx-worker.siddiqsiddiq00012.workers.dev`.

### 4.1 Operational Modes
1. **Proxy Mode (PC Active):** When the developer's computer is running and Cloudflare Tunnel is connected (`active_tunnel.txt`), the worker forwards all traffic transparently to the local backend.
2. **Autonomous Edge Mode (PC Offline / Sleeping):** When the backend is offline:
   - **Catalog Reconciliation:** Queries Google Drive API directly or serves `catalog_snapshot.json`.
   - **Direct Video Streaming:** Streams 1080p/4K MKV/MP4 files from Google Drive with full `Range: bytes=start-end` support directly to VLC and web players.
   - **Telegram Webhook:** Accepts bot commands (`/start`, `/status`, `/library`, `/ping`), queues media uploads, and forwards files to the owner.
   - **Image Proxy:** Caches upstream poster images at edge CDN points (`/media/image-proxy`).

### Cloudflare Worker Environment Secrets
```ini
GOOGLE_CLIENT_ID=                # Shared with backend
GOOGLE_CLIENT_SECRET=            # Shared with backend
GOOGLE_REFRESH_TOKEN=            # Shared with backend
TELEGRAM_BOT_TOKEN=              # Shared with backend
TELEGRAM_OWNER_USER_ID=          # Shared with backend
TELEGRAM_ALLOWED_USER_IDS=       # Shared with backend
TELEGRAM_WEBHOOK_SECRET=         # Secret token for webhook verification
BACKEND_URL=                     # Optional override for backend proxy target
```

---

## 5. Device Storage & Offline Player Integration

### 5.1 Playback Launchers
- **Android Intent:** Launches native VLC via `intent://...#Intent;action=android.intent.action.VIEW;type=video/*;package=org.videolan.vlc`.
- **iOS Protocol:** Uses `vlc-x-callback://` and `vlc://` protocol schemes.
- **Desktop M3U:** Generates live `#EXTM3U` playlists with `#EXTVLCOPT:http-reconnect=true` and launches via the browser or backend subprocess.

### 5.2 Device Offline Storage
- **Progressive Web App (PWA):** Caches frontend assets via service worker (`sw.js`).
- **Offline Download Queue:** Device-local downloads are tracked in `DeviceDownload` and written to device storage using HTML5 FileSystem / Quota APIs or Capacitor Android Scoped Storage.
