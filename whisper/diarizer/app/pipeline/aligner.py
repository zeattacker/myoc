import logging
import re

import librosa
import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer

from ..config import ALIGNER_MODEL
from ..models import WordTimestamp

logger = logging.getLogger(__name__)

_model = None
_tokenizer = None


def _get_model():
    global _model, _tokenizer
    if _model is None:
        logger.info("Loading ForcedAligner model: %s", ALIGNER_MODEL)
        _tokenizer = AutoTokenizer.from_pretrained(
            ALIGNER_MODEL, trust_remote_code=True
        )
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _model = AutoModelForTokenClassification.from_pretrained(
            ALIGNER_MODEL, torch_dtype=torch.bfloat16, trust_remote_code=True
        ).to(device)
        _model.eval()
        logger.info("ForcedAligner model loaded on %s", device.upper())
    return _model, _tokenizer


def align(audio_path: str, transcript: str) -> list[WordTimestamp]:
    """Align transcript words to audio timestamps using Qwen3-ForcedAligner.

    Returns word-level timestamps.
    """
    model, tokenizer = _get_model()

    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    duration = len(audio) / sr

    words = transcript.split()
    if not words:
        return []

    # Build the forced-alignment prompt
    # The model expects: <audio> transcript tokens
    # and predicts start/end frames for each token
    prompt = transcript

    inputs = tokenizer(
        prompt,
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=4096,
    )
    input_ids = inputs["input_ids"].to(model.device)
    attention_mask = inputs["attention_mask"].to(model.device)

    # Convert audio to model input features
    audio_tensor = torch.tensor(audio, dtype=torch.float32).unsqueeze(0).to(model.device)

    with torch.no_grad():
        try:
            outputs = model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                audio_values=audio_tensor,
            )
            logits = outputs.logits
        except Exception:
            # If the model doesn't support audio_values kwarg directly,
            # fall back to uniform distribution
            logger.warning(
                "ForcedAligner forward pass failed, falling back to uniform timestamps"
            )
            return _uniform_timestamps(words, duration)

    # Decode logits into word timestamps
    # The model outputs 2 values per token: start_frame, end_frame
    try:
        timestamps = _decode_alignment(logits, words, duration, tokenizer, input_ids)
        return timestamps
    except Exception:
        logger.warning(
            "Alignment decoding failed, falling back to uniform timestamps"
        )
        return _uniform_timestamps(words, duration)


def _decode_alignment(
    logits: torch.Tensor,
    words: list[str],
    duration: float,
    tokenizer,
    input_ids: torch.Tensor,
) -> list[WordTimestamp]:
    """Decode model logits into per-word timestamps."""
    # logits shape: (batch, seq_len, num_labels)
    # num_labels=2: [start_proportion, end_proportion] of audio duration
    preds = logits[0].cpu().float()
    tokens = tokenizer.convert_ids_to_tokens(input_ids[0].cpu().tolist())

    # Map tokens back to words and extract timestamps
    results: list[WordTimestamp] = []
    word_idx = 0
    current_word_tokens: list[int] = []

    for i, token in enumerate(tokens):
        if token in tokenizer.all_special_tokens:
            continue
        current_word_tokens.append(i)

        # Check if this token ends the current word
        # (next token starts a new word or is special)
        is_last = i == len(tokens) - 1
        next_is_word_start = (
            not is_last
            and i + 1 < len(tokens)
            and not tokens[i + 1].startswith("##")
            and tokens[i + 1] not in tokenizer.all_special_tokens
        )

        if is_last or next_is_word_start or not tokens[i + 1].startswith("##"):
            if word_idx < len(words) and current_word_tokens:
                # Average the predictions across subword tokens
                starts = [
                    torch.sigmoid(preds[t, 0]).item() for t in current_word_tokens
                ]
                ends = [
                    torch.sigmoid(preds[t, 1]).item() for t in current_word_tokens
                ]
                start_t = min(starts) * duration
                end_t = max(ends) * duration
                # Ensure valid range
                end_t = max(end_t, start_t + 0.01)
                results.append(
                    WordTimestamp(
                        word=words[word_idx],
                        start=round(start_t, 3),
                        end=round(end_t, 3),
                    )
                )
                word_idx += 1
            current_word_tokens = []

    # If we didn't get all words, fill remaining with uniform
    while word_idx < len(words):
        last_end = results[-1].end if results else 0.0
        remaining = duration - last_end
        remaining_words = len(words) - word_idx
        step = remaining / remaining_words if remaining_words > 0 else 0.1
        results.append(
            WordTimestamp(
                word=words[word_idx],
                start=round(last_end, 3),
                end=round(last_end + step, 3),
            )
        )
        last_end += step
        word_idx += 1

    return results


def _uniform_timestamps(words: list[str], duration: float) -> list[WordTimestamp]:
    """Distribute words uniformly across the audio duration."""
    if not words:
        return []
    step = duration / len(words)
    return [
        WordTimestamp(
            word=w,
            start=round(i * step, 3),
            end=round((i + 1) * step, 3),
        )
        for i, w in enumerate(words)
    ]
