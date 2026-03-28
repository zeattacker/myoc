---
name: diarize
description: Transcribe audio with speaker diarization — identifies who said what and when
requires: curl, jq
---

# Speaker Diarization

Transcribe an audio file with speaker identification. Produces a timestamped, speaker-attributed transcript.

## Usage

```bash
{baseDir}/scripts/diarize.sh /path/to/audio.m4a
```

## Options

- `--speakers N` — hint the expected number of speakers
- `--language xx` — language code (e.g. `id`, `en`, `zh`)
- `--out path` — custom output path (default: `<input>.diarized.json`)
- `--text` — output plain text format (`SPEAKER: text`) instead of JSON

## Examples

```bash
# Basic diarization
{baseDir}/scripts/diarize.sh meeting.wav

# With speaker count hint
{baseDir}/scripts/diarize.sh --speakers 3 meeting.wav

# Plain text output
{baseDir}/scripts/diarize.sh --text interview.m4a

# Custom output path
{baseDir}/scripts/diarize.sh --out transcript.json call.wav
```

## Output

JSON format includes per-segment speaker labels, timestamps, text, and word-level timing. Plain text mode outputs `SPEAKER_00: text` lines.
