from fastapi import APIRouter

from ..models import HealthResponse
from ..pipeline import speaker as speaker_mod

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        models_loaded=speaker_mod.is_loaded(),
    )
