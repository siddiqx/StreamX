"""Authentication and authorization dependency for StreamX API."""

import hmac
from typing import Optional
from fastapi import Header, HTTPException, Query, Request, status

from app.config.settings import settings
from app.utils.logging import logger


def is_local_request(request: Request) -> bool:
    """Check if the request originates from the local host loopback."""
    client_host = request.client.host if request.client else ""
    return client_host in ("127.0.0.1", "::1", "localhost")


async def require_auth(
    request: Request,
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    api_key_query: Optional[str] = Query(None, alias="api_key"),
) -> bool:
    """Verify API authorization token for sensitive operations.

    Accepts:
    1. Header: Authorization: Bearer <TOKEN>
    2. Header: X-API-Key: <TOKEN>
    3. Query parameter: ?api_key=<TOKEN> (for media players / VLC / M3U)
    4. Local loopback exemption for local desktop interaction if unconfigured.
    """
    expected_key = settings.STREAMX_API_KEY
    if not expected_key:
        if (
            settings.STREAMX_SECRET_KEY
            and settings.STREAMX_SECRET_KEY != "insecure-dev-secret-replace-in-prod"
        ):
            expected_key = settings.STREAMX_SECRET_KEY

    # If no key is configured in dev mode, permit local requests safely
    if not expected_key:
        if settings.STREAMX_ENV == "development" or is_local_request(request):
            return True
        logger.warning(
            "Protected endpoint accessed but STREAMX_API_KEY is not configured"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Server authentication key is not configured. Set STREAMX_API_KEY in environment.",
        )

    # Allow local desktop actions if running locally in development mode
    if is_local_request(request) and settings.STREAMX_ENV == "development":
        return True

    # Extract token
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif x_api_key:
        token = x_api_key.strip()
    elif api_key_query:
        token = api_key_query.strip()

    if not token or not hmac.compare_digest(token, expected_key):
        logger.warning(
            f"Unauthorized access attempt to {request.method} {request.url.path} from {request.client.host if request.client else 'unknown'}"
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return True
