"""Service Markdown Converter Akasha (MarkItDown + Docling). Hanya dipanggil backend Akasha (Bearer CONVERTER_TOKEN).

POST /convert  (multipart: file, filename?, mode=auto|markitdown|docling, pdf_mode=auto|markitdown|docling)
GET  /health   (tanpa token; status & versi mesin)
"""

from __future__ import annotations

import hmac
import logging
import os
import threading
import time
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from . import engines
from .logic import BOTH_ENGINES, MODES, PDF_MODES, choose_engine, compact_markdown, estimate_tokens, file_extension, is_supported

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("converter")

TOKEN = os.environ.get("CONVERTER_TOKEN", "")
MAX_BYTES = int(os.environ.get("CONVERTER_MAX_MB", "50")) * 1024 * 1024
DOCLING_MAX_PAGES = int(os.environ.get("DOCLING_MAX_PAGES", "200"))
if len(TOKEN) < 32:
    raise SystemExit("CONVERTER_TOKEN wajib diisi (minimal 32 karakter).")

app = FastAPI(title="Akasha Markdown Converter", docs_url=None, redoc_url=None, openapi_url=None)
_state = {"started": time.time(), "ready": False, "converted": 0}


@app.on_event("startup")
def _startup() -> None:
    def warm() -> None:
        engines.warm_up()
        _state["ready"] = True

    threading.Thread(target=warm, daemon=True).start()


def require_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = f"Bearer {TOKEN}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Token tidak valid.")


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "ready": _state["ready"],
        "engines": engines.engine_versions(),
        "ocrLanguages": engines.OCR_LANGS,
        "maxMb": MAX_BYTES // (1024 * 1024),
        "doclingMaxPages": DOCLING_MAX_PAGES,
        "converted": _state["converted"],
    }


def _convert(data: bytes, filename: str, ext: str, mode: str, pdf_mode: str) -> dict:
    started = time.monotonic()
    profile = None
    if ext == "pdf":
        try:
            profile = engines.pdf_profile(data)
        except Exception as error:
            # PDF rusak / terenkripsi: biarkan mesin konversi yang melapor; profil kosong = MarkItDown dulu
            log.warning("Profil PDF %s gagal: %s", filename, error)
    engine, reason = choose_engine(ext, mode, pdf_mode, profile, DOCLING_MAX_PAGES)
    pages = profile.pages if profile else None
    warnings: list[str] = []
    fallback = None
    try:
        if engine == "docling":
            markdown, docling_pages = engines.docling_convert(data, ext, filename, DOCLING_MAX_PAGES)
            pages = pages or docling_pages
            if profile and profile.pages > DOCLING_MAX_PAGES:
                warnings.append(f"Hanya {DOCLING_MAX_PAGES} halaman pertama yang dibaca Docling.")
        else:
            markdown = engines.markitdown_convert(data, ext, filename)
    except Exception as error:
        # Mesin pilihan gagal → coba mesin lain untuk format yang dikenal keduanya (PDF, DOCX, …)
        other = "markitdown" if engine == "docling" else "docling"
        if ext not in BOTH_ENGINES:
            raise
        log.warning("%s gagal untuk %s (%s), mencoba %s", engine, filename, error, other)
        fallback = engine
        engine = other
        if other == "docling":
            markdown, _ = engines.docling_convert(data, ext, filename, DOCLING_MAX_PAGES)
        else:
            markdown = engines.markitdown_convert(data, ext, filename)
        warnings.append(f"{fallback} gagal membaca berkas ini; dipakai {other}.")

    raw_chars = len(markdown)
    markdown = compact_markdown(markdown, pages)
    # PDF berlapisan teks tetapi isi tidak terbaca (font tanpa peta Unicode) → ulangi dengan OCR Docling
    if not markdown.strip() and ext == "pdf" and engine == "markitdown" and mode == "auto":
        markdown = compact_markdown(engines.docling_convert(data, ext, filename, DOCLING_MAX_PAGES)[0], pages)
        engine, reason = "docling", "MarkItDown tidak menemukan teks"
    _state["converted"] += 1
    return {
        "markdown": markdown,
        "engine": engine,
        "reason": reason,
        "fallbackFrom": fallback,
        "pages": pages,
        "chars": len(markdown),
        "rawChars": raw_chars,
        "tokens": estimate_tokens(markdown),
        "warnings": warnings,
        "durationMs": int((time.monotonic() - started) * 1000),
    }


@app.post("/convert", dependencies=[Depends(require_token)])
async def convert(
    file: Annotated[UploadFile, File()],
    filename: Annotated[str | None, Form()] = None,
    mime_type: Annotated[str | None, Form()] = None,
    mode: Annotated[str, Form()] = "auto",
    pdf_mode: Annotated[str, Form()] = "auto",
) -> dict:
    if mode not in MODES or pdf_mode not in PDF_MODES:
        raise HTTPException(status_code=400, detail="Mode konversi tidak dikenal.")
    name = (filename or file.filename or "berkas").strip()[:255]
    ext = file_extension(name, mime_type or file.content_type or "")
    if not is_supported(ext):
        raise HTTPException(status_code=415, detail=f"Format .{ext or '?'} tidak didukung converter.")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Berkas lebih dari {MAX_BYTES // (1024 * 1024)} MB.")
    if not data:
        raise HTTPException(status_code=400, detail="Berkas kosong.")
    try:
        return await run_in_threadpool(_convert, data, name, ext, mode, pdf_mode)
    except HTTPException:
        raise
    except Exception as error:
        log.exception("Konversi %s gagal", name)
        raise HTTPException(status_code=422, detail=f"Berkas tidak bisa dikonversi: {error}") from error
