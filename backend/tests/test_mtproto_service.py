"""Tests for Telegram MTProto Streaming Service."""

from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.services.telegram_mtproto_service import TelegramMTProtoService


def test_mtproto_configuration_check():
    unconfigured = TelegramMTProtoService(api_id=None, api_hash=None, session_string=None)
    assert not unconfigured.is_configured()

    configured = TelegramMTProtoService(
        api_id=12345,
        api_hash="abcdef",
        session_string="test_session_string",
    )
    assert configured.is_configured()


@pytest.mark.asyncio
async def test_mtproto_unconfigured_error():
    service = TelegramMTProtoService(api_id=None, api_hash=None, session_string=None)
    with pytest.raises(ValueError, match="MTProto client is not configured"):
        await service.get_client()


@pytest.mark.asyncio
async def test_iter_download_chunks():
    service = TelegramMTProtoService(
        api_id=12345,
        api_hash="abcdef",
        session_string="valid_session_string",
    )

    mock_client = MagicMock()
    mock_client.is_connected.return_value = True
    mock_client.is_user_authorized = AsyncMock(return_value=True)

    # Mock Telegram message with media
    mock_media = MagicMock()
    mock_file = MagicMock()
    mock_file.size = 20 * 1024 * 1024
    mock_file.name = "Dune.Part.Two.1080p.mkv"

    mock_msg = MagicMock()
    mock_msg.media = mock_media
    mock_msg.file = mock_file
    mock_client.get_messages = AsyncMock(return_value=mock_msg)

    # Mock chunk generator
    chunks_data = [b"chunk1", b"chunk2", b"chunk3"]

    async def fake_iter_download(*args, **kwargs):
        for c in chunks_data:
            yield c

    mock_client.iter_download = fake_iter_download

    with patch.object(service, "get_client", AsyncMock(return_value=mock_client)):
        received_chunks = []
        async for chunk in service.iter_download_chunks(chat_id=123, message_id=456, chunk_size=8 * 1024 * 1024):
            received_chunks.append(chunk)

        assert received_chunks == chunks_data
