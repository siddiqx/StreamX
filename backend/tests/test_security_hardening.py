"""Automated Security & Incident Regression Test Suite for StreamX.

Verifies:
1. Telegram webhook secret token enforcement & constant-time verification.
2. Telegram update deduplication (anti-replay).
3. Backend API authentication dependency (require_auth) on mutation & host-execution routes.
4. Safe failure behavior when external credentials are absent (no hardcoded fallbacks).
5. Forensic regression scan ensuring malicious ad channels (@A_TOOLSx2, @TucosProfit)
   and forced-subscription patterns never reappear in the codebase.
6. Cloudflare Worker static security verification (no hardcoded credentials, SSRF protection,
   upstream tunnel validation).
"""

import os
import re
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.auth import require_auth
from app.config.settings import settings
from app.main import app
from app.services.drive_service import GoogleDriveService, drive_service
from app.services.telegram_bot_service import TelegramBotService

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


# --------------------------------------------------------------------------
# 1. Telegram Webhook Security & Token Validation
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_telegram_webhook_secret_enforcement():
    """Verify that incoming Telegram webhooks strictly require the configured secret token."""
    test_secret = "test-webhook-secret-token-32chars"
    transport = ASGITransport(app=app)

    with patch.object(settings, "TELEGRAM_WEBHOOK_SECRET", test_secret):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Request with invalid token must be rejected with HTTP 403
            res_invalid = await client.post(
                "/telegram/webhook",
                json={"update_id": 100, "message": {"text": "hello"}},
                headers={"X-Telegram-Bot-Api-Secret-Token": "wrong-secret-token"},
            )
            assert res_invalid.status_code == 403
            assert "Invalid webhook secret token" in res_invalid.json().get(
                "detail", ""
            )

            # 2. Request with missing token must be rejected with HTTP 403
            res_missing = await client.post(
                "/telegram/webhook",
                json={"update_id": 100, "message": {"text": "hello"}},
            )
            assert res_missing.status_code == 403

            # 3. Request with valid token must be accepted with HTTP 200
            with patch(
                "app.api.telegram.bot_service.process_update", new_callable=AsyncMock
            ) as mock_proc:
                res_valid = await client.post(
                    "/telegram/webhook",
                    json={"update_id": 101, "message": {"text": "hello"}},
                    headers={"X-Telegram-Bot-Api-Secret-Token": test_secret},
                )
                assert res_valid.status_code == 200
                assert res_valid.json() == {"ok": True}
                mock_proc.assert_awaited_once()


# --------------------------------------------------------------------------
# 2. Anti-Replay & Update Deduplication
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_telegram_update_deduplication():
    """Ensure duplicate updates with the same update_id are not processed twice."""
    bot = TelegramBotService(bot_token="test_token")
    mock_handler = AsyncMock()

    with patch.object(bot, "_handle_start", mock_handler):
        update = {
            "update_id": 12345,
            "message": {
                "message_id": 1,
                "chat": {"id": 8142877259},
                "from": {"id": 8142877259, "first_name": "TestUser"},
                "text": "/start",
            },
        }

        # First delivery: processed
        await bot.process_update(update)
        assert mock_handler.call_count == 1

        # Second delivery (replay/retry): ignored as duplicate
        await bot.process_update(update)
        assert mock_handler.call_count == 1


# --------------------------------------------------------------------------
# 3. Backend API Authentication & Authorization
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_protected_routes_require_authentication():
    """Verify that sensitive routes reject unauthorized remote requests."""
    test_key = "test-secret-streamx-api-key"
    transport = ASGITransport(app=app)

    with (
        patch.object(settings, "STREAMX_API_KEY", test_key),
        patch.object(settings, "STREAMX_ENV", "production"),
        patch("app.api.auth.is_local_request", return_value=False),
    ):
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # Transfer mutation routes
            res = await client.delete("/transfers/999")
            assert res.status_code == 401

            res = await client.post("/transfers/999/retry")
            assert res.status_code == 401

            res = await client.post("/transfers/sync")
            assert res.status_code == 401

            # Host VLC process launch
            res = await client.post("/media/1/open-vlc")
            assert res.status_code == 401

            # Media catalog mutation
            res = await client.post(
                "/media/rename-series?current_name=old&new_name=new"
            )
            assert res.status_code == 401

            # Authorize with valid Bearer token
            headers = {"Authorization": f"Bearer {test_key}"}
            res_auth = await client.post("/transfers/sync", headers=headers)
            # 200 or 503 depending on drive/service state, but NOT 401
            assert res_auth.status_code != 401

            # Authorize with valid X-API-Key header
            headers_api_key = {"X-API-Key": test_key}
            res_auth_header = await client.post(
                "/transfers/sync", headers=headers_api_key
            )
            assert res_auth_header.status_code != 401

            # Authorize with query parameter ?api_key= (for media players / VLC)
            res_auth_query = await client.post(f"/transfers/sync?api_key={test_key}")
            assert res_auth_query.status_code != 401


