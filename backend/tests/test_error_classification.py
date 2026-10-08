"""Unit tests for StreamX error classification (PHases 4, 12, 18)."""

import pytest

from app.utils.errors import (
    ErrorCategory,
    PERMANENT_CATEGORIES,
    StreamXError,
    classify_error,
    DriveAuthError,
    DrivePermissionError,
    DriveRateLimitError,
    DriveUploadError,
    DriveVerificationError,
)


def test_permanent_categories_are_not_retried():
    assert ErrorCategory.TELEGRAM_FORWARD_FAILED in PERMANENT_CATEGORIES
    assert ErrorCategory.DRIVE_AUTH_FAILED in PERMANENT_CATEGORIES
    assert ErrorCategory.DRIVE_PERMISSION_DENIED in PERMANENT_CATEGORIES
    assert ErrorCategory.DRIVE_QUOTA_EXCEEDED in PERMANENT_CATEGORIES


def test_transient_categories_are_retryable_by_default():
    for cat in [
        ErrorCategory.TELEGRAM_DOWNLOAD_FAILED,
        ErrorCategory.TELEGRAM_MESSAGE_NOT_FOUND,
        ErrorCategory.DRIVE_RATE_LIMITED,
        ErrorCategory.DRIVE_UPLOAD_FAILED,
        ErrorCategory.DRIVE_VERIFICATION_FAILED,
        ErrorCategory.JOB_TIMEOUT,
        ErrorCategory.UNKNOWN,
    ]:
        assert cat not in PERMANENT_CATEGORIES


def test_streamx_error_retryable_flag():
    assert StreamXError(ErrorCategory.DRIVE_UPLOAD_FAILED, "x").retryable is True
    assert DriveAuthError("bad").retryable is False
    assert DriveRateLimitError("x").retryable is True
    assert DrivePermissionError("x").retryable is False


@pytest.mark.parametrize(
    "exc,expected",
    [
        (RuntimeError("Could not locate media message for 'x' in the relay channel."),
         ErrorCategory.TELEGRAM_MESSAGE_NOT_FOUND),
        (StreamXError(ErrorCategory.TELEGRAM_FORWARD_FAILED, "forward failed"),
         ErrorCategory.TELEGRAM_FORWARD_FAILED),
        (DriveAuthError("HTTP 401 invalid"), ErrorCategory.DRIVE_AUTH_FAILED),
        (DrivePermissionError("HTTP 403 forbidden"), ErrorCategory.DRIVE_PERMISSION_DENIED),
        (DriveRateLimitError("HTTP 429"), ErrorCategory.DRIVE_RATE_LIMITED),
        (DriveUploadError("HTTP 500 server error"), ErrorCategory.DRIVE_UPLOAD_FAILED),
        (DriveVerificationError("size mismatch"), ErrorCategory.DRIVE_VERIFICATION_FAILED),
        (ValueError("Drive chunk upload failed with HTTP 503: unavailable"),
         ErrorCategory.DRIVE_UPLOAD_FAILED),
        (RuntimeError("HTTP 429 rate limit"), ErrorCategory.DRIVE_RATE_LIMITED),
        (RuntimeError("connection reset by peer"), ErrorCategory.DRIVE_UPLOAD_FAILED),
        (RuntimeError("some totally unknown failure"), ErrorCategory.UNKNOWN),
    ],
)
def test_classify_error(exc, expected):
    assert classify_error(exc) == expected
