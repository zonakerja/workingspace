# syntax=docker/dockerfile:1
# ============================================================================
# Akasha Markdown Converter — MarkItDown (dokumen teks) + Docling (gambar & PDF scan/bergambar, OCR Tesseract).
# Mengubah berkas menjadi Markdown di server sendiri sehingga fitur AI tidak membayar token untuk membaca berkas
# (docs/ARCHITECTURE.md §3.14). Image amd64 & arm64; torch versi CPU. Model Docling diunduh saat build, saat jalan
# tidak ada akses internet yang dibutuhkan (HF_HUB_OFFLINE).
# ============================================================================

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  PIP_NO_CACHE_DIR=1 \
  DOCLING_ARTIFACTS_PATH=/opt/docling-models \
  OMP_NUM_THREADS=2

# Tesseract (OCR Docling) + bahasa Indonesia; libGL/glib untuk OpenCV yang ditarik Docling
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ind tesseract-ocr-eng libgl1 libglib2.0-0 curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install uv==0.9.5

# torch CPU dipasang dulu dari indeks resmi PyTorch (versi CUDA di PyPI amd64 ± 3 GB lebih besar)
RUN uv pip install --system torch==2.14.1 torchvision --index-url https://download.pytorch.org/whl/cpu

# Paket lain: versi transitif dikunci tanggal (kebijakan rilis ≥ 2 minggu, CLAUDE.md §14)
COPY requirements.txt /tmp/requirements.txt
RUN uv pip install --system --exclude-newer 2026-10-30 -r /tmp/requirements.txt

# Model tata letak & tabel Docling disimpan di image
RUN docling-tools models download -o /opt/docling-models && chmod -R a+rX /opt/docling-models

WORKDIR /srv
COPY app ./app
COPY tests ./tests
RUN useradd --uid 10001 --create-home converter
USER converter
ENV HF_HUB_OFFLINE=1 \
  HOME=/home/converter
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fs http://127.0.0.1:4200/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4200", "--workers", "1", "--timeout-keep-alive", "30"]
