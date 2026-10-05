"""Interactive Telegram MTProto Session Generator for StreamX.

Connects to Telegram via Telethon and generates an encrypted StringSession
for large-file background transfers. The session string is saved to .env
and never logged or committed to Git.
"""

import asyncio
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Ensure root is in path to load settings
ROOT_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT_DIR / ".env"
load_dotenv(ENV_PATH)

from telethon import TelegramClient
from telethon.sessions import StringSession


def update_env_file(session_string: str) -> None:
    """Save the session string to .env securely."""
    content = ""
    if ENV_PATH.exists():
        content = ENV_PATH.read_text(encoding="utf-8")

    if "TELEGRAM_SESSION_STRING=" in content:
        lines = content.splitlines()
        new_lines = []
        for line in lines:
            if line.startswith("TELEGRAM_SESSION_STRING="):
                new_lines.append(f"TELEGRAM_SESSION_STRING={session_string}")
            else:
                new_lines.append(line)
        content = "\n".join(new_lines) + "\n"
    else:
        content += f"\nTELEGRAM_SESSION_STRING={session_string}\n"

    ENV_PATH.write_text(content, encoding="utf-8")


async def main():
    api_id_str = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")

    if not api_id_str or not api_hash:
        print("ERROR: TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured in .env first.")
        sys.exit(1)

    try:
        api_id = int(api_id_str)
    except ValueError:
        print("ERROR: TELEGRAM_API_ID must be an integer.")
        sys.exit(1)

    print("======================================================")
    print("      StreamX Telegram MTProto Session Generator      ")
    print("======================================================")
    print("This will connect your Telegram user session to StreamX.")
    print("StreamX will use this session ONLY to download large media")
    print("files that you explicitly forward to @Stream1_X_bot.")
    print("======================================================\n")

    client = TelegramClient(StringSession(), api_id, api_hash)
    await client.start()

    session_string = client.session.save()
    me = await client.get_me()
    print("\n------------------------------------------------------")
    print(f"Authentication Successful!")
    print(f"Logged in as: {me.first_name} (@{me.username}) [ID: {me.id}]")
    print("------------------------------------------------------")

    update_env_file(session_string)
    print("\nSession string has been automatically saved to your .env file.")
    print("Your MTProto client is now ready for large file transfers!\n")

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
