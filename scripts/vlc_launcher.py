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
    candidates = [
        os.path.expandvars(r"%ProgramFiles%\VideoLAN\VLC\vlc.exe"),
        str(project_root / "tools" / "vlc-3.0.21" / "vlc.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\VideoLAN\VLC\vlc.exe"),
        os.path.expandvars(r"%LocalAppData%\Programs\VideoLAN\VLC\vlc.exe"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return "vlc.exe"


def clean_target_url(raw_arg: str) -> tuple[str, int]:
    """Extract clean HTTP/HTTPS stream URL and optional seek offset."""
    raw = raw_arg.strip()

    # Strip custom protocol prefixes
    if raw.lower().startswith("vlc://"):
        raw = raw[6:]
    elif raw.lower().startswith("vlc:"):
        raw = raw[4:]
    elif raw.lower().startswith("streamx://"):
        raw = raw[10:]
    elif raw.lower().startswith("streamx:"):
        raw = raw[8:]

    # Remove enclosing quotes if any
    raw = raw.strip("\"' ")

    # Handle percent-encoded URLs (e.g. https%3A%2F%2F...)
    if raw.startswith("http%3A") or raw.startswith("https%3A"):
        raw = urllib.parse.unquote(raw)

    # Fix single-slash schemes resulting from protocol parsing
    if raw.startswith("https:/") and not raw.startswith("https://"):
        raw = "https://" + raw[7:].lstrip("/")
    elif raw.startswith("http:/") and not raw.startswith("http://"):
        raw = "http://" + raw[6:].lstrip("/")

    # Extract resume seek position if present
    start_time = 0
    match = re.search(r"[?&#](?:start|pos|t)=([0-9.]+)", raw)
    if match:
        try:
            start_time = int(float(match.group(1)))
        except (ValueError, TypeError):
            pass

    return raw, start_time


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
        "--video-track=0",
        "--network-caching=1500",
        "--file-caching=1500",
        "--http-reconnect",
    ]

    if start_time > 0:
        vlc_args.append(f"--start-time={start_time}")

    vlc_args.append(stream_url)

    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen(vlc_args, creationflags=flags)
    sys.exit(0)


if __name__ == "__main__":
    main()
