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

---

## Part 4: Configuring the Media Relay (Required for non-owner uploads)

The MTProto transfer worker runs under a **single user account** (the account that
generated `TELEGRAM_SESSION_STRING`). That account can only read messages in chats
it participates in — it **cannot** read messages that *another user* sent to the bot.

To let friends and other allowed users upload files, the bot **forwards** every
accepted media message into a shared location the MTProto account can read, and the
worker downloads that forwarded copy. Configure **one** of the following:

### Option A — Service Channel (recommended for production)

Create a **private channel or group** that **both** the StreamX bot **and** your
MTProto account are members of (the bot must be admin with "Post Messages" /
"Add Members" permission):

1. Create a private channel, e.g. `StreamX Relay`.
2. Add `@YourStreamXBot` as an **admin** (grant it the ability to post messages).
3. Add your own user account (the one whose session string you generated) as a
   member.
4. Copy the channel link/username and set it:

```env
TELEGRAM_SERVICE_CHANNEL=@StreamX_Relay
```

### Option B — Owner DM (fallback)

If you do not want a separate channel, the bot can forward media into a direct
message with the **owner's** Telegram user id (the account that owns the MTProto
session). The owner must have already started the bot:

```env
TELEGRAM_OWNER_USER_ID=8142877259
```

> Without one of these configured, only files sent **by the MTProto account owner**
> will download successfully. Files sent by other users will be queued and then
> fail (the owner's session cannot reach them) — you will see
> `TELEGRAM_MESSAGE_NOT_FOUND` in diagnostics.
