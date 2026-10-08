"""Structured error classification for the StreamX transfer pipeline.

Every failure is categorized so that:
  - permanent configuration errors (bad credentials, missing service channel,
    invalid destination folder) are NOT retried endlessly, and
  - transient errors (network blips, Drive 429/5xx, MTProto flood waits) ARE
    retried with bounded exponential backoff.

Categories are persisted on the ``TelegramTransfer`` row so incidents can be
diagnosed later without exposing secrets to the end user.
"""

import enum


class ErrorCategory(str, enum.Enum):
    # --- Telegram ingestion / download ---
    TELEGRAM_FORWARD_FAILED = "TELEGRAM_FORWARD_FAILED"
    TELEGRAM_DOWNLOAD_FAILED = "TELEGRAM_DOWNLOAD_FAILED"
    TELEGRAM_MESSAGE_NOT_FOUND = "TELEGRAM_MESSAGE_NOT_FOUND"

    # --- Google Drive ---
    DRIVE_AUTH_FAILED = "DRIVE_AUTH_FAILED"
    DRIVE_PERMISSION_DENIED = "DRIVE_PERMISSION_DENIED"
    DRIVE_QUOTA_EXCEEDED = "DRIVE_QUOTA_EXCEEDED"
    DRIVE_RATE_LIMITED = "DRIVE_RATE_LIMITED"
    DRIVE_UPLOAD_FAILED = "DRIVE_UPLOAD_FAILED"
    DRIVE_VERIFICATION_FAILED = "DRIVE_VERIFICATION_FAILED"

    # --- generic ---
    JOB_TIMEOUT = "JOB_TIMEOUT"
    UNKNOWN = "UNKNOWN"


# Errors that represent a permanent configuration/state problem. These must NOT
# be retried indefinitely — the operator has to fix config and then re-queue.
PERMANENT_CATEGORIES = frozenset({
    ErrorCategory.TELEGRAM_FORWARD_FAILED,
    ErrorCategory.DRIVE_AUTH_FAILED,
    ErrorCategory.DRIVE_PERMISSION_DENIED,
    ErrorCategory.DRIVE_QUOTA_EXCEEDED,
})

# Human-actionable, secret-free summaries shown to the Telegram user.
CATEGORY_USER_MESSAGE = {
    ErrorCategory.TELEGRAM_FORWARD_FAILED:
        "Upload could not start: the Telegram service channel is misconfigured. "
        "Administrator attention required.",
    ErrorCategory.TELEGRAM_DOWNLOAD_FAILED:
        "Temporary Telegram download error. The job has been queued for automatic retry.",
    ErrorCategory.TELEGRAM_MESSAGE_NOT_FOUND:
        "The source media could not be located in Telegram. "
        "Please re-send the file and try again.",
    ErrorCategory.DRIVE_AUTH_FAILED:
        "Upload could not be completed: the server's Google Drive configuration is unavailable. "
        "Administrator attention required.",
    ErrorCategory.DRIVE_PERMISSION_DENIED:
        "Upload could not be completed: Google Drive denied write access. "
        "Administrator attention required.",
    ErrorCategory.DRIVE_QUOTA_EXCEEDED:
        "Upload could not be completed: Google Drive storage quota is full. "
        "Administrator attention required.",
    ErrorCategory.DRIVE_RATE_LIMITED:
        "Temporary Google Drive rate limit. The job has been queued for automatic retry.",
    ErrorCategory.DRIVE_UPLOAD_FAILED:
        "Temporary Google Drive upload error. The job has been queued for automatic retry.",
    ErrorCategory.DRIVE_VERIFICATION_FAILED:
        "Upload finished but could not be verified. The job has been queued for automatic retry.",
    ErrorCategory.JOB_TIMEOUT:
        "Transfer timed out. The job has been queued for automatic retry.",
    ErrorCategory.UNKNOWN:
        "Upload failed: an unexpected error occurred. The job has been queued for automatic retry.",
}


class StreamXError(Exception):
    """Base exception carrying a structured error category.

    ``retryable`` defaults to the category's classification so callers can simply
    construct e.g. ``DRIVEAuthError("bad token")`` and let the worker decide.
    """

    def __init__(self, category: ErrorCategory, message: str, retryable: bool | None = None):
        self.category = category
        if retryable is None:
            retryable = category not in PERMANENT_CATEGORIES
        self.retryable = retryable
        self.user_message = CATEGORY_USER_MESSAGE.get(category, str(message))
        super().__init__(message)


# --- Concrete exception types for the Drive layer ---------------------------

class DriveAuthError(StreamXError):
    """Permanent: OAuth credentials are invalid/expired and cannot be refreshed."""

    def __init__(self, message: str):
        super().__init__(ErrorCategory.DRIVE_AUTH_FAILED, message, retryable=False)


class DrivePermissionError(StreamXError):
    """Permanent: the Drive account cannot write to the target folder/file."""

    def __init__(self, message: str):
        super().__init__(ErrorCategory.DRIVE_PERMISSION_DENIED, message, retryable=False)


class DriveQuotaError(StreamXError):
    """Permanent: Drive storage quota exhausted."""

    def __init__(self, message: str):
        super().__init__(ErrorCategory.DRIVE_QUOTA_EXCEEDED, message, retryable=False)


class DriveRateLimitError(StreamXError):
    """Transient: 429 / rate-limited response from Drive."""

    def __init__(self, message: str):
        super().__init__(ErrorCategory.DRIVE_RATE_LIMITED, message, retryable=True)


class DriveUploadError(StreamXError):
    """Transient: a resumable chunk upload failed with a retryable HTTP status."""

    def __init__(self, message: str):
        super().__init__(ErrorCategory.DRIVE_UPLOAD_FAILED, message, retryable=True)


class DriveVerificationError(StreamXError):
    """Transient: upload HTTP completed but Drive metadata check failed."""

    def __init__(self, message: str):
        super().__init__(ErrorCategory.DRIVE_VERIFICATION_FAILED, message, retryable=True)


def classify_error(exc: BaseException) -> ErrorCategory:
    """Map any exception raised during a transfer into a structured category."""
    if isinstance(exc, StreamXError):
        return exc.category

    msg = str(exc).lower()

    # Telegram side
    if "could not locate media" in msg or "no media found" in msg:
        return ErrorCategory.TELEGRAM_MESSAGE_NOT_FOUND
    if "floodwait" in msg or "forward" in msg:
        return ErrorCategory.TELEGRAM_DOWNLOAD_FAILED
    if "not configured" in msg or "invalid" in msg and "session" in msg:
        return ErrorCategory.TELEGRAM_DOWNLOAD_FAILED

    # Google Drive / OAuth side. Order matters: check 401/403 BEFORE 4xx.
    if "401" in msg or "unauthorized" in msg:
        return ErrorCategory.DRIVE_AUTH_FAILED
    if "403" in msg or "permission denied" in msg or "insufficient" in msg:
        return ErrorCategory.DRIVE_PERMISSION_DENIED
    if "404" in msg and ("folder" in msg or "parent" in msg):
        return ErrorCategory.DRIVE_PERMISSION_DENIED
    if "429" in msg or "rate limit" in msg or "quota" in msg and "user" in msg:
        return ErrorCategory.DRIVE_RATE_LIMITED
    if "500" in msg or "502" in msg or "503" in msg or "504" in msg or "timeout" in msg or "connection" in msg:
        return ErrorCategory.DRIVE_UPLOAD_FAILED
    if "drive" in msg and ("upload" in msg or "session" in msg):
        return ErrorCategory.DRIVE_UPLOAD_FAILED

    return ErrorCategory.UNKNOWN
