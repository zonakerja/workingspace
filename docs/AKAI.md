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
- `POST /gateway/v1/embeddings` — model tugas `embedding` + cadangan (768 dimensi), atau `model` = satu model ber-kemampuan
  embedding tanpa cadangan (aplikasi meminta model yang sama untuk semua batch satu indeks). Jawaban membawa `model` yang menjawab.
- `GET /gateway/v1/status` — per tugas: jumlah model (`models`) + ID model utama (`primary`, urutan pertama yang menyala).

Cara kerja gateway (6a.2, `src/gateway/`):

- Kandidat = `model` (satu model, tanpa cadangan) atau model tugas `task` berurutan (bawaan `general`). Permintaan bergambar
  hanya ke model `vision`, permintaan beralat hanya ke model `tools`; tidak ada yang cocok → 422.
- Semua sumber dipanggil lewat HTTP (`SourcesService.endpointOf`): format `openai` → `{base}/chat/completions` &
  `{base}/embeddings` (sumber resmi Gemini/OpenAI memakai endpoint OpenAI-compatible resminya), format `anthropic` → `{base}/messages`
  dengan terjemahan dua arah (`anthropic.ts`: sistem, peran bergantian, gambar, alat). Tugas selain Agen tidak memakai SDK resmi.
- **Tugas Agen** (`task: "agent"`, 6a.4 tahap 2 langkah 2, `agent-model.service.ts`): jalur native yang dipindah dari proxy agen
  Akasha beserta test-nya (`agent-claude.ts`, `agent-openai.ts`, `claude-models.ts`). Sumber berformat Anthropic → SDK Anthropic
  Messages API: prompt caching penanda per blok (alat, sistem, blok terakhir), blok pemikiran antar giliran disimpan
  `ClaudeTurnMemory` per akun (memori satu proses; hilang saat restart = API menurunkan pemikiran giliran itu), `fallbacks` +
  pengikat blok (`drop_block`), effort eksplisit, **stream sungguhan**; router yang menolak fitur beta diulang sekali dengan
  permintaan dasar; saldo habis (400 "credit balance") = 402 → cadangan. Sumber OpenAI resmi → Responses API (`store: false`; model
  bernalar hanya menerima alat di sana). Sumber lain → jalur OpenAI-compatible biasa, kunci khusus OpenAI (`store`, `metadata`, …)
  dibuang (`withoutOpenAiOnlyKeys`). Galat sebelum stream mulai → cadangan berikutnya (aturan `isFallbackStatus`); setelah stream
  mulai → potongan galat lalu stream ditutup. Token cache dicatat di `ai_usage.cached_tokens`; jawaban membawa `usage` format OpenAI
  + `cache_read_input_tokens`/`cache_creation_input_tokens`.
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
  kosong), dan lampiran audio memakai jalur lama (key di Pengaturan → Model AI). Transkrip belum lewat Akai.
- **Agen (Hermes)** (6a.4 tahap 2 langkah 2): `AgentService.proxyChat` → bila tugas `agent` punya model di Akai,
  `AkaiService.proxyAgent` meneruskan body Hermes ke `POST /gateway/v1/chat/completions` (`task: "agent"`, `model` Hermes dibuang —
  `agentGatewayBody`) dan menulis jawaban apa adanya (stream / JSON); galat Akai 429/422/400 diteruskan sebagai galat OpenAI. Akai tak
  terjangkau sebelum menjawab → jalur lama bila ada key, selain itu 422. `lastModelCall` = provider `akai`, model dari `X-Akai-Model`,
  cadangan dari `X-Akai-Fallback-From`, token & cache dari potongan `usage` (`agentUsage`). `GET /agent/llm/v1/models` & kartu Siapkan
  agen menampilkan model utama tugas Agen di Akai (`AkaiService.primaryModel`).
- **Embedding** (6a.4 tahap 2 langkah 1): `AiService.embeddingCredential` memilih Akai lebih dulu bila tugas `embedding` punya
  model di Akai (`AkaiService.embeddingModel` dari `primary` status) → target `provider: "akai"` dengan `remote` =
  `AkaiService.embed` (batch 50; batch pertama lewat tugas, batch berikutnya meminta `model` yang menjawab batch pertama). Nama
  model per potongan `ai_chunks.model` = **model yang benar-benar menjawab** `akai/<ID model>` (cadangan dicatat apa adanya dan
  di-embed ulang saat model utama kembali); pencarian membandingkan vektor dengan model hasil embedding pertanyaan. Format teks
  mengikuti keluarga model (`textFormatOf`: ID berisi `gemini-embedding` = format tugas Gemini). Ganti model utama di Akai =
  Indeks ulang. Galat → `AiProviderError` (kuota / tak terjangkau / lainnya) seperti jalur lama → potongan tetap tersimpan untuk
  pencarian kata. Tools → Indeks Pengetahuan menampilkan "Akai"; kartu Akai di Model AI memuat baris Embedding.
