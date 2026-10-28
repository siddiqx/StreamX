"""Syncs Google OAuth credentials and environment secrets from .env to Cloudflare Worker.

Ensures the 24/7 Cloudflare Worker edge streaming gateway has access to
Google Drive API for zero-disk VLC and browser streaming.
"""

import os
import subprocess
import sys
from pathlib import Path
from dotenv import dotenv_values

ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT_DIR / ".env"

NODE_PATH = (
    Path(r"C:\Users\skdre\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.20.0-win-x64")
)
NPX_CMD = str(NODE_PATH / "npx.cmd")


def main():
    if not ENV_PATH.exists():
        print(f"Error: {ENV_PATH} not found.")
        sys.exit(1)

    env_vars = dotenv_values(ENV_PATH)
    client_id = env_vars.get("GOOGLE_CLIENT_ID", "").strip()
    client_secret = env_vars.get("GOOGLE_CLIENT_SECRET", "").strip()
    refresh_token = env_vars.get("GOOGLE_REFRESH_TOKEN", "").strip()
    bot_token = env_vars.get("TELEGRAM_BOT_TOKEN", "").strip()
    webhook_secret = env_vars.get("TELEGRAM_WEBHOOK_SECRET", "").strip()

    if not client_id or not client_secret or not refresh_token:
        print("Error: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN is missing in .env.")
        sys.exit(1)

    # 1. Test token refresh with Google OAuth endpoint first
    print("Testing Google OAuth token refresh...")
    import requests
    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=10,
    )

    if resp.status_code != 200:
        print(f"Google OAuth verification failed (HTTP {resp.status_code}): {resp.text}")
        print("Please run scripts/interactive_oauth.py to authorize with Google Drive first.")
        sys.exit(1)

    token_data = resp.json()
    print(f"SUCCESS: Google OAuth token valid (expires in {token_data.get('expires_in')}s).")

    # 2. Upload secrets to Cloudflare Worker
    secrets_to_upload = {
        "GOOGLE_CLIENT_ID": client_id,
        "GOOGLE_CLIENT_SECRET": client_secret,
        "GOOGLE_REFRESH_TOKEN": refresh_token,
    }
    if bot_token:
        secrets_to_upload["TELEGRAM_BOT_TOKEN"] = bot_token
    if webhook_secret:
        secrets_to_upload["TELEGRAM_WEBHOOK_SECRET"] = webhook_secret

    env_os = os.environ.copy()
    env_os["Path"] = f"{NODE_PATH};" + env_os.get("Path", "")

    for key, val in secrets_to_upload.items():
        print(f"Uploading secret {key} to Cloudflare Worker...")
        p = subprocess.run(
            [NPX_CMD, "wrangler", "secret", "put", key],
            input=val,
            text=True,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            env=env_os,
            cwd=str(ROOT_DIR),
        )
        if p.returncode == 0:
            print(f"  [OK] Secret {key} configured.")
        else:
            print(f"  [FAIL] Failed to configure {key}: {p.stderr}")

    print("\nDeploying updated Cloudflare Worker...")
    p_dep = subprocess.run(
        [NPX_CMD, "wrangler", "deploy"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env_os,
        cwd=str(ROOT_DIR),
    )
    if p_dep.returncode == 0:
        print("[OK] Cloudflare Worker deployed successfully.")
    else:
        print(f"[FAIL] Wrangler deploy failed:\n{p_dep.stderr}")

    print("\nTesting live edge stream endpoint...")
    test_url = "https://streamx-worker.siddiqsiddiq00012.workers.dev/media/76/stream/test.mkv?drive_id=1TlpXTJh9acSIrQ6bKvzoYtA9eAc8_pPU"
    test_resp = requests.get(test_url, headers={"Range": "bytes=0-1024", "User-Agent": "VLC/3.0.21"}, timeout=12)
    print(f"Stream Status: HTTP {test_resp.status_code}")
    print(f"Content-Type: {test_resp.headers.get('Content-Type')}")
    print(f"Content-Range: {test_resp.headers.get('Content-Range')}")
    print(f"Bytes received: {len(test_resp.content)}")

    if test_resp.status_code in (200, 206) and len(test_resp.content) > 0:
        print("\nALL STREAMING CHANNELS OPERATIONAL!")
    else:
        print(f"\nUnexpected response: {test_resp.text[:300]}")


if __name__ == "__main__":
    main()
