"""StreamX 24/7 Cloudflare Tunnel Supervisor.

Automatically manages a Cloudflare quick tunnel for the local backend, updates
active_tunnel.txt, and registers the live tunnel URL with the Cloudflare Worker edge.
"""

import asyncio
import os
import re
import shutil
import subprocess
from typing import Optional

import httpx

from app.config.settings import settings
from app.utils.logging import log_event, logger

TRYCLOUDFLARE_REGEX = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")


class TunnelService:
    def __init__(self) -> None:
        self.process: Optional[asyncio.subprocess.Process] = None
        self.running: bool = False
        self.current_url: Optional[str] = None
        self._find_binary()

    def _find_binary(self) -> Optional[str]:
        binary = shutil.which("cloudflared")
        if binary:
            return binary

        common_paths = [
            r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
            r"C:\Program Files\cloudflared\cloudflared.exe",
            os.path.expanduser(r"~\cloudflared.exe"),
        ]
        for p in common_paths:
            if os.path.isfile(p):
                return p
        return None

    def is_available(self) -> bool:
        return self._find_binary() is not None

    async def register_with_worker(self, tunnel_url: str) -> bool:
        """Register the live tunnel URL with Cloudflare Worker edge engine."""
        worker_url = "https://streamx-worker.siddiqsiddiq00012.workers.dev/system/tunnel"
        headers = {"Content-Type": "application/json"}
        if settings.TELEGRAM_WEBHOOK_SECRET:
            headers["X-Telegram-Bot-Api-Secret-Token"] = settings.TELEGRAM_WEBHOOK_SECRET

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(worker_url, json={"tunnel": tunnel_url}, headers=headers)
                if res.status_code == 200:
                    logger.info(f"Registered live tunnel with Cloudflare Worker: {tunnel_url}")
                    return True
                else:
                    logger.warning(
                        f"Worker tunnel registration returned HTTP {res.status_code}: {res.text}"
                    )
        except Exception as e:
            logger.debug(f"Could not register tunnel with Cloudflare Worker: {e}")
        return False

    def update_active_tunnel_file(self, tunnel_url: str) -> None:
        """Write current tunnel URL to active_tunnel.txt in repository root."""
        try:
            base_dir = os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            )
            tunnel_file = os.path.join(base_dir, "active_tunnel.txt")
            with open(tunnel_file, "w", encoding="utf-8") as f:
                f.write(tunnel_url + "\n")
            logger.info(f"Updated active_tunnel.txt with live tunnel: {tunnel_url}")
        except Exception as e:
            logger.warning(f"Could not write active_tunnel.txt: {e}")

    async def start(self) -> None:
        binary = self._find_binary()
        if not binary:
            logger.info("cloudflared binary not found on system. Skipping automatic tunnel.")
            return

        self.running = True
        logger.info(f"Starting Cloudflare Tunnel supervisor via {binary}...")

        while self.running:
            try:
                cmd = [binary, "tunnel", "--url", "http://127.0.0.1:8000"]
                self.process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                # cloudflared logs its tunnel URL to stderr
                async def read_stream(stream, is_stderr=False):
                    while self.running and stream:
                        line = await stream.readline()
                        if not line:
                            break
                        decoded = line.decode("utf-8", errors="replace").strip()
                        match = TRYCLOUDFLARE_REGEX.search(decoded)
                        if match:
                            found_url = match.group(0)
                            if found_url != self.current_url:
                                self.current_url = found_url
                                log_event("CLOUDFLARE_TUNNEL_ESTABLISHED", url=found_url)
                                logger.info(f"StreamX Tunnel Live: {found_url}")
                                self.update_active_tunnel_file(found_url)
                                asyncio.create_task(self.register_with_worker(found_url))

                await asyncio.gather(
                    read_stream(self.process.stdout),
                    read_stream(self.process.stderr, is_stderr=True),
                )

                if self.process:
                    await self.process.wait()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Tunnel process error: {e}")

            if self.running:
                logger.info("Tunnel closed. Reconnecting in 5s...")
                await asyncio.sleep(5)

    def stop(self) -> None:
        self.running = False
        if self.process:
            try:
                self.process.terminate()
            except Exception:
                pass


tunnel_service = TunnelService()
