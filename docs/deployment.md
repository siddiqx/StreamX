# Free-Tier Cloud Deployment Guide

## 1. Hosting Candidates Analysis

StreamX is engineered with zero-cost infrastructure requirements.

### Candidate A: Enzonic Cloud (Primary)
- **Characteristics**: Free tier includes up to 3.5GB RAM and containerized application hosting.
- **Suitability for StreamX**: Excellent RAM headroom for chunk buffering and Python async runtime.
- **Key Consideration**: Servers may enter sleep/hibernation if there is no continuous traffic. A periodic heartbeat cron or webhook-driven trigger can be utilized.

### Candidate B: Silly Development / SillyDev (Fallback)
- **Characteristics**: Pterodactyl-based free Python/Node bot hosting with 256MB RAM and 512MB disk space.
- **Suitability for StreamX**: 256MB RAM requires strict memory controls (chunk buffer capped at 8MB–16MB). 512MB disk confirms that our streaming zero-disk architecture is strictly required.

### Candidate C: Render / Hugging Face Spaces / Koyeb (Alternative Fallbacks)
- Standard free container tiers supporting continuous or long-polling Python processes with strict egress and inactivity guidelines.

## 2. Environment Configuration
On your hosting provider's dashboard, configure the environment variables as detailed in `.env.example`:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_STRING`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `STREAMX_SECRET_KEY`

## 3. Deployment Steps
1. Push repository code to your private GitHub repo.
2. Link the repository or upload the backend source to the host.
3. Configure the start command:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
4. Check health endpoint `GET /health` to confirm process availability.
