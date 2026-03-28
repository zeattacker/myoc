from pydantic import BaseModel


class WordTimestamp(BaseModel):
    word: str
    start: float
    end: float


class SpeakerSegment(BaseModel):
    speaker: str
    start: float
    end: float


class DiarizedSegment(BaseModel):
    speaker: str
    start: float
    end: float
    text: str
    words: list[WordTimestamp]


class DiarizeResponse(BaseModel):
    segments: list[DiarizedSegment]
    speakers: list[str]
    duration: float
    language: str | None = None
    metadata: dict[str, float]


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool
