import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qs
import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT_DIR / ".env"
load_dotenv(ENV_PATH)

client_id = os.getenv("GOOGLE_CLIENT_ID")
client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

if not client_id or not client_secret:
    print("ERROR: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing from .env")
    sys.exit(1)

code_input = sys.argv[1].strip() if len(sys.argv) > 1 else ""

if not code_input:
    print("Usage: python scripts/enter_code.py \"<code_or_url>\"")
    sys.exit(1)

# If full URL was pasted, extract 'code' parameter
if "code=" in code_input:
    parsed = urlparse(code_input)
    qs = parse_qs(parsed.query)
    if "code" in qs:
        code_input = qs["code"][0]

print(f"Exchanging code: {code_input[:10]}... for refresh token...")

# Exchange with Google OAuth endpoint directly
token_url = "https://oauth2.googleapis.com/token"
payload = {
    "code": code_input,
    "client_id": client_id,
    "client_secret": client_secret,
    "redirect_uri": "http://localhost:8090/",
    "grant_type": "authorization_code",
}

res = requests.post(token_url, data=payload)
data = res.json()

if "error" in data:
    print(f"ERROR from Google: {data.get('error')} - {data.get('error_description')}")
    # Try with http://localhost
    payload["redirect_uri"] = "http://localhost"
    res2 = requests.post(token_url, data=payload)
    data2 = res2.json()
    if "error" in data2:
        print(f"Fallback redirect_uri also failed: {data2.get('error')}")
        sys.exit(1)
    data = data2

refresh_token = data.get("refresh_token")
access_token = data.get("access_token")

if not refresh_token:
    print(f"No refresh_token returned (got access_token={bool(access_token)}).")
    print("Make sure prompt=consent was used when authorizing.")
    if access_token:
        print("Note: Access token is valid temporarily.")
    sys.exit(1)

# 1. Update .env securely
env_content = ENV_PATH.read_text(encoding="utf-8")
lines = env_content.splitlines()
new_lines = []
for line in lines:
    if line.startswith("GOOGLE_REFRESH_TOKEN="):
        new_lines.append(f"GOOGLE_REFRESH_TOKEN={refresh_token}")
    else:
        new_lines.append(line)
ENV_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
print("SUCCESS: Updated .env with GOOGLE_REFRESH_TOKEN")
print("NOTE: For Cloudflare Worker, configure GOOGLE_REFRESH_TOKEN via Cloudflare dashboard or wrangler secret put.")

