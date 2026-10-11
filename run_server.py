"""StreamX Dedicated Server Launcher.

Ensures StreamX backend package takes absolute precedence over any global or
editable packages installed in Python site-packages.
"""

import os
import sys

# Prepend StreamX backend to sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import uvicorn

if __name__ == "__main__":
    print("[StreamX] Starting backend server on http://127.0.0.1:8000 ...")
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
