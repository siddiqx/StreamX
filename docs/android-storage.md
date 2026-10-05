# Android Storage & Download Architecture

## Scoped Storage Compliance (Android 11 / API 30+)

To guarantee reliable operation across all modern Android versions without requiring elevated device-wide permissions (`MANAGE_EXTERNAL_STORAGE`), StreamX adopts a dual-strategy:

1. **Default App-Specific External Media Directory**:
   - Location: `/storage/emulated/0/Android/media/com.streamx.app/Downloads/`
   - Does not require runtime storage permission prompts.
   - Files are persistent, accessible by video players, and indexed by Android's media scanner.
   
2. **User-Selected Folder via Storage Access Framework (SAF)**:
   - User selects an explicit folder (e.g., `Internal Storage/StreamX/Downloads`) via `ACTION_OPEN_DOCUMENT_TREE`.
   - The app persists URI read/write permissions via `takePersistableUriPermission`.
   - Downloads stream directly into DocumentFile streams.

## Download Reliability & Resume Rules
- **Storage Pre-Check**: Before initiating a transfer, the available bytes on the target volume are queried via `StatFs`. If `available_bytes < (file_size * 1.05)`, the download is rejected immediately with an explanatory alert.
- **Resumable HTTP Range Requests**: Downloads support `Range: bytes=X-` headers so that dropped Wi-Fi connections resume from byte offset `X` rather than redownloading from 0.
- **Wi-Fi Protection**: Network capabilities are monitored using `ConnectivityManager.NetworkCallback`. When "Wi-Fi Only" is toggled in settings and mobile data is detected, transfers pause automatically.
