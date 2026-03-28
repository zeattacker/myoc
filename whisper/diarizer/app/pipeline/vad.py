import logging

import silero_vad
import torch
import torchaudio

from ..config import VAD_THRESHOLD

logger = logging.getLogger(__name__)

_model = None


def _get_model():
    global _model
    if _model is None:
        logger.info("Loading Silero VAD v5 model (CPU)")
        _model = silero_vad.load_silero_vad()
        logger.info("Silero VAD loaded")
    return _model


def detect_speech(
    audio_path: str, threshold: float = VAD_THRESHOLD
) -> list[tuple[float, float]]:
    """Detect speech segments in an audio file.

    Returns a list of (start_sec, end_sec) tuples for voiced regions.
    """
    model = _get_model()

    wav, sr = torchaudio.load(audio_path)
    # Silero VAD expects 16kHz mono
    if sr != 16000:
        wav = torchaudio.functional.resample(wav, sr, 16000)
        sr = 16000
    if wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)
    wav = wav.squeeze(0)

    speech_timestamps = silero_vad.get_speech_timestamps(
        wav, model, threshold=threshold, return_seconds=True
    )

    return [(s["start"], s["end"]) for s in speech_timestamps]


def has_speech(audio_path: str, threshold: float = VAD_THRESHOLD) -> bool:
    """Quick check: does the audio contain any speech?"""
    segments = detect_speech(audio_path, threshold)
    return len(segments) > 0
