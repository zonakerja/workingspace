"""Buat berkas contoh untuk uji manual converter (dijalankan di container): python tests/make_samples.py /tmp/samples"""

import sys
from pathlib import Path

from docx import Document
from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageFont

out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/samples")
out.mkdir(parents=True, exist_ok=True)

doc = Document()
doc.add_heading("Nota Dinas Penetapan Status Penggunaan", level=1)
doc.add_paragraph("Berdasarkan Peraturan Menteri Keuangan Nomor 118 Tahun 2023 tentang Pengelolaan BMN.")
doc.add_heading("Daftar Aset", level=2)
table = doc.add_table(rows=3, cols=3)
for r, row in enumerate([["Kode", "Nama Barang", "Nilai"], ["3.02.01", "Kendaraan Dinas", "250.000.000"], ["3.05.02", "Laptop", "15.000.000"]]):
    for c, value in enumerate(row):
        table.cell(r, c).text = value
doc.save(out / "nota-dinas.docx")

wb = Workbook()
ws = wb.active
ws.title = "Aset"
for row in [["Kode", "Nama", "Jumlah"], ["3.02.01", "Kendaraan", 2], ["3.05.02", "Laptop", 15]]:
    ws.append(row)
wb.save(out / "aset.xlsx")

font = None
for path in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
    if Path(path).exists():
        font = ImageFont.truetype(path, 28)
img = Image.new("RGB", (1240, 900), "white")
draw = ImageDraw.Draw(img)
lines = [
    "KEMENTERIAN KEUANGAN REPUBLIK INDONESIA",
    "SURAT KEPUTUSAN",
    "Nomor: 12/KEU/2026",
    "Tentang Penetapan Status Penggunaan Barang Milik Negara",
    "Menimbang bahwa untuk tertib administrasi pengelolaan",
    "barang milik negara perlu ditetapkan status penggunaannya.",
]
for i, line in enumerate(lines):
    draw.text((80, 80 + i * 70), line, fill="black", font=font or ImageFont.load_default(size=28))
img.save(out / "scan-sk.png")
img.save(out / "scan-sk.pdf", "PDF", resolution=150)
print("ok", sorted(p.name for p in out.iterdir()))
