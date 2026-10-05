# StreamX Troubleshooting Guide

## 1. Telegram Ingestion Issues
- **Problem**: Bot doesn't reply when media is forwarded.
  - Check bot token validity in `.env`.
  - Check that the bot process is running and polling or webhook is healthy.
  - Verify that your user ID is listed in `TELEGRAM_ALLOWED_USER_IDS` if access control is enabled.
- **Problem**: MTProto authentication throws `FloodWaitError`.
  - Telegram enforces flood limits if requests or logins happen too rapidly.
  - Wait the number of seconds requested in the error message. Do not restart in a loop.

## 2. Google Drive Upload Issues
- **Problem**: `TokenExpiredError` or `invalid_grant`.
  - Re-generate the refresh token using `scripts/auth_google_drive.py`.
  - Check whether the OAuth Consent Screen status in Google Cloud Console is "Testing" (testing tokens may expire every 7 days unless the app is published to production or self-user test is refreshed).
- **Problem**: Quota exceeded (`userRateLimitExceeded` / `storageQuotaExceeded`).
  - Check your Google Drive storage quota.
  - StreamX worker marks transfer status as `PAUSED_QUOTA_EXCEEDED` and halts retries until quota clears.

## 3. Worker Process & Memory Issues
- **Problem**: Free host kills process with OOM (Out Of Memory).
  - Reduce `CHUNK_BUFFER_SIZE_BYTES` in `.env` to `4194304` (4MB).
  - Verify that no temporary files are being accumulated in `/tmp`.
