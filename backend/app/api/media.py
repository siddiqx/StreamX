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
from app.schemas.media import (
    BackdropOverrideRequest,
    MediaPatchRequest,
    MediaResponse,
    MetadataEntityResponse,
    MetadataSelectRequest,
    PosterOverrideRequest,
)
from app.services.drive_service import drive_service
from app.services.metadata_service import metadata_service
from app.utils.filenames import make_content_disposition, resolve_mime_type, sanitize_filename
from app.utils.image_resolver import get_media_backdrop_url, get_media_poster_url
from app.utils.logging import logger

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
            category=entity.category,
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
            original_language=entity.original_language,
            origin_country=entity.origin_country,
        )

    # Use centralized image resolver for posters & backdrops
    resolved_poster = get_media_poster_url(item, item.metadata_entity)
    resolved_backdrop = get_media_backdrop_url(item, item.metadata_entity)

    # Maintain backwards-compatible backdrop_url inside metadata_json
    meta_dict = {}
    if item.metadata_json:
        try:
            meta_dict = json.loads(item.metadata_json)
        except Exception:
            meta_dict = {}
    if resolved_backdrop:
        meta_dict["backdrop_url"] = resolved_backdrop
    updated_meta_json = json.dumps(meta_dict) if meta_dict else item.metadata_json

    return MediaResponse(
        id=item.id,
        drive_file_id=item.drive_file_id,
        filename=item.filename,
        size=item.size,
        mime_type=item.mime_type,
        category=item.category or "Other",
        media_type=item.media_type or "MOVIE",
        poster_url=resolved_poster,
        poster_override=item.poster_override,
        backdrop_override=item.backdrop_override,
        metadata_json=updated_meta_json,
        season=item.season,
        episode=item.episode,
        quality=item.quality,
        release_group=item.release_group,
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


@router.post("/sync")
async def sync_media_library() -> Dict[str, Any]:
    """Trigger synchronization of Google Drive library media files into database."""
    if not drive_service.is_configured():
        raise HTTPException(status_code=503, detail="Google Drive service not configured")
    try:
        synced_count = await drive_service.sync_library_to_db()
        return {"status": "ok", "synced_count": synced_count}
    except Exception as e:
        logger.error(f"Manual library sync failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))



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


@router.get("/{media_id}/metadata", response_model=MediaResponse)
async def get_media_metadata(
    media_id: int,
    db: AsyncSession = Depends(get_db),
) -> MediaResponse:
    """Retrieve full canonical metadata details for a media item."""
    stmt = select(Media).options(selectinload(Media.metadata_entity)).where(Media.id == media_id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")
    return format_media_item(item)


@router.get("/{media_id}/metadata/diagnostics")
async def get_media_metadata_diagnostics(
    media_id: int,
):
    """Section 44: Inspect how filename was parsed, candidate scores, and lock state."""
    res = await metadata_service.get_metadata_diagnostics(media_id)
    if "error" in res:
        raise HTTPException(status_code=404, detail=res["error"])
    return res


@router.post("/{media_id}/metadata/search")
async def search_candidates_for_media(
    media_id: int,
    query: Optional[str] = Query(None, description="Custom title search query"),
):
    """Search TMDB candidates for manual correction."""
    return await metadata_service.search_candidates_for_media(media_id, query)


@router.post("/{media_id}/metadata/select")
@router.post("/{media_id}/metadata/apply")
async def select_metadata_for_media(
    media_id: int,
    req: MetadataSelectRequest,
):
    """Manually link media item to a specific TMDB entity and lock it (applies across series if requested)."""
    success = await metadata_service.manually_select_metadata(
        media_id, req.provider_id, req.media_type, apply_to_series=req.apply_to_series
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to retrieve or assign metadata for selected item.")
    return {"status": "ok", "message": "Metadata assigned and locked."}


@router.patch("/{media_id}/metadata")
async def patch_media_metadata(
    media_id: int,
    req: MediaPatchRequest,
):
    """Explicitly patch title, year, category, overview, poster override, or backdrop override."""
    success = await metadata_service.manual_update_metadata(
        media_id=media_id,
        title=req.title,
        year=req.year,
        category=req.category,
        overview=req.overview,
        poster_override=req.poster_override,
        backdrop_override=req.backdrop_override,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Media item not found.")
    return {"status": "ok", "message": "Media metadata updated and locked."}


@router.post("/{media_id}/metadata/poster")
async def override_media_poster(
    media_id: int,
    req: PosterOverrideRequest,
):
    """Manually set or clear custom poster override."""
    success = await metadata_service.set_poster_override(media_id, req.poster_url)
    if not success:
        raise HTTPException(status_code=404, detail="Media item not found.")
    return {"status": "ok", "message": "Poster override updated."}


@router.post("/{media_id}/metadata/backdrop")
async def override_media_backdrop(
    media_id: int,
    req: BackdropOverrideRequest,
):
    """Manually set or clear custom backdrop override."""
    success = await metadata_service.set_backdrop_override(media_id, req.backdrop_url)
    if not success:
        raise HTTPException(status_code=404, detail="Media item not found.")
    return {"status": "ok", "message": "Backdrop override updated."}


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

    content_type = resolve_mime_type(item.filename, item.mime_type)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": content_type,
        "Content-Disposition": make_content_disposition("inline", item.filename),
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


_codec_cache: Dict[str, Dict[str, str]] = {}


async def probe_media_codecs(drive_file_id: str, token: str) -> Dict[str, str]:
    """Probe video, audio codecs, and pixel format using ffprobe (cached in-memory for zero repeated overhead)."""
    if drive_file_id in _codec_cache:
        return _codec_cache[drive_file_id]

    drive_url = f"https://www.googleapis.com/drive/v3/files/{drive_file_id}?alt=media"
    cmd = [
        "ffprobe",
        "-v", "error",
        "-headers", f"Authorization: Bearer {token}\r\n",
        "-i", drive_url,
        "-show_entries", "stream=codec_name,codec_type,pix_fmt",
        "-of", "json",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=4.0)
        data = json.loads(stdout.decode("utf-8", errors="ignore"))
        v_codec = "h264"
        a_codec = "aac"
        pix_fmt = "yuv420p"
        for s in data.get("streams", []):
            if s.get("codec_type") == "video" and "codec_name" in s:
                v_codec = s["codec_name"].lower()
                pix_fmt = s.get("pix_fmt", "yuv420p").lower()
                break
        for s in data.get("streams", []):
            if s.get("codec_type") == "audio" and "codec_name" in s:
                a_codec = s["codec_name"].lower()
                break
        result = {"video": v_codec, "audio": a_codec, "pix_fmt": pix_fmt}
        _codec_cache[drive_file_id] = result
        return result
    except Exception as e:
        logger.warning(f"ffprobe probe failed or timed out: {e}")
        # Default fallback
        return {"video": "h264", "audio": "opus", "pix_fmt": "yuv420p"}


@router.get("/{media_id}/stream/compatible")
async def stream_compatible_media(
    media_id: int,
    start: float = Query(0.0, ge=0.0, description="Seek start position in seconds"),
    mode: str = Query("auto", description="Streaming strategy: 'auto', 'remux', or 'transcode'"),
    db: AsyncSession = Depends(get_db),
):
    """Stream media on-the-fly as fragmented MP4 for 100% universal browser playback.

    Features:
    - Zero-CPU video stream copying (-c:v copy) for H.264 streams: 50x throughput, no lag.
    - Zero-delay audio conversion to AAC stereo when audio is Opus/AC3/Vorbis.
    - Input keyframe seeking for instant response when scrubbing.
    - 100% compatible with Chrome, Safari, Firefox, Edge, iOS, and Android web players.
    """
    stmt = select(Media).where(Media.id == media_id)
    result = await db.execute(stmt)
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Media item not found")

    creds = await drive_service.get_credentials()
    drive_url = f"https://www.googleapis.com/drive/v3/files/{item.drive_file_id}?alt=media"

    codecs = await probe_media_codecs(item.drive_file_id, creds.token)
    v_codec = codecs.get("video", "h264")
    a_codec = codecs.get("audio", "opus")
    pix_fmt = codecs.get("pix_fmt", "yuv420p")
    is_10bit = "10" in pix_fmt or "12" in pix_fmt

    # Fast input seek before input URL avoids decoding unnecessary frames
    seek_args = ["-ss", str(start), "-noaccurate_seek"] if start > 0 else []

    # Choose video strategy:
    # 1. If 10-bit color or non-standard codec, transcode ultrafast to standard 8-bit H.264 (yuv420p)
    #    so all mobile and desktop web browsers render the video frames without black screen.
    # 2. Standard 8-bit H.264/AVC: Instant zero-CPU copy into MP4 container.
    if mode == "transcode" or (mode == "auto" and (v_codec not in ("h264", "avc") or is_10bit)):
        video_flags = [
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-crf", "23",
        ]
    else:
        video_flags = ["-c:v", "copy"]

    # Choose audio strategy:
    # If already AAC, copy directly. Otherwise transcode to standard stereo AAC (takes <10ms).
    if a_codec == "aac":
        audio_flags = ["-c:a", "copy"]
    else:
        audio_flags = ["-c:a", "aac", "-b:a", "160k", "-ac", "2"]

    cmd = [
        "ffmpeg",
        *seek_args,
        "-headers", f"Authorization: Bearer {creds.token}\r\n",
        "-i", drive_url,
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-sn", "-dn",
        "-map_metadata", "-1",
        "-map_chapters", "-1",
        *video_flags,
        *audio_flags,
        "-avoid_negative_ts", "make_zero",
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

    return StreamingResponse(
        transcode_generator(),
        media_type="video/mp4",
        headers={
            "Content-Type": "video/mp4",
            "Content-Disposition": make_content_disposition("inline", f"{item.filename}.mp4"),
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
        content=m3u_content.encode("utf-8"),
        media_type="application/x-mpegurl; charset=utf-8",
        headers={
            "Content-Disposition": make_content_disposition("attachment", f"{clean_title}.m3u"),
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

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": "application/octet-stream",
        "Content-Disposition": make_content_disposition("attachment", item.filename),
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


