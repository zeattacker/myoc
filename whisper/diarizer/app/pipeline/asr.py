import logging

import httpx

from ..config import QWEN3_ASR_URL

logger = logging.getLogger(__name__)


async def transcribe(
    audio_path: str, language: str | None = None, timeout: float = 120.0
) -> str:
    """Send audio to the Qwen3-ASR vLLM service for transcription."""
    url = f"{QWEN3_ASR_URL}/v1/audio/transcriptions"

    async with httpx.AsyncClient(timeout=timeout) as client:
        with open(audio_path, "rb") as f:
            files = {"file": (audio_path.split("/")[-1], f, "audio/wav")}
            data = {"model": "Qwen/Qwen3-ASR-1.7B"}
            if language:
                data["language"] = language

            logger.info("Sending audio to Qwen3-ASR at %s", url)
            response = await client.post(url, files=files, data=data)
            response.raise_for_status()

    result = response.json()
    text = result.get("text", "")
    logger.info("ASR returned %d characters", len(text))
    return text
