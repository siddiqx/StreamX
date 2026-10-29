"""StreamX 24/7 Windows Background Service Supervisor.

Runs FastAPI, MTProto Transfer Worker, and Watchdog supervisors silently in the background.
Automatically restarts on unexpected terminations and directs all output to logs/backend.log.
"""

import os
import sys
import time
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
PYTHON = BACKEND / ".venv" / "Scripts" / "python.exe"
LOG_FILE = ROOT / "logs" / "backend.log"
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

# Grace period on boot for Wi-Fi and network adapters to obtain IP
time.sleep(5)

while True:
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as log:
            log.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [INFO] Starting StreamX Engine via background supervisor...\n")
            log.flush()

            # Ensure PYTHONPATH includes backend directory
            env = os.environ.copy()
            env["PYTHONPATH"] = str(BACKEND)

            p = subprocess.Popen(
                [str(PYTHON), "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"],
                cwd=str(BACKEND),
                stdout=log,
                stderr=subprocess.STDOUT,
                env=env,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            p.wait()
            log.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [WARN] StreamX Backend process exited with code {p.returncode}. Restarting in 5s...\n")
            log.flush()
    except Exception as e:
        with open(LOG_FILE, "a", encoding="utf-8") as log:
            log.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [ERROR] Supervisor exception: {e}. Retrying in 5s...\n")
    time.sleep(5)
