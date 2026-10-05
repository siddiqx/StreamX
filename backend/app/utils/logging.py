"""Structured logging utility for StreamX.

Guarantees clean, structured key-value output and sanitizes any sensitive credentials.
"""

import logging
import re
import sys
from typing import Any

SENSITIVE_REPLACEMENTS = [
    (re.compile(r"bot\d+:[A-Za-z0-9_-]+", re.IGNORECASE), "bot[REDACTED_TOKEN]"),
    (
        re.compile(
            r"(api_hash|session_string|refresh_token|client_secret|secret_key)=['\"][^'\"]+['\"]",
            re.IGNORECASE,
        ),
        r"\1='[REDACTED]'",
    ),
]


class SecretSanitizingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = str(record.msg)
        for pattern, replacement in SENSITIVE_REPLACEMENTS:
            msg = pattern.sub(replacement, msg)
        record.msg = msg
        return True


def setup_logger(name: str = "streamx", level: str = "INFO") -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(getattr(logging, level.upper(), logging.INFO))
        formatter = logging.Formatter(
            fmt="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        handler.addFilter(SecretSanitizingFilter())
        logger.addHandler(handler)

    return logger


logger = setup_logger()


def log_event(event: str, **kwargs: Any) -> None:
    """Format and log an event in structured format."""
    details = " ".join(f'{k}="{v}"' if isinstance(v, str) else f"{k}={v}" for k, v in kwargs.items())
    logger.info(f"{event} {details}".strip())
