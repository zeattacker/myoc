import asyncio
import logging
import tempfile
import time

import librosa
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..models import DiarizeResponse
from ..pipeline import aligner, asr, fusion, speaker, vad

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/v1/diarize", response_model=DiarizeResponse)
async def diarize(
    file: UploadFile = File(...),
    num_speakers: int | None = Form(None),
    language: str | None = Form(None),
    overlap_mode: str = Form("exclusive"),
):
    """Diarize an audio file: identify who said what and when."""
    # Save uploaded file to temp location
    suffix = _get_suffix(file.filename or "audio.wav")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Get audio duration
        duration = librosa.get_duration(path=tmp_path)
        logger.info("Processing audio: %.1fs, file=%s", duration, file.filename)

        # Step 1: VAD pre-check (CPU, fast)
        t0 = time.monotonic()
        loop = asyncio.get_event_loop()

        has_speech = await loop.run_in_executor(None, vad.has_speech, tmp_path)
        if not has_speech:
            raise HTTPException(
                status_code=422,
                detail="No speech detected in the audio file",
            )

        # Step 2: Run ASR + Aligner and Diarization in parallel
        t_asr_start = time.monotonic()

        async def asr_then_align():
            transcript = await asr.transcribe(tmp_path, language=language)
            t_asr = time.monotonic() - t_asr_start
            t_align_start = time.monotonic()
            words = await loop.run_in_executor(
                None, aligner.align, tmp_path, transcript
            )
            t_align = time.monotonic() - t_align_start
            return transcript, words, t_asr, t_align

        async def run_diarization():
            t_diar_start = time.monotonic()
            segments = await loop.run_in_executor(
                None, speaker.diarize, tmp_path, num_speakers
            )
            t_diar = time.monotonic() - t_diar_start
            return segments, t_diar

        (transcript, words, t_asr, t_align), (speaker_segments, t_diar) = (
            await asyncio.gather(asr_then_align(), run_diarization())
        )

        # Step 3: Fusion
        t_fuse_start = time.monotonic()
        diarized = fusion.fuse(words, speaker_segments, mode=overlap_mode)
        t_fuse = time.monotonic() - t_fuse_start

        # Collect unique speakers
        speakers_list = sorted(set(seg.speaker for seg in diarized))

        total_time = time.monotonic() - t0
        logger.info(
            "Pipeline complete: %.1fs total (asr=%.1f, align=%.1f, diar=%.1f, fuse=%.2f)",
            total_time, t_asr, t_align, t_diar, t_fuse,
        )

        return DiarizeResponse(
            segments=diarized,
            speakers=speakers_list,
            duration=round(duration, 2),
            language=language,
            metadata={
                "asr_time": round(t_asr, 3),
                "align_time": round(t_align, 3),
                "diarize_time": round(t_diar, 3),
                "fusion_time": round(t_fuse, 3),
                "total_time": round(total_time, 3),
            },
        )

    finally:
        import os
        os.unlink(tmp_path)


def _get_suffix(filename: str) -> str:
    if "." in filename:
        return "." + filename.rsplit(".", 1)[1]
    return ".wav"
