# Docling PDF Image-to-Markdown Service

## Latar Belakang

Pipeline `index-reports.sh` (daily drive ingestion Gamatecha) sebelumnya **melewati semua image-only PDF** dengan warning "OCR tidak tersedia (skip)". File-file ini menghasilkan < 100 karakter dari pypdf karena kontennya berupa gambar/scan, bukan teks digital.

Dari analisis manifest (`drive-index-manifest.json`), ditemukan **405 image-only PDF** yang gagal diekstrak sejak Februari 2026 — termasuk Daily Executive Summary, Laporan Harian Marketing, Incident Report, dan dokumen administrasi lainnya.

## Arsitektur: 3-Tier Extraction Pipeline

```
PDF masuk ke index-reports.sh
├─ Tier 0: pypdf text extraction (existing, tidak diubah)
│   └─ >= 100 chars? → selesai, gunakan teks
├─ Tier 1: Docling service (baru, self-hosted GPU)
│   └─ >= 100 chars markdown? → selesai, gunakan markdown
└─ Tier 2: Qwen Vision API fallback (baru)
    └─ >= 100 chars? → selesai, gunakan output vision
    └─ Semua gagal → log failure (perilaku sebelumnya)
```

## Komponen yang Dibangun

### 1. Docling Docker Service (`docling/`)

FastAPI service yang mengkonversi PDF (termasuk image-only/scan) menjadi structured markdown menggunakan [Docling](https://github.com/DS4SD/docling) dengan OCR via EasyOCR.

**Fitur:**

- Layout-aware extraction (DocLayNet model)
- Table structure recognition (TableFormer ACCURATE mode)
- OCR multi-bahasa (English + Indonesian via EasyOCR)
- GPU-accelerated inference

**Endpoints:**

- `GET /health` — health check
- `POST /v1/convert` — konversi PDF ke markdown (multipart upload)
  - Form fields: `file` (required), `ocr_lang` (default `eng+ind`)
  - Response: `{"markdown": "...", "pages": N, "tables": N, "method": "docling"}`

**Stack:**

- Base image: `nvidia/cuda:12.6.3-runtime-ubuntu24.04`
- Python: docling >= 2.15, torch >= 2.6, easyocr, FastAPI, uvicorn
- Port: 8202 (mengikuti urutan whisper: 8200, 8201, 8202)
- Model di-download saat build time (DocLayNet, TableFormer, EasyOCR en+id)

#### File Structure

```
docling/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── docs/
│   └── implementation.md    # dokumen ini
└── app/
    ├── __init__.py
    ├── main.py              # FastAPI app + lifespan (pre-load converter)
    └── routers/
        ├── __init__.py
        ├── health.py        # GET /health
        └── convert.py       # POST /v1/convert
```

### 2. Qwen Vision Helper Script

**File:** `~/.openclaw/skills/gamatecha-workspace/scripts/extract-pdf-vision.sh`

Fallback untuk konten yang Docling tidak bisa handle (chart kompleks, handwriting, diagram). Mengkonversi halaman PDF ke gambar (JPEG), encode base64, lalu kirim ke DashScope `qwen-vl-max` multimodal API.

- Limit: 5 halaman pertama, 150 DPI
- API: DashScope (Aliyun) — endpoint dan key sama dengan `summarize-batch-docs.sh`
- Output: structured markdown ke stdout

### 3. Modifikasi `index-reports.sh`

**File:** `~/.openclaw/skills/gamatecha-workspace/scripts/index-reports.sh`

Perubahan:

- **PDF case block** (sekitar line 419): mengganti logic "skip" dengan 3-tier fallback (Docling → Qwen Vision)
- **Counter baru**: `TOTAL_DOCLING` dan `TOTAL_VISION` untuk tracking berapa file berhasil di-rescue
- **Summary output**: menampilkan statistik OCR di akhir run

## Masalah Build yang Diselesaikan

### 1. Torch/Transformers ABI Conflict

NGC PyTorch base image (`nvcr.io/nvidia/pytorch:24.12-py3`) bundling torch 2.5.x yang tidak kompatibel dengan `transformers` versi terbaru yang dibutuhkan Docling.

**Solusi:** Ganti base image ke `nvidia/cuda:12.6.3-runtime-ubuntu24.04` (clean environment) dan biarkan pip install torch >= 2.6 dari scratch.

### 2. numpy.core.multiarray Failed

NGC image memiliki numpy, opencv, dan torch yang saling terikat versi. Upgrade salah satu menyebabkan ABI mismatch.

**Solusi:** Clean CUDA runtime base — tidak ada pre-installed Python packages yang konflik.

### 3. EasyOCR Requires libxcb/libgl

EasyOCR memaksa install `opencv-python` (bukan headless) yang butuh X11/GL system libraries.

**Solusi:** Tambahkan `libxcb1 libgl1 libglib2.0-0` ke apt-get install.

## Hasil Testing

### Test 1: Daily Executive Summary (16 Mar 2026)

- File: `Daily_Executive_Summary_16_Mar_2026.pdf` (3 halaman, 4 MB, image-only)
- Sebelumnya: **SKIP** (0 chars dari pypdf)
- Setelah Docling: **9,684 chars**, 7 tabel terdeteksi
- Konten: ringkasan eksekutif, catatan marketing, tindak lanjut proyek — semua terekstrak dengan heading, tabel, dan formatting

### Test 2: Incident Handler Report (11 Mar 2026)

- File: `10022026 - Incident Handler Report Gamatecha.pdf` (4 halaman, 177 KB, image-only)
- Sebelumnya: **SKIP** (0 chars dari pypdf)
- Setelah Docling: **6,120 chars**, 0 tabel
- Konten: severity assessment, root cause analysis, timeline kejadian — semua terekstrak dengan struktur heading yang benar

## Cara Penggunaan

### Start Service

```bash
cd docling && docker compose up -d
```

### Health Check

```bash
curl http://localhost:8202/health
# {"status": "ok"}
```

### Konversi PDF

```bash
curl -X POST http://localhost:8202/v1/convert \
  -F "file=@dokumen-scan.pdf" \
  -F "ocr_lang=eng+ind" | jq .markdown
```

### Reprocess Failed PDFs

Jalankan `index-reports.sh` dengan `--reindex` pada folder yang mengandung image-only PDF:

```bash
index-reports.sh --folder-id <ID> --reindex
```

Pipeline akan otomatis mencoba Docling, lalu fallback ke Qwen Vision jika Docling gagal.

## Catatan GPU

- Docling sharing GPU (NVIDIA GB10) dengan gateway, QMD, dan whisper services
- Usage bersifat burst-only (hanya saat konversi PDF)
- Daily pipeline berjalan di jam sepi traffic, tidak perlu memory cap
- Proses VLLM existing (whisper ASR + qwen3) tetap berjalan normal selama testing
