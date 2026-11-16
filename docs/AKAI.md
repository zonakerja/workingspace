# Akai — gateway model, chat, dan agen ekosistem workingspace.id (tahap B no. 6–7)

Dokumen kerja (mulai 2026-11-16). Konteks & alasan: [AKASHA-PLAN.md](AKASHA-PLAN.md) §2 (router & katalog model) dan §3
(Akai = backend sendiri, "otak" ekosistem). Status per langkah: §6.

## 1. Keputusan pemilik (2026-11-16)

| No   | Keputusan                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AK-1 | **API key / router model milik setiap pengguna** (seperti Akasha sekarang): setiap akun memasukkan router & key sendiri di Akai, biaya ditanggung masing-masing. Satu tempat untuk semua aplikasi ekosistem. Kunci bersama dari admin tidak dibuat sekarang. |
| AK-2 | **Gateway model dulu**: Akai API (router, katalog model, pembagian tugas, cadangan) dibangun lebih dulu; Akasha memanggil Akai untuk AI-nya. Aplikasi chat Akai menyusul di atasnya.                                                                         |
| AK-3 | **Mesin agen sendiri, Hermes bertahap**: Akai punya loop agen sendiri (multi-pengguna, riwayat di database, alat lewat MCP). Hermes tetap dipakai untuk skill yang sudah ada sampai digantikan.                                                              |

## 2. Gambaran

```
Akasha API ──(klien aplikasi + sub SSO)──► Akai API ──► router / provider resmi (Gemini, Claude, OpenAI, Classai, OpenRouter, …)
Cendekia API ─────────────────────────────►    │
Akai web (akai.workingspace.id) ──(SSO)────►   ├── percakapan, proyek, memori (tahap chat)
                                               └── loop agen ──► alat MCP (Akasha, aplikasi lain)
```

- **Akai API** `apps/akai/api` (`@akai/api`, NestJS + Prisma, sama dengan Akasha), port dev **4400**, database **`akai`**
  (+ `akai_shadow`) di server PostgreSQL yang sama.
- **Akai web** `apps/akai/web` (`@akai/web`), port dev **5177**, dibuka di `http://akai.workingspace.localhost:5177`
  (satu situs dengan SSO dev), produksi `akai.workingspace.id`.
- Akun Akai = akun SSO (`sub`); data milik akun (router, key, model, tugas, riwayat). Isolasi data sama seperti Akasha: admin
  tidak melihat key/percakapan pengguna lain.

## 3. Data (gateway)

| Tabel            | Isi                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accounts`       | `sso_subject` (unik), email, nama — dibuat saat pertama dipakai (masuk web atau panggilan aplikasi)                                                                                                                                                                                              |
| `ai_sources`     | sumber model milik akun: `kind` = `gemini` / `anthropic` / `openai` (SDK resmi, langsung) atau `router` (alamat + format `openai` / `anthropic`, preset `classai` / `openrouter` / `omniroute` / `custom`); key terenkripsi AES-256-GCM (`AKAI_ENCRYPTION_KEY`), `key_hint`, status uji terakhir |
| `ai_catalog`     | salinan `GET /models` per sumber (id, nama, konteks, modalitas, dukungan alat, harga bila ada) — dimuat ulang lewat tombol                                                                                                                                                                       |
| `ai_models`      | model yang **dinyalakan** pemilik: sumber + id model + label + kemampuan (`vision`, `pdf`, `tools`, `embedding`, `audio`) + konteks + harga masukan/keluaran per 1 jt token + mata uang/kredit + penanda "paket" (Classai), bisa diubah manual                                                   |
| `ai_task_routes` | per tugas: model utama + daftar cadangan berurutan. Tugas: `chat`, `general`, `agent`, `document`, `ocr`, `embedding` (768 dimensi), `transcribe` (Gemini langsung)                                                                                                                              |
| `ai_usage`       | log pemakaian per panggilan: aplikasi, tugas, model, token masuk/keluar/cache, perkiraan biaya, durasi, berhasil/gagal, pindah ke cadangan                                                                                                                                                       |

## 4. API

**Untuk pemilik akun** (sesi Akai web, nanti juga lewat tautan dari Pengaturan Akasha):
`/api/sources` (CRUD + `test`), `/api/sources/:id/catalog` (muat & lihat katalog), `/api/models` (nyalakan/ubah/matikan),
`/api/tasks` (pembagian tugas + cadangan), `/api/usage?days=` (total, per model / tugas / aplikasi, 50 panggilan terakhir).

**Sesi Akai web** (6a.3, `src/auth/`, pola sama dengan Akasha — docs/SSO.md §2.3–§2.11):

- Klien OIDC `akai` di SSO (`npm run setup:dev -w @workingspace/auth-api` menambahkannya + mengisi `SSO_*` di `apps/akai/api/.env`);
  aplikasi `akai` di tabel `apps` SSO (seed: admin = admin, user = member). Akses = super admin atau anggota aplikasi `akai`.
- `GET /api/auth/sso/start?returnTo=&silent=1` (cookie alur `akai_sso` = JWT HS256 dari kunci turunan `AKAI_ENCRYPTION_KEY`) →
  `GET /api/auth/sso/callback` → akun dari `sub` → cookie `akai_sid` (token acak, hash di tabel `web_sessions`, 30 hari sejak
  terakhir dipakai, httpOnly, SameSite Lax). `GET /api/me`, `POST /api/auth/logout` (→ `ssoLogoutUrl`), `GET /api/auth/config`.
- Keluar SSO = keluar Akai: `POST /api/auth/sso/backchannel-logout` (logout token diverifikasi `jose`) menghapus sesi ber-`sso_sid`.
  Akun dinonaktifkan / akses dicabut di SSO → sesi dihapus pada permintaan berikutnya (status dicek ke SSO, cache 60 dtk).
- `CallerService`: header `Authorization: Basic` = aplikasi; selain itu cookie sesi web (`clientId = "web"`, nama itu ditolak di
  `AKAI_CLIENTS`). Permintaan web yang mengubah data wajib header `X-Akai-Web: 1` (pengganti token CSRF).
- Halaman masuk web memeriksa SSO diam-diam (`silent=1`) sekali; sudah masuk SSO = langsung masuk Akai.
- Dev: Akai web `http://akai.workingspace.localhost:5177` (Vite meneruskan `/api` ke 4400 dengan Host asli); Akai API memetakan
  `*.localhost` (`localhost-dns.ts`) agar bisa memanggil SSO dev.

