"""Pembungkus MarkItDown & Docling. Objek konverter dibuat sekali lalu dipakai ulang (model Docling berat)."""

from __future__ import annotations

import io
import logging
import os
import threading
from importlib.metadata import version

from .logic import (
    IMAGE_EXTENSIONS,
    MEANINGFUL_IMAGE_AREA,
    SCANNED_PAGE_CHARS,
    PdfProfile,
)

log = logging.getLogger("converter")

OCR_LANGS = [lang for lang in os.environ.get("OCR_LANGS", "ind,eng").split(",") if lang.strip()]
ARTIFACTS_PATH = os.environ.get("DOCLING_ARTIFACTS_PATH") or None
DOCLING_THREADS = int(os.environ.get("DOCLING_THREADS", "2"))

_markitdown = None
_markitdown_lock = threading.Lock()
_docling = None
# Docling memakai CPU penuh → satu konversi sekaligus; MarkItDown ringan dan boleh paralel.
_docling_lock = threading.Lock()


def engine_versions() -> dict[str, str]:
    out: dict[str, str] = {}
    for name in ("markitdown", "docling"):
        try:
            out[name] = version(name)
        except Exception:  # pragma: no cover - paket tidak terpasang
            out[name] = "tidak terpasang"
    return out


def _get_markitdown():
    global _markitdown
    with _markitdown_lock:
        if _markitdown is None:
            from markitdown import MarkItDown

            # Tanpa plugin & tanpa klien LLM: konversi murni lokal, tidak ada data keluar
            _markitdown = MarkItDown(enable_plugins=False)
        return _markitdown


def markitdown_convert(data: bytes, ext: str, filename: str) -> str:
    from markitdown import StreamInfo

    result = _get_markitdown().convert_stream(
        io.BytesIO(data), stream_info=StreamInfo(extension=f".{ext}", filename=filename)
    )
    return result.text_content or ""


def _get_docling():
    global _docling
    if _docling is None:
        from docling.datamodel.accelerator_options import AcceleratorOptions
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions, TesseractCliOcrOptions
        from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption

        def options(force_ocr: bool):
            opts = PdfPipelineOptions(artifacts_path=ARTIFACTS_PATH)
            opts.do_ocr = True
            opts.do_table_structure = True
            opts.ocr_options = TesseractCliOcrOptions(lang=OCR_LANGS, force_full_page_ocr=force_ocr)
            opts.accelerator_options = AcceleratorOptions(num_threads=DOCLING_THREADS, device="cpu")
            return opts

        _docling = DocumentConverter(
            allowed_formats=[InputFormat.PDF, InputFormat.IMAGE, InputFormat.DOCX, InputFormat.PPTX,
                             InputFormat.XLSX, InputFormat.HTML, InputFormat.MD, InputFormat.CSV],
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=options(False)),
                # Gambar = seluruh halaman di-OCR
                InputFormat.IMAGE: ImageFormatOption(pipeline_options=options(True)),
            },
        )
    return _docling


def _as_png(data: bytes) -> bytes:
    """GIF/BMP/TIFF/WEBP → PNG (Docling paling stabil dengan PNG/JPEG). Gambar animasi = bingkai pertama."""
    from PIL import Image

    with Image.open(io.BytesIO(data)) as img:
        img.seek(0)
        out = io.BytesIO()
        img.convert("RGB").save(out, format="PNG")
        return out.getvalue()


def docling_convert(data: bytes, ext: str, filename: str, max_pages: int) -> tuple[str, int | None]:
    from docling.datamodel.base_models import DocumentStream

    if ext in IMAGE_EXTENSIONS and ext not in ("png", "jpg"):
        data, ext = _as_png(data), "png"
    stem = filename.rsplit(".", 1)[0] or "berkas"
    stream = DocumentStream(name=f"{stem}.{ext}", stream=io.BytesIO(data))
    with _docling_lock:
        result = _get_docling().convert(stream, max_num_pages=max_pages, raises_on_error=True)
    doc = result.document
    pages = len(doc.pages) if getattr(doc, "pages", None) else None
    return doc.export_to_markdown(image_placeholder=""), pages


def pdf_profile(data: bytes) -> PdfProfile:
    """Hitung halaman scan & halaman bergambar lewat pypdfium2 (ikut terpasang bersama Docling)."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    pdf = pdfium.PdfDocument(data)
    try:
        pages = len(pdf)
        scanned = images = 0
        for index in range(pages):
            page = pdf[index]
            try:
                width, height = page.get_size()
                area = max(width * height, 1)
                textpage = page.get_textpage()
                chars = len("".join(textpage.get_text_range().split()))
                textpage.close()
                if chars < SCANNED_PAGE_CHARS:
                    scanned += 1
                    continue
                for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE], max_depth=2):
                    # pypdfium2 5.x: get_bounds(); 4.x: get_pos()
                    bounds = obj.get_bounds() if hasattr(obj, "get_bounds") else obj.get_pos()
                    left, bottom, right, top = bounds[:4]
                    if (right - left) * (top - bottom) / area >= MEANINGFUL_IMAGE_AREA:
                        images += 1
                        break
            finally:
                page.close()
        return PdfProfile(pages=pages, scanned_pages=scanned, image_pages=images)
    finally:
        pdf.close()


def warm_up() -> None:
    """Muat model Docling saat start agar konversi pertama tidak lambat (galat dicatat, tidak menghentikan service)."""
    try:
        from docling.datamodel.base_models import InputFormat

        _get_markitdown()
        _get_docling().initialize_pipeline(InputFormat.PDF)
        log.info("Docling siap (OCR %s)", ",".join(OCR_LANGS))
    except Exception as error:  # pragma: no cover - tergantung lingkungan
        log.warning("Pemanasan Docling gagal: %s", error)