- Galat Akai: kuota → 429, lainnya → 422 (pesan berawalan "Akai:"); Akai tidak dapat dihubungi → jalur lama bila ada key, selain
  itu 422 "Akai tidak dapat dihubungi".
- Lampiran → format OpenAI (`akai-logic.ts` + test): gambar `image_url`, PDF `file` (Akai menyaring ke model ber-kemampuan PDF dan
  menerjemahkannya ke blok `document` untuk sumber Anthropic), teks disisipkan sebagai teks.
- `GET /ai/settings` membawa `akai { available, reachable, webUrl, tasks }` → kartu **Akai** di Pengaturan → Model AI (tugas mana
  yang dijawab Akai + tombol Atur di Akai). **Akai utama** (6a.4 tahap 2 langkah 3, `isAkaiPrimary`: akun SSO + Akai terjangkau +
  minimal satu tugas punya model di Akai): kartu Akai di atas, semua pengaturan lama (status provider, cadangan otomatis, kartu
  provider, Pembagian tugas AI) dilipat dalam **Pengaturan lama (cadangan)** yang menyebut tugas yang masih memakainya (+ transkrip
  audio, + saat Akai tidak terjangkau). Akun tanpa Akai melihat halaman lama apa adanya. Modul key lama **belum dihapus**. Data user dari `/auth/*` membawa `aiViaAkai` (Umum/Chat punya model di Akai) sehingga
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
| 6b      | Akai seperti Claude: chat, proyek, memori, artifact, alat & konektor (MCP), skill — rincian & status §8. |
| 6c      | Loop agen Akai (AK-3), Hermes dipensiunkan bertahap.                                                                                                                                                                                                                                                                                                          |

## 6. Status

| Langkah               | Status                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rancangan & keputusan | ✅ 2026-11-16                                                                                                                                                                                                                                                                                                                 |
| 6a.1                  | ✅ 2026-11-16 — unit 13, smoke 24/24 (router tiruan), migrasi `20261116160000_init` tanpa drift                                                                                                                                                                                                                               |
| 6a.2                  | ✅ 2026-11-16 — unit 23, smoke 37/37 (router tiruan: cadangan saat kuota, key ditolak tanpa cadangan, format Anthropic + stream, gambar, embedding 768, log pemakaian). Belum ke router sungguhan                                                                                                                             |
| 6a.3                  | ✅ 2026-11-16 — Akai web (masuk SSO, tab Sumber / Model / Pembagian tugas / Pemakaian), sesi web + back-channel logout; unit API 29 & web 3, smoke 44/44, smoke SSO lulus, browser (masuk diam-diam, alur penuh, keluar dua arah, 375 px). Dockerfile & nginx Akai web ada; **compose/Caddy produksi belum** (bersama deploy) |
| 6a.4 tahap 1          | ✅ 2026-11-16 — gateway menerima PDF (`file`), unit Akai 30 & Akasha (+8), smoke Akasha penuh, smoke Akai 44/44, sso-smoke, uji ujung-ke-ujung admin dev → Akai → router tiruan (generate lewat Akai, tugas lain jalur lama, pemakaian tercatat app `akasha`), kartu Akai di browser. Belum ke router sungguhan               |
| 6a.4 tahap 2          | 🚧 langkah 1 **embedding lewat Akai ✅ 2026-11-16** — unit Akasha +5 (embedding.spec, akai-logic), smoke Akai (+3: `primary`, embeddings ber-`model`, tolak model non-embedding), smoke Akasha penuh, uji ujung-ke-ujung admin dev → Akai → router tiruan (catatan uji ter-embed `akai/gemini-embedding-2`, pencarian menemukannya, pemakaian tercatat; data uji dihapus). Langkah 2 **proxy agen lewat Akai ✅ 2026-11-16** — unit Akai 52 (+22: test agent-claude/agent-openai dipindah, `withoutOpenAiOnlyKeys`) & Akasha 536, smoke Akai (+4: Claude native lewat cadangan dengan penanda cache, stream sungguhan, panggilan alat, blok pemikiran dikirim balik), uji ujung-ke-ujung Hermes-endpoint Akasha → Akai → router tiruan Anthropic (stream, cache, alat, pemikiran, status Siapkan agen; data uji dihapus). Responses API OpenAI resmi hanya diuji unit (sumber resmi tidak bisa ditiru). Langkah 3 **Model AI Akasha → Akai utama ✅ 2026-11-16** (pengaturan lama dilipat; browser 1366×768 & 375 px dengan tugas Chat/Umum/Agen uji di Akai, akun tanpa Akai tidak berubah; data uji dihapus). Modul key lama dilepas hanya atas persetujuan pemilik setelah semua tugas di Akai. Langkah 5 **produksi Akai ✅ 2026-11-16**: `akai-api` (Dockerfile baru) + `akai-web` di compose produksi, host Caddy `AKAI_DOMAIN` (hanya `/api/*` + web; `/gateway/*` internal), DB `akai` (`infra/postgres/init/20-akai.sql`) + backup, klien OIDC `akai`, env `AKAI_*` backend, rahasia di `generate-prod-secrets.mjs`, CI & Dependabot, DEPLOYMENT §17. Diuji stack produksi lokal (`akasha-prodtest`, http `*.localhost`): semua service sehat, migrasi Akai jalan, masuk Akai web lewat SSO produksi, backend → gateway lewat jaringan internal 200, `/gateway` lewat Caddy tidak tembus ke API, backup men-dump `akai`; stack uji dihapus. Sisa tahap 2: melepas modul key lama Akasha (menunggu pemilik) |

