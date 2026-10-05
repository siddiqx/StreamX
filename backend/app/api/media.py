import asyncio
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import Media
from app.schemas.media import MediaResponse
from app.services.drive_service import drive_service

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

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": item.mime_type or "video/mp4",
        "Content-Disposition": f'inline; filename="{item.filename}"',
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

    return StreamingResponse(
        transcode_generator(),
        media_type="video/mp4",
        headers={
            "Content-Type": "video/mp4",
            "Content-Disposition": f'inline; filename="{item.filename}.mp4"',
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

    stream_url = f"http://127.0.0.1:8000/media/{media_id}/stream"

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

    host = request.headers.get("host") or "127.0.0.1:8000"
    scheme = request.url.scheme
    stream_url = f"{scheme}://{host}/media/{media_id}/stream"

    m3u_content = f"#EXTM3U\n#EXTINF:-1,{item.filename}\n{stream_url}\n"

    return Response(
        content=m3u_content,
        media_type="application/x-mpegurl",
        headers={
            "Content-Disposition": f'attachment; filename="{item.filename}.m3u"',
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
        "Content-Disposition": f'attachment; filename="{item.filename}"',
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


