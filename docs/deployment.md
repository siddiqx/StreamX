# StreamX: Deployment Runbook & Infrastructure Guide

**Document Version:** 1.0.0  
**Updated:** October 2026  
**System:** StreamX Production Deployment Architecture

---

## 1. Production Deployment Topology

StreamX operates across a hybrid multi-cloud topology designed for continuous 24/7 availability at zero hosting cost:

| Component | Host / Platform | URL / Endpoint | Configuration File |
| :--- | :--- | :--- | :--- |
| **Frontend Web App** | Vercel (Edge CDN) | `https://streamx7.vercel.app` | `frontend/vercel.json` |
| **Edge Gateway & Proxy** | Cloudflare Workers | `https://streamx-worker.siddiqsiddiq00012.workers.dev` | `wrangler.toml`, `scripts/cloudflare_worker.js` |
| **Primary Backend** | Render / Docker | `https://streamx-backend-cqm0.onrender.com` | `backend/Dockerfile` |
| **Secondary Cloud Host**| Hugging Face Spaces | `https://huggingface.co/spaces/...` | `app.py` |
| **Local Host / Tunnel** | Local Machine + Cloudflare Tunnel | Dynamically reported in `active_tunnel.txt` | `run_server.py` |
| **Master Media Vault** | Google Drive (5TB) | Sovereign Cloud | `backend/app/services/drive_service.py` |

---

## 2. Frontend Deployment (Vercel)

### 2.1 Configuration (`frontend/vercel.json`)
```json
{
  "installCommand": "npm install --include=dev",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "headers": [
    {
      "source": "/sw.js",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
    },
    {
      "source": "/manifest.json",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ],
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### 2.2 Vercel Build Verification
- Project root setting on Vercel: `frontend`
- Build command: `npm run build` (`tsc -b && vite build`)
- Node.js runtime: Node 20+

---

## 3. Edge Gateway Deployment (Cloudflare Worker)

### 3.1 Configuration (`wrangler.toml`)
```toml
name = "streamx-worker"
main = "scripts/cloudflare_worker.js"
compatibility_date = "2024-01-01"
```

### 3.2 Deployment Command
```bash
npx wrangler deploy
```

### 3.3 Autonomous Capabilities
- Dynamically proxies to the developer's PC whenever `active_tunnel.txt` has a valid tunnel URL.
- When the local PC is offline, serves dynamic catalog queries directly from Google Drive or `scripts/catalog_snapshot.json`.
- Streams 1080p/4K MKV/MP4 files from Google Drive directly with HTTP 206 Partial Content headers.
- Handles Telegram bot commands and accepts media forwards.

---

## 4. Backend Deployment Options

### Option A: Render Container (`backend/Dockerfile`)
Uses Python 3.12-slim with FFmpeg:
```dockerfile
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m -u 1000 -s /bin/bash streamx && mkdir -p /data /app && chown -R streamx:streamx /app /data
USER streamx
EXPOSE 8000
CMD sh -c "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"
```

### Option B: Local PC with Dedicated Launcher (`run_server.py`)
```bash
python run_server.py
```
- Engages Windows 24/7 Power Lock (`SetThreadExecutionState`) to prevent sleep/hibernation while StreamX is running.
- Prepend `backend/` to `sys.path` to prevent module collision.

### Option C: Hugging Face Spaces (`app.py`)
- Free cloud container hosting.
- Runs Gradio status dashboard mounted alongside FastAPI.

---

## 5. Local Development Runbook

### Prerequisites
- Python 3.11+
- Node.js 20+ & npm
- FFmpeg installed and in PATH (for live web browser transmuxing)

### Step 1: Backend Setup
```bash
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
# source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env  # Configure secrets
uvicorn app.main:app --port 8000 --reload
```

### Step 2: Frontend Setup
```bash
cd frontend
npm install
npm run dev
# Accessible at http://localhost:5173
```

### Step 3: Run Test Suite
```bash
pytest -v
cd frontend && npm run build
```

---

## 6. Safe Deployment & Rollback Checklist

Before deploying changes:
1. Verify that all unit and integration tests pass locally.
2. Confirm that `.env` credentials are NEVER included in Git commits.
3. Test with a local build (`npm run build` in `frontend/`).
4. Ensure PRAGMA migrations in `backend/app/db/database.py` are non-destructive.
5. In the event of a regression on Vercel, use Vercel's Instant Rollback feature to revert to the previous production deployment hash in seconds.