## 7. Rencana 6a.4 tahap 2 (mulai di sini di chat berikutnya)

Prinsip tetap: **per tugas, bertahap** — tugas yang punya model di Akai memakai Akai, sisanya jalur lama, sampai pemilik
memindahkan semua key ke Akai (TODO-USER A44). Urutan yang disarankan:

1. ✅ **Embedding lewat Akai** (2026-11-16, lihat §4) — `apps/akasha/api/src/ai/index/embedding.ts` + `AiService.embeddingCredential`: bila tugas
   `embedding` punya model di Akai (`AkaiService.handles(user, "embedding")`; tambahkan `embedding` ke `AKAI_TASKS` di
   `akai-logic.ts`) → `POST /gateway/v1/embeddings` (Akai sudah memaksa `dimensions: 768` & memeriksa 768). Nama model yang dicatat
   per potongan `ai_chunks` = `akai/<id model Akai>` agar pencarian hanya mencocokkan vektor model yang sama; ganti model = Indeks ulang
   (aturan yang sudah ada). Perlu: `AkaiService.embed(user, texts)` (batasi ukuran batch), uji unit & smoke indeks.
2. ✅ **Proxy agen Hermes lewat Akai** (2026-11-16, lihat §4) — `AgentService.proxyChat` (`apps/akasha/api/src/agent/agent.service.ts`): bila tugas `agent` punya
   model di Akai → teruskan body Hermes ke `POST /gateway/v1/chat/completions` (`task: "agent"`, alat & stream diteruskan). Sebelum itu
   **Akai perlu fitur Claude yang kini ada di Akasha**: prompt caching per blok (`applyCacheMode` di `apps/akasha/api/src/agent/agent-claude.ts`),
   blok pemikiran antar giliran (`ClaudeTurnMemory`), `fallbacks`, stream sungguhan untuk sumber Anthropic (sekarang dijawab utuh lalu
   dikirim sebagai SSE), dan Responses API untuk OpenAI model bernalar (`agent-openai.ts`). Pindahkan logika murni itu ke
   `apps/akai/api/src/gateway/` beserta test-nya; tanpa itu agen Claude lewat Akai kehilangan cache (biaya naik).
3. ✅ **Pengaturan → Model AI Akasha** (2026-11-16) — bila akun punya Akai, kartu Akai menjadi utama dan kartu provider lama dilipat sebagai
   "Pengaturan lama (cadangan)"; frontend `apps/akasha/web/src/features/settings/ai-settings-tab.tsx`. Modul key lama baru dilepas setelah
   pemilik memastikan semua tugas (termasuk agen, embedding) sudah di Akai — **tanyakan pemilik sebelum menghapus**.
4. **Transkrip audio** tetap Gemini langsung (Files API, berkas besar) — tidak dipindah di tahap 2.
5. ✅ **Produksi Akai** (2026-11-16, DEPLOYMENT §17): service `akai-api` & `akai-web` di `docker-compose.prod.yml`, host Caddy
   `AKAI_DOMAIN` (`akai.workingspace.id`), database `akai` di `infra/postgres/init` + `EXTRA_DATABASES` backup, rahasia
   `AKAI_ENCRYPTION_KEY` & `AKAI_CLIENTS` (+ klien OIDC `akai` di `OIDC_CLIENTS` SSO, `generate-prod-secrets.mjs`), env `AKAI_*` backend
   Akasha (alamat internal `http://akai-api:4400`), CSP `nginx.conf` Akai web, CI (image akai-web). Uji dengan stack produksi lokal.

