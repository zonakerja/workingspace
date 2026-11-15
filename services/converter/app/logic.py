"""Logika murni Markdown Converter (tanpa MarkItDown/Docling) — diuji di tests/test_logic.py.

Pembagian kerja (docs/ARCHITECTURE.md §3.14):
- MarkItDown: dokumen berbasis teks (DOCX, XLSX/XLS, PPTX, PDF berlapisan teks, CSV, HTML, JSON, XML, EPUB, MSG, …).
- Docling: gambar & PDF hasil scan / bergambar (OCR Tesseract bahasa Indonesia + Inggris, tata letak & tabel).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Ekstensi yang dibaca MarkItDown (dokumen teks). PDF diputuskan per isi (lihat choose_pdf_engine).
MARKITDOWN_EXTENSIONS = {
    "docx", "xlsx", "xls", "pptx", "csv", "tsv", "html", "htm", "xhtml", "json", "jsonl", "xml",
    "epub", "msg", "txt", "md", "markdown", "rst", "yaml", "yml", "ipynb",
}
# Ekstensi gambar yang dibaca Docling (OCR). GIF/BMP/TIFF diubah ke PNG dulu.
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"}

MIME_TO_EXTENSION = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/epub+zip": "epub",
    "application/vnd.ms-outlook": "msg",
    "application/json": "json",
    "application/xml": "xml",
    "text/xml": "xml",
    "text/html": "html",
    "text/csv": "csv",
    "text/tab-separated-values": "tsv",
    "text/markdown": "md",
    "text/plain": "txt",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
}

# Format yang dikenal kedua mesin (boleh saling menggantikan bila salah satu gagal)
BOTH_ENGINES = {"pdf", "docx", "pptx", "xlsx", "html", "htm", "md", "csv"}

MODES = ("auto", "markitdown", "docling")
PDF_MODES = ("auto", "markitdown", "docling")

# Halaman dianggap hasil scan bila karakter teksnya di bawah ini.
SCANNED_PAGE_CHARS = 20
# Gambar dihitung "bermakna" (grafik, foto, tabel gambar) bila menutupi ≥ bagian halaman ini — logo kop kecil tidak.
MEANINGFUL_IMAGE_AREA = 0.10
# PDF dianggap bergambar bila ≥ porsi halaman ini memuat gambar bermakna.
IMAGE_PAGE_RATIO = 0.25


def file_extension(filename: str, mime_type: str = "") -> str:
    """Ekstensi berkas (huruf kecil, tanpa titik); dari MIME bila nama tidak berekstensi."""
    name = filename.rsplit("/", 1)[-1]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext:
        return "jpg" if ext == "jpeg" else ("tiff" if ext == "tif" else ext)
    return MIME_TO_EXTENSION.get(mime_type.split(";")[0].strip().lower(), "")


def is_supported(ext: str) -> bool:
    return ext == "pdf" or ext in MARKITDOWN_EXTENSIONS or ext in IMAGE_EXTENSIONS


@dataclass(frozen=True)
class PdfProfile:
    """Ringkasan isi PDF: jumlah halaman, halaman tanpa teks (scan), halaman bergambar bermakna."""

    pages: int
    scanned_pages: int
    image_pages: int


def choose_pdf_engine(profile: PdfProfile, pdf_mode: str, docling_max_pages: int) -> tuple[str, str]:
    """(mesin, alasan) untuk PDF. `auto`: ada halaman scan → Docling; banyak gambar → Docling; selain itu MarkItDown.

    PDF lebih panjang dari `docling_max_pages` tanpa halaman scan tetap MarkItDown agar tidak menahan antrian lama.
    """
    if pdf_mode == "markitdown":
        return "markitdown", "dipilih pengguna"
    if pdf_mode == "docling":
        return "docling", "dipilih pengguna"
    if profile.pages and profile.scanned_pages > 0:
        return "docling", f"{profile.scanned_pages} dari {profile.pages} halaman tanpa lapisan teks (scan)"
    if profile.pages and profile.image_pages / profile.pages >= IMAGE_PAGE_RATIO:
        if profile.pages > docling_max_pages:
            return "markitdown", f"PDF bergambar tetapi lebih dari {docling_max_pages} halaman"
        return "docling", f"{profile.image_pages} dari {profile.pages} halaman berisi gambar/grafik"
    return "markitdown", "PDF berlapisan teks"


def choose_engine(ext: str, mode: str, pdf_mode: str, profile: PdfProfile | None, docling_max_pages: int):
    """(mesin, alasan) untuk satu berkas. Gambar selalu Docling; dokumen teks selalu MarkItDown kecuali dipaksa."""
    if ext in IMAGE_EXTENSIONS:
        return "docling", "gambar (OCR)"
    if ext == "pdf":
        if mode in ("markitdown", "docling"):
            return mode, "dipilih pengguna"
        return choose_pdf_engine(profile or PdfProfile(0, 0, 0), pdf_mode, docling_max_pages)
    # Docling hanya untuk format yang ia kenal; dokumen kantor lain tetap MarkItDown
    if mode == "docling" and ext in BOTH_ENGINES:
        return "docling", "dipilih pengguna"
    return "markitdown", "dokumen teks"


_DATA_URI_IMAGE = re.compile(r"!\[[^\]]*\]\(data:[^)]*\)")
_IMAGE_PLACEHOLDER = re.compile(r"^\s*<!--\s*image\s*-->\s*$", re.MULTILINE)
# Gambar berupa nama berkas lokal (MarkItDown PPTX/DOCX: `![ikon](A2_ikon111.jpg)`) — berkasnya tidak ikut, hanya alt yang berguna
_LOCAL_IMAGE = re.compile(r"!\[([^\]]*)\]\((?!https?:)[^)\s]*\)")
_SLIDE_MARKER = re.compile(r"^\s*<!--\s*Slide number:\s*(\d+)\s*-->\s*$", re.MULTILINE | re.IGNORECASE)
# Alt bawaan yang tidak bermakna (ikon, Picture 3, image1, gambar)
_GENERIC_ALT = re.compile(r"^(?:ikon|icon|logo|image|img|picture|gambar|foto|photo|graphic|grafik|chart)?\s*\d*$", re.IGNORECASE)
_TRAILING_SPACES = re.compile(r"[ \t]+$", re.MULTILINE)
_BLANK_LINES = re.compile(r"\n{3,}")
_TABLE_DIVIDER = re.compile(r"^\|(?:\s*:?-{3,}:?\s*\|)+\s*$")
_TABLE_ROW = re.compile(r"^\|.*\|\s*$")
NBSP = chr(0xA0)


def _compact_table_line(line: str) -> str:
    """Rapatkan baris tabel Markdown: spasi pengisi antar-sel dibuang (`|  a   |` → `| a |`), pemisah `|---|`."""
    if _TABLE_DIVIDER.match(line):
        cells = line.strip().strip("|").split("|")
        return "|" + "|".join("---" for _ in cells) + "|"
    cells = [re.sub(r"\s+", " ", cell).strip() for cell in line.strip().strip("|").split("|")]
    return "| " + " | ".join(cells) + " |"


def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_fake_table(rows: list[str]) -> bool:
    """Tabel palsu = paragraf rata kiri-kanan yang dibaca pdfplumber sebagai tabel (`| | Peraturan | | Pemerintah |`).

    Ciri: banyak sel kosong, sel berisi rata-rata satu kata, dan bukan tabel angka. Tabel data asli (aset, anggaran) jarang
    memenuhi ketiganya sekaligus.
    """
    body = [_cells(r) for r in rows if not _TABLE_DIVIDER.match(r)]
    cells = [c for row in body for c in row]
    filled = [c for c in cells if c]
    if len(cells) < 6 or not filled:
        return False
    empty_ratio = 1 - len(filled) / len(cells)
    words_per_cell = sum(len(c.split()) for c in filled) / len(filled)
    numeric = sum(1 for c in filled if re.fullmatch(r"[\d.,%()/-]+", c)) / len(filled)
    return empty_ratio >= 0.3 and words_per_cell <= 1.6 and numeric < 0.4


def _flatten_fake_tables(lines: list[str]) -> list[str]:
    """Ubah tabel palsu kembali menjadi baris teks (sel berisi digabung spasi) — hemat token & terbaca sebagai kalimat."""
    out: list[str] = []
    i = 0
    while i < len(lines):
        if not _TABLE_ROW.match(lines[i]):
            out.append(lines[i])
            i += 1
            continue
        j = i
        while j < len(lines) and _TABLE_ROW.match(lines[j]):
            j += 1
        block = lines[i:j]
        if _is_fake_table(block):
            out.extend(" ".join(c for c in _cells(row) if c) for row in block if not _TABLE_DIVIDER.match(row))
        else:
            out.extend(block)
        i = j
    return out


def _promote_empty_headers(lines: list[str]) -> list[str]:
    """Tabel tanpa baris judul (DOCX) ditulis MarkItDown dengan kepala kosong `|  |  |` → baris pertama jadi kepala."""
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        is_empty_header = _TABLE_ROW.match(line) and not line.replace("|", "").strip()
        if (
            is_empty_header
            and i + 2 < len(lines)
            and _TABLE_DIVIDER.match(lines[i + 1])
            and _TABLE_ROW.match(lines[i + 2])
            and (i == 0 or not _TABLE_ROW.match(lines[i - 1]))
        ):
            out.extend([lines[i + 2], lines[i + 1]])
            i += 3
            continue
        out.append(line)
        i += 1
    return out


_PAGE_NUMBER = re.compile(r"^(?:-\s*\d{1,4}\s*-|halaman\s+\d{1,4}(?:\s+dari\s+\d{1,4})?|page\s+\d{1,4}(?:\s+of\s+\d{1,4})?|\d{1,4}\s*/\s*\d{1,4})$", re.IGNORECASE)


def _drop_page_furniture(lines: list[str], pages: int | None) -> list[str]:
    """Buang nomor halaman (`-2-`, `Halaman 2 dari 9`) dan kepala/kaki halaman yang berulang di hampir setiap halaman.

    Baris dianggap kepala/kaki bila pendek (≤ 80 karakter), bukan tabel/judul, dan muncul ≥ 3 kali serta pada ≥ separuh
    halaman (`pages` diketahui untuk PDF). Tanpa jumlah halaman hanya nomor halaman yang dibuang.
    """
    counts: dict[str, int] = {}
    for line in lines:
        key = line.strip()
        if key:
            counts[key] = counts.get(key, 0) + 1
    threshold = max(3, (pages or 0) // 2) if pages and pages >= 3 else None

    def furniture(line: str) -> bool:
        key = line.strip()
        if not key:
            return False
        if _PAGE_NUMBER.match(key):
            return True
        if threshold is None or len(key) > 80 or _TABLE_ROW.match(key) or key.startswith("#"):
            return False
        return counts[key] >= threshold

    return [line for line in lines if not furniture(line)]


def _local_image(match: re.Match) -> str:
    """Gambar lokal → keterangan teks bila alt bermakna (`[Gambar: …]`), selain itu dibuang."""
    alt = match.group(1).strip()
    return "" if _GENERIC_ALT.match(alt) or len(alt) < 4 else f"[Gambar: {alt}]"


def compact_markdown(markdown: str, pages: int | None = None) -> str:
    """Bersihkan hasil konversi agar hemat token tanpa membuang isi.

    - gambar data URI (base64) & penanda `<!-- image -->` Docling dibuang (tidak terbaca model, ribuan token),
    - spasi pengisi di sel tabel & spasi di akhir baris dibuang, baris kosong beruntun dirapatkan,
    - kepala tabel kosong diganti baris pertama tabel,
    - tabel palsu (paragraf rata kiri-kanan yang terbaca sebagai tabel) dikembalikan menjadi teks,
    - nomor halaman & kepala/kaki halaman berulang dibuang (`pages` = jumlah halaman PDF bila diketahui),
    - gambar berkas lokal (PPTX/DOCX) dibuang kecuali alt-nya bermakna, penanda slide diringkas `[Slide n]`.
    """
    text = markdown.replace("\r\n", "\n").replace("\r", "\n").replace(NBSP, " ")
    text = _DATA_URI_IMAGE.sub("", text)
    text = _IMAGE_PLACEHOLDER.sub("", text)
    text = _LOCAL_IMAGE.sub(_local_image, text)
    text = _SLIDE_MARKER.sub(lambda m: f"[Slide {m.group(1)}]", text)
    lines = [(_compact_table_line(line) if _TABLE_ROW.match(line) else line) for line in text.split("\n")]
    lines = _drop_page_furniture(_flatten_fake_tables(_promote_empty_headers(lines)), pages)
    text = _TRAILING_SPACES.sub("", "\n".join(lines))
    text = _BLANK_LINES.sub("\n\n", text)
    return text.strip() + "\n" if text.strip() else ""


def estimate_tokens(text: str) -> int:
    """Perkiraan kasar token (± 4 karakter per token) untuk ditampilkan ke pengguna."""
    return (len(text) + 3) // 4