**Untuk aplikasi ekosistem** (server ke server): autentikasi klien aplikasi (HTTP Basic `client_id:client_secret`, daftar di
env `AKAI_CLIENTS`, pola sama dengan `/api/pin/verify` SSO) + header `X-Akai-Subject: <sub SSO>`:

- `POST /gateway/v1/chat/completions` — format OpenAI Chat Completions (+ streaming), memilih model lewat `task` (Akai memilih
  model & cadangan) atau `model` (id model Akai). Lampiran gambar/PDF hanya ke model yang mendukung.
- `POST /gateway/v1/embeddings` — model tugas `embedding` (768 dimensi).
- `GET /gateway/v1/status` — tugas mana yang sudah punya model (Akasha menampilkan "atur di Akai").

Cara kerja gateway (6a.2, `src/gateway/`):

- Kandidat = `model` (satu model, tanpa cadangan) atau model tugas `task` berurutan (bawaan `general`). Permintaan bergambar
  hanya ke model `vision`, permintaan beralat hanya ke model `tools`; tidak ada yang cocok → 422.
- Semua sumber dipanggil lewat HTTP (`SourcesService.endpointOf`): format `openai` → `{base}/chat/completions` &
  `{base}/embeddings` (sumber resmi Gemini/OpenAI memakai endpoint OpenAI-compatible resminya), format `anthropic` → `{base}/messages`
  dengan terjemahan dua arah (`anthropic.ts`: sistem, peran bergantian, gambar, alat). SDK resmi per provider tidak dipakai di
  gateway; prompt caching & blok pemikiran Claude menyusul di loop agen (6c).
- Streaming: sumber OpenAI diteruskan apa adanya (Akai menambah `stream_options.include_usage` untuk mencatat token); sumber
  Anthropic dijawab utuh lalu dikirim sebagai event SSE.
- Header jawaban `X-Akai-Model` (model yang menjawab) dan `X-Akai-Fallback-From` (model yang gagal sebelumnya, bila ada).
- Setiap percobaan dicatat di `ai_usage` (berhasil / gagal + galat, token, perkiraan biaya dari harga model; model "paket" = 0).
- Embedding: `dimensions: 768` selalu dikirim dan hasil diperiksa 768 dimensi.

**Akasha memakai Akai** (6a.4 tahap 1, `apps/akasha/api/src/akai/`):

- Env Akasha `AKAI_URL`, `AKAI_CLIENT_ID` (bawaan `akasha`), `AKAI_CLIENT_SECRET` (= secret klien `akasha` di `AKAI_CLIENTS`),
  `AKAI_WEB_URL` (tautan "Atur di Akai"). Kosong = Akai tidak pernah dipakai. Dev: diisi `npm run setup:dev -w @akai/api`.