Cara uji yang sudah terbukti (6a.4 tahap 1): router tiruan OpenAI-compatible kecil (`/v1/models`, `/v1/chat/completions`,
`/v1/embeddings`) di port 4499, atur sumber/model/tugas Akai untuk sub SSO admin dev lewat API Akai (HTTP Basic klien `akasha` +
`X-Akai-Subject`), lalu panggil endpoint Akasha sebagai admin (masuk kata sandi lokal dev). Hapus sumber uji & baris `ai_usage` setelahnya.

## 8. 6b — Akai sebagai asisten seperti Claude (dimulai 2026-11-16)

Pemilik meminta Akai web punya pengalaman setara Claude: chat, **memori**, **skill**, **plugin/konektor**, **artifact**, proyek.
Dibangun bertahap; tiap tahap berdiri sendiri dan memakai gateway yang sama (pembagian tugas + cadangan, log pemakaian).

| Tahap | Isi | Status |
| --- | --- | --- |
| 6b.1 | **Chat inti**: percakapan & pesan tersimpan per akun, sidebar riwayat per tanggal (cari, sematkan, ganti nama, hapus), jawaban stream (tugas `chat` + cadangan atau model pilihan per percakapan), lampiran gambar/PDF/teks (unggah, tempel, seret), salin, ulangi jawaban, judul otomatis (tugas `general`), Markdown (tabel, blok kode + salin) | ✅ 2026-11-16 |
| 6b.2 | **Proyek**: kumpulan percakapan + instruksi tetap + berkas pengetahuan proyek (teks diekstrak, ikut konteks / dicari) | ✅ 2026-11-16 |
| 6b.3 | **Memori**: fakta tentang pengguna yang diingat lintas percakapan (diusulkan model lewat alat `memory`, bisa dilihat/diubah/dihapus pemilik di Pengaturan, bisa dimatikan), ikut prompt sistem | ✅ 2026-11-16 |
| 6b.4 | **Artifact**: model membuat dokumen/kode/HTML/SVG/Mermaid sebagai artifact di panel samping (iframe sandbox, versi, salin/unduh) | ✅ 2026-11-16 |
| 6b.5 | **Alat & konektor (plugin)**: loop alat di Akai (pencarian web lewat provider, memori, artifact), konektor MCP — Akasha (Knowledge, agenda, to-do, … dengan token akses per akun) dan aplikasi MCP lain; izin per konektor seperti Aplikasi MCP Akasha | ✅ 2026-11-16 (konektor MCP + loop alat; pencarian web belum) |
| 6b.6 | **Skill**: kumpulan instruksi + berkas (format SKILL.md, sama dengan skill Hermes) yang dimuat otomatis saat relevan; skill bawaan + buatan pemilik | ✅ 2026-11-17 |

**6b.1 — rincian teknis** (`apps/akai/api/src/chat/`, `apps/akai/web/src/pages/chat-page.tsx`):

- Tabel `conversations` (judul, `model_id` = model pilihan atau null = tugas Chat, `pinned`), `chat_messages` (role, isi, lampiran
  `[{id,name,mimeType,size}]`, model yang menjawab, cadangan, galat, token), `chat_attachments` (berkas di database `bytea`, batas
  gambar 5 MB / PDF 10 MB / teks 1 MB, maks. 5 per pesan; belum dikirim > 1 hari dibersihkan saat unggah berikutnya). Migrasi
  `20261116190000_chat`. Hapus percakapan = permanen beserta lampirannya.
- Endpoint sesi web (`X-Akai-Web` untuk ubah data; aplikasi lewat Basic ditolak 403): `GET|POST /api/chat/conversations`,
  `GET|PATCH|DELETE /api/chat/conversations/:id`, `POST /api/chat/conversations/:id/messages { content, attachmentIds, regenerate }`
  (jawaban `text/event-stream` format OpenAI), `POST /api/chat/attachments` (multipart `file`), `GET /api/chat/attachments/:id`
  (`CSP: sandbox`).
- Pengiriman: `ChatService.send` menyusun riwayat (`buildChatMessages`: prompt sistem Akai + tanggal WIB, jawaban gagal dibuang, peran
  digabung, batas 400 rb karakter, hanya 6 gambar/PDF terbaru dikirim ulang) → `GatewayService.chat` dengan `res` yang di-*tee*: potongan
  diteruskan ke browser sekaligus dikumpulkan, lalu jawaban disimpan setelah stream selesai (juga bila dihentikan / galat — galat
  disimpan di pesan). Judul: sementara dari pesan pertama, lalu judul AI lewat `GatewayService.completion` (tugas `general`).
- Akai web: kerangka baru (sidebar ala Claude; HP = laci), `/` → `/chat`, `/chat/:id?`, Pengaturan Model tetap di `/models`.
- Uji: unit API (chat-logic 6) & web (chat 3), smoke Akai (+13 chat: unggah, tolak jenis, stream + cadangan, simpan, judul, lampiran
  dipakai ulang ditolak, ulangi, kosong, unduh, aplikasi 403, ganti nama/sematkan, hapus). Lokal (SSO aktif) smoke memakai akun dev
  `user@workingspace.id` dengan router tiruan lalu membersihkannya; CI (SSO mati) memakai akun smoke.

