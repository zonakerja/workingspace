from app.logic import (
    PdfProfile,
    choose_engine,
    compact_markdown,
    estimate_tokens,
    file_extension,
    is_supported,
)


def test_file_extension():
    assert file_extension("Laporan.PDF") == "pdf"
    assert file_extension("foto.jpeg") == "jpg"
    assert file_extension("scan.tif") == "tiff"
    assert file_extension("tanpa-ekstensi", "application/vnd.openxmlformats-officedocument.wordprocessingml.document") == "docx"
    assert file_extension("x", "image/png; charset=binary") == "png"
    assert file_extension("x", "application/octet-stream") == ""


def test_is_supported():
    assert is_supported("pdf") and is_supported("docx") and is_supported("png") and is_supported("xls")
    assert not is_supported("exe") and not is_supported("")


def test_images_always_docling():
    assert choose_engine("png", "markitdown", "auto", None, 200)[0] == "docling"


def test_text_documents_markitdown():
    assert choose_engine("docx", "auto", "auto", None, 200)[0] == "markitdown"
    assert choose_engine("xls", "docling", "auto", None, 200)[0] == "markitdown"  # Docling tidak membaca XLS
    assert choose_engine("pptx", "docling", "auto", None, 200)[0] == "docling"


def test_pdf_auto():
    text = PdfProfile(pages=10, scanned_pages=0, image_pages=1)
    scanned = PdfProfile(pages=10, scanned_pages=1, image_pages=0)
    pictures = PdfProfile(pages=8, scanned_pages=0, image_pages=2)
    long_pictures = PdfProfile(pages=400, scanned_pages=0, image_pages=300)
    assert choose_engine("pdf", "auto", "auto", text, 200)[0] == "markitdown"
    assert choose_engine("pdf", "auto", "auto", scanned, 200)[0] == "docling"
    assert choose_engine("pdf", "auto", "auto", pictures, 200)[0] == "docling"
    assert choose_engine("pdf", "auto", "auto", long_pictures, 200)[0] == "markitdown"
    assert choose_engine("pdf", "auto", "docling", text, 200)[0] == "docling"
    assert choose_engine("pdf", "auto", "markitdown", scanned, 200)[0] == "markitdown"
    assert choose_engine("pdf", "docling", "markitdown", text, 200)[0] == "docling"


def test_compact_markdown():
    raw = (
        "# Judul  \r\n\r\n\r\n\r\nParagraf" + chr(0xA0) + "satu\n"
        "![logo](data:image/png;base64,AAAA)\n<!-- image -->\n"
        "|  Nama    |   Nilai  |\n|:--------|-------:|\n|  A   |  1   |\n"
    )
    assert compact_markdown(raw) == "# Judul\n\nParagraf satu\n\n| Nama | Nilai |\n|---|---|\n| A | 1 |\n"
    assert compact_markdown("  \n\n ") == ""


def test_estimate_tokens():
    assert estimate_tokens("") == 0
    assert estimate_tokens("abcd") == 1
    assert estimate_tokens("abcde") == 2


def test_compact_promotes_empty_docx_header():
    docx = "Teks\n\n|  |  |\n|---|---|\n| Kode | Nama |\n| 1 | A |\n"
    assert compact_markdown(docx) == "Teks\n\n| Kode | Nama |\n|---|---|\n| 1 | A |\n"


def test_compact_replaces_nbsp():
    assert compact_markdown("a" + chr(0xA0) + "b") == "a b\n"


def test_compact_flattens_fake_tables_from_justified_pdf():
    fake = (
        "Menimbang :\n"
        "|  |  | Peraturan |  | Pemerintah |  | Nomor |  | 32 | Tahun |\n"
        "|---|---|---|---|---|---|---|---|---|---|\n"
        "|  |  | Penyelenggaraan |  |  | Bidang |  | Penerbangan, |  |  |\n"
        "mengenai kegiatan pengusahaan;\n"
    )
    assert compact_markdown(fake) == (
        "Menimbang :\nPeraturan Pemerintah Nomor 32 Tahun\nPenyelenggaraan Bidang Penerbangan,\nmengenai kegiatan pengusahaan;\n"
    )


def test_compact_keeps_real_tables():
    real = "| Kode | Nama Barang | Nilai |\n|---|---|---|\n| 3.02.01 | Kendaraan Dinas | 250.000.000 |\n| 3.05.02 |  | 15.000.000 |\n"
    assert compact_markdown(real) == real


def test_compact_drops_page_numbers_and_repeated_headers():
    page = "2021, No.1146\n-{n}-\nPasal {n} isi pasal ke {n}.\n"
    text = "".join(page.format(n=n) for n in range(2, 8))
    out = compact_markdown(text, pages=6)
    assert "No.1146" not in out and "-3-" not in out
    assert out.count("Pasal") == 6
    # Tanpa jumlah halaman: hanya nomor halaman yang dibuang
    assert compact_markdown(text).count("No.1146") == 6
    assert compact_markdown("Halaman 2 dari 9\nIsi") == "Isi\n"


def test_compact_local_images_and_slide_markers():
    pptx = (
        "<!-- Slide number: 1 -->\n"
        "![Ilustrasi kawasan General Aviation](A1_ilustrasi.jpg)\n"
        "![ikon](A2_ikon111.jpg)\n![Picture 3](image3.png)\n![](x.png)\n"
        "![logo](https://contoh.id/logo.png)\nJudul slide\n"
    )
    assert compact_markdown(pptx) == (
        "[Slide 1]\n[Gambar: Ilustrasi kawasan General Aviation]\n\n\n\n"
        .replace("\n\n\n\n", "\n\n")
        + "![logo](https://contoh.id/logo.png)\nJudul slide\n"
    )
