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
from app.utils.errors import (
    DriveAuthError,
    DrivePermissionError,
    DriveQuotaError,
    DriveRateLimitError,
    DriveUploadError,
    DriveVerificationError,
)
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
        self._show_folder_cache: Dict[str, str] = {}
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
        if category in ("Anime Movies", "Anime Movie", "Anime Series"):
            return self._folder_cache.get("Anime", self._folder_cache.get("Other", ""))
        return self._folder_cache.get(category, self._folder_cache.get("Other", ""))

    async def get_or_create_show_folder(self, category: str = "Other", show_name: str = "Unknown") -> str:
        """Get or create a dedicated show/movie folder under StreamX/<Category>/<show_name>.
        
        Reuses existing folders via intelligent sibling & prefix matching to avoid
        duplicate show folders, consolidates duplicates, and maintains a clean hierarchy.
        """
        import re
        clean_name = re.sub(r'[\\/*?:"<>|]', '', show_name).strip()
        if not clean_name:
            return await self.get_folder_id(category)

        cache_key = f"{category}:{clean_name.casefold()}"
        if cache_key in self._show_folder_cache:
            return self._show_folder_cache[cache_key]

        cat_folder_id = await self.get_folder_id(category)
        creds = await self.get_credentials()
        loop = asyncio.get_running_loop()

        # Build list of category folder IDs to search across
        categories_to_check = ["Anime", "TV Shows", "Movies", "Other"]
        cat_ids_to_check = []
        for c in categories_to_check:
            cid = await self.get_folder_id(c)
            if cid and cid not in cat_ids_to_check:
                cat_ids_to_check.append(cid)

        def _sync_show_folder() -> str:
            service = self._get_drive_client(creds)
            # Query all existing active subfolders across categories to prevent duplicate folders
            folders = []
            for c_id in cat_ids_to_check:
                query = (
                    f"'{c_id}' in parents and "
                    "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                )
                res = service.files().list(q=query, fields="files(id, name, parents)", pageSize=1000).execute()
                folders.extend(res.get("files", []))

            # 1. Check for exact case-insensitive match
            exact_matches = [f for f in folders if f.get("name", "").strip().casefold() == clean_name.casefold()]
            if exact_matches:
                primary = exact_matches[0]
                if len(exact_matches) > 1:
                    for dup in exact_matches[1:]:
                        dup_id = dup["id"]
                        try:
                            c_res = service.files().list(q=f"'{dup_id}' in parents and trashed = false", fields="files(id)").execute()
                            for child in c_res.get("files", []):
                                service.files().update(fileId=child["id"], addParents=primary["id"], removeParents=dup_id).execute()
                            service.files().update(fileId=dup_id, body={"trashed": True}).execute()
                            log_event("DRIVE_DUPLICATE_FOLDER_CONSOLIDATED", name=clean_name, removed_id=dup_id, target_id=primary["id"])
                        except Exception as e:
                            logger.debug(f"Error consolidating duplicate folder {dup_id}: {e}")
                return primary["id"]

            # 2. Intelligent First-Word & Continuation Matcher
            # Strips common articles (The, A, An) so "The Daily Life" and "The Promised" never collide.
            import re
            STOPWORDS = {"the", "a", "an", "le", "la", "der", "die", "das", "el"}

            def _get_sig_words(title: str) -> list[str]:
                words = [re.sub(r"[^a-z0-9]", "", w.lower()) for w in title.split()]
                words = [w for w in words if w]
                while words and words[0] in STOPWORDS:
                    words = words[1:]
                return words

            target_sig = _get_sig_words(clean_name)

            for f in folders:
                fname = f.get("name", "").strip()
                if not fname:
                    continue
                folder_sig = _get_sig_words(fname)
                if not target_sig or not folder_sig:
                    continue

                is_match = False
                # First significant word must match (e.g. 'alya' == 'alya' or 'promised' == 'promised')
                if target_sig[0] == folder_sig[0]:
                    if len(target_sig) == 1:
                        # Single word query like 'Alya' matching 'Alya Sometimes Hides Her Feelings in Russian'
                        if len(target_sig[0]) >= 3:
                            is_match = True
                    elif len(target_sig) <= len(folder_sig):
                        # Multi-word prefix like 'The Promised' matching 'The Promised Neverland'
                        if folder_sig[:len(target_sig)] == target_sig:
                            is_match = True

                if is_match:
                    f_id = f["id"]
                    log_event("DRIVE_EXISTING_SHOW_FOLDER_MATCHED", incoming_name=clean_name, matched_folder=fname, folder_id=f_id)
                    return f_id

            # 3. No match found, create a clean new folder
            meta = {
                "name": clean_name,
                "mimeType": "application/vnd.google-apps.folder",
                "parents": [cat_folder_id],
            }
            folder = service.files().create(body=meta, fields="id").execute()
            log_event("DRIVE_SHOW_FOLDER_CREATED", show=clean_name, category=category, folder_id=folder["id"])
            return folder["id"]

        folder_id = await loop.run_in_executor(None, _sync_show_folder)
        self._show_folder_cache[cache_key] = folder_id
        return folder_id

    async def find_existing_file(self, filename: str, folder_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Search Google Drive for an existing active file with the same name to prevent duplicates."""
        service = await self.get_service()
        loop = asyncio.get_running_loop()

        def _search():
            escaped_name = filename.replace("'", "\\'")
            q = f"name = '{escaped_name}' and mimeType != 'application/vnd.google-apps.folder' and trashed = false"
            if folder_id:
                q += f" and '{folder_id}' in parents"
            res = service.files().list(q=q, fields="files(id, name, size)", pageSize=1).execute()
            files = res.get("files", [])
            return files[0] if files else None

        try:
            return await loop.run_in_executor(None, _search)
        except Exception as e:
            logger.debug(f"Drive search for existing file '{filename}' encountered error: {e}")
            return None

    async def create_resumable_upload_session(
        self,
        filename: str,
        size: int,
        mime_type: str = "video/mp4",
        category: str = "Other",
        show_name: Optional[str] = None,
    ) -> str:
        """Initiate a resumable upload session inside the show's dedicated folder in Google Drive."""
        creds = await self.get_credentials()
        if not show_name:
            from app.utils.filename_parser import parse_filename
            parsed = parse_filename(filename)
            show_name = parsed.clean_title

        folder_id = await self.get_or_create_show_folder(category=category, show_name=show_name)

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

            log_event("DRIVE_UPLOAD_SESSION_CREATED", filename=filename, size=size, folder_id=folder_id)
            return upload_url

    def _classify_upload_status(self, status_code: int, body: str) -> Exception:
        """Map a Drive upload HTTP status to a typed, classified error.

        Permanent errors (401/403/404-config, quota) propagate immediately so the
        job layer fails fast; transient errors (429, 5xx, 408) are flagged
        retryable so the chunk-level retry loop backs off and retries.
        """
        text = body.lower()
        if status_code in (401, 403):
            if "insufficient" in text or "quota" in text and "user" in text:
                return DriveQuotaError(f"Drive quota exceeded: HTTP {status_code}")
            if "permission" in text or "forbidden" in text:
                return DrivePermissionError(f"Drive permission denied: HTTP {status_code}")
            return DriveAuthError(f"Drive authentication failed: HTTP {status_code}")
        if status_code == 429 or "rate" in text or "limit" in text or "user-rate-limit" in text:
            return DriveRateLimitError(f"Drive rate limited: HTTP {status_code}")
        if status_code >= 500 or status_code in (408, 416, 409, 500, 502, 503, 504):
            return DriveUploadError(f"Drive transient error: HTTP {status_code}")
        return DriveUploadError(f"Drive chunk upload failed: HTTP {status_code}: {body}")

    async def upload_chunk(
        self,
        upload_url: str,
        chunk: Any,
        start_byte: int,
        total_size: int,
    ) -> Tuple[bool, Optional[str]]:
        """Upload a chunk to a resumable session with bounded per-chunk retry.

        Retryable HTTP/transport errors (429, 5xx, network) are retried with
        exponential backoff; permanent errors (401/403/404-config) propagate
        immediately so the job layer can fail fast without burning retries.

        Returns (is_completed, drive_file_id).
        """
        chunk_bytes = bytes(chunk) if not isinstance(chunk, bytes) else chunk
        chunk_len = len(chunk_bytes)
        end_byte = start_byte + chunk_len - 1
        headers = {
            "Content-Range": f"bytes {start_byte}-{end_byte}/{total_size}",
            "Content-Length": str(chunk_len),
        }

        max_chunk_retries = 3
        for attempt in range(1, max_chunk_retries + 1):
            async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as client:
                try:
                    res = await client.put(upload_url, headers=headers, content=chunk_bytes)
                except (httpx.TimeoutException, httpx.TransportError) as e:
                    if attempt < max_chunk_retries:
                        await asyncio.sleep(min(2 ** (attempt - 1), 8))
                        continue
                    raise DriveUploadError(f"Drive chunk transport error after retries: {e}")

            # HTTP 308 Resume Incomplete -> chunk received, upload still in progress
            if res.status_code == 308:
                return False, None

            # HTTP 200 / 201 -> upload completed!
            if res.status_code in (200, 201):
                try:
                    data = res.json()
                except Exception:
                    data = {}
                drive_file_id = data.get("id")
                log_event("DRIVE_UPLOAD_COMPLETED", drive_file_id=drive_file_id)
                return True, drive_file_id

            error_exc = self._classify_upload_status(res.status_code, res.text)
            # Permanent errors propagate immediately.
            if error_exc is not None and not getattr(error_exc, "retryable", True):
                raise error_exc
            # Transient errors: back off and retry the chunk.
            if attempt < max_chunk_retries:
                wait = min(2 ** (attempt - 1), 8)
                log_event(
                    "DRIVE_CHUNK_RETRY",
                    attempt=attempt,
                    status_code=res.status_code,
                    retry_after=wait,
                )
                await asyncio.sleep(wait)
                continue
            raise error_exc if error_exc else DriveUploadError(
                f"Drive chunk upload failed after retries: HTTP {res.status_code}: {res.text}"
            )

    async def get_resumable_offset(self, upload_url: str, total_size: int) -> int:
        """Query how many bytes Google Drive has acknowledged for this session (restart recovery).
        Returns the byte offset, or -1 if the resumable session is expired / invalid (HTTP 404/410).
        """
        headers = {
            "Content-Range": f"bytes */{total_size}",
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                res = await client.put(upload_url, headers=headers)
                if res.status_code == 308:
                    range_header = res.headers.get("Range")
                    if range_header:
                        # Format: 'bytes=0-1048575'
                        last_byte = int(range_header.split("-")[1])
                        return last_byte + 1
                    return 0
                if res.status_code in (404, 410):
                    return -1
            except Exception:
                pass
            return 0


    async def verify_file(self, drive_file_id: str, expected_size: int, filename: str) -> bool:
        """Verify an uploaded Drive file: exists, correct size.

        Called after the resumable session reports completion to guarantee the
        artifact is durable and matches the expected size — successful upload
        HTTP response alone is never trusted.
        """
        creds = await self.get_credentials()
        loop = asyncio.get_running_loop()

        def _fetch():
            service = self._get_drive_client(creds)
            return service.files().get(
                fileId=drive_file_id, fields="id,name,size,md5Checksum"
            ).execute()

        try:
            meta = await loop.run_in_executor(None, _fetch)
        except Exception as e:
            raise DriveVerificationError(f"Drive get() failed for {drive_file_id}: {e}")

        if not meta or meta.get("id") != drive_file_id:
            raise DriveVerificationError(f"Drive file {drive_file_id} not found after upload")
        drive_size = int(meta.get("size") or 0)
        if expected_size and drive_size and drive_size != expected_size:
            raise DriveVerificationError(
                f"Drive size mismatch for {drive_file_id}: "
                f"expected {expected_size}, got {drive_size}"
            )
        return True

    async def list_library_files(self) -> List[Dict[str, Any]]:
        """List all media files inside Google Drive with full pagination."""
        if not self.is_configured():
            return []

        creds = await self.get_credentials()
        loop = asyncio.get_running_loop()

        def _fetch():
            service = self._get_drive_client(creds)
            query = (
                "trashed = false and ("
                "mimeType contains 'video/' or "
                "name contains '.mkv' or "
                "name contains '.mp4' or "
                "name contains '.avi' or "
                "name contains '.mov' or "
                "name contains '.webm' or "
                "name contains '.ts' or "
                "name contains '.m4v'"
                ")"
            )
            all_files = []
            page_token = None
            while True:
                results = service.files().list(
                    q=query,
                    fields="nextPageToken, files(id, name, mimeType, size, parents, createdTime)",
                    pageSize=100,
                    pageToken=page_token,
                ).execute()
                all_files.extend(results.get("files", []))
                page_token = results.get("nextPageToken")
                if not page_token:
                    break
            return all_files

        return await loop.run_in_executor(None, _fetch)

    async def sync_library_to_db(self) -> int:
        """Scan Google Drive StreamX media, catalog new files, and update renamed files."""
        from app.db.database import AsyncSessionLocal
        from app.db.models import Media, MetadataStatus, TelegramTransfer, TransferStatus
        from app.services.metadata_service import metadata_service
        from app.utils.filename_parser import parse_filename
        from app.utils.media_classifier import classify_media
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
                    name.lower().endswith(ext)
                    for ext in [".mkv", ".mp4", ".avi", ".mov", ".webm", ".ts", ".m4v"]
                )
                if not is_video:
                    continue

                # Check if already cataloged
                stmt = select(Media).where(Media.drive_file_id == drive_id)
                existing = (await session.execute(stmt)).scalar_one_or_none()
                parsed_tech = parse_filename(name)
                taxonomy_type, shelf_cat = classify_media(parsed_tech, raw_filename=name, mime_type=mime)

                if not existing:
                    item = Media(
                        drive_file_id=drive_id,
                        filename=name,
                        size=size,
                        mime_type=mime,
                        category=shelf_cat,
                        media_type=taxonomy_type.value,
                        season=parsed_tech.season,
                        episode=parsed_tech.episode,
                        quality=parsed_tech.quality,
                        release_group=parsed_tech.release_group,
                        metadata_status=MetadataStatus.PENDING,
                    )
                    session.add(item)
                    await session.flush()
                    await metadata_service.enqueue_media_for_enrichment(item.id, session=session)
                    synced_count += 1
                else:
                    # File was renamed or updated on Google Drive!
                    if existing.filename != name:
                        log_event(
                            "DRIVE_FILE_RENAMED",
                            drive_file_id=drive_id,
                            old_name=existing.filename,
                            new_name=name,
                        )
                        existing.filename = name
                        existing.size = size
                        existing.category = shelf_cat
                        existing.media_type = taxonomy_type.value
                        existing.season = parsed_tech.season
                        existing.episode = parsed_tech.episode
                        existing.quality = parsed_tech.quality
                        existing.release_group = parsed_tech.release_group

                        # If not explicitly locked by user, reset metadata and re-fetch fresh artwork & synopsis!
                        if not existing.metadata_locked:
                            existing.metadata_entity_id = None
                            existing.metadata_status = MetadataStatus.PENDING
                            existing.metadata_confidence = None
                            existing.poster_url = None
                            existing.poster_override = None
                            existing.backdrop_override = None
                            existing.metadata_json = None
                            existing.series_key = None
                            await metadata_service.enqueue_media_for_enrichment(existing.id, session=session)
                        synced_count += 1
                    elif not existing.metadata_entity_id and not existing.metadata_locked:
                        await metadata_service.enqueue_media_for_enrichment(existing.id, session=session)

                # Reconcile transfer if exists
                stmt_t = select(TelegramTransfer).where(TelegramTransfer.filename == name)
                t = (await session.execute(stmt_t)).scalar_one_or_none()
                if t and t.status != TransferStatus.COMPLETED:
                    t.status = TransferStatus.COMPLETED
                    t.bytes_transferred = size

            await session.commit()

        # Check for user-renamed folders in Google Drive, auto-rename files, and relocate categories
        try:
            await self.sync_folder_renames_and_reorganize()
        except Exception as ex:
            logger.debug(f"Drive folder rename sync skipped or failed: {ex}")

        # Organize all library files in Google Drive into their proper show subfolders
        try:
            await self.organize_existing_drive_media()
        except Exception as ex:
            logger.debug(f"Drive folder organization skipped or failed: {ex}")

        if synced_count > 0:
            log_event("DRIVE_LIBRARY_SYNCED", synced_count=synced_count)
        return synced_count

    async def organize_existing_drive_media(self) -> int:
        """Move loose library files in Google Drive into their proper show subfolders."""
        if not self.is_configured():
            return 0

        from app.db.database import AsyncSessionLocal
        from app.db.models import Media, MetadataEntity
        from app.utils.filename_parser import parse_filename
        from sqlalchemy import select

        creds = await self.get_credentials()
        loop = asyncio.get_running_loop()
        moved_count = 0

        async with AsyncSessionLocal() as session:
            stmt = select(Media)
            res = await session.execute(stmt)
            medias = res.scalars().all()

            for item in medias:
                if not item.drive_file_id:
                    continue

                show_name = None
                if item.metadata_entity_id:
                    entity = await session.get(MetadataEntity, item.metadata_entity_id)
                    if entity and entity.title:
                        show_name = entity.title
                if not show_name:
                    parsed = parse_filename(item.filename)
                    show_name = parsed.clean_title

                category = item.category or "Other"
                try:
                    target_folder_id = await self.get_or_create_show_folder(category=category, show_name=show_name)
                except Exception as e:
                    logger.debug(f"Could not get or create show folder for {show_name}: {e}")
                    continue

                def _check_and_move(file_id: str, dest_folder_id: str):
                    service = self._get_drive_client(creds)
                    try:
                        f = service.files().get(fileId=file_id, fields="id, parents").execute()
                        current_parents = f.get("parents", [])
                        if dest_folder_id not in current_parents:
                            remove_p = ",".join(current_parents) if current_parents else None
                            service.files().update(
                                fileId=file_id,
                                addParents=dest_folder_id,
                                removeParents=remove_p,
                                fields="id, parents",
                            ).execute()

                            # If old parent folder is now empty (and not a root category), trash it!
                            protected_ids = set(self._folder_cache.values())
                            for p_id in current_parents:
                                if p_id not in protected_ids:
                                    try:
                                        cq = f"'{p_id}' in parents and trashed = false"
                                        c_res = service.files().list(q=cq, pageSize=1, fields="files(id)").execute()
                                        if len(c_res.get("files", [])) == 0:
                                            service.files().update(fileId=p_id, body={"trashed": True}).execute()
                                            log_event("DRIVE_OLD_EMPTY_FOLDER_TRASHED", folder_id=p_id)
                                    except Exception as err:
                                        logger.debug(f"Error checking old parent {p_id}: {err}")

                            return True
                    except Exception as err:
                        logger.debug(f"Failed to move file {file_id} into {dest_folder_id}: {err}")
                    return False

                did_move = await loop.run_in_executor(None, _check_and_move, item.drive_file_id, target_folder_id)
                if did_move:
                    moved_count += 1
                    log_event("DRIVE_FILE_MOVED_TO_SHOW_FOLDER", file_id=item.drive_file_id, show=show_name, folder_id=target_folder_id)

        if moved_count > 0:
            log_event("DRIVE_MEDIA_ORGANIZED", moved_count=moved_count)

        # Always purge any remaining empty folders across all categories
        try:
            await self.cleanup_empty_drive_folders()
        except Exception as e:
            logger.debug(f"Empty folder cleanup error: {e}")

        return moved_count

    async def cleanup_empty_drive_folders(self) -> int:
        """Scan StreamX category folders (Anime, TV Shows, Movies, Other) for empty subfolders and trash them."""
        if not self.is_configured():
            return 0

        creds = await self.get_credentials()
        loop = asyncio.get_running_loop()

        def _sync_cleanup() -> int:
            service = self._get_drive_client(creds)
            categories = ["Anime", "TV Shows", "Movies", "Other"]
            cleaned = 0
            cat_ids = set()
            for cat in categories:
                c_id = self._folder_cache.get(cat)
                if c_id:
                    cat_ids.add(c_id)

            root_id = self._folder_cache.get("StreamX")
            protected_ids = cat_ids | ({root_id} if root_id else set())

            for cat_id in cat_ids:
                q = f"'{cat_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                res = service.files().list(q=q, fields="files(id, name)", pageSize=1000).execute()
                subfolders = res.get("files", [])

                for sf in subfolders:
                    sf_id = sf["id"]
                    if sf_id in protected_ids:
                        continue
                    cq = f"'{sf_id}' in parents and trashed = false"
                    c_res = service.files().list(q=cq, pageSize=1, fields="files(id)").execute()
                    children = c_res.get("files", [])
                    if len(children) == 0:
                        try:
                            service.files().update(fileId=sf_id, body={"trashed": True}).execute()
                            cleaned += 1
                            log_event("DRIVE_EMPTY_FOLDER_TRASHED", name=sf.get("name"), folder_id=sf_id)
                        except Exception as e:
                            logger.debug(f"Failed to trash empty folder {sf_id}: {e}")

            return cleaned

        count = await loop.run_in_executor(None, _sync_cleanup)
        if count > 0:
            log_event("DRIVE_EMPTY_FOLDERS_CLEANED", total_cleaned=count)
        return count

    async def sync_folder_renames_and_reorganize(self) -> Dict[str, Any]:
        """Detect when a user renames a series folder in Google Drive.
        
        Automatically:
        1. Renames all video files inside that folder to match the new series title,
           preserving season/episode numbers (e.g. S01-02), quality, and audio/release tags.
        2. Queries TMDB / AniList metadata for the new folder name to fetch high-res posters,
           backdrops, and canonical metadata.
        3. Identifies the correct category (e.g. Japanese animation -> Anime) and moves
           the folder from TV Shows to Anime in Google Drive.
        4. Updates all SQLite media records and enqueues fresh metadata enrichment.
        """
        if not self.is_configured():
            return {"status": "not_configured"}

        from app.db.database import AsyncSessionLocal
        from app.db.models import Media, MetadataStatus
        from app.services.metadata_service import metadata_service
        from app.utils.filename_parser import parse_filename, update_filename_title
        from app.utils.media_classifier import has_anime_signals
        from sqlalchemy import select

        creds = await self.get_credentials()
        loop = asyncio.get_running_loop()

        categories = ["TV Shows", "Anime", "Movies", "Other"]
        cat_map: Dict[str, str] = {}
        for cat in categories:
            cid = await self.get_folder_id(cat)
            if cid:
                cat_map[cat] = cid

        def _scan_and_propagate():
            service = self._get_drive_client(creds)
            changes = []

            for current_cat, cat_id in cat_map.items():
                if not cat_id:
                    continue
                q = f"'{cat_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                res = service.files().list(q=q, fields="files(id, name, parents)", pageSize=1000).execute()
                subfolders = res.get("files", [])

                for sf in subfolders:
                    folder_id = sf["id"]
                    folder_name = sf.get("name", "").strip()
                    if not folder_name:
                        continue

                    # List video files in this folder
                    q_files = (
                        f"'{folder_id}' in parents and trashed = false and "
                        "mimeType != 'application/vnd.google-apps.folder'"
                    )
                    f_res = service.files().list(q=q_files, fields="files(id, name, mimeType, size)", pageSize=1000).execute()
                    files = f_res.get("files", [])
                    if not files:
                        continue

                    folder_needs_file_renames = []
                    for f in files:
                        fid = f["id"]
                        fname = f.get("name", "")
                        parsed = parse_filename(fname)
                        if folder_name and folder_name.casefold() in fname.casefold():
                            continue
                        if clean_title and folder_name and clean_title.casefold() != folder_name.casefold():
                            new_name = update_filename_title(fname, folder_name)
                            if new_name != fname:
                                folder_needs_file_renames.append((fid, fname, new_name))

                    if folder_needs_file_renames:
                        renamed_files = []
                        for fid, old_n, new_n in folder_needs_file_renames:
                            try:
                                service.files().update(fileId=fid, body={"name": new_n}).execute()
                                renamed_files.append((fid, old_n, new_n))
                                log_event("DRIVE_FILE_AUTO_RENAMED", folder=folder_name, old_name=old_n, new_name=new_n)
                            except Exception as ex:
                                logger.error(f"Failed to rename file {fid} ({old_n} -> {new_n}): {ex}")

                        if renamed_files:
                            changes.append({
                                "folder_id": folder_id,
                                "folder_name": folder_name,
                                "current_category": current_cat,
                                "current_cat_id": cat_id,
                                "renamed_files": renamed_files,
                            })

            return changes

        changes = await loop.run_in_executor(None, _scan_and_propagate)
        total_renamed = 0
        total_relocated = 0

        if changes:
            async with AsyncSessionLocal() as session:
                for item in changes:
                    folder_id = item["folder_id"]
                    folder_name = item["folder_name"]
                    current_cat = item["current_category"]
                    current_cat_id = item["current_cat_id"]
                    renamed_files = item["renamed_files"]

                    # 1. Update SQLite records and enqueue metadata
                    for fid, old_n, new_n in renamed_files:
                        total_renamed += 1
                        stmt = select(Media).where(Media.drive_file_id == fid)
                        media_rec = (await session.execute(stmt)).scalar_one_or_none()
                        if media_rec:
                            media_rec.filename = new_n
                            media_rec.series_key = folder_name
                            media_rec.metadata_locked = False
                            media_rec.metadata_entity_id = None
                            media_rec.metadata_status = MetadataStatus.PENDING
                            media_rec.metadata_confidence = None
                            media_rec.poster_url = None
                            media_rec.poster_override = None
                            media_rec.backdrop_override = None
                            await metadata_service.enqueue_media_for_enrichment(media_rec.id, session=session)

                    # 2. Determine target category from metadata/signals
                    target_category = current_cat
                    try:
                        from app.utils.media_classifier import classify_media, MediaTaxonomy
                        parsed_sample = parse_filename(folder_name)
                        # If already in Anime, check if any file or details confirm anime
                        if current_cat == "Anime" or has_anime_signals(parsed_sample, raw_filename=folder_name):
                            target_category = "Anime"
                        else:
                            from app.services.metadata_providers.tmdb import TMDBProvider
                            from app.config.settings import settings
                            provider = TMDBProvider(api_key=settings.TMDB_API_KEY)
                            candidates = await provider.search(folder_name, media_type="tv")
                            if not candidates:
                                candidates = await provider.search(folder_name, media_type="movie")
                            details = None
                            if candidates:
                                top = candidates[0]
                                details = await provider.get_details(top.provider_id, media_type=top.media_type)
                            tax, cat = classify_media(parsed_sample, details=details, raw_filename=folder_name)
                            if cat in ("Anime", "Anime Movies") or has_anime_signals(parsed_sample, details=details, raw_filename=folder_name):
                                target_category = "Anime"
                            elif cat == "Movies" or tax == MediaTaxonomy.MOVIE:
                                target_category = "Movies"
                            else:
                                target_category = "TV Shows"
                    except Exception as ex:
                        logger.debug(f"Metadata lookup for folder relocation ({folder_name}): {ex}")
                        parsed_sample = parse_filename(folder_name)
                        if has_anime_signals(parsed_sample, raw_filename=folder_name) or current_cat == "Anime":
                            target_category = "Anime"

                    # 3. Move folder in Google Drive if target category differs!
                    if target_category != current_cat and target_category in cat_map:
                        target_cat_id = cat_map[target_category]
                        def _move_folder(f_id: str, dest_cat_id: str, src_cat_id: str):
                            service = self._get_drive_client(creds)
                            service.files().update(
                                fileId=f_id,
                                addParents=dest_cat_id,
                                removeParents=src_cat_id,
                                fields="id, parents",
                            ).execute()

                        try:
                            await loop.run_in_executor(None, _move_folder, folder_id, target_cat_id, current_cat_id)
                            total_relocated += 1
                            log_event(
                                "DRIVE_FOLDER_RELOCATED",
                                folder=folder_name,
                                from_category=current_cat,
                                to_category=target_category,
                            )
                            # Update Media category in database
                            for fid, _, _ in renamed_files:
                                stmt = select(Media).where(Media.drive_file_id == fid)
                                m = (await session.execute(stmt)).scalar_one_or_none()
                                if m:
                                    m.category = target_category
                        except Exception as ex:
                            logger.error(f"Failed to relocate folder {folder_name} to {target_category}: {ex}")

                await session.commit()

            # Invalidate folder cache
            self._show_folder_cache.clear()

        return {
            "status": "ok",
            "folders_modified": len(changes),
            "files_renamed": total_renamed,
            "folders_relocated": total_relocated,
        }

    async def rename_series_folder(self, current_name_or_id: str, new_name: str) -> Dict[str, Any]:
        """Explicitly rename a series folder in Google Drive and propagate all changes."""
        clean_new = new_name.strip()
        if not clean_new:
            raise ValueError("New name cannot be empty")

        creds = await self.get_credentials()
        loop = asyncio.get_running_loop()

        def _rename_in_drive():
            service = self._get_drive_client(creds)
            folder_id = None
            if len(current_name_or_id) > 20 and " " not in current_name_or_id:
                folder_id = current_name_or_id
            else:
                q = (
                    f"mimeType = 'application/vnd.google-apps.folder' and "
                    f"name = '{current_name_or_id}' and trashed = false"
                )
                res = service.files().list(q=q, fields="files(id, name)").execute()
                items = res.get("files", [])
                if items:
                    folder_id = items[0]["id"]

            if not folder_id:
                q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                res = service.files().list(q=q, fields="files(id, name)").execute()
                for f in res.get("files", []):
                    if f.get("name", "").strip().casefold() == current_name_or_id.strip().casefold():
                        folder_id = f["id"]
                        break

            if not folder_id:
                raise FileNotFoundError(f"Folder '{current_name_or_id}' not found in Google Drive")

            service.files().update(fileId=folder_id, body={"name": clean_new}).execute()
            log_event("DRIVE_FOLDER_RENAMED", old_name=current_name_or_id, new_name=clean_new, folder_id=folder_id)
            return folder_id

        fid = await loop.run_in_executor(None, _rename_in_drive)
        sync_res = await self.sync_folder_renames_and_reorganize()
        sync_res["folder_id"] = fid
        sync_res["new_name"] = clean_new
        return sync_res

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


