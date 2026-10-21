import os
import sys
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path
from dotenv import load_dotenv
from google_auth_oauthlib.flow import InstalledAppFlow

ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT_DIR / ".env"
load_dotenv(ENV_PATH)

client_id = os.getenv("GOOGLE_CLIENT_ID")
client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

if not client_id or not client_secret:
    print("ERROR: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing from .env")
    sys.exit(1)

REDIRECT_PORT = 8090
REDIRECT_URI = f"http://localhost:{REDIRECT_PORT}/"

client_config = {
    "installed": {
        "client_id": client_id,
        "client_secret": client_secret,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [REDIRECT_URI],
    }
}

flow = InstalledAppFlow.from_client_config(
    client_config,
    scopes=["https://www.googleapis.com/auth/drive"],
)
flow.redirect_uri = REDIRECT_URI
auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline")

auth_code = None

class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if "code" in params:
            auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            html = """
            <html>
            <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0b0f19; color: #fff; margin: 0;">
                <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 20px; text-align: center; max-width: 480px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">🎬</div>
                    <h1 style="margin: 0 0 12px; color: #10b981; font-size: 24px;">Google Drive Connected!</h1>
                    <p style="color: #94a3b8; font-size: 15px; line-height: 1.5;">StreamX has received your authorization token and updated your credentials. You can now close this tab.</p>
                </div>
            </body>
            </html>
            """
            self.wfile.write(html.encode("utf-8"))
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"No authorization code received.")

    def log_message(self, format, *args):
        pass  # Quiet logging

server = HTTPServer(("localhost", REDIRECT_PORT), OAuthCallbackHandler)
print(f"OAUTH_SERVER_LISTENING on {REDIRECT_URI}", flush=True)
print(f"AUTH_URL: {auth_url}", flush=True)
webbrowser.open(auth_url)

while auth_code is None:
    server.handle_request()

server.server_close()

print("Received authorization code! Exchanging for tokens...")
flow.fetch_token(code=auth_code)
refresh_token = flow.credentials.refresh_token

if not refresh_token:
    print("WARNING: No refresh token returned. Did you already consent? Force prompt=consent")
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
print("SUCCESS: Google Drive refresh token saved to .env")
print("\n" + "=" * 60)
print("  IMPORTANT: TO PREVENT 7-DAY EXPIRATION (MAKE TOKEN PERMANENT):")
print("  1. Open https://console.cloud.google.com/apis/credentials/consent")
print("  2. Under 'Publishing status', click 'PUBLISH APP' and confirm.")
print("  When status is 'In production', Google refresh tokens NEVER expire!")
print("=" * 60)
print("\nNext step for Cloudflare Worker 24/7 streaming:")
print("Run: npx wrangler secret put GOOGLE_REFRESH_TOKEN")
print("Or update GOOGLE_REFRESH_TOKEN in your Cloudflare Worker dashboard.")
print("=" * 60 + "\n")

