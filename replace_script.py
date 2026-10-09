with open(r"D:\02_Projects\StreamX\backend\app\services\telegram_bot_service.py", "r", encoding="utf-8") as f:
    content = f.read()

old_block = """            try:
                data = res.json()
            except Exception:
                data = {}

            # Telegram Bot API uses "ok" field for actual API success/failure
            if data.get("ok"):
                result = data.get("result", {})
                dest_chat = result.get("chat", {}).get("id")
                dest_msg = result.get("message_id")
                if not dest_chat or not dest_msg:
                    log_event(
                        "FORWARD_MISSING_IDS",
                        from_chat_id=from_chat_id,
                        message_id=message_id,
                        target=str(target),
                        response=data,
                    )
                    raise StreamXError(
                        ErrorCategory.TELEGRAM_FORWARD_FAILED,
                        "forwardMessage returned no chat/message id",
                    )
                return int(dest_chat), int(dest_msg)

            # Handle Telegram API error (ok: false) - use error_code from response
            error_code = data.get("error_code", res.status_code)
            error_description = data.get("description", res.text)

            # Telegram Bot API error codes that are transient
            transient_codes = {429, 500, 502, 503, 504}
            # Permanent configuration errors
            permanent_codes = {400, 401, 403}

            is_transient = error_code in transient_codes
            is_permanent = error_code in permanent_codes

            # Also check for FLOOD_WAIT in error description
            if "FLOOD_WAIT" in error_description or "flood" in error_description.lower():
                is_transient = True

            log_event(
                "FORWARD_FAILED_ATTEMPT",
                attempt=attempt + 1,
                max_attempts=MAX_FORWARD_RETRIES + 1,
                from_chat_id=from_chat_id,
                message_id=message_id,
                target=str(target),
                error_code=error_code,
                error=error_description,
                is_transient=is_transient,
            )

            if is_permanent or attempt >= MAX_FORWARD_RETRIES:
                # Permanent error or retries exhausted
                raise StreamXError(
                    ErrorCategory.TELEGRAM_FORWARD_FAILED,
                    f"forwardMessage failed: error_code={error_code} - {error_description}",
                )

            # Transient error - retry with backoff
            delay = INITIAL_FORWARD_RETRY_DELAY * (2 ** attempt)
            # If Telegram tells us to wait (FLOOD_WAIT), try to extract the wait time
            if error_code == 429:
                try:
                    params = data.get("parameters", {})
                    retry_after = params.get("retry_after", delay)
                    delay = min(retry_after, 60)  # Cap at 60 seconds
                except Exception:
                    pass

            logger.warning(
                f"Forward transient error (attempt {attempt + 1}), retrying in {delay}s: {error_description}"
            )
            await asyncio.sleep(delay)"""

new_block = """            data = {}
            try:
                data = res.json()
            except Exception:
                pass

            # Telegram Bot API returns HTTP 200 even for API errors.
            # The actual success/failure is indicated by the "ok" field in the JSON body.
            # Success: {"ok": true, "result": {...}}
            # Failure: {"ok": false, "error_code": 403, "description": "Forbidden: ..."}
            api_ok = data.get("ok")
            error_code = data.get("error_code")
            error_description = data.get("description", "")

            if res.status_code == 200 and api_ok is True:
                # Successful forward - extract destination chat/message IDs from result
                result = data.get("result", {})
                dest_chat = result.get("chat", {}).get("id")
                dest_msg = result.get("message_id")
                if not dest_chat or not dest_msg:
                    log_event(
                        "FORWARD_MISSING_IDS",
                        from_chat_id=from_chat_id,
                        message_id=message_id,
                        target=str(target),
                        response=data,
                    )
                    raise StreamXError(
                        ErrorCategory.TELEGRAM_FORWARD_FAILED,
                        "forwardMessage returned no chat/message id in result",
                    )
                return int(dest_chat), int(dest_msg)

            # Handle API error (ok: false) or HTTP error status
            # Use Telegram's error_code for classification when available, else fall back to HTTP status
            classification_code = error_code if error_code is not None else res.status_code
            error_text = error_description or res.text

            # Telegram Bot API error codes that are transient
            transient_codes = {429, 500, 502, 503, 504}
            # Permanent configuration errors
            permanent_codes = {400, 401, 403}

            is_transient = classification_code in transient_codes
            is_permanent = classification_code in permanent_codes

            # Also check for FLOOD_WAIT in error description
            if "FLOOD_WAIT" in error_text or "flood" in error_text.lower():
                is_transient = True

            log_event(
                "FORWARD_FAILED_ATTEMPT",
                attempt=attempt + 1,
                max_attempts=MAX_FORWARD_RETRIES + 1,
                from_chat_id=from_chat_id,
                message_id=message_id,
                target=str(target),
                http_status=res.status_code,
                telegram_error_code=error_code,
                error=error_text,
                is_transient=is_transient,
            )

            if is_permanent or attempt >= MAX_FORWARD_RETRIES:
                # Permanent error or retries exhausted
                raise StreamXError(
                    ErrorCategory.TELEGRAM_FORWARD_FAILED,
                    f"forwardMessage failed: Telegram error {classification_code} - {error_text}",
                )

            # Transient error - retry with backoff
            delay = INITIAL_FORWARD_RETRY_DELAY * (2 ** attempt)
            # If Telegram tells us to wait (FLOOD_WAIT), try to extract the wait time
            if classification_code == 429:
                try:
                    params = data.get("parameters", {})
                    retry_after = params.get("retry_after", delay)
                    delay = min(retry_after, 60)  # Cap at 60 seconds
                except Exception:
                    pass

            logger.warning(
                f"Forward transient error (attempt {attempt + 1}), retrying in {delay}s: {error_text}"
            )
            await asyncio.sleep(delay)"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(r"D:\02_Projects\StreamX\backend\app\services\telegram_bot_service.py", "w", encoding="utf-8") as f:
        f.write(content)
    print("Replacement successful!")
else:
    print("Old block not found exactly")
    idx = content.find("Telegram Bot API uses \"ok\" field")
    if idx >= 0:
        print("Found similar at:", idx)
        print(content[idx:idx+200])
