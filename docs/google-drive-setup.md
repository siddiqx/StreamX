# Google Drive Setup Guide

StreamX uses the official Google Drive API v3 to manage your media library and perform resumable uploads.

---

## Prerequisites: Google Cloud Project & OAuth 2.0 Credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `StreamX-Personal`).
3. Enable the **Google Drive API**:
   - Go to **APIs & Services** > **Library**.
   - Search for **Google Drive API** and click **Enable**.
4. Configure the **OAuth Consent Screen**:
   - User Type: **External**.
   - App Name: `StreamX`.
   - User support email: Your personal email.
   - Developer contact info: Your personal email.
   - Scopes: Add `https://www.googleapis.com/auth/drive.file` (access only to files created/opened by StreamX) or `https://www.googleapis.com/auth/drive`.
   - Test Users: Add your personal Google account email address.
5. Create **OAuth Client ID**:
   - Go to **APIs & Services** > **Credentials**.
   - Click **Create Credentials** > **OAuth client ID**.
   - Application type: **Desktop app** or **Web application** (with `http://localhost:8080/oauth2callback`).
   - Save your:
     - `Client ID` -> `GOOGLE_CLIENT_ID`
     - `Client Secret` -> `GOOGLE_CLIENT_SECRET`

---

## Authorizing & Generating Refresh Token (For Phase 5)

StreamX provides an authorization helper script (`scripts/auth_google_drive.py`).
When run:
1. It opens the Google OAuth consent page in your browser.
2. You sign in with your personal Google account and grant permissions.
3. The script retrieves and prints the **`GOOGLE_REFRESH_TOKEN`**.
4. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` in `.env`.
The backend uses the refresh token to silently obtain short-lived access tokens as needed.
