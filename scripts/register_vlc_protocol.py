"""StreamX Protocol Handler Registration for Windows.

Registers vlc:// and streamx:// URL schemes in HKEY_CURRENT_USER without requiring Administrator rights.
Ensures Chrome, Edge, Firefox, and Brave can launch VLC directly on click with 0 downloads.
"""

import sys
import os
import winreg
from pathlib import Path


def register_protocol(protocol: str, description: str, command: str, icon: str = None) -> bool:
    try:
        base_path = rf"Software\Classes\{protocol}"
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base_path) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, description)
            winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")

        if icon and os.path.exists(icon):
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"{base_path}\DefaultIcon") as key:
                winreg.SetValueEx(key, "", 0, winreg.REG_SZ, f"{icon},0")

        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"{base_path}\shell\open\command") as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, command)

        print(f"[OK] Registered protocol handler: {protocol}:// -> {command}")
        return True
    except Exception as e:
        print(f"[FAIL] Failed to register {protocol}://: {e}")
        return False


def main():
    root = Path(__file__).resolve().parent.parent
    backend = root / "backend"
    pythonw = backend / ".venv" / "Scripts" / "pythonw.exe"
    if not pythonw.exists():
        pythonw = Path(sys.executable).parent / "pythonw.exe"
    if not pythonw.exists():
        pythonw = Path(sys.executable)

    launcher_script = root / "scripts" / "vlc_launcher.py"

    vlc_icon = os.path.expandvars(r"%ProgramFiles%\VideoLAN\VLC\vlc.exe")
    if not os.path.exists(vlc_icon):
        bundled_vlc = root / "tools" / "vlc-3.0.21" / "vlc.exe"
        if bundled_vlc.exists():
            vlc_icon = str(bundled_vlc)

    command = f'"{pythonw}" "{launcher_script}" "%1"'

    ok1 = register_protocol("vlc", "URL:VLC Media Player Protocol", command, vlc_icon)
    ok2 = register_protocol("streamx", "URL:StreamX Protocol", command, vlc_icon)

    if ok1 and ok2:
        print("\nAll VLC protocols registered successfully in Windows HKCU registry!")
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
