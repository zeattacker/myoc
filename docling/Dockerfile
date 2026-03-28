FROM nvidia/cuda:12.6.3-runtime-ubuntu24.04

ENV NVIDIA_DISABLE_REQUIRE=1
ENV DEBIAN_FRONTEND=noninteractive

# System deps: Python, poppler (for pdf2image if needed), curl (healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv curl \
    libxcb1 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps in a clean environment (no NGC conflicts)
COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

# Pre-download Docling models (DocLayNet + TableFormer) at build time
RUN python3 -c "from docling.document_converter import DocumentConverter; DocumentConverter()"

# Pre-download EasyOCR models for English + Indonesian
RUN python3 -c "import easyocr; easyocr.Reader(['en', 'id'], gpu=False)"

COPY app/ app/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
