import os


QWEN3_ASR_URL = os.environ.get("QWEN3_ASR_URL", "http://qwen3-asr:8000")

ALIGNER_MODEL = os.environ.get(
    "ALIGNER_MODEL", "Qwen/Qwen3-ForcedAligner-0.6B"
)

DIARIZATION_MODEL = os.environ.get(
    "DIARIZATION_MODEL", "pyannote/speaker-diarization-3.1"
)

VAD_THRESHOLD = float(os.environ.get("VAD_THRESHOLD", "0.5"))

# Merge segments from the same speaker if gap is below this (seconds)
MERGE_GAP_THRESHOLD = float(os.environ.get("MERGE_GAP_THRESHOLD", "1.5"))
