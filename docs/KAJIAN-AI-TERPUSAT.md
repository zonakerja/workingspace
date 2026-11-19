# Kajian: Semua AI Akasha Terpusat di Akai (melepas modul API key lama Akasha)

Status: **disetujui pemilik 2026-11-19 ("Ikuti semua saran")** — T1–T4 dieksekusi 2026-11-19 (status: §8), key dipindah pemilik dan tabel key lama di-drop hari yang sama — **selesai**. Keputusan §7: 1 ya dipusatkan, 2 transkrip pindah ke Akai, 3 Bandingkan token dihapus, 4 key dipindah otomatis server ke server, 5 Akai tidak terjangkau = AI berhenti dengan pesan jelas.

## 1. Ringkasan & rekomendasi

**Rekomendasi: ya, pusatkan.** Akasha tidak perlu menyimpan API key sendiri. Yang dipindah ke Akai hanyalah **siapa yang memanggil model
dan menyimpan key** (sumber, router, model, pembagian tugas, cadangan, pemakaian & biaya). **Fitur AI Akasha tetap di Akasha**: indeks RAG
(`ai_chunks` + pgvector), pemotongan dokumen, Pencarian Pintar, chatbot bersitasi, My Notebook, Catatan serupa, Approval (analisis/telaah),
bot WhatsApp, Rapikan dokumen, OCR ekstraksi, AI di ONLYOFFICE, ringkasan Notes AI. Akasha tetap menyusun prompt, memilih potongan
pengetahuan, menyaring item terkunci PIN & berbagi, lalu mengirim permintaan ke gateway Akai — persis seperti hari ini untuk tugas yang
sudah diatur di Akai.

Alasan:

- **Satu tempat untuk key & biaya** — pemilik mengatur model sekali di Akai web dan semua aplikasi ekosistem (Akasha, Akai chat, Cendekia
  kelak) memakainya; pemakaian & perkiraan biaya terlihat di satu halaman.
- **Jalurnya sudah ada dan teruji**: sejak tahap 6a.4 tugas `chat`, `general`, `document`, `ocr`, `embedding`, dan `agent` sudah dijawab Akai
  bila diatur (docs/AKAI.md §4, §7). Jalur lama di Akasha kini hanya cadangan.
- **Kode yang bisa dihapus besar**: ± 15 berkas backend (klien Gemini/Claude/OpenAI/router, pembagian tugas, cadangan per tugas, proxy agen
  native yang sudah disalin ke Akai), kartu Pengaturan → Model AI lama, tabel `ai_credentials`, 3 SDK model di Akasha.
- **Tidak ada pihak baru yang melihat data**: Akasha → Akai berjalan di jaringan internal server yang sama (`http://akai-api:4400`); data
  tetap dikirim ke provider model yang sama seperti sekarang.

Syaratnya: **tutup dulu tiga celah** di Akai (transkrip audio, lampiran audio, hitung token — §3), lalu migrasi key pemilik, baru hapus
jalur lama.

## 2. Peta pemakaian AI Akasha hari ini

| Fitur Akasha | Pemanggilan | Tugas | Sudah bisa lewat Akai? |
| --- | --- | --- | --- |
| Chatbot melayang, chat My Notebook | `AiService.generate(…, "chat")` | chat | ✅ |
| Ringkasan Notes AI, analisis & telaah Approval, isi templat dengan AI, saran ikon, jawaban bot WhatsApp, AI di ONLYOFFICE, ringkasan berkas | `generate(…, "general")` | general | ✅ |
| Rapikan dokumen (Markdown Converter) | `generate(…, "document")` | document | ✅ |
| OCR saat ekstraksi berkas (gambar, PDF scan) | `AiService.ocr` | ocr | ✅ |
| Indeks pengetahuan, Pencarian Makna, Catatan serupa, chatbot (pencarian vektor) | `embeddingCredential` → `AkaiService.embed` | embedding | ✅ (butuh model embedding di Akai; katalog Classai tidak punya → tambah sumber Gemini/OpenAI di Akai) |
| Agen Hermes (proxy `/agent/llm/v1`) | `AgentService.proxyChat` → `AkaiService.proxyAgent` | agent | ✅ |
| **Transkrip rekaman Notes AI** (WebM dipotong 10 menit, Files API, model cadangan bila ditolak) | `AiService.transcribeFile` | transcribe | ❌ — Gemini **langsung** saja; tugas `transcribe` sudah ada di pengaturan rute Akai tetapi **belum ada endpoint gateway** |
| Lampiran **audio** di `generate` (jarang) | `generate` dengan lampiran audio | — | ❌ — dikecualikan dari jalur Akai |
| **Bandingkan token** (pustaka Markdown Converter) | `AiService.countTokens` (tokenizer Gemini) | — | ❌ — key Gemini langsung |
| Uji koneksi, pilih model, pembagian tugas | Pengaturan → Model AI | — | ✅ sudah ada padanannya di Akai web |
| Akun tanpa SSO (hanya akun uji smoke) | semua di atas | — | ❌ — Akai mengenali akun dari `sub` SSO |

Catatan: `AI_ENCRYPTION_KEY` **tidak** ikut dihapus — kunci itu juga dipakai sesi robot, kalender ICS, akun email, OAuth, dan brankas
(kunci turunan). Yang dihapus hanya pemakaiannya untuk `ai_credentials`.

## 3. Celah yang harus ditutup di Akai lebih dulu

1. **Transkrip audio panjang** — pindahkan logika `ai/transcribe/` (pemotong WebM tanpa encode ulang, 3 paralel, penanda `[Menit N]`,
   sambung `MAX_TOKENS`, model cadangan untuk potongan yang ditolak, Files API untuk format lain) ke Akai sebagai endpoint gateway **asinkron**
   (`POST /gateway/v1/audio/transcriptions` → id tugas, `GET …/:id`), memakai rute tugas `transcribe` (wajib sumber Gemini langsung).
   Akasha mengirim berkas dari object storage (aliran) atau Akai mengambilnya lewat tautan unduh bertanda tangan 10 menit (lebih hemat
   memori; disarankan). Status per potongan tetap disimpan agar mengulang tidak membayar dua kali.
2. **Lampiran audio umum** — ikut jalur yang sama (transkrip dulu, lalu teks dikirim ke tugas `general`), atau ditolak dengan pesan jelas.
3. **Hitung token** — dua pilihan: (a) endpoint `POST /gateway/v1/tokens/count` di Akai (tokenizer Gemini dari sumber Gemini milik akun), atau
   (b) **hapus** tombol Bandingkan token (fitur riset, jarang dipakai). Rekomendasi: (b) — lebih sedikit kode, tidak mengurangi fungsi kerja.
4. **Embedding** — pastikan akun punya model embedding di Akai sebelum jalur lama dihapus; tanpa itu Pencarian Makna & Catatan serupa mati
   (pencarian kata tetap jalan). Penanda di Pengaturan → Model AI Akasha: "Embedding belum diatur di Akai".

## 4. Dampak & risiko setelah dipusatkan

| Hal | Dampak | Penanganan |
| --- | --- | --- |
| Akai mati / gagal start | Semua fitur AI Akasha berhenti (fitur non-AI tetap jalan). Hari ini jalur lama menjadi cadangan | Satu VPS, healthcheck compose & `restart: unless-stopped`; pesan galat jelas "Akai tidak dapat dihubungi"; RAG pencarian kata tetap bekerja |
| Akun belum mengatur tugas di Akai | Tombol AI menjawab "Atur model di Akai" | Kartu Model AI Akasha menampilkan status per tugas + tombol **Buka Akai** (sudah ada sejak 6a.4 langkah 3) |
| Smoke test Akasha | Skenario AI memakai key palsu di Akasha | Ganti dengan Akai tiruan (server kecil di smoke) atau periksa galat "belum diatur di Akai" |
| Hermes | Proxy agen Akasha tinggal meneruskan ke Akai | Hapus `agent-claude.ts` / `agent-openai.ts` / cabang native di Akasha (sudah ada salinannya di Akai) |
| Biaya | Terlihat per aplikasi & tugas di Akai → Pemakaian | Lebih baik dari sekarang (Akasha tidak mencatat biaya) |
| Privasi | Tidak berubah (provider sama, Akai di server yang sama) | — |

## 5. Yang dihapus dari Akasha setelah eksekusi

- Backend: `ai/providers/*` (gemini, anthropic, openai, openai-compatible, gemini-transcribe), `ai-routing.ts`, `ai-endpoint.ts`,
  `ai-providers.ts` (katalog), bagian `ai.service.ts` yang memanggil provider (generate/ocr/countTokens/transcribe → tipis, hanya ke Akai),
  `ai-crypto.ts` untuk kredensial AI, `agent-claude.ts`, `agent-openai.ts`, bagian `agent-llm.ts` yang memilih kredensial, endpoint
  `/ai/settings/:provider*`, `ai/transcribe/` (pindah ke Akai).
- Database: tabel `ai_credentials`, kolom `users.ai_provider`, `ai_fallback`, `ai_routing` (migrasi drop setelah key dipindah).
- Frontend: kartu provider & API key, Pembagian tugas, cadangan di Pengaturan → Model AI (menjadi status Akai + tautan), `isAkaiPrimary`.
- Paket npm Akasha: `@google/genai`, `@anthropic-ai/sdk`, `openai` (bila tidak dipakai di tempat lain).
- Tetap: `AkaiService` (+ `akai-logic.ts`), seluruh fitur & prompt AI, indeks RAG, MCP server Akasha, cakupan token agen.

## 6. Usulan tahapan eksekusi

| Tahap | Isi | Chat |
| --- | --- | --- |
| T1 | Akai: endpoint transkrip asinkron (+ audio umum), test, smoke | Akai |
| T2 | Akasha: transkrip lewat Akai; hapus Bandingkan token (atau endpoint hitung token bila dipilih); semua `generate`/`ocr`/`embed` **wajib** Akai, jalur lama hanya bila sakelar sementara `AI_LEGACY_FALLBACK` menyala | Akasha |
| T3 | Migrasi key: tombol sekali jalan **Pindahkan key ke Akai** di Pengaturan → Model AI (Akasha mendekripsi key → kirim server-ke-server ke Akai sebagai sumber baru, pemilik mengonfirmasi; key tidak lewat browser) — atau pemilik memasukkan ulang key di Akai web | Akasha + Akai |
| T4 | Hapus jalur lama, tabel & kolom (migrasi drop), kartu UI lama, paket SDK; smoke dengan Akai tiruan | Akasha |
| T5 | Dokumentasi (CLAUDE.md §8/§8b, ARCHITECTURE §3.1, AKAI.md), TODO-USER | keduanya |

Perkiraan: T1 ± 1 sesi, T2–T4 ± 1–2 sesi. Uji ujung-ke-ujung dengan router tiruan (pola 6a.4) + satu transkrip sungguhan (butuh key Gemini
pemilik di Akai).

## 7. Keputusan yang dibutuhkan pemilik

1. **Setuju dipusatkan** di Akai (Akasha tanpa API key sendiri)?
2. **Transkrip audio** dipindah ke Akai (disarankan) — atau tetap Gemini langsung di Akasha sebagai pengecualian?
3. **Bandingkan token**: hapus (disarankan) atau pindah ke Akai?
4. **Migrasi key**: tombol pindah otomatis server-ke-server (disarankan) atau isi ulang manual di Akai web?
5. **Saat Akai tidak dapat dihubungi**: AI berhenti dengan pesan jelas (disarankan, sederhana) — atau tetap menyimpan satu key cadangan di
   Akasha (mengurangi manfaat pemusatan)?

## 8. Hasil eksekusi (2026-11-19)

- **T1 Akai**: `POST /gateway/v1/audio/transcriptions` (body = audio mentah, `X-Akai-Key`) + `GET …/:key`; logika transkrip (pemotong WebM,
  Files API, model cadangan) dipindah ke `apps/akai/api/src/transcribe/`; cadangan antar model tugas Transkrip bila kuota/key/sibuk. Impor key
  `POST /gateway/v1/sources/import` (`SourcesService.importFromApp`).
- **T2/T4 Akasha**: `AiService` Akai-saja; klien provider, `ai-endpoint`, pembagian tugas & cadangan lama, proxy agen Claude/OpenAI, `countTokens`
  + Bandingkan token, SDK `@google/genai`/`@anthropic-ai/sdk`/`openai` dihapus dari Akasha. Pengaturan → Model AI = status Akai.
- **T3**: tombol **Pindahkan ke Akai** (`POST /ai/settings/migrate`, `ai-migrate.ts`).
- **Pembersihan** (2026-11-19, setelah pemilik menekan Pindahkan): `ai_credentials`, enum `ai_provider`, kolom `users.ai_provider/ai_fallback/
  ai_routing` di-drop; tombol & endpoint pindah key (Akasha dan Akai) dihapus. **Sisa**: uji transkrip & embedding sungguhan.
