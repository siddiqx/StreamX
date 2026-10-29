"""StreamX Native VLC Media Player Protocol Launcher.

Handles vlc:// and streamx:// protocol invocations from browsers (Chrome, Edge, Firefox, Brave)
to launch hardware VLC directly on Windows without downloading .m3u files.
"""

import os
import sys
import re
import urllib.parse
import subprocess
from pathlib import Path


def find_vlc_binary() -> str:
    """Locate the best VLC executable on the host system."""
    project_root = Path(__file__).resolve().parent.parent
    bundled_vlc = project_root / "tools" / "vlc-3.0.21" / "vlc.exe"
    candidates = [
        str(bundled_vlc),
        r"d:\02_Projects\StreamX\tools\vlc-3.0.21\vlc.exe",
        os.path.expandvars(r"%ProgramFiles%\VideoLAN\VLC\vlc.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\VideoLAN\VLC\vlc.exe"),
        os.path.expandvars(r"%LocalAppData%\Programs\VideoLAN\VLC\vlc.exe"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return "vlc.exe"


def clean_target_url(raw_arg: str) -> tuple[str, int]:
    """Extract clean HTTP/HTTPS stream URL and optional seek offset."""
    raw = raw_arg.strip().strip("\"'")

    # Strip custom protocol prefixes
    for prefix in ("vlc://", "vlc:", "streamx://", "streamx:"):
        if raw.lower().startswith(prefix):
            raw = raw[len(prefix):]
            break

    raw = raw.strip().strip("\"'")

    # Handle percent-encoded full URLs (e.g. https%3A%2F%2F...)
    if raw.lower().startswith("http%3a") or raw.lower().startswith("https%3a"):
        raw = urllib.parse.unquote(raw)

    # Fix single-slash schemes resulting from browser protocol parsing
    if raw.startswith("https:/") and not raw.startswith("https://"):
        raw = "https://" + raw[7:].lstrip("/")
    elif raw.startswith("http:/") and not raw.startswith("http://"):
        raw = "http://" + raw[6:].lstrip("/")

    # Parse URL components
    parts = urllib.parse.urlsplit(raw)

    # Ensure path is URL encoded so spaces, square brackets, and unicode do not break VLC MRL parser
    clean_path = urllib.parse.quote(urllib.parse.unquote(parts.path), safe="/")

    # Extract resume seek position if present and clean query parameters
    start_time = 0
    query_pairs = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    filtered_pairs = []
    for k, v in query_pairs:
        if k in ("start", "pos", "t"):
            try:
                start_time = int(float(v))
            except (ValueError, TypeError):
                pass
        else:
            filtered_pairs.append((k, v))

    clean_query = urllib.parse.urlencode(filtered_pairs)
    clean_url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, clean_path, clean_query, ""))

    return clean_url, start_time


def main():
    if len(sys.argv) < 2:
        # Just open VLC directly if called with no arguments
        vlc_bin = find_vlc_binary()
        subprocess.Popen([vlc_bin], creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        sys.exit(0)

    raw_arg = sys.argv[1]
    stream_url, start_time = clean_target_url(raw_arg)

    if not stream_url.startswith("http://") and not stream_url.startswith("https://"):
        # If relative or invalid, exit safely
        sys.exit(1)

    vlc_bin = find_vlc_binary()

    vlc_args = [
        vlc_bin,
        "--no-qt-privacy-ask",
        "--network-caching=300",
        "--file-caching=300",
        "--http-reconnect",
        "--avcodec-hw=any",
    ]

    if start_time > 0:
        vlc_args.append(f"--start-time={start_time}")

    vlc_args.append(stream_url)

    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen(vlc_args, creationflags=flags)
    sys.exit(0)


if __name__ == "__main__":
    main()
