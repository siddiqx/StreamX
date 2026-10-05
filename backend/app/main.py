"""StreamX Backend Application Entrypoint."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.config.settings import settings
from app.db.database import init_db
from app.utils.logging import log_event, logger


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup and shutdown lifecycle."""
    log_event("STARTUP", environment=settings.STREAMX_ENV)
    await init_db()
    log_event("DATABASE_INITIALIZED")
    yield
    log_event("SHUTDOWN")


app = FastAPI(
    title="StreamX API",
    version="1.0.0",
    description="StreamX Personal Media Management & Transfer System",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restricted in production when frontend domain is configured
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health_router)
