"""Health check API router."""

from fastapi import APIRouter
from app.schemas.health import HealthResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    """Return health status of StreamX service."""
    return HealthResponse(status="ok", service="streamx")
