import pathlib
path = pathlib.Path("D:/02_Projects/StreamX/backend/tests/test_telegram_bot.py")
content = path.read_text()

old = """return _FakeResp(200, {"message_id": 999, "chat": {"id": 8142877259}})
            return _FakeResp(404)"""

new = """return _FakeResp(200, {"ok": True, "result": {"message_id": 999, "chat": {"id": 8142877259}}})
            return _FakeResp(404)"""

content = content.replace(old, new)
path.write_text(content)
print("Done")
