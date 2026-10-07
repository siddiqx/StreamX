"""Database configuration and asynchronous session factory."""

from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from app.config.settings import settings

# Async engine for SQLite
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that provides an asynchronous database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


def _migrate_schema_sync(connection):
    """Safely apply column additions and indexes for existing SQLite databases."""
    res = connection.exec_driver_sql("PRAGMA table_info(media)").fetchall()
    existing_cols = {row[1] for row in res}
    if existing_cols:
        if "metadata_entity_id" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN metadata_entity_id INTEGER REFERENCES metadata_entities(id) ON DELETE SET NULL")
        if "metadata_status" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN metadata_status VARCHAR(32) DEFAULT 'PENDING'")
        if "metadata_confidence" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN metadata_confidence FLOAT")
        if "metadata_locked" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN metadata_locked BOOLEAN DEFAULT 0")
        if "poster_override" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN poster_override VARCHAR(1024)")
        if "backdrop_override" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN backdrop_override VARCHAR(1024)")
        if "media_type" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN media_type VARCHAR(32)")
        if "season" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN season INTEGER")
        if "episode" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN episode INTEGER")
        if "quality" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN quality VARCHAR(64)")
        if "release_group" not in existing_cols:
            connection.exec_driver_sql("ALTER TABLE media ADD COLUMN release_group VARCHAR(128)")

        # Create indexes if they do not exist
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_media_metadata_entity_id ON media (metadata_entity_id)")
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_media_metadata_status ON media (metadata_status)")
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_media_media_type ON media (media_type)")

    res_ent = connection.exec_driver_sql("PRAGMA table_info(metadata_entities)").fetchall()
    existing_ent_cols = {row[1] for row in res_ent}
    if existing_ent_cols:
        if "category" not in existing_ent_cols:
            connection.exec_driver_sql("ALTER TABLE metadata_entities ADD COLUMN category VARCHAR(64)")
        if "original_language" not in existing_ent_cols:
            connection.exec_driver_sql("ALTER TABLE metadata_entities ADD COLUMN original_language VARCHAR(32)")
        if "origin_country" not in existing_ent_cols:
            connection.exec_driver_sql("ALTER TABLE metadata_entities ADD COLUMN origin_country VARCHAR(64)")
        connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_metadata_entities_category ON metadata_entities (category)")


async def init_db() -> None:
    """Initialize database tables and run safe migrations."""
    # Ensure all models are registered with Base.metadata
    from app.db import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_migrate_schema_sync)

