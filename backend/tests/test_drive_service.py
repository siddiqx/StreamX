"""Tests for StreamX Google Drive Service."""

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.services.drive_service import GoogleDriveService


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
