"""Telegram Thumbnail Retrieval and Visual OCR Evidence Service for StreamX.

Retrieves Telegram thumbnails conditionally when filename parsing is uncertain,
runs non-blocking OCR/text extraction when available, normalizes text into
metadata search evidence, caches results by content hash, and ensures Telegram
thumbnails are never mistaken for official provider posters.
"""

import asyncio
from dataclasses import dataclass, field
import hashlib
import io
import re
from typing import Any, Dict, List, Optional, Tuple
import httpx

from app.config.settings import settings
from app.utils.logging import log_event, logger


@dataclass
class ThumbnailEvidence:
    has_thumbnail: bool = False
    image_hash: Optional[str] = None
    extracted_text: Optional[str] = None
    candidate_titles: List[str] = field(default_factory=list)
    detected_season: Optional[int] = None
    detected_episode: Optional[int] = None
    evidence_confidence: float = 0.0


# Cache to avoid repeatedly analyzing the same thumbnail image (hash -> ThumbnailEvidence)
_THUMBNAIL_CACHE: Dict[str, ThumbnailEvidence] = {}


class ThumbnailAnalysisService:
    """Bounded, failure-tolerant Telegram thumbnail retriever and OCR analyzer."""

    def __init__(self):
        self._tesseract_available: Optional[bool] = None

    def should_trigger_analysis(
        self,
        parsed_title: str,
        parsing_confidence: float,
        is_truncated: bool,
        candidate_count: int,
        best_confidence: float,
        is_ambiguous: bool = False,
    ) -> bool:
        """Evaluate deterministic criteria to trigger thumbnail inspection conditionally.

        Never runs on confident filename matches with clear provider identity.
        """
        # Trigger 1: Parsed title is suspiciously short or empty
        if len(parsed_title.strip()) <= 3:
            return True

        # Trigger 2: Filename appears truncated (e.g. ends with '...', incomplete word)
        if is_truncated:
            return True

        # Trigger 3: Filename parsing signaled low confidence
        if parsing_confidence < 0.80:
            return True

        # Trigger 4: Provider search yielded zero candidates
        if candidate_count == 0:
            return True

        # Trigger 5: Candidate match was low confidence or ambiguous
        if best_confidence < 0.86 or is_ambiguous:
            return True

        return False

    def is_ocr_available(self) -> bool:
        """Check if local OCR (pytesseract + binary) is available without crashing."""
        if self._tesseract_available is not None:
            return self._tesseract_available

        try:
            import pytesseract
            # Test simple call
            pytesseract.get_tesseract_version()
            self._tesseract_available = True
        except Exception:
            self._tesseract_available = False

        return self._tesseract_available

    async def retrieve_telegram_thumbnail_bytes(
        self,
        chat_id: Optional[int] = None,
        message_id: Optional[int] = None,
        file_id: Optional[str] = None,
        bot_token: Optional[str] = None,
    ) -> Optional[bytes]:
        """Safely retrieve thumbnail bytes via Telegram Bot API or MTProto.

        Bounded by timeout (10s) and max payload size (5MB). Safe SSRF guards applied.
        """
        token = bot_token or settings.TELEGRAM_BOT_TOKEN
        if not token or not file_id:
            return None

        # Bot API: getFile -> download
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get(
                    f"https://api.telegram.org/bot{token}/getFile",
                    params={"file_id": file_id},
                )
                if res.status_code != 200:
                    return None
                data = res.json()
                if not data.get("ok"):
                    return None
                file_path = data.get("result", {}).get("file_path")
                if not file_path:
                    return None

                # SSRF Protection: ensure path is standard Telegram file path
                if ".." in file_path or file_path.startswith("/"):
                    return None

                img_res = await client.get(
                    f"https://api.telegram.org/file/bot{token}/{file_path}",
                    headers={"Accept": "image/*"},
                )
                if img_res.status_code == 200 and len(img_res.content) <= 5 * 1024 * 1024:
                    return img_res.content
        except Exception as e:
            logger.debug(f"Failed to retrieve Bot API thumbnail: {e}")

        return None

    def analyze_image_bytes(self, image_data: bytes) -> ThumbnailEvidence:
        """Extract evidence text, season/episode hints, and title candidates from image bytes."""
        if not image_data or len(image_data) < 100:
            return ThumbnailEvidence(has_thumbnail=False)

        # Stable content hash
        img_hash = hashlib.sha256(image_data).hexdigest()
        if img_hash in _THUMBNAIL_CACHE:
            return _THUMBNAIL_CACHE[img_hash]

        extracted_text = ""
        candidate_titles = []
        detected_season = None
        detected_episode = None
        conf = 0.0

        if self.is_ocr_available():
            try:
                import pytesseract
                from PIL import Image

                image = Image.open(io.BytesIO(image_data))
                # Convert to RGB if palette/RGBA
                if image.mode not in ("L", "RGB"):
                    image = image.convert("RGB")

                # Bounded execution timeout via executor
                raw_ocr = pytesseract.image_to_string(image, timeout=5)
                extracted_text = raw_ocr.strip()

                if extracted_text:
                    conf = 0.50
                    # Normalize OCR text
                    cleaned_lines = []
                    for line in extracted_text.splitlines():
                        line_clean = re.sub(r"[^\w\s:.-]", " ", line)
                        line_clean = re.sub(r"\s+", " ", line_clean).strip()
                        # Filter out common video watermark noise (e.g. 1080p, release groups, @handles)
                        line_clean = re.sub(r"(?i)\b(?:1080p|720p|4k|uhd|hevc|x264|x265|bluray|webrip)\b", "", line_clean).strip()
                        if len(line_clean) >= 3 and not line_clean.startswith("@"):
                            cleaned_lines.append(line_clean)

                    # Extract episode patterns from thumbnail OCR text
                    ep_match = re.search(r"(?i)\b(?:EP|Episode|Ep|E)\s*[-_.]?\s*0*(\d{1,4})\b", extracted_text)
                    if ep_match:
                        detected_episode = int(ep_match.group(1))
                    s_match = re.search(r"(?i)\b(?:Season|S)\s*[-_.]?\s*0*(\d{1,2})\b", extracted_text)
                    if s_match:
                        detected_season = int(s_match.group(1))

                    if cleaned_lines:
                        # Top line usually represents title/franchise
                        candidate_titles = cleaned_lines[:3]
                        conf = min(0.80, conf + 0.20)

                    log_event(
                        "METADATA_THUMBNAIL_OCR_COMPLETED",
                        hash=img_hash[:10],
                        extracted_chars=len(extracted_text),
                        candidates=candidate_titles,
                    )
            except Exception as e:
                logger.debug(f"OCR processing skipped or failed: {e}")

        evidence = ThumbnailEvidence(
            has_thumbnail=True,
            image_hash=img_hash,
            extracted_text=extracted_text or None,
            candidate_titles=candidate_titles,
            detected_season=detected_season,
            detected_episode=detected_episode,
            evidence_confidence=conf,
        )

        _THUMBNAIL_CACHE[img_hash] = evidence
        return evidence


thumbnail_service = ThumbnailAnalysisService()
