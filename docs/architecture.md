# StreamX System Architecture & Design Specification

## 1. System Overview

StreamX is an automated media transfer pipeline and offline media player designed for personal use. It eliminates the need to keep Telegram or a local PC open while downloading large files, transferring media directly from Telegram to Google Drive via an ultra-low-footprint cloud worker, and then allowing resumable offline caching on Android devices.

## 2. Component Diagram

```text
+--------------------------------------------------------------------------+
|                              TELEGRAM                                    |
|   +-----------------------+              +---------------------------+   |
|   |   @StreamXBot         |              |   Telegram MTProto Server |   |
|   |   (Command/Ingest)    |              |   (Media Storage / DC)    |   |
|   +-----------+-----------+              +-------------+-------------+   |
+---------------|----------------------------------------|-----------------+
                | New media forwarded                    |
                v                                        | Chunked download
+--------------------------------------------------------|-----------------+
|                       STREAMX BACKEND & WORKER         |                 |
|                                                        v                 |
|   +-----------------------+             +----------------------------+   |
|   | FastAPI Web API       |             | In-Memory Chunk Pipeline   |   |
|   | - Health Check        |             | (8MB - 16MB ring buffer)   |   |
|   | - Library API         |             +--------------+-------------+   |
|   | - Transfer State API  |                            |                 |
|   | - Metadata API        |                            | Chunked stream  |
|   +-----------+-----------+                            v upload          |
|               |                         +----------------------------+   |
|   +-----------v-----------+             | Google Drive API Service   |   |
|   | SQLite State DB       |             | (Resumable Upload Session) |   |
|   | - transfers           |             +--------------+-------------+   |
|   | - media               |                            |                 |
|   | - metadata_entities   |             +--------------v-------------+   |
|   | - metadata_jobs       |             | Metadata Background Worker |   |
|   | - device_downloads    |             | (TMDB / Confidence Scorer) |   |
|   +-----------------------+             +----------------------------+   |
+--------------------------------------------------------|-----------------+
                                                         v
+--------------------------------------------------------------------------+
|                       GOOGLE DRIVE MASTER STORAGE                        |
|                                                                          |
|   StreamX/                                                               |
|   ├── Movies/                                                            |
|   ├── TV Shows/                                                          |
|   ├── Anime/                                                             |
|   └── Other/                                                             |
+------------------------------------+-------------------------------------+
                                     |
                                     | Direct / Proxy download
                                     v
+--------------------------------------------------------------------------+
|                       STREAMX ANDROID APP                                |
|                                                                          |
|   +------------------------------------------------------------------+   |
|   | React + Vite UI (Mobile Optimized)                               |   |
|   | - Media catalog, search, status, downloads view                  |   |
|   +--------------------------------+---------------------------------+   |
|                                    |                                     |
|   +--------------------------------v---------------------------------+   |
|   | Android Download Engine (Resumable, Wi-Fi policy, SAF)           |   |
|   | -> Writes to Scoped Storage: `Internal Storage/StreamX/Downloads`|   |
|   +--------------------------------+---------------------------------+   |
|                                    |                                     |
|   +--------------------------------v---------------------------------+   |
|   | Embedded Offline Player (ExoPlayer/Native: MKV, MP4, H.265, Subs)|   |
|   +------------------------------------------------------------------+   |
+--------------------------------------------------------------------------+
```

## 3. Core Architectural Decisions

### 3.1 Streaming In-Memory Transfer (Zero Full-Disk Requirement)
- Free tier hosts (such as Silly Development with ~512MB disk or Enzonic with limited persistent storage) cannot store 10GB–20GB media files on local disk.
- StreamX utilizes a chunked streaming pipe:
  1. Requests chunks (e.g. 4MB–8MB) from Telegram via MTProto.
  2. Forwards chunk bytes into Google Drive's resumable upload HTTP endpoint (`PUT` with `Content-Range`).
  3. Commits state after each acknowledged range.
- Peak memory usage is bounded to the size of the active chunk buffer (e.g. 16MB), comfortably running within 256MB–512MB RAM constraints.

### 3.2 State Machine & Fault Tolerance
Transfers are tracked in SQLite through explicit states:
- `QUEUED`: Enqueued from Telegram bot.
- `FETCHING_TELEGRAM`: Worker engaged MTProto connection.
- `UPLOADING_DRIVE`: Active resumable upload stream.
- `VERIFYING`: MD5/size check against Google Drive file metadata.
- `COMPLETED`: Master file successfully stored and cataloged in `media`.
- `FAILED`: Failure recorded with reason; evaluated for bounded exponential retry.
- `CANCELLED`: User or worker cancelled.

If the worker restarts or crashes midway through an upload, the resumable session URI and byte offset stored in SQLite allow resuming without re-transferring previously committed bytes.

### 3.3 Storage Access Framework (SAF) on Android
Android 11+ enforces scoped storage. StreamX uses the Storage Access Framework (SAF) or app-specific media directories (`Context.getExternalFilesDir` or user-picked tree URI) to persist offline media securely across reboots without requiring legacy root or all-files permissions.
