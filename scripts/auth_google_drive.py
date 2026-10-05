"""Interactive Google Drive OAuth Authorization Script for StreamX.

Opens the Google OAuth consent page in your default browser, retrieves the
refresh token, and securely saves it to your local .env file.
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT_DIR / ".env"
load_dotenv(ENV_PATH)

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    # Full access or file-specific access to Drive
    "https://www.googleapis.com/auth/drive",
]


def update_env_file(refresh_token: str) -> None:
    content = ""
    if ENV_PATH.exists():
        content = ENV_PATH.read_text(encoding="utf-8")

    if "GOOGLE_REFRESH_TOKEN=" in content:
        lines = content.splitlines()
        new_lines = []
        for line in lines:
            if line.startswith("GOOGLE_REFRESH_TOKEN="):
                new_lines.append(f"GOOGLE_REFRESH_TOKEN={refresh_token}")
            else:
                new_lines.append(line)
        content = "\n".join(new_lines) + "\n"
    else:
        content += f"\nGOOGLE_REFRESH_TOKEN={refresh_token}\n"

    ENV_PATH.write_text(content, encoding="utf-8")


def main():
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

    if not client_id or not client_secret:
        print("ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured in .env first.")
        sys.exit(1)

    print("======================================================")
    print("      StreamX Google Drive OAuth Authorization        ")
    print("======================================================")
    print("A browser window will open asking you to sign in with")
    print("your Google account and grant Drive access to StreamX.")
    print("======================================================\n")

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    try:
        flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
        credentials = flow.run_local_server(
            port=0,
            prompt="consent",
            access_type="offline",
            success_message="StreamX Google Drive Authorization Successful! You can close this tab now.",
        )
    except Exception as e:
        print(f"\nAuthorization failed: {e}")
        print("\nTip: Make sure you added your email under 'Test users' on the Google Cloud OAuth Consent Screen!")
        sys.exit(1)

    if not credentials.refresh_token:
        print("WARNING: No refresh token returned. Did you already authorize without prompt=consent?")
        sys.exit(1)

    update_env_file(credentials.refresh_token)
    print("\n------------------------------------------------------")
    print("SUCCESS: Google Drive refresh token generated and saved to .env!")
    print("StreamX can now upload directly to your Google Drive library.")
    print("------------------------------------------------------\n")


if __name__ == "__main__":
    main()
