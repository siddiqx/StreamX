"""StreamX Dedicated Server Launcher.

Ensures StreamX backend package takes absolute precedence over any global or
editable packages installed in Python site-packages.
"""

import os
import platform
import sys

# Prepend StreamX backend to sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import uvicorn


def prevent_sleep() -> None:
    """Lock operating system power state to prevent sleep/standby while StreamX is running."""
    if platform.system() == "Windows":
        try:
            import ctypes
            ES_CONTINUOUS = 0x80000000
            ES_SYSTEM_REQUIRED = 0x00000001
            ES_AWAYMODE_REQUIRED = 0x00000002
            ctypes.windll.kernel32.SetThreadExecutionState(
                ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED
            )
            print("[StreamX] 24/7 Power Lock Engaged: Windows sleep and hibernation prevented.")
        except Exception as e:
            print(f"[StreamX] Power lock note: {e}")


if __name__ == "__main__":
    prevent_sleep()
    print("[StreamX] Starting backend server on http://127.0.0.1:8000 ...")
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