**6b.2 — rincian teknis** (`apps/akai/api/src/projects/`, `apps/akai/web/src/pages/project*-page.tsx`):

- Tabel `projects` (nama, deskripsi, instruksi ≤ 20 rb karakter), `project_files` (hanya **teks hasil ekstraksi** — berkas asal tidak
  disimpan; PDF berteks lewat `unpdf`, DOCX lewat `mammoth`, berkas teks; maks. 20 MB per berkas, 500 rb karakter per berkas, 50 berkas
  & ± 2 jt karakter per proyek; PDF hasil scan / berkas kosong ditolak), `conversations.project_id` (hapus proyek = percakapan tetap,
  keluar dari proyek). Migrasi `20261116200000_projects`.
- Endpoint sesi web: `GET|POST /api/projects`, `GET|PATCH|DELETE /api/projects/:id` (detail = berkas + percakapan),
  `POST /api/projects/:id/files` (multipart `file`), `DELETE /api/projects/:id/files/:fileId`; `POST /api/chat/conversations
  { projectId }`, `PATCH … { projectId }` (pindah / keluar proyek); `GET /api/chat/conversations/:id` membawa `project { id, name }`.
- Konteks (`projectContext`, logika murni + test): prompt sistem ditambah nama proyek, `<instruksi_proyek>`, dan `<pengetahuan_proyek>`
  berisi `<dokumen nama>` — **utuh** bila total ≤ 120 rb karakter, selain itu **potongan paling relevan** (± 2 rb karakter per potongan,
  skor kata kunci ber-bobot IDF terhadap pesan pengguna terakhir) sampai 60 rb karakter. Isi dokumen diperlakukan sebagai data. Pencarian
  makna (embedding) menyusul bila Akai punya model embedding.
- Akai web: menu **Proyek** di sidebar, `/projects` (kartu + Proyek baru), `/projects/:id` (mulai percakapan di proyek → `/chat/:id`
  dengan pertanyaan pertama terkirim otomatis, daftar percakapan, instruksi, pengetahuan dengan bar kapasitas & peringatan potongan),
  label proyek di atas percakapan.
- Uji: unit API (project-logic 5), smoke (+11: buat, unggah, tolak gambar, percakapan di proyek, **instruksi & isi dokumen terbukti masuk
  prompt sistem**, detail, label, jumlah, aplikasi 403, hapus berkas, hapus proyek = percakapan tetap), ekstraksi PDF berteks diuji, browser
  (buat proyek → unggah → instruksi → tanya → jawaban dari dokumen dengan Claude Sonnet 5.5; data uji dihapus).

**6b.3 — rincian teknis** (`apps/akai/api/src/memory/`, `apps/akai/web/src/pages/memory-page.tsx`):

- Tabel `memories` (isi ≤ 300 karakter, `source` auto | manual, percakapan asal), `accounts.memory_enabled` (bawaan menyala),
  `chat_messages.memory_updates` (`[{ op: add|remove, content }]`). Maks. 200 memori; 100 terbaru ikut prompt. Migrasi
  `20261116210000_memory`.
- **Pencatatan otomatis** (`MemoryService.learn`, latar belakang setelah jawaban tersimpan, bukan saat Ulangi): pesan pengguna ≥ 15
  karakter + jawaban + memori bernomor → prompt pencatat (`extractionPrompt`) → JSON `{ add, remove }` (`parseExtraction`: maks. 3 baru,
  hapus lewat nomor, buang duplikat & **data rahasia** — kata sandi, PIN, OTP, token/API key, NIK, nomor rekening/kartu, angka ≥ 12 digit).
  Tugas Akai baru **`memory`** "Memori (catat fakta)"; kosong = tugas Umum (akun admin dev: DeepSeek V4.1 Flash → GPT-6 Luna → Haiku 5.5,
  murah karena berjalan setiap pesan).
- **Pemakaian**: `memoryBlock` di prompt sistem semua percakapan (`<memori_pengguna>`, "pakai bila relevan, pesan terbaru menang").
  Memori mati = tidak dicatat & tidak dipakai.
- Endpoint sesi web: `GET /api/memory`, `PATCH /api/memory/settings { enabled }`, `POST|PATCH|DELETE /api/memory[/:id]`,
  `DELETE /api/memory` (hapus semua). Tambah/ubah manual ikut ditolak bila berisi data rahasia.
