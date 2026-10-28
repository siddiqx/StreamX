# StreamX: System Architecture & Technical Specification

**Document Version:** 2.0.0  
**Updated:** October 2026  
**System:** StreamX Personal Media Platform  
**Detailed Documentation:** See `docs/ARCHITECTURE.md` for full diagrams and specifications.

---

## 1. System Overview

StreamX is an enterprise-grade personal media streaming ecosystem and Netflix-inspired library application. It connects Telegram ingestion to Google Drive master storage (5.0 TB) via an asynchronous, zero-disk in-memory streaming pipeline, serving media to a mobile-first React 19 web app and native hardware VLC players.

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

For the comprehensive specification, refer to [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