- `AiService.generate` & `ocr` bertanya ke Akai lebih dulu (`AkaiService.handles`: status `GET /gateway/v1/status`, cache 30 dtk):
  tugas **chat, general, document, ocr** yang punya model di Akai dijawab gateway Akai (hasil `provider: "akai"`, model = label
  model di Akai, `fallback` bila Akai memakai cadangan). Tugas yang belum diatur di Akai, akun tanpa SSO (`users.sso_subject`
  kosong), dan lampiran audio memakai jalur lama (key di Pengaturan → Model AI). Agen (Hermes), embedding, dan transkrip belum
  lewat Akai.
- Galat Akai: kuota → 429, lainnya → 422 (pesan berawalan "Akai:"); Akai tidak dapat dihubungi → jalur lama bila ada key, selain
  itu 422 "Akai tidak dapat dihubungi".
- Lampiran → format OpenAI (`akai-logic.ts` + test): gambar `image_url`, PDF `file` (Akai menyaring ke model ber-kemampuan PDF dan
  menerjemahkannya ke blok `document` untuk sumber Anthropic), teks disisipkan sebagai teks.
- `GET /ai/settings` membawa `akai { available, reachable, webUrl, tasks }` → kartu **Akai** di Pengaturan → Model AI (tugas mana
  yang dijawab Akai + tombol Atur di Akai). Data user dari `/auth/*` membawa `aiViaAkai` (Umum/Chat punya model di Akai) sehingga
  fitur AI di frontend aktif walau belum ada key di Akasha.

Aturan cadangan dipindah dari Akasha apa adanya (`ai-routing.ts`): kuota/saldo/sibuk/tak terjangkau → model berikutnya; key
ditolak / model tidak ada / permintaan salah → tidak dialihkan (galat terlihat). Galat ke aplikasi: 429 (kuota) / 422 (lainnya),
tidak pernah 401/≥ 502 (aturan §15 Akasha).

## 5. Langkah

| Langkah | Isi                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6a.1    | Kerangka `apps/akai/api`: env, Prisma + DB `akai`, health, akun dari `sub`, klien aplikasi, enkripsi; sumber model (resmi & router) + uji koneksi; katalog `GET /models` (OpenRouter harga, Classai tanpa harga); model yang dinyalakan. Unit + smoke.                                                                                                        |
| 6a.2    | Gateway `chat/completions` & `embeddings` dengan pembagian tugas + cadangan lewat HTTP (format OpenAI / Anthropic, §4); log pemakaian.                                                                                                                                                                                                                        |
| 6a.3    | `apps/akai/web` minimal: masuk SSO + Pengaturan Model (sumber, katalog, model, tugas, pemakaian).                                                                                                                                                                                                                                                             |
| 6a.4    | Akasha memakai Akai. **Tahap 1**: `AiService` memanggil gateway untuk tugas chat/umum/rapikan dokumen/OCR yang diatur di Akai (fitur lama tetap jalan untuk tugas yang belum diatur), kartu Akai di Pengaturan → Model AI. **Tahap 2**: agen & embedding lewat Akai, Pengaturan → Model AI Akasha menjadi tautan ke Akai, lalu modul key lama Akasha dilepas. |
| 6b      | Chat Akai (percakapan, proyek, lampiran, alat MCP Akasha).                                                                                                                                                                                                                                                                                                    |
| 6c      | Loop agen Akai (AK-3), Hermes dipensiunkan bertahap.                                                                                                                                                                                                                                                                                                          |

## 6. Status

| Langkah               | Status                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rancangan & keputusan | ✅ 2026-11-16                                                                                                                                                                                                                                                                                                                 |
| 6a.1                  | ✅ 2026-11-16 — unit 13, smoke 24/24 (router tiruan), migrasi `20261116160000_init` tanpa drift                                                                                                                                                                                                                               |
| 6a.2                  | ✅ 2026-11-16 — unit 23, smoke 37/37 (router tiruan: cadangan saat kuota, key ditolak tanpa cadangan, format Anthropic + stream, gambar, embedding 768, log pemakaian). Belum ke router sungguhan                                                                                                                             |
| 6a.3                  | ✅ 2026-11-16 — Akai web (masuk SSO, tab Sumber / Model / Pembagian tugas / Pemakaian), sesi web + back-channel logout; unit API 29 & web 3, smoke 44/44, smoke SSO lulus, browser (masuk diam-diam, alur penuh, keluar dua arah, 375 px). Dockerfile & nginx Akai web ada; **compose/Caddy produksi belum** (bersama deploy) |
| 6a.4 tahap 1          | ✅ 2026-11-16 — gateway menerima PDF (`file`), unit Akai 30 & Akasha (+8), smoke Akasha penuh, smoke Akai 44/44, sso-smoke, uji ujung-ke-ujung admin dev → Akai → router tiruan (generate lewat Akai, tugas lain jalur lama, pemakaian tercatat app `akasha`), kartu Akai di browser. Belum ke router sungguhan               |
| 6a.4 tahap 2          | berikutnya (agen & embedding lewat Akai, Model AI Akasha → tautan ke Akai)                                                                                                                                                                                                                                                    |