- Akai web: menu **Memori** (sakelar, tambah, ubah, hapus, hapus semua, asal "Dicatat Akai/Ditambah Anda" + tautan percakapan asal,
  penjelasan privasi); di bawah jawaban penanda **Memori diperbarui** (dibuka = daftar perubahan) dimuat ulang ± 6 dtk setelah stream.
- Uji: unit (memory-logic 5), smoke (+10: tercatat otomatis lewat cadangan tugas Umum, penanda di pesan, dipakai di prompt, tambah/ubah/hapus
  manual, tolak PIN, mati = tidak dipakai, hapus semua, aplikasi 403), browser dengan model sungguhan (fakta uji tercatat 3 memori →
  percakapan baru menjawab "Pak Penguji … menguji aplikasi Akai" dalam poin; data uji dihapus).
- Belum: memori per proyek (sekarang global per akun), memori dari percakapan lama (hanya pertukaran baru).

**6b.4 — rincian teknis** (`apps/akai/web/src/lib/artifacts.ts`, `components/chat/artifact-*.tsx`, `public/artifact-frame.html`):

- Tanpa tabel baru: model menulis `<akai_artifact identifier type title language>…</akai_artifact>` di jawaban (instruksi
  `ARTIFACT_INSTRUCTIONS` di prompt sistem, `apps/akai/api/src/chat/chat-logic.ts`; jenis `markdown | html | svg | mermaid | code`;
  memperbarui = identifier sama + isi lengkap). Web mengurai (`parseArtifacts`, juga tag yang belum selesai saat stream & pembungkus
  ``` yang tetap ditulis model) → kartu di jawaban; versi = urutan identifier yang sama di percakapan (`collectVersions`). Format tag
  disalin di dua tempat — ubah bersamaan.
- Panel samping (layar penuh di HP): Pratinjau / Kode, pindah versi (v n/m), Salin, Unduh (`downloadInfo`: md, html, svg, mmd, ekstensi
  bahasa kode); terbuka otomatis saat model mulai menulis artifact (versi yang sedang ditulis tampil sebagai kode yang bertambah).
- Pratinjau: Markdown; **HTML di iframe `sandbox="allow-scripts"`** (asal buram: tanpa cookie, penyimpanan, atau API Akai) yang memuat
  `/artifact-frame.html` lalu menerima isi lewat postMessage — nginx memberi halaman itu CSP sendiri (skrip sebaris & CDN https,
  `frame-ancestors 'self'`); bila bingkai tidak memberi tanda siap dalam 1,5 dtk → cadangan `srcdoc` ber-sandbox (panel browser Claude tidak
  menjalankan skrip di iframe ber-sandbox yang dimuat lewat jaringan; di produksi srcdoc mewarisi CSP Akai web sehingga skrip sebaris
  diblokir tetapi tampilan tetap); SVG lewat `<img>` data URI (tanpa skrip); Mermaid dimuat malas (`securityLevel: strict`, tema ikut
  aplikasi; `chunkSizeWarningLimit` 1500 kB seperti Akasha).
- Uji: unit web (artifacts 5), API (prompt memuat format), browser dengan model sungguhan: kalkulator HTML → kartu + panel otomatis +
  pratinjau; "ubah jadi hijau" → **versi 2** (v2/2, warna berubah); diagram alur cuti → SVG Mermaid 9 node; HP = panel layar penuh.
  Dua percakapan contoh (kalkulator, diagram) dibiarkan di akun admin dev.
- Belum: artifact React (model diarahkan membuat HTML + pustaka CDN), menyunting artifact langsung, daftar semua artifact lintas
  percakapan, bagikan artifact.

**6b.5 — rincian teknis** (`apps/akai/api/src/connectors/`, `chat/stream-sink.ts`, `apps/akai/web/src/pages/connectors-page.tsx`):

- Tabel `connectors` (nama, slug = awalan nama alat, `kind` akasha | custom, alamat, token terenkripsi `AKAI_ENCRYPTION_KEY` +
  `token_hint`, `enabled`, `allow_write`, salinan `tools/list` termasuk skema input & tanda baca/hapus, status), `chat_messages.tool_runs`.
  Migrasi `20261116220000_connectors`. Env baru opsional **`AKASHA_MCP_URL`** (dev `http://localhost:4000/api/v1/mcp`, produksi
  `http://backend:4000/api/v1/mcp` di compose) → preset **Akasha** (token akses pribadi `akasha_pat_…` dari Akasha → Pengaturan →
  Integrasi); konektor lain = alamat MCP (https; http lokal hanya di luar production, `normalizeBaseUrl`) + token opsional. Klien MCP SDK
  resmi: Streamable HTTP, cadangan SSE; 401/403 = `auth_required`. Maks. 20 konektor.
