import logging
from contextlib import asynccontextmanager

import torch

# Pyannote/speechbrain models use legacy pickle format incompatible with
# torch >= 2.6 default weights_only=True. Globally patch torch.load so
# all downstream loaders (lightning_fabric, pyannote, speechbrain) work.
_original_torch_load = torch.load


def _safe_torch_load(*args, **kwargs):
    kwargs.setdefault("weights_only", False)
    return _original_torch_load(*args, **kwargs)


torch.load = _safe_torch_load

from fastapi import FastAPI  # noqa: E402

from .pipeline import vad  # noqa: E402
from .routers import diarize, health  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Preloading Silero VAD model...")
    vad._get_model()
    logger.info("CUDA available: %s", torch.cuda.is_available())
    logger.info("VAD model ready. Heavy models (aligner, pyannote) load on first request.")
    yield
    logger.info("Shutting down diarizer service")


app = FastAPI(
    title="Speaker Diarization Service",
    description="Speaker diarization pipeline: VAD + ASR + Forced Alignment + Speaker Diarization + Fusion",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(diarize.router)
