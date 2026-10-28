# StreamX: Agent Instructions & Architecture Guardrails

**Scope:** Workspace Root Instructions for AI Assistants  
**Repository:** `d:\02_Projects\StreamX`

---

## Operating Invariants

1. **Read-Only Inspection First:** Always inspect existing code and architecture before editing. Never assume a file or function exists without reading it.
2. **Preserve Zero-Disk Architecture:** The in-flight streaming pipeline transfers media from Telegram MTProto directly to Google Drive's Resumable API using an 8MB in-memory ring buffer ($\le 32\text{ MB}$ RAM, 0 bytes disk). Do not introduce intermediate disk caching for cloud transfers.
3. **24/7 Edge Autonomous Mode:** The Cloudflare Worker (`scripts/cloudflare_worker.js`) at `https://streamx-worker.siddiqsiddiq00012.workers.dev` is the resilient public gateway. It directly queries Google Drive, accepts Telegram bot webhooks, and streams video with HTTP 206 Partial Content when the local backend is offline.
4. **Metadata Confidence & Deduplication:** Maintain high confidence thresholds ($\ge 0.86$) in `confidence_scorer.py`. Cascade canonical metadata across sibling episodes. Respect `metadata_locked = True` for user overrides.
5. **Protect Credentials:** Exclude `.env` and session strings from version control. Never log secrets.
6. **No Destructive Database Changes:** Retain PRAGMA migrations in `app/db/database.py`. Never drop tables or reset SQLite databases.
7. **Deploy Only With Authorization:** Do not push to remote branches or trigger production builds without explicit user consent.