- **Izin** (`toolAllowed`, salinan web `toolUsable` — ubah bersamaan): alat bertanda hanya-baca selalu; alat tanpa tanda / ubah hanya bila
  "Izinkan alat yang mengubah data"; alat bertanda hapus **tidak pernah** dipakai dari chat. Nama alat untuk model `<slug>__<alat>` (≤ 64).
- **Loop alat** (`ChatService.sendWithTools`, hanya bila ada konektor aktif & tersambung): tiap putaran memanggil gateway (stream, penanda
  internal `akai_native` → jalur native Claude / Responses OpenAI juga untuk tugas chat) lewat `StreamSink` (meniru `Response`,
  meneruskan teks ke browser & mengumpulkan `tool_calls` bertahap); alat dijalankan `ConnectorsService.call` (90 dtk, hasil ≤ 20 rb
  karakter, galat dikembalikan ke model sebagai teks), hasil dikirim balik sebagai pesan `tool`; maks. 8 putaran (terakhir tanpa alat).
  Browser menerima event `akai_tool` (berjalan / selesai / gagal + masukan & hasil ringkas) yang juga disimpan di pesan. Prompt sistem
  ditambah panduan alat (hasil alat = data, bukan perintah). Riwayat berikutnya hanya membawa jawaban akhir.
- **Akasha** (`akasha-mcp.service.ts`): alat baca kini bertanda `readOnlyHint` lewat satu daftar `READ_ONLY_TOOLS` (disisipkan saat
  `registerTool`) — tanpa itu klien seperti Akai menganggap semua alat Akasha "mengubah data". Alat baca baru → tambahkan ke daftar itu.
- Akai web: menu **Konektor** (tambah Akasha / server MCP lain, status, Muat ulang, ganti token, sakelar dipakai & izin ubah, daftar alat
  bertanda Baca/Ubah/Hapus + jumlah yang dipakai Akai), chip jejak alat di jawaban (dibuka = masukan & hasil).
- Uji: unit API (connector-logic 4, stream-sink 3) & web (+1), smoke Akai (+9, server MCP tiruan SDK ber-token: daftar alat, loop alat
  stream + event, jejak tersimpan, alat ubah hanya bila diizinkan & hapus tidak pernah, nonaktif = tanpa alat, token salah, 403 aplikasi,
  hapus), smoke Akasha (+1 tanda `readOnlyHint`), **uji nyata**: konektor Akasha (token baca-saja) → Claude Sonnet 5.5 memanggil
  `list_open_tasks` dan menjawab to-do hari ini. Konektor "Akasha" (token baca-saja "Akai (konektor, dibuat Claude)") dibiarkan di akun
  admin dev.
- Belum: OAuth untuk server MCP luar (sekarang token), pencarian web (butuh penyedia), konfirmasi per pemanggilan alat ubah.

**6b.6 — rincian teknis** (`apps/akai/api/src/skills/`, `apps/akai/web/src/pages/skills-page.tsx`):

- Format **SKILL.md** sama dengan skill Hermes: frontmatter `name` + `description` (satu baris, berkutip, atau blok `>`/`|`), lalu
  instruksi Markdown; berkas pendukung = berkas teks. Logika murni + test `skill-logic.ts` (`parseSkillMd`, `toSkillMd`, `validateSkill`,
  `skillCatalog`, `skillToolResult`, `pickSkills`).
- **Skill bawaan** di kode (`builtin-skills.ts`, nama berawalan `akai-` yang dilarang untuk skill buatan pemilik): naskah dinas, notulen
  rapat, telaahan staf, ringkasan dokumen — tanpa nomor peraturan, pedoman instansi pengguna didahulukan. Dimatikan per akun lewat
  `accounts.disabled_skills`. **Skill buatan pemilik** di tabel `skills` (nama unik per akun, deskripsi ≤ 1.024, instruksi ≤ 30 rb karakter,
  ≤ 10 berkas × 50 rb karakter, maks. 50 skill, path tanpa `..`). Migrasi `20261117090000_skills`.
- **Cara dimuat** (pola Claude): prompt sistem hanya memuat katalog skill yang menyala (`<skill_tersedia>` nama + deskripsi); model
  memanggil alat **`akai__skill`** `{ name, file? }` untuk memuat instruksi (atau satu berkas pendukung) lalu bekerja mengikutinya.
  Alat dijalankan di Akai sendiri lewat loop alat 6b.5 (`ChatService.sendWithTools`), jejak "Skill · nama" tampil & tersimpan di
  `tool_runs` (`connector: "Skill"`). Karena itu chat kini selalu lewat loop alat selama ada skill aktif → daftar model tugas Chat
  disaring ke model **yang mendukung alat**. Bila tidak ada satu pun (model pilihan percakapan tanpa alat), chat jatuh ke jalur lama dan
  maks. 2 skill yang kata kuncinya cocok dengan pesan disisipkan utuh ke prompt sistem (`pickSkills` + `inlineSkills`, tanpa menyimpan pesan
  gagal). Nyalakan kemampuan **Alat** pada model cadangan tugas Chat agar cadangan tidak terlewat.
