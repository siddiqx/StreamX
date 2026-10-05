# StreamX

StreamX is a personal media management, transfer, and offline playback system that unifies Telegram, Google Drive, and Android device storage into a seamless, automated workflow.

## The Concept

- **Telegram**: The ingestion source (forward media to the bot).
- **Google Drive**: The permanent, master library.
- **Android Device**: The temporary, high-performance offline playback cache.

```text
USER
 │
 │ forwards media
 ▼
TELEGRAM (@StreamXBot)
 │
 │ webhook / notification
 ▼
STREAMX CLOUD WORKER
 │
 ├── MTProto Client (retrieves large chunks)
 ├── Chunk-streaming buffer (zero full-disk requirement)
 └── Google Drive Resumable API (uploads master copy)
         │
         ▼
    GOOGLE DRIVE (Master Library)
         │
         ▼ (StreamX API)
    STREAMX ANDROID APP
         │
         ▼
    DEVICE STORAGE (Scoped / SAF)
         │
         ▼
    OFFLINE PLAYER (Zero Internet Required)
```

## Repository Structure

```text
StreamX/
├── backend/            # FastAPI + SQLite + MTProto + Google Drive worker
├── frontend/           # Modern React + Vite + TypeScript media UI
├── android/            # Native wrapper & background download engine
├── docs/               # Technical specs, architecture, setups, and runbooks
├── scripts/            # Helper & migration scripts
├── .env.example        # Environment variable specification
└── docker-compose.yml  # Local developer environment orchestration
```

## Getting Started

See [docs/architecture.md](docs/architecture.md) for architectural details and [docs/deployment.md](docs/deployment.md) for running StreamX.
