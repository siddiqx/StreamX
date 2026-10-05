"""Health check schemas."""

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = Field(default="ok", json_schema_extra={"example": "ok"})
    service: str = Field(default="streamx", json_schema_extra={"example": "streamx"})
