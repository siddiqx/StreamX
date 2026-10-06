import asyncio
import json
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import get_db
from app.db.models import Media, MetadataEntity
from app.schemas.media import MediaResponse, MetadataEntityResponse, MetadataSelectRequest
from app.services.drive_service import drive_service
from app.services.metadata_service import metadata_service
from app.utils.filenames import sanitize_filename

router = APIRouter(prefix="/media", tags=["Media Library"])


def format_media_item(item: Media) -> MediaResponse:
    """Format SQLAlchemy Media entity into MediaResponse schema with canonical metadata."""
    canonical = None
    if item.metadata_entity:
        entity = item.metadata_entity
        genres = []
        if entity.genres_json:
            try:
                genres = json.loads(entity.genres_json)
            except Exception:
                genres = []
        canonical = MetadataEntityResponse(
            id=entity.id,
            provider=entity.provider,
            provider_id=entity.provider_id,
            media_type=entity.media_type,
            title=entity.title,
            original_title=entity.original_title,
            release_date=entity.release_date,
            release_year=entity.release_year,
            overview=entity.overview,
            poster_path=entity.poster_path,
            backdrop_path=entity.backdrop_path,
            rating=entity.rating,
            runtime=entity.runtime,
            genres=genres,
        )

    return MediaResponse(
        id=item.id,
        drive_file_id=item.drive_file_id,
        filename=item.filename,
        size=item.size,
        mime_type=item.mime_type,
        category=item.category,
        poster_url=item.poster_url,
        metadata_json=item.metadata_json,
        metadata_entity_id=item.metadata_entity_id,
        metadata_status=item.metadata_status.value if hasattr(item.metadata_status, "value") else str(item.metadata_status),
        metadata_confidence=item.metadata_confidence,
        metadata_locked=item.metadata_locked,
        canonical_metadata=canonical,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("", response_model=List[MediaResponse])
async def list_media(
    category: Optional[str] = Query(None, description="Filter by category (e.g. Movies, TV Shows, Anime)"),
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
) -> List[MediaResponse]:
    """List library media items ordered by creation date descending with canonical metadata."""
    stmt = (
        select(Media)
        .options(selectinload(Media.metadata_entity))
        .order_by(Media.id.desc())
    )
    if category:
        stmt = stmt.where(Media.category == category)
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [format_media_item(item) for item in items]


@router.get("/search", response_model=List[MediaResponse])
async def search_media(
    q: str = Query(..., min_length=1, description="Search keyword in filename or canonical title"),
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
) -> List[MediaResponse]:
    """Search media catalog across canonical titles, original titles, and raw filenames."""
    pattern = f"%{q.strip()}%"
    stmt = (
        select(Media)
        .outerjoin(MetadataEntity, Media.metadata_entity_id == MetadataEntity.id)
        .options(selectinload(Media.metadata_entity))
        .where(
            or_(
                Media.filename.ilike(pattern),
                MetadataEntity.title.ilike(pattern),
                MetadataEntity.original_title.ilike(pattern),
            )
        )
        .order_by(Media.id.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [format_media_item(item) for item in items]


@router.get("/categories")
async def list_categories(
    db: AsyncSession = Depends(get_db),
):
    """List available media categories with count of items."""
    stmt = select(Media.category, func.count(Media.id)).group_by(Media.category)
    result = await db.execute(stmt)
    rows = result.all()
    return [{"category": row[0], "count": row[1]} for row in rows]


@router.get("/image-proxy")
async def proxy_image(url: str = Query(..., description="The TMDB or CDN image URL to proxy")):
    """Safely proxy metadata/poster images (e.g. from TMDB) to bypass ISP/client CORS or domain blocks."""
    if not (url.startswith("https://image.tmdb.org/") or url.startswith("http://image.tmdb.org/")):
        raise HTTPException(status_code=400, detail="Only TMDB images can be proxied")

    import httpx
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch image")
            return Response(
                content=resp.content,
                media_type=resp.headers.get("content-type", "image/jpeg"),
                headers={
                    "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000",
                    "Access-Control-Allow-Origin": "*",
                },
            )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Image proxy error: {str(e)}")


@router.get("/metadata/stats")
async def get_metadata_stats():
    """Retrieve metadata catalog health metrics and match percentage."""
    return await metadata_service.get_metadata_stats()


@router.post("/metadata/backfill")
async def trigger_metadata_backfill(
    force: bool = Query(False, description="Force reprocess even already matched items"),
):
    """Enqueue metadata backfill for library media items."""
    return await metadata_service.backfill_library(force=force)


@router.get("/{media_id}", response_model=MediaResponse)
async def get_media_item(
    media_id: int,
    db: AsyncSession = Depends(get_db),
) -> MediaResponse:
    """Retrieve details for a single media item with canonical metadata."""
    stmt = select(Media).options(selectinload(Media.metadata_entity)).where(Media.id == media_id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")
    return format_media_item(item)


@router.post("/{media_id}/metadata/search")
async def search_candidates_for_media(
    media_id: int,
    query: Optional[str] = Query(None, description="Custom title search query"),
):
    """Search TMDB candidates for manual correction."""
    return await metadata_service.search_candidates_for_media(media_id, query)


@router.post("/{media_id}/metadata/select")
async def select_metadata_for_media(
    media_id: int,
    req: MetadataSelectRequest,
):
    """Manually link media item to a specific TMDB entity and lock it."""
    success = await metadata_service.manually_select_metadata(media_id, req.provider_id, req.media_type)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to retrieve or assign metadata for selected item.")
    return {"status": "ok", "message": "Metadata assigned and locked."}


@router.post("/{media_id}/metadata/reprocess")
async def reprocess_media_metadata(
    media_id: int,
    force: bool = Query(False, description="Reprocess even if locked"),
):
    """Reprocess metadata for a specific media item."""
    success = await metadata_service.reprocess_media(media_id, force=force)
    if not success:
        raise HTTPException(status_code=400, detail="Could not enqueue media for reprocessing (it may be locked).")
    return {"status": "ok", "message": "Media enqueued for reprocessing."}


@router.post("/{media_id}/metadata/unlock")
async def unlock_media_metadata(
    media_id: int,
):
    """Unlock media metadata so it can be automatically enriched."""
    success = await metadata_service.unlock_metadata(media_id)
    if not success:
        raise HTTPException(status_code=404, detail="Media item not found.")
    return {"status": "ok", "message": "Metadata unlocked."}



@router.get("/{media_id}/stream")
async def stream_media(
    media_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Stream media file directly from Google Drive with full HTTP Range (seek) support."""
    stmt = select(Media).where(Media.id == media_id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")

    range_header = request.headers.get("Range")
    client, res = await drive_service.get_download_stream(item.drive_file_id, range_header)

    async def stream_generator():
        try:
            async for chunk in res.aiter_bytes(chunk_size=65536):
                yield chunk
        finally:
            await res.aclose()
            await client.aclose()

    clean_name = sanitize_filename(item.filename)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": item.mime_type or "video/mp4",
        "Content-Disposition": f'inline; filename="{clean_name}"',
    }
    if "Content-Range" in res.headers:
        headers["Content-Range"] = res.headers["Content-Range"]
    if "Content-Length" in res.headers:
        headers["Content-Length"] = res.headers["Content-Length"]

    return StreamingResponse(
        stream_generator(),
        status_code=res.status_code,
        headers=headers,
    )


def find_vlc_executable() -> Optional[str]:
    """Locate VLC Media Player executable on Windows or POSIX."""
    import os
    import shutil
    candidates = [
        os.path.expandvars(r"%ProgramFiles%\VideoLAN\VLC\vlc.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\VideoLAN\VLC\vlc.exe"),
        r"C:\Program Files\VideoLAN\VLC\vlc.exe",
        r"C:\Program Files (x86)\VideoLAN\VLC\vlc.exe",
        shutil.which("vlc"),
        shutil.which("vlc.exe"),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


@router.get("/{media_id}/stream/compatible")
async def stream_compatible_media(
    media_id: int,
    start: float = Query(0.0, ge=0.0, description="Seek start position in seconds"),
    db: AsyncSession = Depends(get_db),
):
    """Transcode stream on-the-fly into fragmented H.264/AAC MP4 for 100% universal browser playback."""
    stmt = select(Media).where(Media.id == media_id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")

    creds = await drive_service.get_credentials()
    drive_url = f"https://www.googleapis.com/drive/v3/files/{item.drive_file_id}?alt=media"

    seek_args = ["-ss", str(start)] if start > 0 else []

    cmd = [
        "ffmpeg",
        *seek_args,
        "-headers", f"Authorization: Bearer {creds.token}\r\n",
        "-i", drive_url,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "160k",
        "-ac", "2",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4",
        "pipe:1",
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

    async def transcode_generator():
        try:
            while True:
                chunk = await process.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                process.kill()
            except ProcessLookupError:
                pass

    clean_name = sanitize_filename(item.filename)
    return StreamingResponse(
        transcode_generator(),
        media_type="video/mp4",
        headers={
            "Content-Type": "video/mp4",
            "Content-Disposition": f'inline; filename="{clean_name}.mp4"',
            "Accept-Ranges": "none",
            "Cache-Control": "no-cache",
        },
    )


@router.post("/{media_id}/open-vlc")
async def open_in_vlc(
    media_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Launch VLC Media Player directly on the host system to play the media stream."""
    import subprocess
    import os

    stmt = select(Media).where(Media.id == media_id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")

    vlc_bin = find_vlc_executable()
    if not vlc_bin:
        raise HTTPException(status_code=404, detail="VLC Media Player was not found on this system.")

    host = request.headers.get("host") or "127.0.0.1:8000"
    scheme = request.url.scheme
    stream_url = f"{scheme}://{host}/media/{media_id}/stream"

    try:
        if os.name == "nt":
            flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            subprocess.Popen([vlc_bin, stream_url], creationflags=flags)
        else:
            subprocess.Popen([vlc_bin, stream_url])
        return {"status": "ok", "message": "VLC Media Player launched", "url": stream_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to launch VLC: {str(e)}")


@router.get("/{media_id}/playlist.m3u")
async def get_m3u_playlist(
    media_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Generate an M3U playlist file to open this stream in external players (VLC, MX Player, IINA, etc.)."""
    from fastapi.responses import Response

    stmt = select(Media).where(Media.id == media_id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")

    clean_title = sanitize_filename(item.filename)
    host = request.headers.get("host") or "127.0.0.1:8000"
    scheme = request.url.scheme
    stream_url = f"{scheme}://{host}/media/{media_id}/stream"

    m3u_content = f"#EXTM3U\n#EXTINF:-1,{clean_title}\n{stream_url}\n"

    return Response(
        content=m3u_content,
        media_type="application/x-mpegurl",
        headers={
            "Content-Disposition": f'attachment; filename="{clean_title}.m3u"',
            "Cache-Control": "no-cache",
        },
    )


@router.get("/{media_id}/download")
async def download_media(
    media_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Download media file directly from Google Drive with resumable Range header support."""
    stmt = select(Media).where(Media.id == media_id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")

    range_header = request.headers.get("Range")
    client, res = await drive_service.get_download_stream(item.drive_file_id, range_header)

    async def stream_generator():
        try:
            async for chunk in res.aiter_bytes(chunk_size=131072):
                yield chunk
        finally:
            await res.aclose()
            await client.aclose()

    clean_name = sanitize_filename(item.filename)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": "application/octet-stream",
        "Content-Disposition": f'attachment; filename="{clean_name}"',
    }
    if "Content-Range" in res.headers:
        headers["Content-Range"] = res.headers["Content-Range"]
    if "Content-Length" in res.headers:
        headers["Content-Length"] = res.headers["Content-Length"]

    return StreamingResponse(
        stream_generator(),
        status_code=res.status_code,
        headers=headers,
    )


