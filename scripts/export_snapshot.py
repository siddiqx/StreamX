"""StreamX Catalog Snapshot Exporter.

Exports all media and canonical metadata from the local database
to scripts/catalog_snapshot.json using atomic temp-file replacement.

Invariants:
- Preserves full Unicode / Japanese character fidelity (ensure_ascii=False).
- Atomic replacement (writes to .tmp first, verifies, then os.replace).
- ZERO git side-effects (never executes git push or commit).
- Resolves database dynamically from settings or explicit CLI/arg parameter.
"""

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Add backend directory to sys.path so app modules can be imported
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
BACKEND_DIR = REPO_ROOT / "backend"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

logger = logging.getLogger("export_snapshot")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


async def export_catalog_snapshot(
    output_path: Optional[str] = None,
    db_url: Optional[str] = None,
    session: Optional[Any] = None,
    dry_run: bool = False,
) -> Tuple[int, str]:
    """Export the media catalog to a validated JSON snapshot atomically.

    Args:
        output_path: Target path for the snapshot JSON. Defaults to scripts/catalog_snapshot.json.
        db_url: Optional custom database URL override.
        session: Optional active AsyncSession to reuse.
        dry_run: If True, validates serialization without overwriting the target file.

    Returns:
        Tuple of (item_count, final_output_path).
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.config.settings import settings
    from app.db.database import AsyncSessionLocal, engine
    from app.db.models import Media
    from app.api.media import format_media_item

    target_path = Path(output_path) if output_path else (SCRIPT_DIR / "catalog_snapshot.json")
    target_path = target_path.resolve()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_suffix(".json.tmp")

    close_session = False
    active_session = session

    if active_session is None:
        if db_url and db_url != settings.DATABASE_URL:
            from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
            custom_engine = create_async_engine(
                db_url,
                echo=False,
                connect_args={"check_same_thread": False} if "sqlite" in db_url else {},
            )
            custom_maker = async_sessionmaker(bind=custom_engine, expire_on_commit=False)
            active_session = custom_maker()
            close_session = True
        else:
            active_session = AsyncSessionLocal()
            close_session = True

    try:
        stmt = (
            select(Media)
            .options(selectinload(Media.metadata_entity))
            .order_by(Media.id.desc())
        )
        result = await active_session.execute(stmt)
        items = result.scalars().all()

        catalog_data: List[Dict[str, Any]] = [
            format_media_item(item).model_dump(mode="json")
            for item in items
        ]

        logger.info(f"Loaded {len(catalog_data)} media items for catalog snapshot export.")

        if dry_run:
            logger.info(f"[Dry Run] Validated {len(catalog_data)} items. Target file was not modified.")
            return len(catalog_data), str(target_path)

        # Write to temporary file with UTF-8 encoding and indented format
        json_text = json.dumps(catalog_data, ensure_ascii=False, indent=2)
        with open(temp_path, "w", encoding="utf-8") as f:
            f.write(json_text)
            f.flush()
            os.fsync(f.fileno())

        # Verify integrity of the temporary file before atomic replace
        with open(temp_path, "r", encoding="utf-8") as f:
            verified_data = json.load(f)
            if len(verified_data) != len(catalog_data):
                raise ValueError(
                    f"Integrity check failed: written count {len(verified_data)} != source count {len(catalog_data)}"
                )

        # Atomic replacement: replaces target_path safely in a single filesystem operation
        os.replace(temp_path, target_path)
        logger.info(f"Successfully exported {len(catalog_data)} items to {target_path}")
        return len(catalog_data), str(target_path)

    finally:
        if close_session and active_session is not None:
            await active_session.close()
        # Clean up temporary file if it remains due to an error
        if temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass


def main() -> None:
    parser = argparse.ArgumentParser(description="StreamX Catalog Snapshot Exporter")
    parser.add_argument(
        "-o", "--output",
        default=str(SCRIPT_DIR / "catalog_snapshot.json"),
        help="Path to output JSON snapshot file (default: scripts/catalog_snapshot.json)",
    )
    parser.add_argument(
        "--db-url",
        default=None,
        help="Custom database connection URL override",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate export without writing or modifying files",
    )
    parser.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Suppress informational console logs",
    )
    args = parser.parse_args()

    if args.quiet:
        logger.setLevel(logging.WARNING)

    try:
        count, path = asyncio.run(
            export_catalog_snapshot(
                output_path=args.output,
                db_url=args.db_url,
                dry_run=args.dry_run,
            )
        )
        print(f"Exported {count} items to {path}")
    except Exception as err:
        logger.error(f"Catalog snapshot export failed: {err}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
