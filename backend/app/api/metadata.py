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
):
    """Enqueue metadata backfill for library media items."""
    return await metadata_service.backfill_library(force=force)