## 7. Rencana 6a.4 tahap 2 (mulai di sini di chat berikutnya)

Prinsip tetap: **per tugas, bertahap** — tugas yang punya model di Akai memakai Akai, sisanya jalur lama, sampai pemilik
memindahkan semua key ke Akai (TODO-USER A44). Urutan yang disarankan:

1. **Embedding lewat Akai** — `apps/akasha/api/src/ai/index/embedding.ts` + `AiService.embeddingCredential`: bila tugas
   `embedding` punya model di Akai (`AkaiService.handles(user, "embedding")`; tambahkan `embedding` ke `AKAI_TASKS` di
   `akai-logic.ts`) → `POST /gateway/v1/embeddings` (Akai sudah memaksa `dimensions: 768` & memeriksa 768). Nama model yang dicatat
   per potongan `ai_chunks` = `akai/<id model Akai>` agar pencarian hanya mencocokkan vektor model yang sama; ganti model = Indeks ulang
   (aturan yang sudah ada). Perlu: `AkaiService.embed(user, texts)` (batasi ukuran batch), uji unit & smoke indeks.
2. **Proxy agen Hermes lewat Akai** — `AgentService.proxyChat` (`apps/akasha/api/src/agent/agent.service.ts`): bila tugas `agent` punya
   model di Akai → teruskan body Hermes ke `POST /gateway/v1/chat/completions` (`task: "agent"`, alat & stream diteruskan). Sebelum itu
   **Akai perlu fitur Claude yang kini ada di Akasha**: prompt caching per blok (`applyCacheMode` di `apps/akasha/api/src/agent/agent-claude.ts`),
   blok pemikiran antar giliran (`ClaudeTurnMemory`), `fallbacks`, stream sungguhan untuk sumber Anthropic (sekarang dijawab utuh lalu
   dikirim sebagai SSE), dan Responses API untuk OpenAI model bernalar (`agent-openai.ts`). Pindahkan logika murni itu ke
   `apps/akai/api/src/gateway/` beserta test-nya; tanpa itu agen Claude lewat Akai kehilangan cache (biaya naik).
3. **Pengaturan → Model AI Akasha** — bila akun punya Akai, kartu Akai menjadi utama dan kartu provider lama dilipat sebagai
   "Pengaturan lama (cadangan)"; frontend `apps/akasha/web/src/features/settings/ai-settings-tab.tsx`. Modul key lama baru dilepas setelah
   pemilik memastikan semua tugas (termasuk agen, embedding) sudah di Akai — **tanyakan pemilik sebelum menghapus**.
4. **Transkrip audio** tetap Gemini langsung (Files API, berkas besar) — tidak dipindah di tahap 2.
5. **Produksi Akai** (bisa digabung dengan tahap D deploy): service `akai-api` & `akai-web` di `docker-compose.prod.yml`, host Caddy
   `AKAI_DOMAIN` (`akai.workingspace.id`), database `akai` di `infra/postgres/init` + `EXTRA_DATABASES` backup, rahasia
   `AKAI_ENCRYPTION_KEY` & `AKAI_CLIENTS` (+ klien OIDC `akai` di `OIDC_CLIENTS` SSO, `generate-prod-secrets.mjs`), env `AKAI_*` backend
   Akasha (alamat internal `http://akai-api:4400`), CSP `nginx.conf` Akai web, CI (image akai-web). Uji dengan stack produksi lokal.

Cara uji yang sudah terbukti (6a.4 tahap 1): router tiruan OpenAI-compatible kecil (`/v1/models`, `/v1/chat/completions`,
`/v1/embeddings`) di port 4499, atur sumber/model/tugas Akai untuk sub SSO admin dev lewat API Akai (HTTP Basic klien `akasha` +
`X-Akai-Subject`), lalu panggil endpoint Akasha sebagai admin (masuk kata sandi lokal dev). Hapus sumber uji & baris `ai_usage` setelahnya.
