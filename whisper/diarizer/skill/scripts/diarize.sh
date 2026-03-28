#!/usr/bin/env bash
set -euo pipefail

DIARIZE_URL="${DIARIZE_URL:-http://host.docker.internal:8201}"

usage() {
    echo "Usage: diarize.sh [OPTIONS] <audio-file>"
    echo ""
    echo "Options:"
    echo "  --speakers N    Expected number of speakers"
    echo "  --language xx   Language code (e.g. id, en, zh)"
    echo "  --out PATH      Output file path (default: <input>.diarized.json)"
    echo "  --text          Output plain text (SPEAKER: text) instead of JSON"
    echo "  --url URL       Diarizer service URL (default: $DIARIZE_URL)"
    exit 1
}

NUM_SPEAKERS=""
LANGUAGE=""
OUTPUT=""
TEXT_MODE=false
INPUT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --speakers) NUM_SPEAKERS="$2"; shift 2 ;;
        --language) LANGUAGE="$2"; shift 2 ;;
        --out) OUTPUT="$2"; shift 2 ;;
        --text) TEXT_MODE=true; shift ;;
        --url) DIARIZE_URL="$2"; shift 2 ;;
        --help|-h) usage ;;
        -*) echo "Unknown option: $1"; usage ;;
        *) INPUT="$1"; shift ;;
    esac
done

if [[ -z "$INPUT" ]]; then
    echo "Error: No audio file specified"
    usage
fi

if [[ ! -f "$INPUT" ]]; then
    echo "Error: File not found: $INPUT"
    exit 1
fi

# Build curl command
CURL_ARGS=(-sS -X POST "${DIARIZE_URL}/v1/diarize" -F "file=@${INPUT}")

if [[ -n "$NUM_SPEAKERS" ]]; then
    CURL_ARGS+=(-F "num_speakers=${NUM_SPEAKERS}")
fi

if [[ -n "$LANGUAGE" ]]; then
    CURL_ARGS+=(-F "language=${LANGUAGE}")
fi

RESPONSE=$(curl "${CURL_ARGS[@]}")

# Check for errors
if echo "$RESPONSE" | jq -e '.detail' >/dev/null 2>&1; then
    echo "Error: $(echo "$RESPONSE" | jq -r '.detail')" >&2
    exit 1
fi

if [[ "$TEXT_MODE" == true ]]; then
    echo "$RESPONSE" | jq -r '.segments[] | "\(.speaker): \(.text)"'
else
    if [[ -z "$OUTPUT" ]]; then
        OUTPUT="${INPUT}.diarized.json"
    fi
    echo "$RESPONSE" | jq '.' > "$OUTPUT"
    echo "Output written to: $OUTPUT"

    # Print summary
    SPEAKERS=$(echo "$RESPONSE" | jq -r '.speakers | length')
    SEGMENTS=$(echo "$RESPONSE" | jq -r '.segments | length')
    DURATION=$(echo "$RESPONSE" | jq -r '.duration')
    echo "Speakers: $SPEAKERS | Segments: $SEGMENTS | Duration: ${DURATION}s"
fi
