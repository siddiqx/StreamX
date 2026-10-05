"""Pytest global configuration and fixtures."""

import os
import pytest

# Ensure tests run against a dedicated test database, never touching streamx.db
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_streamx.db"
os.environ["STREAMX_ENV"] = "testing"
