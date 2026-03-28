import logging
import os

from pyannote.audio import Pipeline as PyannotePipeline

from ..config import DIARIZATION_MODEL
from ..models import SpeakerSegment

logger = logging.getLogger(__name__)

_pipeline = None


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        hf_token = os.environ.get("HUGGING_FACE_HUB_TOKEN")
        if not hf_token:
            raise RuntimeError(
                "HUGGING_FACE_HUB_TOKEN is required for pyannote speaker diarization. "
                "Set it in your environment and ensure you have accepted the model license "
                "at https://huggingface.co/pyannote/speaker-diarization-3.1"
            )
        logger.info("Loading pyannote diarization pipeline: %s", DIARIZATION_MODEL)
        _pipeline = PyannotePipeline.from_pretrained(
            DIARIZATION_MODEL, use_auth_token=hf_token
        )
        import torch

        if torch.cuda.is_available():
            _pipeline.to(torch.device("cuda"))
            logger.info("Pyannote pipeline loaded on GPU")
        else:
            logger.info("Pyannote pipeline loaded on CPU")
    return _pipeline


def is_loaded() -> bool:
    return _pipeline is not None


def diarize(
    audio_path: str, num_speakers: int | None = None
) -> list[SpeakerSegment]:
    """Run speaker diarization on an audio file.

    Returns a list of speaker segments with start/end times.
    """
    pipeline = _get_pipeline()

    params = {}
    if num_speakers is not None:
        params["num_speakers"] = num_speakers

    logger.info("Running diarization on %s", audio_path)
    diarization = pipeline(audio_path, **params)

    segments: list[SpeakerSegment] = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append(
            SpeakerSegment(
                speaker=speaker,
                start=round(turn.start, 3),
                end=round(turn.end, 3),
            )
        )

    logger.info("Diarization found %d segments, %d speakers",
                len(segments), len(set(s.speaker for s in segments)))
    return segments