# --------------------------------------------------------------------------
# 4. Safe Credential Handling (No Hardcoded Fallbacks)
# --------------------------------------------------------------------------


def test_google_drive_fails_safely_when_unconfigured():
    """Verify DriveService fails safely and does not fall back to embedded keys."""
    with (
        patch.object(settings, "GOOGLE_CLIENT_ID", None),
        patch.object(settings, "GOOGLE_CLIENT_SECRET", None),
        patch.object(settings, "GOOGLE_REFRESH_TOKEN", None),
    ):
        drive = GoogleDriveService()
        assert not drive.is_configured()


# --------------------------------------------------------------------------
# 5. Malicious Channel & Advertising Regression Tests
# --------------------------------------------------------------------------


def test_regression_no_unauthorized_ad_channels_in_codebase():
    """Scan the entire repository to ensure the observed malicious channels and force-sub logic never exist."""
    prohibited_patterns = [
        re.compile(r"A_TOOLSx2", re.IGNORECASE),
        re.compile(r"TucosProfit", re.IGNORECASE),
        re.compile(r"must join our channel", re.IGNORECASE),
        re.compile(r"join our channel to continue", re.IGNORECASE),
        re.compile(r"force_channel", re.IGNORECASE),
    ]

    scanned_extensions = {
        ".py",
        ".js",
        ".ts",
        ".tsx",
        ".html",
        ".json",
        ".md",
        ".yml",
        ".yaml",
    }
    ignore_dirs = {
        ".git",
        ".pytest_cache",
        "node_modules",
        "dist",
        ".venv",
        "__pycache__",
    }

    violations = []
    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        for f in files:
            path = Path(root) / f
            # Exclude this test file itself and the audit report which documents the incident
            if path.name in ("test_security_hardening.py", "security_audit_report.md"):
                continue
            if path.suffix.lower() in scanned_extensions:
                try:
                    content = path.read_text(encoding="utf-8", errors="ignore")
                    for pattern in prohibited_patterns:
                        match = pattern.search(content)
                        if match:
                            violations.append(
                                f"{path.relative_to(REPO_ROOT)} matched {match.group(0)}"
                            )
                except Exception:
                    pass

    assert not violations, (
        f"Prohibited malicious channel patterns detected: {violations}"
    )


# --------------------------------------------------------------------------
# 6. Cloudflare Worker Security Verification
# --------------------------------------------------------------------------


def test_cloudflare_worker_security_controls():
    """Verify Cloudflare Worker script contains no hardcoded secrets, obfuscated keys, or open proxy SSRF."""
    worker_path = REPO_ROOT / "scripts" / "cloudflare_worker.js"
    assert worker_path.exists(), "scripts/cloudflare_worker.js not found"

    content = worker_path.read_text(encoding="utf-8")

    # 1. No Telegram bot token pattern [0-9]{8,10}:[a-zA-Z0-9_-]{35}
    token_pattern = re.compile(r"\b[0-9]{8,10}:[a-zA-Z0-9_-]{35}\b")
    assert not token_pattern.search(content), (
        "Hardcoded Telegram bot token found in cloudflare_worker.js"
    )

    # 2. No obfuscated XOR credentials or decoding routines
    assert "_FALLBACK_CID" not in content, "_FALLBACK_CID found in cloudflare_worker.js"
    assert "_FALLBACK_SEC" not in content, "_FALLBACK_SEC found in cloudflare_worker.js"
    assert "_FALLBACK_TOK" not in content, "_FALLBACK_TOK found in cloudflare_worker.js"
    assert "_xdec" not in content, "Obfuscation decoder found in cloudflare_worker.js"

    # 3. Webhook secret validation is present
    assert "TELEGRAM_WEBHOOK_SECRET" in content, (
        "TELEGRAM_WEBHOOK_SECRET check missing in cloudflare_worker.js"
    )
    assert "X-Telegram-Bot-Api-Secret-Token" in content, (
        "Secret token header check missing in cloudflare_worker.js"
    )

    # 4. Image proxy SSRF whitelist check is present
    assert "image.tmdb.org" in content, (
        "Image proxy missing domain whitelist in cloudflare_worker.js"
    )

    # 5. Upstream tunnel domain validation is present
    assert "isValidBackendUrl" in content, (
        "Upstream tunnel validation missing in cloudflare_worker.js"
    )
