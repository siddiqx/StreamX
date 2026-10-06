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
        default="", description="Comma-separated user IDs allowed to interact with the bot"
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
    TMDB_API_KEY: Optional[str] = Field(default=None, description="The Movie Database (TMDB) API Key")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_telegram_users(self) -> List[int]:
        if not self.TELEGRAM_ALLOWED_USER_IDS:
            return []
        users = []
        for item in self.TELEGRAM_ALLOWED_USER_IDS.split(","):
            item = item.strip()
            if item.isdigit():
                users.append(int(item))
        return users


settings = Settings()
