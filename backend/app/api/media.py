"""Media Library API Router for StreamX."""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import Media
from app.schemas.media import MediaResponse

router = APIRouter(prefix="/media", tags=["Media Library"])


@router.get("", response_model=List[MediaResponse])
async def list_media(
    category: Optional[str] = Query(None, description="Filter by category (e.g. Movies, TV Shows, Anime)"),
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
) -> List[MediaResponse]:
    """List library media items ordered by creation date descending."""
    stmt = select(Media).order_by(Media.id.desc())
    if category:
        stmt = stmt.where(Media.category == category)
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/search", response_model=List[MediaResponse])
async def search_media(
    q: str = Query(..., min_length=1, description="Search keyword in filename"),
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
) -> List[MediaResponse]:
    """Search media catalog by filename."""
    pattern = f"%{q.strip()}%"
    stmt = select(Media).where(Media.filename.ilike(pattern)).order_by(Media.id.desc()).limit(limit)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/categories")
async def list_categories(
    db: AsyncSession = Depends(get_db),
):
    """List available media categories with count of items."""
    stmt = select(Media.category, func.count(Media.id)).group_by(Media.category)
    result = await db.execute(stmt)
    rows = result.all()
    return [{"category": row[0], "count": row[1]} for row in rows]


@router.get("/{media_id}", response_model=MediaResponse)
async def get_media_item(
    media_id: int,
    db: AsyncSession = Depends(get_db),
) -> MediaResponse:
    """Retrieve details for a single media item by ID."""
    stmt = select(Media).where(Media.id == media_id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")
    return item