- Endpoint sesi web: `GET /api/skills` (`{ builtin, custom }`), `GET /api/skills/:id` (+ isi berkas & `skillMd`), `POST /api/skills`
  (`skillMd` dan/atau isian + `files`), `PATCH /api/skills/:id`, `DELETE /api/skills/:id` (permanen), `PATCH /api/skills/builtin/:name
  { enabled }`. Aplikasi (server ke server) 403.
- Akai web: menu **Skill** (Skill saya + Skill bawaan, sakelar, ubah, lihat instruksi bawaan, unduh SKILL.md, hapus), **Buat skill**
  (nama, deskripsi, instruksi, berkas teks), **Impor SKILL.md** (pilih SKILL.md + berkas pendukung sekaligus = folder skill Hermes); chip
  jejak skill di atas jawaban (ikon percikan).
- Uji: unit API (skill-logic 7), smoke Akai (+14: daftar bawaan, 403 aplikasi, sakelar bawaan, buat dari SKILL.md + berkas, ganda 409,
  awalan bawaan & path ditolak, katalog di prompt + alat ditawarkan, skill dimuat lewat alat & instruksinya terpakai, jejak tersimpan,
  model tanpa alat → skill cocok disisipkan, skill mati tidak di katalog, hapus; uji chat lama berjalan dengan skill dimatikan sementara,
  smoke kini menunggu pesan tersimpan), browser: buat skill lewat formulir → chat dengan Claude Sonnet 5.5 memuat skill itu dan mengikuti
  instruksinya; HP 375 px tanpa luberan. Data uji (skill, percakapan, memori yang tercatat) dihapus.
- Belum: berkas biner/skrip yang dijalankan (Akai tidak menjalankan kode skill), skill per proyek, skill bersama antar akun, Hermes
  membaca skill Akai (folder skill Hermes tetap terpisah — pindahkan lewat Unduh/Impor SKILL.md).

**Pengaturan model akun admin dev (2026-11-16, riset harga router.classai.id/model + peringkat November 2026):**

| Tugas | Urutan (utama → cadangan) | Alasan |
| --- | --- | --- |
| Chat & asisten | Claude Sonnet 5.5 → GPT 6.1 Sol → Kimi K3 → DeepSeek V4.1 Flash | kualitas tulisan Indonesia & penalaran, harga separuh Opus |
| Umum | Claude Sonnet 5.5 → GPT-6 Luna → DeepSeek V4.1 Flash → GLM 5.3 | ringkasan/notulen butuh kualitas; cadangan makin murah |
| Rapikan dokumen | DeepSeek V4.1 Flash → Claude Haiku 5.5 → GLM 5.3 → GPT-6 Luna | volume besar, keluaran ± sepanjang masukan → harga keluaran termurah |
| Baca gambar (OCR) | Claude Sonnet 5.5 → GPT 6.1 Sol → Claude Haiku 5.5 → Grok 4.7 | wajib gambar/PDF; akurasi |
| Agen (Hermes) | Claude Opus 5.5 → Claude Sonnet 5.5 → GPT 6.1 Sol → Kimi K3 → GLM 5.3 | agen terbaik + cache; semua cadangan lulus uji alat (Sonnet + alat berfungsi di jalur native, 6b.5) |
| Memori (catat fakta) | DeepSeek V4.1 Flash → GPT-6 Luna → Claude Haiku 5.5 | berjalan setiap pesan → termurah |
| Embedding | — (katalog Classai tanpa model embedding) | tetap jalur Gemini lama di Akasha atau tambah sumber Gemini/OpenAI di Akai |

Claude dipanggil lewat sumber **Classai (Claude · Anthropic)** (format Anthropic: cache, pemikiran, PDF), salinan sumber Classai
OpenAI lewat fitur baru **salin sumber dengan format lain** (`POST /api/sources/:id/clone`, key terenkripsi disalin di server). Model lain
lewat sumber OpenAI. Harga diisi dalam `jt kredit` per 1 jt token (kredit Classai ± Rp150–240 per 1 jt kredit). Uji nyata tiap model
(teks; gambar & alat bila ditandai): semua lulus, kecuali **Claude Sonnet 5.5 + alat lewat format Anthropic di Classai → 502 "gangguan"**
(konsisten 3×) — ternyata hanya di jalur terjemahan lama; di jalur native (agen & chat beralat) Sonnet + alat berfungsi, jadi Sonnet kini cadangan pertama Agen. Grok 4.7 gambar sempat 502 sekali.
