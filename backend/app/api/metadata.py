"""Root /metadata endpoints for stats and library backfill."""

from fastapi import APIRouter, Query
from app.services.metadata_service import metadata_service

router = APIRouter(prefix="/metadata", tags=["Metadata Operations"])


@router.get("/stats")
@router.get("/status")
async def get_metadata_stats():
    """Retrieve metadata catalog health metrics and match percentage."""
    return await metadata_service.get_metadata_stats()


@router.post("/backfill")
async def trigger_metadata_backfill(
    force: bool = Query(False, description="Force reprocess even already matched items"),
    dry_run: bool = Query(False, description="Run dry-run audit report without queuing or mutating records"),
    preserve_manual: bool = Query(True, description="Preserve manual metadata overrides"),
):
    """Enqueue metadata backfill for library media items or perform dry-run audit."""
    return await metadata_service.backfill_library(
        force=force,
        dry_run=dry_run,
        preserve_manual=preserve_manual,
    )

