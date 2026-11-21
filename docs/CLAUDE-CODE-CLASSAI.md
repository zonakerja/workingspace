# Memakai paket/kredit router.classai di Claude Code

> Dokumen sementara milik pemilik. **Hapus berkas ini (dan rujukannya di CLAUDE.md) bila pemilik memerintahkan / tidak lagi
> memakai Classai.** Data harga & batas dicatat 2026-11-21 dari dokumentasi Classai — cek ulang di dasbor sebelum membeli.

Claude Code biasanya memakai langganan/akun Anthropic. Dengan Classai Router, Claude Code memakai **paket token & kredit Classai**
(lebih murah) lewat alamat yang kompatibel dengan API Anthropic. Router adalah **pihak ketiga yang melihat isi permintaan**
(kode, berkas yang dibaca Claude, isi chat) — jangan dipakai untuk pekerjaan yang isinya tidak boleh keluar.

## 1. Mengaktifkan

Cara tetap (berlaku untuk semua sesi): isi blok `env` di `C:\Users\<nama>\.claude\settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://router.classai.id",
    "ANTHROPIC_AUTH_TOKEN": "sk_live_...",
    "ANTHROPIC_MODEL": "claude-opus-5.5",
    "ANTHROPIC_SMALL_FAST_MODEL": "claude-opus-5.5"
  }
}
```

- `ANTHROPIC_BASE_URL` **tanpa** `/v1`.
- `ANTHROPIC_AUTH_TOKEN` = API key dari dasbor Classai (`sk_live_…`). Ketik sendiri; jangan ditempel ke chat Claude.
- `ANTHROPIC_SMALL_FAST_MODEL` dipakai Claude Code untuk tugas kecil (judul, ringkasan). Bisa diganti model lebih murah
  (mis. `claude-haiku-5.5`) agar kredit lebih awet.

Cara sementara (hanya satu jendela PowerShell):

```powershell
$env:ANTHROPIC_BASE_URL = "https://router.classai.id"; $env:ANTHROPIC_AUTH_TOKEN = "sk_live_..."; claude
```

Periksa: jalankan `/status` di Claude Code (CLI) — alamat API harus `router.classai.id`. Aplikasi desktop membaca
`settings.json` yang sama; mulai ulang aplikasinya setelah mengubah berkas.

## 2. Kembali ke akun Anthropic

Hapus keempat baris di blok `env` (biarkan `{}`) lalu mulai ulang Claude Code. Variabel PowerShell sementara hilang saat
jendelanya ditutup.

## 3. Biaya (dicatat 2026-11-21)

- **Paket token** (mis. paket Opus) dipakai lebih dulu; setelah habis memakai **kredit** yang berlaku untuk semua model pada key
  yang sama.
- Paket kredit, masing-masing berlaku 30 hari: **Pro** 250 jt kredit Rp60.000 · **Max** 500 jt Rp90.000 · **Ultra** 1 miliar Rp150.000.
- Tarif per 1 juta token (masukan / keluaran), dalam kredit: Opus 5.5 52,8 jt / 264 jt · Sonnet 5.5 26,4 jt / 132 jt · Haiku 5.5
  10,8 jt / 33 jt.
- **Prompt caching**: token yang dibaca dari cache ditagih 50 %. Claude Code memasang penanda cache sendiri, jadi sesi panjang jauh
  lebih murah daripada hitungan kasar.

## 4. Batas

- 60 permintaan/menit per key, 180/menit per akun.
- Badan permintaan maks. 25 MB (berkas/gambar besar yang dibaca Claude bisa ditolak).
- Satu permintaan maks. 15 menit.
- Sensor data pribadi (PII) bisa diatur lewat header `x-classai-pii: strict | off` (bawaan mengikuti pengaturan akun).

## 5. Memantau pemakaian

Dasbor Classai → **Usage**: bandingkan total token dengan **"tokens from packages"** (yang benar-benar memotong paket; cache sudah
dihitung setengah). Angka token di log Claude Code / Akasha adalah token mentah, bukan potongan paket (CLAUDE.md §12, 2026-11-07).

## 6. Catatan

- Router yang sama juga dipakai Akai (sumber Classai di Pengaturan Model Akai) — key Claude Code boleh berbeda agar pemakaian
  terpisah di dasbor.
- Bila Claude Code menampilkan galat 401/403: key salah/kedaluwarsa; 429: batas per menit; 402/saldo: paket & kredit habis.
