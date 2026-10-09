import sys
sys.path.insert(0, "D:/02_Projects/StreamX/backend")
import asyncio
from unittest.mock import patch
from app.services.telegram_bot_service import TelegramBotService
from app.utils.errors import StreamXError, ErrorCategory

class _FakeResp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text
    def json(self):
        print("json() called, returning:", self._payload)
        return self._payload

class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response
    async def __aenter__(self):
        return self
    async def __aexit__(self, *a):
        return False
    async def post(self, url, json=None, headers=None, content=None, timeout=None):
        print("post called, url:", url)
        return self._response

async def test():
    bot = TelegramBotService(bot_token="test_token", service_channel="@TestRelay")
    error_response = _FakeResp(
        status_code=200,
        payload={"ok": False, "error_code": 400, "description": "Bad Request: chat not found"},
        text="{\"ok\": false, \"error_code\": 400, \"description\": \"Bad Request: chat not found\"}"
    )
    fake = _FakeAsyncClient(error_response)
    
    with patch("app.services.telegram_bot_service.httpx.AsyncClient", lambda *a, **k: fake):
        try:
            await bot.forward_media_to_service(from_chat_id=12345, message_id=67890)
            print("FAIL: Expected StreamXError")
            return False
        except StreamXError as e:
            print("Got StreamXError: category=%s, message=%s" % (e.category, e))
            return True
        except Exception as e:
            print("FAIL: Unexpected exception: %s: %s" % (type(e).__name__, e))
            return False

asyncio.run(test())
