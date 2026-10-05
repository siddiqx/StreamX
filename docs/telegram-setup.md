# Telegram Setup Guide

StreamX uses two separate layers of Telegram integration:
1. **StreamX Bot** (`@BotFather`): Handles user commands (`/start`, `/help`) and immediate forward ingestion acknowledgment.
2. **MTProto Client Session**: Enables fast, chunked streaming of arbitrary large files (up to 2GB or 4GB Premium) that standard Bot API endpoints cannot download.

---

## Part 1: Obtaining the Bot Token (For Phase 2)

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot`.
3. Provide a friendly name (e.g. `My StreamX Bot`) and a unique username ending in `bot` (e.g. `MyStreamX_bot`).
4. `@BotFather` will reply with your **Bot Token** in the format:
   `1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ_1234567`
5. Save this token securely for `TELEGRAM_BOT_TOKEN`.

---

## Part 2: Obtaining MTProto API ID & API Hash (For Phase 3)

1. Sign in with your phone number at [https://my.telegram.org](https://my.telegram.org).
2. Click **API development tools**.
3. Create a new application with an App title (e.g. `StreamX Worker`) and short name (e.g. `streamx`).
4. Note the:
   - **`App api_id`** (numeric integer, e.g. `12345678`)
   - **`App api_hash`** (32-character hexadecimal string)
5. Save these securely for `TELEGRAM_API_ID` and `TELEGRAM_API_HASH`.

---

## Part 3: Generating Session String (For Phase 3)

- During Phase 3, StreamX provides an interactive, standalone script (`scripts/generate_session.py`) that prompts for your phone number, the verification code sent to your Telegram app, and your two-factor authentication (2FA) password if enabled.
- It outputs an encrypted `TELEGRAM_SESSION_STRING`.
- **Security Rule**: The session string is strictly stored in your local `.env` and host environment. It is never logged, exposed via web endpoints, or committed to Git.
