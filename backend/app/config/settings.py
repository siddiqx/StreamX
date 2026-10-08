"""StreamX Configuration System.

Environment-based settings using Pydantic Settings.
Never prints or logs secret credentials.
"""

from typing import List, Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App
    STREAMX_ENV: str = Field(default="development", description="Environment mode")
    STREAMX_SECRET_KEY: str = Field(default="insecure-dev-secret-replace-in-prod", description="App secret key")
    DATABASE_URL: str = Field(default="sqlite+aiosqlite:///./streamx.db", description="Database connection URL")
    LOG_LEVEL: str = Field(default="INFO", description="Logging verbosity")

    # Telegram
    TELEGRAM_BOT_TOKEN: Optional[str] = Field(default=None, description="Telegram Bot Token")
    TELEGRAM_API_ID: Optional[int] = Field(default=None, description="Telegram MTProto API ID")
    TELEGRAM_API_HASH: Optional[str] = Field(default=None, description="Telegram MTProto API Hash")
    TELEGRAM_SESSION_STRING: Optional[str] = Field(default=None, description="Telegram MTProto Session String")
    TELEGRAM_ALLOWED_USER_IDS: Optional[str] = Field(
        default="8142877259,7344705202",
        description="Comma-separated user IDs allowed to interact with the bot",
    )
    # Telegram Media Relay: the MTProto worker runs under ONE user account (owner)
    # and cannot read messages sent to the bot by OTHER users. The bot must
    # forward every accepted file into a shared location the MTProto account can
    # read. Preferred = a channel/group both the bot and MTProto account join.
    # Fallback = the owner's user ID (bot DMs the owner; MTProto reads its DMs).
    TELEGRAM_SERVICE_CHANNEL: Optional[str] = Field(
        default=None, description="Channel/group (username or ID) for bot->MTProto media relay"
    )
    TELEGRAM_OWNER_USER_ID: Optional[int] = Field(
        default=None, description="Owner Telegram user ID (MTProto session owner). Forward fallback target."
    )

    # Google Drive
    GOOGLE_CLIENT_ID: Optional[str] = Field(default=None, description="Google OAuth Client ID")
    GOOGLE_CLIENT_SECRET: Optional[str] = Field(default=None, description="Google OAuth Client Secret")
    GOOGLE_REFRESH_TOKEN: Optional[str] = Field(default=None, description="Google OAuth Refresh Token")
    GOOGLE_DRIVE_ROOT_FOLDER_ID: Optional[str] = Field(default=None, description="Target Drive Root Folder ID")

    # Streaming & Worker
    CHUNK_BUFFER_SIZE_BYTES: int = Field(default=8 * 1024 * 1024, description="In-memory chunk buffer (8MB)")
    MAX_RETRIES: int = Field(default=3, description="Bounded retry attempts")

    # TMDB Metadata Provider
    TMDB_API_KEY: Optional[str] = Field(
        default=None, description="The Movie Database (TMDB) API key or v4 read token"
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_telegram_users(self) -> List[int]:
        users: List[int] = [8142877259, 7344705202]
        if self.TELEGRAM_ALLOWED_USER_IDS:
            for item in self.TELEGRAM_ALLOWED_USER_IDS.split(","):
                item = item.strip()
                if item.isdigit():
                    uid = int(item)
                    if uid not in users:
                        users.append(uid)
        return users


settings = Settings()
