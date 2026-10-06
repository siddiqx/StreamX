"""Google Drive Service for StreamX.

Provides OAuth 2.0 token management, folder structure initialization,
resumable chunked uploading, metadata retrieval, and file management.
Zero full-disk requirements: streams memory chunks directly to Google Drive.
"""

import asyncio
from typing import Any, Dict, List, Optional, Tuple
import httpx
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from app.config.settings import settings
from app.utils.logging import log_event, logger


class GoogleDriveService:
    def __init__(
        self,
        client_id: Any = "DEFAULT",
        client_secret: Any = "DEFAULT",
        refresh_token: Any = "DEFAULT",
    ):
        self.client_id = settings.GOOGLE_CLIENT_ID if client_id == "DEFAULT" else client_id
        self.client_secret = (
            settings.GOOGLE_CLIENT_SECRET if client_secret == "DEFAULT" else client_secret
        )
        self.refresh_token = (
            settings.GOOGLE_REFRESH_TOKEN if refresh_token == "DEFAULT" else refresh_token
        )
        self.credentials: Optional[Credentials] = None
        self._folder_cache: Dict[str, str] = {}
        self._lock = asyncio.Lock()

    def is_configured(self) -> bool:
        return bool(
            self.client_id
            and self.client_secret
            and self.refresh_token
            and self.refresh_token.strip()
        )

    async def get_credentials(self) -> Credentials:
        """Get or refresh valid Google OAuth credentials."""
        async with self._lock:
            if not self.is_configured():
                raise ValueError("Google Drive credentials are not fully configured in .env.")

            if not self.credentials:
                self.credentials = Credentials(
                    None,
                    refresh_token=self.refresh_token,
                    token_uri="https://oauth2.googleapis.com/token",
                    client_id=self.client_id,
                    client_secret=self.client_secret,
                    scopes=["https://www.googleapis.com/auth/drive"],
                )

            if not self.credentials.valid:
                # Run synchronous refresh in executor
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, self.credentials.refresh, Request())
                log_event("GOOGLE_CREDENTIALS_REFRESHED")

            return self.credentials

    def _get_drive_client(self, creds: Credentials):
        return build("drive", "v3", credentials=creds, cache_discovery=False)

    async def ensure_folder_structure(self) -> Dict[str, str]:
        """Ensure StreamX/ and category subfolders exist in Drive. Returns map of name->id."""
        creds = await self.get_credentials()
        loop = asyncio.get_running_loop()

        def _sync_folders() -> Dict[str, str]:
            service = self._get_drive_client(creds)
            # Find or create root 'StreamX' folder
            query = "name = 'StreamX' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
            results = service.files().list(q=query, fields="files(id, name)").execute()
            files = results.get("files", [])
            if files:
                root_id = files[0]["id"]
            else:
                meta = {
                    "name": "StreamX",
                    "mimeType": "application/vnd.google-apps.folder",
                }
                folder = service.files().create(body=meta, fields="id").execute()
                root_id = folder["id"]

            folders = {"StreamX": root_id}

            # Ensure category subfolders
            categories = ["Movies", "TV Shows", "Anime", "Other"]
            for cat in categories:
                sub_query = f"name = '{cat}' and '{root_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                res = service.files().list(q=sub_query, fields="files(id, name)").execute()
                sub_files = res.get("files", [])
                if sub_files:
                    folders[cat] = sub_files[0]["id"]
                else:
                    sub_meta = {
                        "name": cat,
                        "mimeType": "application/vnd.google-apps.folder",
                        "parents": [root_id],
                    }
                    sub_f = service.files().create(body=sub_meta, fields="id").execute()
                    folders[cat] = sub_f["id"]

            return folders

        self._folder_cache = await loop.run_in_executor(None, _sync_folders)
        log_event("DRIVE_FOLDERS_VERIFIED", root_id=self._folder_cache.get("StreamX"))
        return self._folder_cache

    async def get_folder_id(self, category: str = "Other") -> str:
        """Get the Drive folder ID for a category."""
        if category not in self._folder_cache:
            await self.ensure_folder_structure()
        return self._folder_cache.get(category, self._folder_cache.get("Other", ""))

    async def create_resumable_upload_session(
        self,
        filename: str,
        size: int,
        mime_type: str = "video/mp4",
        category: str = "Other",
    ) -> str:
        """Initiate a resumable upload session with Google Drive. Returns the upload session URI."""
        creds = await self.get_credentials()
        folder_id = await self.get_folder_id(category)

        metadata = {
            "name": filename,
            "parents": [folder_id],
        }

        headers = {
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": mime_type,
            "X-Upload-Content-Length": str(size),
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
                headers=headers,
                json=metadata,
            )
            if res.status_code != 200:
                raise RuntimeError(
                    f"Failed to initiate resumable upload session: HTTP {res.status_code} {res.text}"
                )

            upload_url = res.headers.get("Location")
            if not upload_url:
                raise RuntimeError("Google Drive did not return a resumable Location header.")

            log_event("DRIVE_UPLOAD_SESSION_CREATED", filename=filename, size=size)
            return upload_url

    async def upload_chunk(
        self,
        upload_url: str,
        chunk: Any,
        start_byte: int,
        total_size: int,
    ) -> Tuple[bool, Optional[str]]:
        """Upload a chunk to a resumable session.

        Returns (is_completed, drive_file_id).
        """
        # Ensure chunk is strict bytes (Telethon yields memoryview)
        chunk_bytes = bytes(chunk) if not isinstance(chunk, bytes) else chunk
        chunk_len = len(chunk_bytes)
        end_byte = start_byte + chunk_len - 1
        headers = {
            "Content-Range": f"bytes {start_byte}-{end_byte}/{total_size}",
            "Content-Length": str(chunk_len),
        }

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as client:
            res = await client.put(upload_url, headers=headers, content=chunk_bytes)

            # HTTP 308 Resume Incomplete -> chunk received, upload still in progress
            if res.status_code == 308:
                return False, None

            # HTTP 200 / 201 -> upload completed!
            if res.status_code in (200, 201):
                data = res.json()
                drive_file_id = data.get("id")
                log_event("DRIVE_UPLOAD_COMPLETED", drive_file_id=drive_file_id)
                return True, drive_file_id

            raise RuntimeError(f"Drive chunk upload failed with HTTP {res.status_code}: {res.text}")

    async def get_resumable_offset(self, upload_url: str, total_size: int) -> int:
        """Query how many bytes Google Drive has acknowledged for this session (for server restart recovery)."""
        headers = {
            "Content-Range": f"bytes */{total_size}",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.put(upload_url, headers=headers)
            if res.status_code == 308:
                range_header = res.headers.get("Range")
                if range_header:
                    # Format: 'bytes=0-1048575'
                    last_byte = int(range_header.split("-")[1])
                    return last_byte + 1
            return 0

    async def list_library_files(self) -> List[Dict[str, Any]]:
        """List all media files inside Google Drive."""
        if not self.is_configured():
            return []

        creds = await self.get_credentials()
        loop = asyncio.get_running_loop()

        def _fetch():
            service = self._get_drive_client(creds)
            query = "trashed = false and (mimeType contains 'video/' or name contains '.mkv' or name contains '.mp4' or name contains '.avi')"
            results = service.files().list(
                q=query,
                fields="files(id, name, mimeType, size, parents, createdTime)",
                pageSize=100,
            ).execute()
            return results.get("files", [])

        return await loop.run_in_executor(None, _fetch)

    async def sync_library_to_db(self) -> int:
        """Scan Google Drive StreamX media and ensure cataloged in SQLite Media table."""
        from app.db.database import AsyncSessionLocal
        from app.db.models import Media, TelegramTransfer, TransferStatus
        from app.workers.transfer_worker import detect_category
        from sqlalchemy import select

        files = await self.list_library_files()
        synced_count = 0

        async with AsyncSessionLocal() as session:
            for f in files:
                drive_id = f.get("id")
                name = f.get("name") or ""
                size = int(f.get("size") or 0)
                mime = f.get("mimeType") or "video/mp4"

                # Strictly skip folders and non-video files
                if mime == "application/vnd.google-apps.folder":
                    continue
                is_video = mime.startswith("video/") or any(
                    name.lower().endswith(ext) for ext in [".mkv", ".mp4", ".avi", ".mov", ".webm", ".ts", ".m4v"]
                )
                if not is_video:
                    continue

                # Check if already cataloged
                stmt = select(Media).where(Media.drive_file_id == drive_id)
                existing = (await session.execute(stmt)).scalar_one_or_none()
                category = detect_category(name)

                if not existing:
                    from app.services.metadata_service import metadata_service
                    from app.db.models import MetadataStatus
                    item = Media(
                        drive_file_id=drive_id,
                        filename=name,
                        size=size,
                        mime_type=mime,
                        category=category,
                        metadata_status=MetadataStatus.PENDING,
                    )
                    session.add(item)
                    await session.flush()
                    await metadata_service.enqueue_media_for_enrichment(item.id, session=session)
                    synced_count += 1
                elif not existing.metadata_entity_id and not existing.metadata_locked:
                    from app.services.metadata_service import metadata_service
                    await metadata_service.enqueue_media_for_enrichment(existing.id, session=session)

                # Reconcile transfer if exists
                stmt_t = select(TelegramTransfer).where(TelegramTransfer.filename == name)
                t = (await session.execute(stmt_t)).scalar_one_or_none()
                if t and t.status != TransferStatus.COMPLETED:
                    t.status = TransferStatus.COMPLETED
                    t.bytes_transferred = size

            await session.commit()

        if synced_count > 0:
            log_event("DRIVE_LIBRARY_SYNCED", synced_count=synced_count)
        return synced_count

    async def get_download_stream(self, drive_file_id: str, range_header: Optional[str] = None):
        """Yield chunks directly from Google Drive alt=media endpoint for streaming or ranged downloads."""
        creds = await self.get_credentials()
        headers = {"Authorization": f"Bearer {creds.token}"}
        if range_header:
            headers["Range"] = range_header

        url = f"https://www.googleapis.com/drive/v3/files/{drive_file_id}?alt=media"
        client = httpx.AsyncClient(timeout=300.0)
        req = client.build_request("GET", url, headers=headers)
        res = await client.send(req, stream=True)
        return client, res

    async def get_storage_and_user_info(self) -> Dict[str, Any]:
        """Fetch live Google Drive account display name, email, and storage quota."""
        if not self.is_configured():
            return {"configured": False, "connected": False}
        try:
            creds = await self.get_credentials()
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(
                    "https://www.googleapis.com/drive/v3/about?fields=storageQuota,user",
                    headers={"Authorization": f"Bearer {creds.token}"},
                )
                if res.status_code == 200:
                    data = res.json()
                    quota = data.get("storageQuota", {})
                    user = data.get("user", {})
                    return {
                        "configured": True,
                        "connected": True,
                        "user_name": user.get("displayName", "User"),
                        "email": user.get("emailAddress", ""),
                        "limit_bytes": int(quota.get("limit", 0)),
                        "usage_bytes": int(quota.get("usage", 0)),
                        "drive_usage_bytes": int(quota.get("usageInDrive", 0)),
                    }
                return {"configured": True, "connected": False, "error": f"HTTP {res.status_code}"}
        except Exception as e:
            return {"configured": True, "connected": False, "error": str(e)}


drive_service = GoogleDriveService()


