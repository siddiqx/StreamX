"""Tests for StreamX Google Drive Service."""

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.services.drive_service import GoogleDriveService
from app.utils.errors import (
    DriveAuthError,
    DrivePermissionError,
    DriveRateLimitError,
    DriveUploadError,
    DriveVerificationError,
)


def test_drive_service_configuration():
    unconfigured = GoogleDriveService(client_id=None, client_secret=None, refresh_token=None)
    assert not unconfigured.is_configured()

    configured = GoogleDriveService(
        client_id="test_client_id",
        client_secret="test_secret",
        refresh_token="test_refresh_token",
    )
    assert configured.is_configured()


@pytest.mark.asyncio
async def test_drive_unconfigured_error():
    service = GoogleDriveService(client_id=None, client_secret=None, refresh_token=None)
    with pytest.raises(ValueError, match="Google Drive credentials are not fully configured"):
        await service.get_credentials()


@pytest.mark.asyncio
async def test_upload_chunk_308_and_200():
    service = GoogleDriveService(
        client_id="cid", client_secret="csec", refresh_token="reftok"
    )

    # Test chunk 1 -> HTTP 308 (Incomplete)
    with patch("httpx.AsyncClient.put") as mock_put:
        mock_resp_308 = MagicMock()
        mock_resp_308.status_code = 308
        mock_put.return_value = mock_resp_308

        completed, file_id = await service.upload_chunk(
            upload_url="http://drive/upload",
            chunk=b"0" * 1024,
            start_byte=0,
            total_size=2048,
        )
        assert completed is False
        assert file_id is None

        # Test chunk 2 -> HTTP 200 (Completed)
        mock_resp_200 = MagicMock()
        mock_resp_200.status_code = 200
        mock_resp_200.json.return_value = {"id": "google_drive_file_id_789"}
        mock_put.return_value = mock_resp_200

        completed, file_id = await service.upload_chunk(
            upload_url="http://drive/upload",
            chunk=b"0" * 1024,
            start_byte=1024,
            total_size=2048,
        )
        assert completed is True
        assert file_id == "google_drive_file_id_789"


@pytest.mark.asyncio
async def test_upload_chunk_classifies_permanent_errors():
    service = GoogleDriveService(client_id="cid", client_secret="csec", refresh_token="reftok")

    for status, body, exc_type in [
        (401, "invalid", DriveAuthError),
        (403, "permission denied", DrivePermissionError),
        (429, "rate limit exceeded", DriveRateLimitError),
        (500, "server", DriveUploadError),
        (503, "unavailable", DriveUploadError),
    ]:
        with patch("httpx.AsyncClient.put") as mock_put:
            resp = MagicMock()
            resp.status_code = status
            resp.text = body
            mock_put.return_value = resp

            with pytest.raises(exc_type):
                await service.upload_chunk(
                    upload_url="http://drive/upload",
                    chunk=b"x" * 1024,
                    start_byte=0,
                    total_size=2048,
                )


@pytest.mark.asyncio
async def test_upload_chunk_retries_transient_then_succeeds():
    service = GoogleDriveService(client_id="cid", client_secret="csec", refresh_token="reftok")

    bad = MagicMock()
    bad.status_code = 500
    bad.text = "transient"

    good = MagicMock()
    good.status_code = 200
    good.json.return_value = {"id": "file_123"}

    with patch("httpx.AsyncClient.put", new_callable=AsyncMock, side_effect=[bad, good]):
        completed, file_id = await service.upload_chunk(
            upload_url="http://drive/upload",
            chunk=b"x" * 1024,
            start_byte=0,
            total_size=2048,
        )
    assert completed is True
    assert file_id == "file_123"


@pytest.mark.asyncio
async def test_verify_file_succeeds_on_matching_size():
    service = GoogleDriveService(client_id="cid", client_secret="csec", refresh_token="reftok")

    fake_meta = MagicMock()
    fake_meta.to_query = lambda *a, **k: {"id": "did", "name": "x.mkv", "size": "1024"}
    # Mimic googleapiclient files().get().execute()
    class _Chain:
        def execute(self_inner):
            return {"id": "did", "name": "x.mkv", "size": "1024"}

    fake_creds = MagicMock()
    fake_creds.token = "tok"
    with patch.object(service, "get_credentials", new_callable=AsyncMock, return_value=fake_creds), \
         patch.object(service, "_get_drive_client", return_value=MagicMock(files=lambda: MagicMock(get=lambda **k: _Chain()))):
        ok = await service.verify_file("did", 1024, "x.mkv")
    assert ok is True


@pytest.mark.asyncio
async def test_verify_file_fails_on_size_mismatch():
    service = GoogleDriveService(client_id="cid", client_secret="csec", refresh_token="reftok")

    class _Chain:
        def execute(self_inner):
            return {"id": "did", "name": "x.mkv", "size": "9999"}

    fake_creds = MagicMock()
    fake_creds.token = "tok"
    with patch.object(service, "get_credentials", new_callable=AsyncMock, return_value=fake_creds), \
         patch.object(service, "_get_drive_client", return_value=MagicMock(files=lambda: MagicMock(get=lambda **k: _Chain()))):
        with pytest.raises(DriveVerificationError):
            await service.verify_file("did", 1024, "x.mkv")


@pytest.mark.asyncio
async def test_get_resumable_offset_reads_range_header():
    service = GoogleDriveService(client_id="cid", client_secret="csec", refresh_token="reftok")

    resp = MagicMock()
    resp.status_code = 308
    resp.headers = {"Range": "bytes=0-1048575"}

    with patch("httpx.AsyncClient.put", new_callable=AsyncMock, return_value=resp):
        offset = await service.get_resumable_offset("http://upload/session", 2048)
    assert offset == 1048576
