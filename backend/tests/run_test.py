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
        return self._payload

class _FakeAsyncClient:
    def __init__(self, response):
        self._response = response
    async def __aenter__(self):
        return self
    async def __aexit__(self, *a):
        return False
    async def post(self, url, json=None, headers=None, content=None, timeout=None):
        return self._response

async def test_ok_false_error():
    """Test HTTP 200 with ok: false returns proper error with error_code from response."""
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
            if e.category == ErrorCategory.TELEGRAM_FORWARD_FAILED and "error_code=400" in str(e):
                print("PASS: Correctly includes error_code from response")
                return True
            else:
                print("FAIL: Wrong error category or message")
                return False
        except Exception as e:
            print("FAIL: Unexpected exception: %s: %s" % (type(e).__name__, e))
            return False

async def test_ok_true_success():
    """Test HTTP 200 with ok: true returns forwarded message IDs."""
    bot = TelegramBotService(bot_token="test_token", service_channel="@TestRelay")
    success_response = _FakeResp(
        status_code=200,
        payload={"ok": True, "result": {"message_id": 999, "chat": {"id": -100123456789}}},
        text="{\"ok\": true, \"result\": {\"message_id\": 999, \"chat\": {\"id\": -100123456789}}}"
    )
    fake = _FakeAsyncClient(success_response)
    
    with patch("app.services.telegram_bot_service.httpx.AsyncClient", lambda *a, **k: fake):
        try:
            result = await bot.forward_media_to_service(from_chat_id=12345, message_id=67890)
            print("Got result: %s" % str(result))
            if result == (-100123456789, 999):
                print("PASS: Correctly returns forwarded chat_id and message_id")
                return True
            else:
                print("FAIL: Wrong result")
                return False
        except Exception as e:
            print("FAIL: Unexpected exception: %s: %s" % (type(e).__name__, e))
            return False

async def test_transient_error_retries():
    """Test that transient errors (e.g., 429, 500) are retried."""
    bot = TelegramBotService(bot_token="test_token", service_channel="@TestRelay")
    
    call_count = {"n": 0}
    
    class _RetryClient:
        def __init__(self):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, json=None, headers=None, content=None, timeout=None):
            call_count["n"] += 1
            if call_count["n"] < 3:
                # First two calls return 429 (transient)
                return _FakeResp(
                    status_code=200,
                    payload={"ok": False, "error_code": 429, "description": "Too Many Requests", "parameters": {"retry_after": 1}},
                    text="{\"ok\": false, \"error_code\": 429, \"description\": \"Too Many Requests\"}"
                )
            else:
                # Third call succeeds
                return _FakeResp(
                    status_code=200,
                    payload={"ok": True, "result": {"message_id": 999, "chat": {"id": -100123456789}}},
                    text="{\"ok\": true, \"result\": {\"message_id\": 999, \"chat\": {\"id\": -100123456789}}}"
                )
    
    with patch("app.services.telegram_bot_service.httpx.AsyncClient", lambda *a, **k: _RetryClient()):
        try:
            result = await bot.forward_media_to_service(from_chat_id=12345, message_id=67890)
            print("Got result after retries: %s" % str(result))
            if result == (-100123456789, 999) and call_count["n"] == 3:
                print("PASS: Retried transient errors and succeeded")
                return True
            else:
                print("FAIL: Wrong result or call count: %s" % call_count["n"])
                return False
        except Exception as e:
            print("FAIL: Unexpected exception: %s: %s" % (type(e).__name__, e))
            return False

async def main():
    r1 = await test_ok_false_error()
    print("---")
    r2 = await test_ok_true_success()
    print("---")
    r3 = await test_transient_error_retries()
    print("---")
    print("Results: ok_false=%s, ok_true=%s, retry=%s" % (r1, r2, r3))
    return all([r1, r2, r3])

result = asyncio.run(main())
print("Overall: %s" % ("PASS" if result else "FAIL"))

