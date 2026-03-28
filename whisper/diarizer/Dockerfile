FROM nvcr.io/nvidia/pytorch:24.12-py3

# Bypass NGC GPU compatibility check (GB10/Blackwell not in allowlist yet)
ENV NVIDIA_DISABLE_REQUIRE=1

WORKDIR /app

# Remove torchvision to avoid conflicts (not needed for diarization)
RUN pip uninstall -y torchvision torchprofile 2>/dev/null || true

# Install torchaudio <2.9 (has AudioMetaData) without pulling in its torch dep.
# NGC already has torch 2.6.0a with CUDA; torchaudio 2.5.1 is API-compatible.
RUN pip install --no-cache-dir --no-deps torchaudio==2.5.1

# Install pyannote.audio and all other deps.
# Constrain torch to stay at NGC version so nothing upgrades it.
COPY requirements.txt .
RUN printf "torch==2.6.0a0+df5bbc09d1.nv24.12\ntorchaudio==2.5.1\n" > /tmp/constraints.txt && \
    PIP_CONSTRAINT=/tmp/constraints.txt pip install --no-cache-dir -r requirements.txt && \
    rm /tmp/constraints.txt

# Pre-download Silero VAD model into the image
RUN python3 -c "import silero_vad; silero_vad.load_silero_vad()"

COPY app/ ./app/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
