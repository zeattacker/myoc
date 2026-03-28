import logging

from ..config import MERGE_GAP_THRESHOLD
from ..models import DiarizedSegment, SpeakerSegment, WordTimestamp

logger = logging.getLogger(__name__)


def fuse(
    words: list[WordTimestamp],
    speakers: list[SpeakerSegment],
    mode: str = "exclusive",
) -> list[DiarizedSegment]:
    """Merge word timestamps with speaker segments into diarized output.

    Exclusive mode: each word is assigned to the speaker with the most
    temporal overlap. Ties broken by earliest segment start.
    """
    if not words:
        return []

    attributed: list[tuple[str, WordTimestamp]] = []

    for word in words:
        best_speaker = _assign_speaker(word, speakers, mode)
        attributed.append((best_speaker, word))

    # Group consecutive same-speaker words into segments
    segments = _group_segments(attributed)

    # Merge nearby segments from the same speaker
    merged = _merge_close_segments(segments)

    return merged


def _assign_speaker(
    word: WordTimestamp,
    speakers: list[SpeakerSegment],
    mode: str,
) -> str:
    """Find the best speaker for a given word based on overlap."""
    best_speaker = "UNKNOWN"
    best_overlap = 0.0
    best_start = float("inf")

    for seg in speakers:
        overlap_start = max(word.start, seg.start)
        overlap_end = min(word.end, seg.end)
        overlap = max(0.0, overlap_end - overlap_start)

        if overlap > best_overlap or (
            overlap == best_overlap and overlap > 0 and seg.start < best_start
        ):
            best_overlap = overlap
            best_speaker = seg.speaker
            best_start = seg.start

    # If no overlap found, assign to nearest speaker segment
    if best_overlap == 0.0 and speakers:
        word_mid = (word.start + word.end) / 2
        nearest = min(speakers, key=lambda s: min(
            abs(s.start - word_mid), abs(s.end - word_mid)
        ))
        best_speaker = nearest.speaker

    return best_speaker


def _group_segments(
    attributed: list[tuple[str, WordTimestamp]],
) -> list[DiarizedSegment]:
    """Group consecutive words from the same speaker into segments."""
    if not attributed:
        return []

    segments: list[DiarizedSegment] = []
    current_speaker, current_word = attributed[0]
    current_words = [current_word]

    for speaker, word in attributed[1:]:
        if speaker == current_speaker:
            current_words.append(word)
        else:
            segments.append(_make_segment(current_speaker, current_words))
            current_speaker = speaker
            current_words = [word]

    segments.append(_make_segment(current_speaker, current_words))
    return segments


def _make_segment(
    speaker: str, words: list[WordTimestamp]
) -> DiarizedSegment:
    text = " ".join(w.word for w in words)
    return DiarizedSegment(
        speaker=speaker,
        start=words[0].start,
        end=words[-1].end,
        text=text,
        words=words,
    )


def _merge_close_segments(
    segments: list[DiarizedSegment],
) -> list[DiarizedSegment]:
    """Merge segments from the same speaker if gap is below threshold."""
    if not segments:
        return []

    merged: list[DiarizedSegment] = [segments[0]]

    for seg in segments[1:]:
        prev = merged[-1]
        gap = seg.start - prev.end

        if seg.speaker == prev.speaker and gap < MERGE_GAP_THRESHOLD:
            # Merge: combine words and extend time range
            merged[-1] = DiarizedSegment(
                speaker=prev.speaker,
                start=prev.start,
                end=seg.end,
                text=prev.text + " " + seg.text,
                words=prev.words + seg.words,
            )
        else:
            merged.append(seg)

    return merged
