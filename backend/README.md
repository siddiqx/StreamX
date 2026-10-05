# StreamX Backend

Asynchronous Python backend providing:
- FastAPI REST API for media catalog and transfers.
- Telegram Bot integration for forwarding media.
- MTProto client for large file streaming.
- Resumable Google Drive upload engine with SQLite-backed state recovery.

## Structure
```
backend/
├── app/
│   ├── api/          # Route handlers (health, transfers, media, etc.)
│   ├── config/       # Pydantic Settings & environment config
│   ├── db/           # SQLite database engine, session, & SQLAlchemy models
│   ├── schemas/      # Pydantic request/response schemas
│   ├── services/     # Business logic (Telegram, Drive, Transfers, Media)
│   ├── utils/        # Logging, sanitize filenames, hashing
│   ├── workers/      # Resumable transfer background workers
│   └── main.py       # FastAPI application entrypoint
├── tests/            # Pytest test suite
├── requirements.txt  # Python package specifications
└── README.md
```
