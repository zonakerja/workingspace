# Arsitektur Akasha

Dokumen fondasi: arsitektur, tech stack beserta versinya, dan aturan yang wajib diikuti. **Versi komponen hanya
dicatat di §2** (dokumen lain merujuk ke sini). Rencana & kajian upgrade ada di [UPGRADE-PLAN.md](UPGRADE-PLAN.md).

## 1. Gambaran umum

```
Browser (React SPA)
   │  /api/v1 (JWT Bearer + cookie refresh httpOnly)   dev: Vite proxy · prod: Caddy (HTTPS)
   ▼
NestJS API ──── PostgreSQL (+pgvector)      data domain, user, aset, audit, kredensial AI, indeks RAG (ai_chunks)
   │      ├──── Redis (BullMQ + status)     antrian ekstraksi dokumen & pengindeksan RAG
   │      ├──── S3-compatible storage       berkas upload (SeaweedFS dev / S3, R2, B2 prod)
   │      ├──── Akai API (4400)             gateway model ekosistem: router/key model & pembagian tugas per akun SSO
   │      └──── Provider AI (HTTPS)         Gemini / Claude / OpenAI dengan API key milik user (tugas yang belum diatur di Akai)
   └── Worker ekstraksi & indeks RAG (BullMQ, in-process)
```

Ekosistem workingspace.id (monorepo): SSO `apps/auth` (docs/SSO.md), halaman depan `apps/landing`, Akai `apps/akai/{api,web}`
(docs/AKAI.md), paket identitas visual bersama `packages/ui`.

Prinsip:
- **Satu kontrak data domain** `/records/:type` — frontend menulis per item (upsert/soft delete) dengan ID buatan client;
  backend menyimpannya ke tabel terstruktur per domain.
- **Data terisolasi per user** — setiap baris domain punya `user_id`; setiap user (termasuk `admin`/`super_admin`)
  hanya membaca & menulis datanya sendiri. Akses ke data user lain hanya lewat **berbagi** per item (§3.3) dengan izin
  Lihat / Komentar / Edit. Role hanya mengatur pengelolaan akun & aplikasi (admin melihat statistik, bukan isi data).
- **Secret di server** — tidak ada token/kredensial di storage browser. API key AI milik user disimpan terenkripsi
  di server dan hanya dipakai backend; browser tidak pernah memanggil provider AI secara langsung (§3.1).

## 2. Tech stack & kebijakan dependensi

### 2.1 Komponen dan versi (per 2026-10-10)

Sumber kebenaran versi: `package-lock.json` (root workspace: apps/akasha/api, apps/akasha/web, services/robot), `Dockerfile`, `docker-compose*.yml`, `.nvmrc`,
`.github/workflows/ci.yml`. Tabel ini diperbarui setiap upgrade major.

| Lapisan | Komponen | Versi | Peran / alasan pemilihan |
|---|---|---|---|
| Runtime | Node.js | **24 LTS** (`.nvmrc`; image `node:24-trixie-slim`, Debian 13) | Hanya LTS di produksi; npm 11 bawaan Node |
| Bahasa | TypeScript (backend & frontend) | **6.0** | Satu versi di kedua sisi (keputusan 2026-10-09) |
| Backend | NestJS (`@nestjs/*`) + Express | **12.1** (config/jwt/passport/swagger/mapped-types 12.0, throttler 6.7) + Express 5.2 | Framework modular, DI, guard/pipe, Swagger |
| | Prisma ORM + `@prisma/adapter-pg` (driver `pg`) | **7.10.1** | ORM bertipe; driver adapter tanpa engine Rust (wajib untuk Windows ARM64) |
| | BullMQ / ioredis | **6.3** / **5.11** | Antrian job (ekstraksi, AI) di atas Redis |
| | class-validator / class-transformer | 0.15 / 0.5 | Validasi DTO & env |
| | nestjs-pino / pino | 5.3 / 10.4 | Log terstruktur JSON |
| | `@node-rs/argon2` | 2.2 | Hash password Argon2id, prebuilt arm64 |
| | `@aws-sdk/client-s3` | 3.x | Object storage S3-compatible |
| | `@google/genai` / `@anthropic-ai/sdk` / `openai` | 2.28 / 0.133 / 7.32 | SDK resmi provider AI (dipanggil hanya dari backend, §3.1) |
| | `unpdf` / `mammoth` / `read-excel-file` | 1.8 / 1.13 / 9.3 | Ekstraksi teks PDF / DOCX / XLSX (pure JS, aman ARM64; §3.2) |
| | `@mozilla/readability` / `linkedom` | 0.6 / 0.18 | Teks utama halaman web untuk sumber My Notebook (pure JS; §3.4) |
| | `docxtemplater` / `pizzip` | 3.71 / 3.3 | Mengisi templat DOCX instansi untuk Pengajuan (penanda `${…}`, pure JS; §3.8) |
| | dotenv | 18.0 | Env untuk CLI Prisma & seed (aplikasi memakai `@nestjs/config`) |
| | tsx (esbuild 0.28) | 4.23 | Menjalankan seed TypeScript di development (`prisma db seed`); produksi memakai `dist/` |
| | ESLint / typescript-eslint / Vitest | 10.12 / 8.71 / 5.0 | Lint & unit test |
| Frontend | React / React DOM | **19.3** | UI |
| | Vite / `@vitejs/plugin-react` | **8.3** / 6.1 | Dev server & bundler |
| | React Router / TanStack Query / Zustand | 8.4 / 5.104 / 5.0 | Rute lazy, cache data server, state UI/sesi |
| | react-hook-form / zod | 7.89 / 4.6.7 | Form & validasi skema |
| | Tailwind CSS / shadcn CLI (Radix, lucide) | 4.3 / 4.22 | Design system berbasis token |
| | react-markdown / KaTeX | 10.1 / **0.18.9** | Render Markdown & matematika (dimuat malas) |
| | Mermaid | **12.2.0** | Diagram di catatan Knowledge (dimuat malas, mode ketat) |
| | Tiptap (`@tiptap/*` + `@tiptap/markdown`, MIT) / perfect-freehand | **3.31** / 1.2 | Editor teks kaya + tulisan tangan stylus di Catatan Bebas (dimuat malas); Markdown → dokumen editor (salin dari My Notebook) |
| | CodeMirror (`@codemirror/*` view 6.43, state 6.7, `@lezer/markdown` 1.8, `@lezer/highlight` 1.2, MIT) | **6** | Editor sumber Markdown menu Knowledge (dimuat malas; tanpa `@codemirror/lang-markdown` agar chunk < 500 kB) |
| | react-force-graph-2d (MIT, kanvas, d3-force) | **1.29** | Graf vault menu Knowledge (dimuat malas) |
| | pdf.js (`pdfjs-dist`, Apache-2.0) | **6.4** | Penampil PDF modal halaman publik brankas digital (kanvas; HP & desktop), dimuat malas (chunk `pdf-pages` + worker `.mjs`) |
| | oxlint / Vitest | 1.87 / 5.0 | Lint (0 warning) & unit test |
| Data | PostgreSQL + pgvector | **18** (18.6) + 0.8.7 (`pgvector/pgvector:0.8.7-pg18`, Debian 12; volume `postgres18-data` di `/var/lib/postgresql`) | Data relasional + vector search (RAG) |
| | Redis | **8.10** (`redis:8.10-alpine`) | Antrian BullMQ; cache/rate-limit/sesi chat (rencana) |
| | SeaweedFS | 4.48 | S3-compatible self-host (dev & default produksi) |
| Edge | Caddy / nginx | 2.11 / 1.30 (stable) | HTTPS otomatis + reverse proxy / sajian SPA + CSP |
| Ekosistem (SSO & Akai) | `oidc-provider` (server OIDC SSO, tersertifikasi OpenID) / `openid-client` (klien OIDC Akasha & Akai) / `jose` (verifikasi logout token, cookie alur Akai) / `nodemailer` (email SSO) | 9.13 / 6.8.9 / 6.2 / 10.3 | `apps/auth/api` (docs/SSO.md), masuk SSO di `apps/akasha/api` & `apps/akai/api` (docs/AKAI.md); stack backend/frontend Akai & SSO sama dengan Akasha |
| Monorepo | Turborepo | 2.11.10 | `turbo run lint typecheck test build`, `turbo prune` untuk image Docker |
| Agen | Hermes Agent (`nousresearch/hermes-agent:v0.22.2`, image resmi, amd64+arm64) | 0.22.2 | Service `hermes` (profile `agent`): API server OpenAI-compatible + MCP klien ke Akasha; skill di `apps/akai/agent/skills/` (§3.11) |
| Sinkron vault | Syncthing (`syncthing/syncthing:2.1.6`, image resmi, amd64+arm64) | 2.1.6 | Service `syncthing` (profile `sync`, produksi saja): vault Obsidian laptop/HP ↔ `./knowledge-vaults` VPS (DEPLOYMENT §10); Obsidian tidak berjalan di server |
| Robot | Playwright + Chromium (`mcr.microsoft.com/playwright:v1.63.0-noble`, paket `playwright` **1.63.0** — versi keduanya wajib sama) | 1.63 | Service `services/robot/` (TypeScript, Node bawaan image): browser jarak jauh & eksplor halaman konektor SRIKANDI/e-Kinerja (§3.10) |
| Converter | MarkItDown **0.1.9** + Docling **2.142.1** (Python 3.12, torch CPU 2.14.1, Tesseract `ind`+`eng`, FastAPI/uvicorn; image `services/converter/`, ± 5 GB, amd64+arm64; transitif dikunci `uv --exclude-newer`) | 0.1.9 / 2.142 | Service `converter` (profile `converter`): berkas → Markdown untuk semua fitur AI (§3.14) |
| Backup | rclone (`rclone/rclone:1.75.1`) di image `infra/backup` (base = image postgres) | 1.75 | Cermin object storage via API S3 + salinan luar server terenkripsi (crypt) |
| CI | GitHub Actions | checkout v7, setup-node v7, setup-buildx v4, build-push v7; runner `ubuntu-24.04` | Lint, test, build, smoke, drift, image |

### 2.2 Batasan platform (wajib dijaga)

- **Windows 11 ARM64** untuk development: hanya paket dengan prebuilt win32-arm64, pure JS, atau WASM. Prisma memakai
  driver adapter `pg` (Rust query engine tidak tersedia untuk ARM64).
- **Backend CommonJS**: paket NestJS 12 berformat ESM dimuat via `require(esm)` (Node ≥ 22.12); tsconfig
  `module/moduleResolution: nodenext`. Migrasi ke ESM tidak diperlukan.
- **Prisma Client di-generate**, tidak di-commit: generator `prisma-client` (`moduleFormat = "cjs"`,
  `importFileExtension = ""`) → `apps/akasha/api/src/generated/prisma`, dijalankan oleh `postinstall`. Kode mengimpor dari path
  itu (bukan `@prisma/client`). URL datasource & shadow DB di `prisma.config.ts`.
- Image produksi multi-arsitektur (x86_64/ARM64), dibangun dari source; image pihak ketiga di-pin per minor.

### 2.3 Kebijakan dependensi

- **Pemilihan versi**: hanya rilis stabil (tanpa `-rc/-beta/-next`), dirilis ≥ 2–4 minggu, ekosistem plugin sudah
  mendukung (`peerDependencies`), Node hanya LTS. Instal dengan `npm install --before=<tanggal>`.
- **Dependabot** (`.github/dependabot.yml`): ekosistem npm (backend & frontend), `docker` (Dockerfile),
  `docker-compose` (image infra di `docker-compose*.yml`), dan GitHub Actions. Aturan `ignore` tambahan: nginx minor
  ganjil (mainline) dan versi yang dijadwalkan manual (saat ini KaTeX ≥ 0.19). PR mingguan minor/patch (npm
  dikelompokkan); update **major** diabaikan dan dikerjakan terencana — satu
  keluarga paket per commit, semua test + smoke + drift + image + CI hijau (resep di CLAUDE.md §14).
- **PostgreSQL major** bukan sekadar ganti tag image (butuh dump/restore ke volume baru), dikerjakan terpisah —
  prosedur produksi di [DEPLOYMENT.md §8](DEPLOYMENT.md#8-upgrade-major-postgresql-mis-18--19), data dev di
  [SETUP.md §7.1](SETUP.md#71-upgrade-major-postgresql-data-development). Image `postgres`/`pgvector` dipin per major
  (`-pg18`); Dependabot hanya mengusulkan minor/patch.
- **Overrides npm aktif** (menutup advisory di dependensi transitif; tinjau setiap upgrade paket induknya):

  | Lokasi | Override | Alasan | Hapus bila |
  |---|---|---|---|
  | `apps/akasha/web/package.json` | `katex: "$katex"` (langsung `^0.18.9`) | `rehype-katex`/`micromark-extension-math` masih `^0.16` (advisory prototype pollution < 0.18.2) | keduanya mendukung katex ≥ 0.18 |
  | `apps/akasha/api/package.json` | `multer` → 2.5.0 | `@nestjs/platform-express` 12.1.2 mem-pin `multer` 2.4.0 (advisory high GHSA-q7qp-rjg7-q26m, DoS `fileFilter` asinkron) | `npm view @nestjs/platform-express@<versi> dependencies.multer` ≥ 2.5.0 |

  Override `prisma > mysql2` dicabut 2026-11-09: Prisma 7.10.1 sudah memakai `mysql2` 3.24.4.

  Advisory 2026-10-19–22 `body-parser` ≤ 2.3.0 (via `express`) dan `fast-uri` ≤ 3.1.8 (via `ajv`) ditutup cukup dengan
  `npm update --before=<tanggal>` dalam rentang semver induknya (2.4.0 / 3.1.9) — tanpa override.

## 3. Backend (`apps/akasha/api/`)

NestJS (CommonJS), prefix `api/v1`, port 4000.

| Modul | Tanggung jawab |
|---|---|
| `config` | validasi env saat boot (`env.validation.ts`), parsing durasi |
| `prisma` | `PrismaService` + driver adapter `pg`; client hasil generate di `src/generated/prisma` |
| `redis` | koneksi ioredis & opsi BullMQ |
| `storage` | klien S3 + pembuatan bucket |
| `auth` | login, refresh token berotasi via cookie httpOnly, profil `/auth/me`, ganti password |
| `users` | manajemen akun (admin/super_admin), statistik pemakaian tanpa isi data, direktori penerima berbagi |
| `sharing` | berbagi item antar-user + komentar; `ShareAccessService` menghitung akses untuk `records` & `uploads` (§3.3) |
| `settings` | branding aplikasi (`GET` publik) |
| `records` | API domain generik + audit kearsipan |
| `uploads` / `extraction` | upload berkas, link unduh bertanda tangan, job ekstraksi teks (§3.2) |
| `office` | editor dokumen ONLYOFFICE: config bertanda tangan, link berkas & callback simpan, riwayat 10 versi (§3.5) |
| `ai` | AI multi-provider: pengaturan provider/key/model per user, `POST /ai/generate` (§3.1); indeks pengetahuan RAG `ai/index/` (§3.2) |
| `health` | `/health` readiness (database, redis, storage) · `/health/live` liveness |
| `database/seed.ts` | seed dev (akun demo) / produksi (super admin dari env) |

Lapisan global: Helmet, CORS, `ValidationPipe` (whitelist + forbidNonWhitelisted), `PrismaExceptionFilter`
(P2002→409, P2025→404, P2003→400), Throttler (600/menit; login 10/menit; refresh 30/menit), `TRUST_PROXY` untuk
deployment di belakang reverse proxy. Swagger di `/api/docs` (non-production).

**Observabilitas**: log terstruktur `nestjs-pino` (JSON di production, pretty di development), setiap request punya
`reqId` (header `X-Request-Id`, diteruskan bila dikirim klien), header `Authorization`/`Cookie`/`Set-Cookie` dan token
unduhan disensor; health check tidak dicatat.

### 3.1 AI multi-provider (`src/ai/`)

| Endpoint | Fungsi |
|---|---|
| `GET /ai/settings` | provider aktif, `fallbackEnabled`, daftar provider (label, model default & saran, lampiran yang didukung, `configured`, `keyHint`, `model`) |
| `PUT /ai/settings/:provider` `{ apiKey?, model?, baseUrl?, apiFormat?, embeddingModel? }` | simpan/ganti key (kosong = pertahankan) dan model (`null` = default); `baseUrl` = jalur lewat router (`null` = langsung), `apiFormat` `openai` / `anthropic` (Claude), `embeddingModel` = ID embedding di router; ganti jalur wajib key baru; provider pertama otomatis aktif |
| `DELETE /ai/settings/:provider` | hapus key; bila aktif, pindah ke provider lain yang punya key atau AI nonaktif |
| `PATCH /ai/settings` `{ activeProvider?, fallbackEnabled? }` | ganti provider aktif (harus sudah punya key) / sakelar cadangan otomatis |
| `POST /ai/settings/:provider/test` | uji key & model dengan prompt singkat (10/menit) |
| `POST /ai/generate` (multipart: `prompt` + `files[]`) | jawab prompt → `{ text, provider, model, fallback }` (30/menit) |

- **Lewat Akai lebih dulu** (2026-11-16, `src/akai/`, rinci di `docs/AKAI.md` §4): Akai = backend sendiri ekosistem
  (`apps/akai/api`, port 4400, DB `akai`) yang menyimpan sumber model (router / API key resmi), model yang dinyalakan, dan
  pembagian tugas + cadangan **per akun SSO**. `generate` & `ocr` memanggil gateway Akai (`POST /gateway/v1/chat/completions`,
  HTTP Basic klien `akasha` + `X-Akai-Subject`) untuk tugas chat / general / document / ocr yang sudah punya model di Akai;
  selain itu jalur di bawah (key di Pengaturan → Model AI) tetap dipakai. Agen Hermes, embedding, transkrip belum lewat Akai
  (6a.4 tahap 2). Respons `provider: "akai"`.
- **Jalur lewat router** (`ai-endpoint.ts`): kredensial dengan `base_url` dipanggil lewat router pihak ketiga — format OpenAI
  Chat Completions (`openai-compatible.client.ts`, embedding `/embeddings`) atau Anthropic Messages (SDK Claude + `baseURL`,
  fitur beta yang ditolak router → diulang tanpa fitur itu). Lampiran lewat format OpenAI: gambar, PDF, teks (tanpa audio).
  Alamat wajib https publik di production; label provider menjadi "… lewat <host>".
- **Provider** (`ai-providers.ts` = katalog, satu klien per provider di `providers/`, SDK resmi):
  Gemini `generateContent` (stateless; Interactions API menyimpan percakapan di server Google secara default),
  Claude Messages API (streaming, `effort` + `fallbacks: "default"` pada model yang mendukung), OpenAI Responses
  API (`store: false`). Model default ada di katalog, tetapi **user bisa mengganti model** di Pengaturan → Model AI — bila
  provider menghentikan model, tidak perlu rilis aplikasi.
- **Transkrip audio berkas tersimpan**: `POST /ai/transcribe` + `GET /ai/transcribe/:uploadId` (pekerjaan latar belakang, Gemini langsung, tanpa batas 20 MB di bawah); rekaman WebM dipotong per ± 10 menit.
- **Lampiran**: maks. 5 berkas / 20 MB total, diterima di memori lalu dikirim inline. PDF, gambar (png/jpeg/gif/webp),
  teks (dikirim sebagai teks) untuk semua provider; audio hanya Gemini.
- **Pembagian tugas** (`users.ai_routing`, logika murni `ai-routing.ts` + test): provider per tugas `chat` (asisten
  Akasha & My Notebook), `general` (fitur lain, bawaan `generate`), `ocr` (urutan pilihan → Gemini → OpenAI → Claude,
  kuota/tak terjangkau → berikutnya), `embedding` (Gemini | OpenAI, `index/embedding.ts`, 768 dimensi; pencarian hanya
  membandingkan vektor model yang sama, ganti provider ⇒ indeks dibangun ulang). Kosong = provider aktif / urutan bawaan.
  `generate(userId, prompt, files, task)`; `GET /ai/settings` mengembalikan `routing` + `effective`. **Cadangan per tugas**
  (`chatBackup`, `generalBackup`, `agentBackup`): provider yang dicoba pertama bila provider tugas gagal (berlaku bila cadangan
  otomatis menyala); `effective.<tugas>Backup` = cadangan yang benar-benar dipakai. Proxy agen Hermes mencoba kandidat
  berikutnya (`agentCredentials`) bila gagal sebelum respons dimulai dengan 429/402/408/5xx.
- **Cadangan otomatis** (`users.ai_fallback`, default menyala; logika murni di `ai-routing.ts`): urutan provider =
  provider aktif lalu provider lain yang punya key (urutan katalog); provider yang tidak mendukung semua jenis lampiran
  dilewati (mis. audio saat aktif Claude → Gemini). Kuota habis, provider tidak terjangkau, atau key tidak terbaca →
  provider berikutnya dicoba; key ditolak, model tidak tersedia, permintaan tidak valid, dan penolakan filter keamanan
  **tidak** dialihkan (masalah yang harus diperbaiki user). Respons berisi `fallback: { from, reason, message }` →
  frontend menampilkan toast. Semua gagal → error provider pertama + "Provider cadangan juga gagal". Tanpa cadangan /
  tidak ada provider yang mendukung lampiran → 400 dengan saran. `/test` tidak memakai cadangan.
- **Kredensial**: tabel `ai_credentials` (`UNIQUE(user_id, provider)`), key dienkripsi AES-256-GCM dengan
  `AI_ENCRYPTION_KEY` (format `v1.<iv>.<tag>.<ciphertext>`); API hanya mengembalikan 4 karakter terakhir (`keyHint`).
  Provider aktif di `users.ai_provider`. Kunci enkripsi diganti/hilang ⇒ key tersimpan tidak terbaca (422, user
  memasukkan ulang).
- **Error provider → HTTP**: kuota/limit → 429; key ditolak, model tidak tersedia, ditolak filter keamanan, provider
  tidak terjangkau → 422 dengan pesan Indonesia yang menyebut tindakan (mis. "Ganti model di Pengaturan → Model AI").
  Sengaja tidak memakai 401 (memicu refresh sesi di frontend) maupun ≥ 502 (disamarkan frontend sebagai "server tidak
  dapat dihubungi"). Log mencatat provider, model, durasi, jenis error — tidak pernah key maupun isi prompt.
- **Router yang dipakai pemilik: Classai Router** (`https://router.classai.id/v1`; dikaji 2026-11-13 dari halaman publik `/model`,
  `/kredit`, `/paket`, `/docs`, tanpa perubahan kode). Akun memegang dua jenis saldo pada **semua API key akun yang sama**:
  - **Paket token**: dibeli per model (pemilik: **Claude Opus 5.5**, mis. 23 jt token Rp119 rb), 30 hari, beli lagi = token bertambah &
    masa aktif diperpanjang. **Dipakai lebih dulu.** Token cache dipotong setengah (terbukti di dasbor Usage → "tokens from packages",
    §12 CLAUDE.md 2026-11-07).
  - **Kredit**: satu saldo untuk **semua model** (± 55: Claude, GPT, Gemini, DeepSeek, Kimi, GLM, …), 30 hari, dipotong per token
    sesuai tarif model (contoh per 1 jt token input/output dalam juta kredit: Opus 5.5 53/264, Sonnet 5.5 26/132, Haiku 5.5 11/33,
    `gemini-3.8-flash` 14/56, `gpt-6-sol` 34/110, `deepseek-v4-flash` 7,7/31, `kimi-k3` 20/99, `glm-5.3` 13/62; 1 jt kredit ≈ Rp150–240
    tergantung paket kredit). Cache ditagih 50 %. Request gagal tidak ditagih.
  - Opus 5.5 setelah token paket habis **tetap jalan memakai kredit** (tarif kredit ± 2–3× harga paket) tanpa galat — Akasha tidak
    bisa melihat sisa paket (router membuang angka usage/cache); pantau di dasbor Classai.
  - Format: OpenAI Chat Completions, Anthropic Messages, `/v1/embeddings`, `GET /v1/models`; ID model huruf kecil bertitik
    (`claude-opus-5.5`, `gemini-3.8-flash`, `deepseek-v4-flash`, `kimi-k3`). Batas 60 permintaan/menit per key, 180 per akun (429 +
    `Retry-After` → Akasha menganggapnya kuota → cadangan otomatis). Router = pihak ketiga yang melihat isi permintaan.
  - **Memakai kredit di Akasha tanpa kode baru**: key Classai yang sama boleh dipasang di kartu Gemini dan/atau OpenAI Pengaturan →
    Model AI → **Lewat router** (format OpenAI, ID model diisi bebas). Slot OpenAI lewat router bisa memuat model mana pun yang
    berformat OpenAI (mis. `deepseek-v4-flash`, `kimi-k3`) — labelnya tetap "OpenAI". Batasan jalur router (bukan Classai): transkrip
    audio Notes AI wajib key Gemini langsung; jalur OpenAI-compatible tanpa audio; embedding lewat router butuh ID model embedding yang
    mendukung 768 dimensi (katalog embedding Classai belum dicek).

### 3.2 Ekstraksi dokumen & indeks pengetahuan (RAG tahap 1)

**Ekstraksi** (`extraction/`, job BullMQ `asset-extraction`, berkas ≤ 20 MB, teks ≤ 2 juta karakter). **Bila service
Markdown Converter menyala, berkas dibaca converter lebih dulu** (MarkItDown/Docling → Markdown, hingga `CONVERTER_MAX_MB`,
tanpa token AI; §3.14); pembaca bawaan di bawah ini menjadi cadangan saat converter mati/menolak berkas atau dimatikan user. Pembaca bawaan: teks polos,
PDF berlapis teks (`unpdf`, penanda `[Halaman N]`), DOCX (`mammoth`), XLSX (`read-excel-file`, `[Sheet: …]`, baris
`a | b`). Gambar dan PDF hasil scan (< 10 karakter/halaman) dibaca lewat **Gemini milik pemilik berkas** (OCR); tanpa
key Gemini → `unsupported` (`metadata.reason = needs_gemini_key`). MIME `application/octet-stream` ditebak dari
ekstensi. Logika murni di `text-extractors.ts` (diuji dengan berkas PDF/DOCX/XLSX buatan test). Format kantor lain
(PPTX, ODT, ODP, RTF, DOC, PPT, EPUB, ODS, XLS, …) dibaca lewat **konversi ONLYOFFICE** ke TXT/CSV bila ONLYOFFICE diatur
(`office/office-text-converter.ts`, metode `onlyoffice`; §3.5).

**Indeks** (`ai/index/`): tabel `ai_chunks` = potongan teks (± 1.800 karakter, tumpang-tindih 200) per sumber —
record (17 tipe di `INDEXED_TYPES`, teks generik `key: nilai` dari payload sehingga field baru otomatis ikut) dan isi
berkas (`sourceType = "asset"`) — dengan embedding `gemini-embedding-2` 768 dimensi (format teks
`title: … | text: …` / `task: search result | query: …`).
- **Pemicu**: `PUT/DELETE /records/:type/:clientId` dan ekstraksi selesai → job `ai-index` (BullMQ; deduplikasi per
  sumber, jeda 3 detik, `keepLastIfActive`); hapus berkas → potongannya dihapus. Key Gemini disimpan / sakelar
  dinyalakan / `POST /ai/index/rebuild` → bangun ulang semua sumber (hash per potongan: yang tidak berubah dilewati;
  berkas yang dulu `unsupported` diekstrak ulang). Worker 1 job sekaligus; kuota habis diulang (backoff), key ditolak
  tidak diulang. Status & error terakhir di Redis `ai:index:status:<userId>` (TTL 30 hari).
- **Tanpa key Gemini** potongan tetap disimpan tanpa embedding (`model = "none"`) → pencarian kata persis tetap jalan
  dan tidak ada data dikirim ke luar; embedding dilengkapi saat key tersedia. **Sakelar `users.ai_index_enabled`**
  (default menyala) mati → semua potongan dihapus dan tidak ada yang diindeks.
- **Pencarian** `GET /ai/index/search?q=&limit=`: kemiripan makna (pgvector cosine, indeks HNSW) + kata persis
  (full-text `simple`, indeks GIN — penting untuk nomor arsip/kode) digabung **Reciprocal Rank Fusion**, duplikat isi
  (berkas yang diunggah berulang) dibuang. Gagal embedding pertanyaan → kata kunci saja. `GET /ai/index` = status.
- **Pencarian Pintar** `GET /ai/search?q=&mode=text|meaning` (Ctrl+K → tab Pintar; logika murni + test `smart-search.ts`):
  menemukan item & isi berkas semua modul **tanpa model generatif**. `text` = kata persis + awalan kata (`to_tsquery` dari kata
  yang disaring) + judul memuat kueri (didahulukan), tanpa biaya AI; semua kata tidak ditemukan bersama → cukup salah satu kata.
  `meaning` = ditambah satu embedding pertanyaan. Kandidat dibatasi 2 potongan per sumber (`perSource`, jendela
  `row_number()`, tanpa HNSW) agar dokumen besar tidak memenuhi hasil; hasil satu baris per sumber + modul (resource berstatus
  kearsipan = File Control) + cuplikan (record: nilai bermakna saja, `readableRecordText`). Hanya data milik sendiri; bidang
  aktif **tidak** dipakai (tugasnya menemukan, bukan menjawab). Indeks dimatikan → `indexEnabled: false`.
- **Indeks khusus di migrasi SQL** (tidak bisa dinyatakan di Prisma): HNSW dibuat sebagai **indeks parsial**
  (`WHERE embedding IS NOT NULL`) agar tidak dianggap drift oleh Prisma — query vektor wajib menyertakan kondisi itu;
  GIN berupa indeks ekspresi `to_tsvector('simple', title || ' ' || content)`.
- Pencarian bisa dibatasi ke daftar sumber `(sourceType, sourceId)` (`search(userId, q, limit, only)`) — dipakai My
  Notebook (§3.4). Sumber teks/web notebook diindeks dengan `sourceType = "notebook_source"`.
- Chatbot global `POST /ai/chat` (RAG tahap 2), koleksi & metadata, pemotongan berstruktur: §3.6.

### 3.4 My Notebook (`src/notebooks/`, RAG ala NotebookLM)

Tabel `notebooks`, `notebook_sources`, `notebook_messages`, `notebook_notes` (migrasi `20261014130000_notebooks`;
`notebook_messages.attachments` dari `20261014140000_notebook_message_attachments`); semua milik satu user (tanpa
berbagi — tahap berikutnya). Endpoint `/notebooks` (CRUD), `/:id/sources` (tambah/ubah aktif/
muat ulang web/hapus), `/:id/chat` + `/:id/messages` (riwayat permanen), `/:id/summary` (Studio), `/:id/notes`.
- **Sumber**: `upload` (asset + `asset_extractions`, status ikut ekstraksi), `record` (item milik sendiri: `free_note`,
  `ai_note`, `list`, `para_resource` — resource berkas ikut membaca isi berkasnya), `text` (tempel, ≤ 500 rb karakter),
  `web` (diambil server saat ditambahkan, isi disimpan di `content`).
- **Pengambilan web aman** (`web-source.ts`): http/https saja, tanpa kredensial; IP tujuan diperiksa di lookup DNS saat
  koneksi (tahan DNS rebinding) dan di setiap redirect — loopback, jaringan privat, link-local/metadata cloud, CGNAT,
  multicast ditolak (`net.BlockList`); batas 15 detik, 5 MB, 4 redirect; HTML → Readability + linkedom, PDF lewat
  ekstraktor, teks polos.
- **Chat hibrida** (`notebook-context.ts`, logika murni + test): total teks sumber aktif ≤ 150 rb karakter → semua
  potongan dikirim (mode `full`); lebih besar → 14 potongan terbaik (mode `rag`) dari gabungan RRF pencarian indeks
  (vektor + kata, dibatasi ke sumber notebook lewat `search(…, { only })`) dan peringkat kata kunci di memori (tetap jalan
  bila indeks dimatikan / tanpa embedding). Sumber dipotong dengan `chunkSource` — aturan yang sama dengan indeks AI
  (berkas & teks/web sadar struktur per judul/BAB/Pasal, item Akasha dipotong biasa) sehingga hasil vektor cocok per potongan. Potongan
  bernomor `[n]`; AI wajib menjawab hanya dari sumber dengan sitasi; nomor yang dikutip disimpan sebagai `citations`
  (sumber + cuplikan). 8 pesan terakhir ikut sebagai riwayat; **profil kerja** user (`users.ai_profile`) ikut sebagai
  penyesuai gaya, bukan sumber fakta. Chat & ringkasan Studio memakai provider tugas **`chat`** (Pembagian tugas AI).
- **Lampiran chat**: `fileIds` (maks. 4, milik sendiri): gambar (≤ 10 MB) dikirim ke AI; dokumen (≤ 20 MB) dibaca dari
  teks ekstraksi server (dibatasi 100 rb karakter, tag `<lampiran_pengguna>`), PDF tanpa teks dikirim ke AI sebagai berkas;
  lampiran tidak diberi nomor sitasi. Tersimpan di `notebook_messages.attachments` dan ikut dihapus saat chat dibersihkan /
  notebook dihapus. Hanya berkas context `notebook_chat` yang diterima sebagai lampiran dan yang ikut dihapus.
- **Riwayat**: `GET /:id/messages?take=` mengembalikan pesan terbaru (default 100) + `hasMore`.
- **Dipakai notebook**: `GET /notebooks/usage` (item & berkas sumber milik user); `DELETE /uploads/:id` menolak (409)
  berkas yang masih menjadi sumber notebook agar tidak terhapus dari fitur lain (mis. dokumen Notes AI diganti).
- **Kepemilikan berkas sumber**: berkas yang diunggah lewat notebook (context `notebook`) ikut terhapus bersama sumber /
  notebook; berkas Akasha lain yang dipilih sebagai sumber hanya dirujuk dan tidak pernah dihapus notebook.
- **Studio**: ringkasan JSON (`overview`, `keyPoints`, `questions`) dengan sidik jari sumber → `summaryStale` bila sumber
  ditambah/diubah/dinonaktifkan. Hapus sumber unggahan / notebook → berkasnya ikut dihapus dari storage.

### 3.3 Isolasi data & berbagi (`src/sharing/`)

- **Role**: `super_admin`, `admin`, `member` (role `viewer` dihapus di migrasi `20261011170000_sharing`; akun viewer
  menjadi member). Role tidak memberi akses ke data user lain: `/records`, `/uploads`, `/archive-audit` hanya data
  sendiri + item yang dibagikan. Admin mengelola akun dan melihat `GET /users/stats` (jumlah data, berkas & ukurannya,
  berbagi, aktif terakhir — tanpa isi). Menghapus user ikut menghapus berkasnya dari object storage.
- **Tabel**: `shares` (`owner_id`, `recipient_id`, `record_type`, `record_id` = clientId item induk, `permission`
  `view | comment | edit`, unik per item+penerima) dan `record_comments` (`owner_id` = pemilik item, `author_id`,
  `body`). `assets.uploaded_by_id` = kolaborator yang mengunggah ke ruang pemilik.
- **Item induk yang bisa dibagikan**: `para_project`, `para_area`, `para_resource` (termasuk arsip File Control),
  `free_note`, `ai_note`, `list`, `schedule`, dan item virtual **`schedule_series`** (`record_id` = `seriesId` agenda
  berulang). Akses dihitung saat request (logika murni `share-graph.ts` + test):
  1. **Turunan** ikut dengan izin yang sama: project → action & agenda; area → sub area/kegiatan/sub kegiatan, project
     di area, dan semua task & agenda-nya (`schedules.project_id`); agenda → Notes AI terhubung; seri agenda → semua
     pertemuan dengan `seriesId` itu (filter JSON `extra->seriesId`), masing-masing berstatus **root** (hanya pemilik
     yang menghapus) — pertemuan yang ditambahkan kemudian otomatis ikut. `parentRefsOf` agenda menyertakan
     `["schedule_series", seriesId]` sehingga kolaborator izin edit bisa menambah pertemuan ke ruang pemilik.
  2. **Rujukan** (catatan/resource yang dilampirkan, klasifikasi/JRA/wadah arsip beserta induk wadahnya, agenda dari
     Notes AI) ikut **baca-saja** dan tidak menurunkan turunannya.
  3. **Berkas**: semua `uploadId` (key berakhiran `uploadId`, termasuk gambar editor & berita acara) di payload item yang
     dapat diakses.
- **Records API**: `GET /records/:type` = milik sendiri + item bersama bertanda `share: { ownerId, ownerName,
  permission, root }`. Tulis ke item milik user lain wajib menyebut `userId` pemilik (atau diturunkan dari induk untuk
  item baru: task di project/kegiatan, kegiatan di sub area/area, project di area) dan butuh izin `edit`; item induk
  hanya bisa dihapus pemiliknya. Key `share` yang ikut terkirim dibuang server.
- **Uploads**: baca = pemilik, pengunggah, atau penerima yang dapat mengakses item yang merujuk berkas. Unggah dengan
  `ownerId` (izin edit dari pemilik itu) → berkas milik pemilik item; hapus hanya oleh pemilik atau pengunggahnya.
- **Endpoint**: `GET /shares?recordType=&recordId=` (penerima satu item, pemilik saja), `GET /shares/outgoing`,
  `GET /shares/incoming`, `POST /shares` `{ recordType, recordId, email, permission }`, `PATCH /shares/:id`
  `{ permission }`, `DELETE /shares/:id` (pemilik mencabut / penerima keluar), `GET|POST /comments`
  (`recordType, recordId, ownerId?`; menulis butuh `comment`/`edit`), `PATCH|DELETE /comments/:id` (penulis; pemilik
  item boleh menghapus), `GET /users/directory?q=` (min. 3 huruf, nama + email saja).
- **Cache**: akses baca disimpan 3 detik per user (beberapa koleksi dimuat bersamaan); pemeriksaan tulis selalu
  dihitung ulang; perubahan berbagi mengosongkan cache.
- **Belum**: indeks RAG/chatbot hanya mencari data milik sendiri (item bersama tidak ikut); notifikasi saat item
  dibagikan; tautan publik.

### 3.5 Editor dokumen ONLYOFFICE (`src/office/`, menu Tools → ONLYOFFICE)

Riset, keputusan user, dan tahapan: [ONLYOFFICE.md](ONLYOFFICE.md). Server ONLYOFFICE Docs = container terpisah; berkas
tetap Asset Akasha di object storage.

| Endpoint | Fungsi |
|---|---|
| `GET /office/status` | aktif? (`ONLYOFFICE_URL` diisi), URL server ONLYOFFICE, format yang bisa diedit |
| `GET /office/diagnostics` (admin) | halaman Tools → ONLYOFFICE: server sehat (`/healthcheck`), versi (Command Service `version`), alamat teknis |
| `POST /office/documents` `{ format: docx\|xlsx\|pptx\|pdf \| templateId, title?, context?, ownerId? }` | dokumen kosong dari templat `apps/akasha/api/templates/office/` (A4, id-ID), atau salinan berkas templat (`templateId` = berkas yang boleh dibaca; format selain docx/xlsx/pptx/pdf dikonversi ONLYOFFICE) → Asset seperti upload lampiran (context default `office`; `ownerId` = pemilik item bersama berizin edit) |
| `GET/PATCH /office/preferences` `{ ai: boolean }` | sakelar AI di editor per user (`users.office_ai`) + `aiReady` + provider/model yang menjawab |
| `POST /office/ai/proxy` (token sesi AI di `headers.Authorization` isi permintaan, bukan token login) | proxy tab AI ONLYOFFICE: Chat Completions → `AiService.generate` milik user → jawaban format OpenAI (biasa/SSE); 60/menit; CORS origin apa pun tanpa credentials |
| `GET /office/templates` | templat dokumen milik user (berkas konteks `office-template`, diunggah lewat `/uploads`) |
| `GET /office/fonts` · `POST /office/fonts` (multipart) · `DELETE /office/fonts/:name` (admin) | keluarga font terpasang (`AllFonts.js`) + berkas font tambahan di `ONLYOFFICE_FONTS_DIR` (validasi isi TTF/OTF/TTC); pemantau di image ONLYOFFICE membuat ulang daftar font |
| `GET /office/files/:id/links` · `PUT /office/files/:id/draft` · `GET /office/links?ids=` · `GET /office/link-candidates` | tautan konsep ↔ dokumen final (`assets.draft_id`, ONLYOFFICE.md §3.5) |
| `POST /office/files/:id/forcesave` | simpan paksa sesi edit yang terbuka (Command Service `forcesave`) dan menunggu versi tersimpan (≤ 15 detik) → `saved \| pending \| no-changes \| no-session`; dipanggil saat modal editor ditutup |
| `POST /office/config` `{ uploadId, mode?, mobile?, theme?, appOrigin? }` (frontend selalu `mobile: false`: editor seluler Community hanya bisa melihat) | config `DocsAPI.DocEditor` ditandatangani `ONLYOFFICE_JWT_SECRET` (HS256); AI sesuai pilihan user (lihat butir AI) |
| `GET /office/files/:id/versions` · `GET …/versions/:v` · `POST …/versions/:v/restore` | riwayat versi, unduh versi lama, pulihkan (izin edit) |
| `GET /office/files/:id/content?token=` | dipanggil ONLYOFFICE (`document.url`), token 1 hari |
| `POST /office/callback?token=` | dipanggil ONLYOFFICE saat status dokumen berubah; jawaban `{ error: 0 }` |

- **Hak akses** = akses berkas: pemilik/pengunggah → edit; penerima berbagi → izin item yang merujuk berkas (Edit / Komentar
  / Lihat). Format mengikuti daftar resmi ONLYOFFICE (`office-formats.ts`): `edit` & `lossy` bisa disunting (respons
  config membawa `lossy`), `view` & `mode: view` → baca saja; komentar/tinjau/isi formulir hanya bila format mendukung.
- **Token**: link berkas & callback memakai secret turunan `JWT_ACCESS_SECRET:office` (mengikat ke satu berkas);
  isi callback hanya dipercaya dari JWT ONLYOFFICE (header `AuthorizationJwt`, berisi `{ payload }`). Link berkas hasil
  edit hanya diterima dari host ONLYOFFICE (URL publik dialihkan ke `ONLYOFFICE_INTERNAL_URL`) → mencegah SSRF.
- **Kunci dokumen** `document.key = <assetId>-<assets.office_key>`; berganti saat sesi edit selesai (status 2/4) atau versi
  dipulihkan. Pengguna yang membuka kunci yang sama = edit bersama.
- **Versi** (`assets.version`, `version_author_id`, `versioned_at`; riwayat di `asset_versions`): simpan pertama
  dalam satu sesi (force save tombol Simpan = status 6, atau tutup = status 2) memindahkan isi lama ke riwayat; simpanan
  berikutnya di sesi yang sama menimpa (satu sesi = satu versi). Maks. 10 versi termasuk saat ini; yang lebih lama
  dihapus beserta objeknya. Isi identik tidak membuat versi. Setiap simpan → ekstraksi teks + indeks AI diulang.
  Pulihkan = salin objek versi lama sebagai versi terbaru (tidak ada yang hilang). Hapus berkas/user → objek versi ikut.
  Callback dari **sesi lama** (kunci sudah berganti karena dipulihkan — editor yang ditutup sesudahnya mengirim ulang isinya,
  dibuat ulang ONLYOFFICE sehingga checksum berbeda walau isi sama) hanya masuk **riwayat** tepat di bawah versi saat ini;
  isi saat ini (hasil pemulihan) tidak pernah diganti.
- **AI di editor (satu pintu)**: sakelar mati → `customization.ai.disabled`; aktif → tab AI plugin resmi (dipasang di image
  `infra/onlyoffice/Dockerfile` bersama jembatan `akasha-ai-bridge.js`) dengan `editorConfig.plugins.options[GUID AI] =
  { akasha: { token, proxy, url, … } }`; jembatan mengisi mode pengaturan server plugin (provider "AI Akasha", tanpa tombol
  Settings) sehingga semua permintaan lewat `/office/ai/proxy` memakai provider & key Pengaturan → Model AI. Detail: ONLYOFFICE.md §3.4.
- **Ruang kerja dokumen** (2026-11-15, Tools → ONLYOFFICE → sub-tab **Dokumen**): dokumen dibuat (kosong / templat / impor) dengan
  context `office-workspace` (`OFFICE_WORKSPACE_CONTEXT`) dan **tidak** menjadi Resource Global / File Control. `GET /office/workspace`
  (milik sendiri: nama, format, `target` salinan, versi, waktu simpan, jumlah final tertaut), `PATCH /office/workspace/:id { title }`
  (ekstensi tetap, `renamedDocumentName` + test), hapus = `DELETE /uploads/:id` (Sampah). Working Space memanggilnya lewat form
  Resource/lampiran → **Buat Dokumen (ONLYOFFICE) → Dari Dokumen Saya** = `POST /office/documents { templateId: <dokumen ruang kerja>,
  context }` → **salinan** di context lampiran (dokumen asal tidak tersentuh; salinan diperlakukan seperti dokumen baru: dibuang saat
  form batal). Salinan dipilih (bukan rujukan) agar hapus item/Resource tidak pernah menghapus dokumen ruang kerja.
- **Dokumen tidak hilang saat form ditutup** (2026-11-15): `DELETE /uploads/:id?discard=1` atas berkas milik sendiri yang sudah disunting di
  ONLYOFFICE (`version > 1`, `shouldRescueOnDiscard`) → context menjadi `office-workspace`, respons `kept: true` (frontend menampilkan toast
  dengan tombol Buka). Berkas yang belum disunting tetap dibuang permanen; hapus biasa (Sampah) & pembersihan internal tidak terpengaruh.
- **Alamat backend untuk ONLYOFFICE** (`ONLYOFFICE_BACKEND_URL`): `auto` (dev) = IPv4 antarmuka Windows `vEthernet (WSL…)`
  dibaca setiap membuat config; produksi `http://backend:4000`. Logika murni + test: `office-logic.ts`.

### 3.6 Chatbot Akasha & basis pengetahuan (`src/ai/chat/`, `src/knowledge/`)

> Tambahan 2026-11-06: catatan harian `POST /knowledge/daily` (`KnowledgeDailyService`, `vault-daily.ts`) dan catatan serupa
> `GET /knowledge/notes/:id/similar` (rata-rata vektor `ai_chunks` koleksi `knowledge`, tanpa panggilan AI) — detail CLAUDE.md §8.
> Tambahan 2026-11-07: tugas lintas vault `GET /knowledge/tasks` + `POST /knowledge/tasks/toggle` (`vault-tasks.ts`, format plugin
> Tasks; tulis balik dicocokkan dengan baris asli, berubah → 409) — detail CLAUDE.md §8.
> Tambahan 2026-11-07: Bases `GET|POST /knowledge/bases`, `GET|PUT|DELETE /knowledge/bases/file` (`vault-bases.ts`, berkas `.base`
> Obsidian; filter dievaluasi frontend `base-engine.ts`) — detail CLAUDE.md §8 & §8b.
> Tambahan 2026-11-07: riwayat versi catatan vault — tabel `knowledge_note_versions` (isi sebelum Akasha menimpa + versi terpantau
> saat pindai, maks. 30 per path), `GET /knowledge/notes/:id/versions[/:vid]`, `POST …/:vid/restore` — detail CLAUDE.md §8.
> Tambahan 2026-11-07: Canvas `GET|POST /knowledge/canvases`, `GET|PUT|DELETE /knowledge/canvases/file` (`vault-canvas.ts`, JSON
> Canvas 1.0; tampilan & sunting di frontend `canvas-tab.tsx`) — detail CLAUDE.md §8 & §8b. Isi canvas diindeks RAG sebagai sumber
> `obsidian_canvas` (sourceId = path) lewat `AiIndexService.registerSourceLoader`; catatan berkala `POST /knowledge/daily { period }`.
> Tambahan 2026-11-09: Proxy agen ke OpenAI langsung memakai Responses API (`agent/agent-openai.ts`). Note composer `POST /knowledge/notes/:id/merge|extract|split` (`vault-compose.ts`) — detail CLAUDE.md §8.

Rencana & keputusan: [AI-AGENT.md](AI-AGENT.md) §9–§17 (tahap 1 "fondasi pengetahuan" & tahap 2 "konektor Obsidian").

**Cermin hasil kerja → vault** (`knowledge-export.service.ts`, logika murni `vault-export.ts`): satu arah ke folder
`80-Akasha/` (catatan, List, Notes AI, My Notebook, Working Space) bertanda `sumber: akasha`; dipicu sidik jari tabel tiap menit /
tombol; hanya berkas bertanda yang ditimpa/dihapus; folder ini tidak diindeks ulang (`noteDocument`) dan baca saja di menu
Pengetahuan (`findEditable`). Pengaturan di `users.knowledge_prefs.export`. Endpoint `GET/PUT /knowledge/export`,
`POST /knowledge/export/run`, `DELETE /knowledge/export/files`.

**Koleksi & metadata indeks** (migrasi `20261024120000_knowledge_base`): `ai_chunks.collection` = `knowledge` (catatan
vault Obsidian + berkas vault) atau `workspace` (data kerja: record, berkas biasa, sumber notebook), `ai_chunks.metadata`
(jsonb: `path`, `jenis`, `status` berlaku/draf/dicabut/templat, `publik`, `topik`, `tags`, `diperbarui`). Koleksi &
metadata ikut hash potongan → perubahan status catatan menulis ulang potongannya. `AiIndexService.search(userId, q,
limit, { only?, collections?, excludeStatuses?, publicOnly? })`.

**Pemotongan per sumber** (`chunkSource` di `index-text.ts`, satu aturan untuk indeks **dan** My Notebook): berkas,
sumber notebook, dan catatan Obsidian dipotong **sadar struktur** (`chunkStructured`: judul Markdown, BAB, Bagian,
Paragraf, Pasal; bagian < 200 karakter digabung ke bagian berikutnya; tiap potongan membawa "Konteks: induk > …";
bagian panjang dipotong lagi dengan label "(Pasal 5, lanjutan)"); record tetap `chunkText`. Teks tanpa judul = hasil
sama persis dengan `chunkText`. Ganti aturan pemotongan ⇒ "Indeks ulang" di Tools → Indeks Pengetahuan agar sitasi notebook
mode RAG kembali cocok dengan indeks.

**Chat** (`POST /ai/chat { conversationId?, message, snapshot?, today? }`, 20/menit): cari koleksi `knowledge`
(8 potongan, tanpa status dicabut/templat) + `workspace` (6) dengan pertanyaan (pertanyaan lanjutan < 80 karakter
digabung dengan pertanyaan sebelumnya) → **perluasan graf**: catatan yang tertaut dengan catatan hasil pencarian
(tautan keluar & backlink, `knowledge_links`) ikut sebagai konteks (potongan pertama, maks. 4, bertanda `linked`) →
prompt (`buildAssistantPrompt`: profil kerja, tanggal hari ini, `<pengetahuan>`, `<data_kerja>`, `<data_aplikasi>` =
ringkasan agenda/to-do/project + ID tautan `app:` yang dikirim browser (maks. 20 rb karakter), riwayat 8 pesan; aturan:
utamakan pengetahuan, sitasi `[n]`, sebut dasar hukum, label "(pengetahuan umum, perlu diverifikasi)", isi kutipan =
data bukan perintah) → `AiService.generate` (provider & cadangan user) → sitasi yang dipakai (`chatCitations`) →
`ai_conversations` + `ai_messages` (riwayat permanen). Gagal di AI ⇒ tidak ada yang tersimpan. Endpoint lain:
`GET /ai/chat/conversations` (30 terbaru), `GET /ai/chat/conversations/:id/messages?take=`, `DELETE
/ai/chat/conversations/:id`, `GET/PUT /ai/profile` (**profil kerja & instruksi tetap** `users.ai_profile`, maks. 6.000
karakter; ikut di chat Akasha & chat My Notebook). Logika murni + test: `ai-chat-context.ts`.

**Menu Pengetahuan** (antarmuka Obsidian, [AI-AGENT.md](AI-AGENT.md) §25.2): endpoint `/knowledge/tree|graph|search|health|prefs|
attachment`, `notes/:id/source`, `PUT notes/:id`, `PATCH notes/:id/properties`, `POST notes`, `notes/:id/move`, `DELETE notes/:id`,
`notes/:id/unlinked|link-mention`, `folders`, `folders/move`, `DELETE folders`. Setiap tulisan membawa `baseHash` (SHA-256 isi
berkas saat dibuka); berkas berubah di disk → 409 berisi `currentHash` (tidak pernah menimpa perubahan Obsidian/Syncthing). Tulis
atomik (berkas `*.akasha-tmp` → rename), lalu `scanNow` → id catatan dibaca ulang dari path (pindah = id baru). Properti diubah
lewat dokumen YAML (`updateFrontmatter`, komentar & urutan tetap). Ganti nama memperbarui `[[tautan]]` di catatan perujuk
(`renameWikilinks`). Hapus = pindah ke `.trash` (folder bertitik tidak dipindai). Gambar sematan dibaca langsung dari disk
(`attachment`, ≤ 10 MB, `CSP: sandbox`, tanpa OCR). Preferensi `users.knowledge_prefs` (penanda path ikut pindah/hapus, grup warna
graf). Logika murni + test: `vault-editor.ts`.

**Vault Obsidian** (`KnowledgeVaultService`): env `KNOWLEDGE_VAULTS_DIR` (kosong = nonaktif); vault user =
subfolder `users.knowledge_vault` (nama aman, langsung di bawah root, satu folder satu user). Pemantau `fs.watch`
rekursif (jeda 3 detik) + pindai ulang tiap 10 menit + pindai saat boot; satu pemindaian per user (perubahan selama
memindai → satu pemindaian lanjutan). Berkas `.md` (≤ 2 MB) → `knowledge_notes` (`kind = note`: judul, isi tanpa
frontmatter, frontmatter + tag inline, hash, mtime) + `knowledge_links` (`[[…]]` = link, `![[…]]` = embed, tautan di
properti seperti `dasar_hukum` = property; di dalam kode & folder templat diabaikan) → antrean indeks
`sourceType = "obsidian"`. Berkas PDF/DOCX/XLSX/TXT/CSV (≤ 20 MB) → disalin ke storage sebagai asset konteks
`knowledge_vault` (`kind = file`) → ekstraksi → indeks koleksi `knowledge`; asset ini tidak muncul di `GET /uploads`.
Folder `.obsidian`/tersembunyi dilewati; maks. 5.000 entri. Tautan dicocokkan seperti Obsidian (`buildLinkResolver`:
path lengkap, nama berkas tanpa peka huruf, alias; nama ganda → path terpendek). Status: properti `status`, folder
`00-Inbox` = draf, folder `90-Templat` = templat (tidak diindeks). Endpoint `/knowledge`: `GET status` (jumlah, catatan
bermasalah — tanpa properti/jenis/status —, tautan tak ditemukan), `GET folders`, `PUT vault { folder|null }` (lepas =
catatan, tautan, berkas salinan, potongan dihapus; isi disk tidak disentuh), `POST vault/create { folder }` (salin
templat `apps/akasha/api/templates/knowledge-vault/`), `POST scan`, `GET notes?q=`, `GET notes/:id` (isi + tautan keluar +
backlink), `POST inbox { title, content, question? }` (menulis catatan draf ke `00-Inbox/`, tidak pernah menimpa).
Logika murni + test: `vault-parser.ts`.

### 3.7 Integrasi agen: token akses pribadi + MCP server (`src/integrations/`)

Tahap 3 [AI-AGENT.md](AI-AGENT.md) §18. Agen AI luar (Hermes, Claude Desktop, n8n, OnTrack, …) memakai Akasha lewat
**Model Context Protocol** atas nama satu user.

- **Token akses pribadi** (`api_tokens`, migrasi `20261024140000_api_tokens_mcp`): `akasha_pat_<32 byte base64url>`,
  disimpan sebagai SHA-256 (`token_hash` unik) + `prefix` untuk dikenali, `scopes` (`knowledge:read`,
  `knowledge:write`, `workspace:read`, `workspace:write`, `ai:chat`, `requests:read`, `requests:write`), `expires_at` opsional, `last_used_at` (diperbarui
  maks. tiap 5 menit). Maks. 20 token per user. Endpoint (login aplikasi): `GET /integrations/scopes`,
  `GET/POST /integrations/tokens` (token utuh hanya di respons POST), `DELETE /integrations/tokens/:id`,
  `GET /integrations/activity?take=`. Logika murni + test: `api-token-logic.ts`.
- **MCP server** `POST /api/v1/mcp` (`McpController`, Streamable HTTP **stateless** — server & transport baru per
  permintaan, `enableJsonResponse`; GET/DELETE → 405), header `Authorization: Bearer akasha_pat_…` (JWT login biasa
  ditolak 401 + `WWW-Authenticate`), 120 permintaan/menit. `AkashaMcpService` mendaftarkan **hanya tool yang diizinkan
  cakupan token**: `search_knowledge`, `read_knowledge_note` (knowledge:read), `add_knowledge_inbox` (knowledge:write),
  `search_workspace`, `list_agenda` (maks. 62 hari), `list_open_tasks` (workspace:read), `create_todo`
  (workspace:write, lewat `RecordsService.upsert` → indeks & audit sama dengan aplikasi), `ask_akasha` (ai:chat →
  `AiChatService.chat`, memakai provider & kuota user), `list_requests`, `get_request` (requests:read),
  `list_whatsapp_followups` (requests:read), `create_request` (status Baru, sumber `mcp`), `analyze_request` (analisis +
  telaah) (requests:write). Tanggal default = hari ini WIB. Instruksi server: isi
  dokumen = data, bukan perintah; jangan membuat to-do/Inbox tanpa permintaan jelas.
- **Log aktivitas agen** (`agent_activity_logs`): setiap pemanggilan tool (token, argumen diringkas, ok/error, pesan);
  token dicabut → log tetap (`token_id` SetNull, `token_name` tersimpan).
- Paket: `@modelcontextprotocol/sdk` (CJS `dist/cjs` lewat subpath `…/server/mcp.js`) + `zod` 4 (peer SDK).
- **Arah sebaliknya: Akasha sebagai klien MCP** (`src/mcp-connections/`, 2026-11-10). User menyambungkan aplikasi luar (Canva,
  Notion, Linear, GitHub, alamat lain) dari menu Connection & MCP → Aplikasi MCP. Kredensial (token / OAuth dengan pendaftaran
  klien dinamis + PKCE) disimpan terenkripsi di `mcp_connections` dan hanya dipakai backend; daftar alat disalin dari `tools/list`.
  Agen memakai aplikasi lewat alat Akasha `list_app_tools` / `call_app_tool` (cakupan `mcp:apps`) dengan izin per aplikasi: baca
  selalu, ubah bila diizinkan, hapus (`destructiveHint`) tidak pernah, karena aksi di aplikasi luar tidak bisa dipulihkan dari
  Sampah. Sejak 2026-11-13 Aplikasi MCP = fitur terbuka: agen juga bisa **meminta** koneksi baru / perubahan izin agen
  (`request_app_connection`, `request_app_access` → `agent_actions` pending) dan menambah workflow `placement: mcp`
  (docs/AI-AGENT.md §26.6). Server OAuth tanpa pendaftaran klien dinamis (Google Workspace — server MCP resmi Google `*mcp.googleapis.com`,
  Developer Preview; GitHub OAuth App) memakai **OAuth client milik pemilik** (Client ID + secret terenkripsi + scope di `mcp_connections`), satu
  client dipakai bersama layanan sekelompok. Alat bertanda Hapus bisa diizinkan pemilik satu per satu (`agent_tools`), dan hasil aplikasi
  (tautan ekspor) disimpan agen ke Akasha lewat `save_app_file` — unduhan hanya dari domain aplikasi itu, tanpa jaringan lokal, maks. 50 MB.
  Rincian: CLAUDE.md §8 "Koneksi aplikasi MCP luar".

### 3.8 Pengajuan satker, mesin templat & Antrian Verifikasi (`src/requests/`, menu Pengajuan)

> **Arah 2026-10-31** (`AI-AGENT.md` §22): alur per jenis dokumen (Analisis/Telaah bawaan) akan dikerjakan agen Hermes lewat
> skill; tabel `requests`, Approval (menu Workspace), dan mesin templat tetap, mesin templat diekspos sebagai tool MCP.

Tahap 4 [AI-AGENT.md](AI-AGENT.md) §19. Pengajuan & surat dari pemohon mana pun (satker, instansi, masyarakat; jenis PSP,
penghapusan, pemanfaatan BMN, surat, lainnya) dicatat
manual (UI) atau oleh agen (MCP), dikerjakan AI, lalu **diputuskan user** — semua keluaran AI berstatus konsep.

- **Tabel `requests`** (migrasi `20261024150000_requests`, milik user, bukan record type): `kind`
  (`psp | penghapusan | pemanfaatan | surat | lainnya`), data surat (`applicant` = pemohon, `group_code` = kode grup
  kontak pemohon — kolom lama `satker`/`satker_code` diganti nama di migrasi tahap 5, `letter_number`, `letter_date` YMD, `subject`, `message`, `notes`), `status`
  (`baru → diproses → menunggu_verifikasi → disetujui → dikirim` / `ditolak`), `source` (`manual | mcp | whatsapp`),
  `attachments` (berkas pemohon, upload context `request`), `analysis` (ringkasan, field, kelengkapan, kekurangan,
  saran, sumber persyaratan), `review` + `review_citations` (telaah Markdown bersitasi), `draft_reply` (konsep isi
  surat jawaban), `documents` (berkas hasil templat, context `request-document`), `history` (status, oleh `user` /
  `agen`, catatan). Hapus pengajuan → berkas pemohon & dokumennya ikut dihapus.
- **Endpoint** `/requests`: `GET` (`?status=`), `POST`, `GET/PATCH/DELETE /:id` (PATCH `status` + `statusNote`
  menambah riwayat; `uploadIds` mengganti berkas, yang dilepas dihapus), `POST /:id/analyze`, `POST /:id/review`,
  `GET /templates/:templateId/fields`, `POST /:id/suggest-values`, `POST /:id/documents`,
  `DELETE /:id/documents/:uploadId` (endpoint AI 10/menit).
- **Agen AI** (`requests.service.ts`, prompt & pembaca jawaban murni di `request-logic.ts` + test): teks berkas dari
  ekstraksi server (masih dibaca → 409; jatah 60 rb karakter), persyaratan/ketentuan dari **basis pengetahuan**
  (`AiIndexService.search` koleksi `knowledge`, tanpa status draf/dicabut) → `AiService.generate` tugas `chat` →
  JSON tervalidasi. Analisis mengisi data surat yang masih kosong; status maju otomatis tetapi **tidak pernah mundur**
  dan tidak pernah `disetujui/dikirim` (hanya user).
- **Mesin templat** (`template-engine.ts` + test, `docxtemplater` + `pizzip`): templat DOCX milik user (context
  `office-template`, Tools → ONLYOFFICE → Dokumen → Templat dokumen) dengan penanda gaya SRIKANDI `${nama_isian}` dan paragraf
  petunjuk `[…]` (paragraf yang seluruhnya dalam kurung siku). Penanda SRIKANDI (`jabatan_tujuan*`, `jabatan_pengirim*`, `nama_pengirim*`, `nip_pengirim*`, `nomor_naskah`, `tanggal_naskah`,
  `ttd*`) dan penanda tanpa nilai **dibiarkan utuh**; paragraf petunjuk diganti teks (format paragraf & run pertama
  dipertahankan; teks beberapa baris → beberapa paragraf bergaya sama; kosong → petunjuk tetap tertulis). Usulan nilai
  dari AI (`buildFillPrompt`: data pengajuan, analisis, konsep jawaban, profil kerja) disunting user dulu → dokumen baru
  dibuka di ONLYOFFICE.

### 3.9 Bot WhatsApp (`src/whatsapp/`, menu Pengajuan → Percakapan WA / Grup & Kontak)

Tahap 5 [AI-AGENT.md](AI-AGENT.md) §20. Bot **di dalam Akasha** (bukan Hermes publik) lewat **WhatsApp Business Cloud
API resmi** — agar identitas pengirim (nomor, dijamin tanda tangan Meta) dan **grupnya** (tabel kontak) ditentukan server,
tidak pernah oleh model/isi pesan (AG-20). Grup bersifat umum: satker, instansi, masyarakat umum, internal, lainnya —
bot bisa dipakai untuk layanan apa pun (profil layanan per user).

- **Tabel** (migrasi `20261024160000_whatsapp_bot`): `contact_groups` (kode unik per user, `kind`, hak akses
  `allow_requests` = boleh kirim berkas pengajuan, `share_requests` = lihat status pengajuan seluruh grup),
  `wa_contacts` (nomor internasional tanpa `+`, `group_id`, `verified`, `active`, `last_inbound_at` untuk jendela 24 jam),
  `users.wa_bot` (profil layanan `{ serviceName, topic }`, `botProfile()` mengisi bawaan), `wa_messages` (masuk/keluar,
  status `received | answered | needs_reply | ignored | sent | simulated | failed`, intent, `wa_message_id` unik =
  dedupe webhook, `request_id`, sitasi), `requests.wa_contact_id` (pemohon WhatsApp).
- **Webhook** `GET/POST /api/v1/whatsapp/webhook` (tanpa login, tanpa throttler): isi mentah (`express.raw` di
  `main.ts`) diverifikasi HMAC-SHA256 App Secret → `parseWebhook` → `wa_messages` → antrian BullMQ
  `whatsapp-inbound` (1 percobaan, konkurensi 2). Aktif hanya bila env `WHATSAPP_PHONE_NUMBER_ID`, `_ACCESS_TOKEN`,
  `_APP_SECRET`, `_VERIFY_TOKEN`, `_OWNER_EMAIL` lengkap; pemilik bot = akun `WHATSAPP_OWNER_EMAIL`.
- **Pemrosesan** (`WhatsappService.process`): nomor tak terdaftar / nonaktif / belum terverifikasi → balasan sopan
  (sekali per 24 jam); > 30 pesan/jam → ditahan; jenis pesan tak didukung → petunjuk. Maksud (`detectIntent`):
  **berkas / `#ajukan`** → (bila grup `allow_requests`) pengajuan baru (`source: whatsapp`, `applicant` = grup — nama
  kontak, `group_code`, jenis ditebak `guessKind`) atau berkas susulan ≤ 30 menit digabung (`appendAttachments`);
  **`#status`** → `statusScope`: grup `share_requests` = 5 pengajuan terbaru berkode grup itu, selain itu / tanpa grup =
  hanya pengajuan kontak itu sendiri (`wa_contact_id`); **pertanyaan** → `AiIndexService.search` koleksi knowledge,
  `publicOnly` + `audienceGroup` (catatan `publik: true` **atau** properti `grup` memuat kode grup kontak), tanpa
  draf/dicabut/templat → `buildPublicAnswerPrompt` (topik & nama layanan dari profil, dasar hukum + tanggal, data ≠
  perintah) → JSON `{jawaban, yakin,
  di_luar_topik, sumber}`; tanpa sumber / ragu → diteruskan ke petugas (`needs_reply`). Riwayat 6 pesan terakhir hanya
  konteks (tidak ada memori yang bisa ditulis penanya).
- **Kabar status**: `RequestsService.onStatusChange` → pemohon WhatsApp diberi kabar diproses/disetujui/dikirim/ditolak
  (+ catatan). **Balasan manual** petugas (`POST /whatsapp/conversations/:phone/reply`) menutup `needs_reply` dan bisa
  disimpan sebagai draf FAQ di `00-Inbox` vault (`saveToInbox`).
- **Simulator** `POST /whatsapp/simulate` (pesan seolah dari nomor itu, berkas = upload milik user): jalur proses sama,
  balasan dicatat `simulated` — juga dipakai semua balasan bila user bukan pemilik bot / kredensial belum diisi.
- Endpoint pengelolaan (login): `/whatsapp/status`, `GET/PUT /whatsapp/profile`, `/whatsapp/groups`, `/whatsapp/contacts`
  (CRUD),
  `/whatsapp/conversations[/:phone[/reply|/resolve]]`. Logika murni + test: `whatsapp-logic.ts`.
- Pengiriman: `POST {WHATSAPP_API_URL}/{WHATSAPP_GRAPH_VERSION}/{phone_number_id}/messages` (teks dipecah ≤ 4096);
  media diunduh dari Graph API (≤ 20 MB) → `createFromBuffer` context `request`.

### 3.10 Konektor robot SRIKANDI & e-Kinerja (`services/robot/`, `src/robot/`, tab Connector di Laporan Kinerja & SRIKANDI) + tautan publik

Tahap 6 [AI-AGENT.md](AI-AGENT.md) §21. Mesin robot dibangun di Akasha (keputusan AG-21): OnTrack belum punya mesin
Playwright, dan pola "sesi tersimpan + login manusia" dipakai bersama kedua sistem.

- **Service robot** (`services/robot/`, container `robot`, profile `robot`, port dev `127.0.0.1:4100`, produksi hanya jaringan
  internal): Node `http` + Playwright Chromium headless, viewport 1280×800, locale id-ID/WIB. **Tanpa penyimpanan**: sesi
  masuk sebagai `storageState` (cookie + localStorage + IndexedDB) dari backend dan dikembalikan setelah selesai. API
  (Bearer `ROBOT_TOKEN`): `POST /sessions` (buka browser jarak jauh), `GET /sessions/:id/frame` (JPEG + header url/judul/
  status login), `POST /sessions/:id/input` (klik, ketik, tombol terbatas, gulir, buka alamat, kembali, muat ulang),
  `POST /sessions/:id/capture` (rekam halaman yang sedang tampil, tanpa klik), `POST /sessions/:id/finish` (kembalikan sesi & tutup), `DELETE /sessions/:id`, `POST /check`, `POST /capture`
  (tangkapan layar halaman penuh + `ariaSnapshot`), `GET /health`. Hanya membuka host konektor (+ subdomain, https)
  — `urlAllowed`; tombol yang boleh dikirim dibatasi (tanpa pintasan alat pengembang); sesi menganggur ditutup 10 menit,
  maks. 4 sesi. Status login ditebak `looksLikeLogin` (kolom password terlihat / penanda alamat login). Logika murni +
  test: `services/robot/src/logic.ts`.
- **Backend** `src/robot/`: tabel `robot_connectors` (per user per sistem: alamat, host tambahan, penanda login, status
  `none | active | expired | error`, `session_enc` = storageState terenkripsi AES-256-GCM dengan kunci turunan HMAC dari
  `AI_ENCRYPTION_KEY` — `robotSessionKey`), `robot_runs` (login/check/capture, url, judul, catatan, snapshot aria,
  `screenshot_key` = objek JPEG di object storage `robot/<userId>/<runId>.jpg`, bukan Asset → tidak diekstraksi/OCR).
  Endpoint `/robot/status`, `/robot/connectors[/:system]` (PATCH alamat), `/connectors/:system/login|check|capture`,
  `DELETE /connectors/:system/session`, `/robot/sessions/:id/frame|input|capture|finish` (sesi live dipetakan ke user di memori),
  `/robot/runs[/:id[/screenshot]]`. Klien `robot-client.ts`: robot mati → 422 berpetunjuk. Katalog sistem & batas
  tindakan: `robot-logic.ts` (`SYSTEM_INFO`; SRIKANDI bawaan https://srikandi.arsip.go.id, e-Kinerja diisi user).
  Status juga melaporkan `vault` (brankas aktif).
- **Brankas kredensial & login otomatis** (§21.1 AI-AGENT): `credential-vault.ts` (AES-256-GCM, kunci
  `CREDENTIAL_ENCRYPTION_KEY` khusus, AAD user+sistem+kolom), kolom `username_enc`/`password_enc`/`credential_hint`;
  `POST /robot/connectors/:system/credentials` (wajib `accountPassword` Akasha), `DELETE …/credentials`,
  `POST …/auto-login`, `POST /robot/sessions/:id/answer` (`captcha | otp`). Robot: `POST /sessions/:id/autofill` &
  `/answer` + `login-form.ts` (pengenalan kolom & tombol). CAPTCHA/OTP **tidak pernah** dibaca mesin; rahasia TOTP tidak
  disimpan. Modal informasi setelah login ("berhasil" + OK) ditutup otomatis (`dismissInfoDialog`, aturan `infoDialogButton`);
  modal keputusan tidak pernah ditutup robot.
- **Alur kerja robot** (job `POST /jobs/...` di service robot, dipanggil endpoint backend; detail
  [AI-AGENT.md](AI-AGENT.md) §21.4–§21.12). Semua job membuka konteks baru dari sesi tersimpan, mengembalikan sesi yang
  diperbarui, dan mencatat run (+ tangkapan layar) di Riwayat Connector:

  | Sistem | Job robot | Endpoint backend | Isi |
  |---|---|---|---|
  | e-Kinerja | `/jobs/ekinerja/skp` | `POST /robot/ekinerja/skp/sync` | baca SKP & RHK → record `skp`, `skp_target` |
  | e-Kinerja | `/jobs/ekinerja/renaksi` (`mode: add \| sync`) | `POST /robot/ekinerja/renaksi/fill` | samakan Rencana Aksi bulanan dengan Akasha: baca & impor dulu, tambah butir, tulis ulang baris yang berubah (`dryRun` = Periksa); tidak pernah Kirim Penilaian |
  | e-Kinerja | `/jobs/ekinerja/renaksi/submit` (tanpa `confirm: "KIRIM_PENILAIAN"` selalu dryRun) | `POST /robot/ekinerja/renaksi/submit` | Kirim Penilaian Ke Atasan satu bulan: isi e-Kinerja wajib sama dengan Akasha & lengkap; `dryRun` (bawaan) = tandai tombol tanpa klik; kirim wajib PIN setiap kali, hanya sesi login (bukan agen/jadwal) — `docs/AI-AGENT.md` §21.16 |
  | e-Kinerja | `/jobs/ekinerja/renaksi/read` | `POST /robot/ekinerja/renaksi/sync` | baca semua bulan (status draf/diajukan/dinilai, tanggal pengajuan, rating, isi, feedback) → `action_plan_month` + impor |
  | SRIKANDI | `/jobs/srikandi/outgoing` | `POST /robot/srikandi/letters/sync` | Daftar Naskah Keluar + PDF ber-TTD & lampiran → `srikandi_letter`, Resource Global |
  | SRIKANDI | `/jobs/srikandi/inbox` | `POST /robot/srikandi/inbox/sync` | daftar Naskah Masuk, Tembusan, Disposisi, Koordinasi, Arahan (hanya halaman daftar; detail tidak dibuka agar status baca tetap) → `srikandi_inbox` ([AI-AGENT.md](AI-AGENT.md) §21.14) |
  | SRIKANDI | `/jobs/srikandi/references` (`categories?`) | `POST /robot/srikandi/references/sync`, `…/classifications/sync`, `…/sender-units/sync` | tabel menu Pengguna (7 kategori) / Klasifikasi Arsip (1.048 baris) / **Instansi Pengirim** = pilihan "Dikirimkan melalui" formulir Registrasi yang digulir sampai habis (± 1.470, formulir tidak diisi/disimpan) → `srikandi_reference` |
  | SRIKANDI | `/jobs/srikandi/register` (body ≤ 40 MB, berkas base64) | `POST /robot/srikandi/register/:id { dryRun? }` | isi formulir Registrasi Naskah Keluar dari `srikandi_outgoing` → **Simpan** = konsep di Log Naskah Keluar (tidak ganda); tidak pernah Kirim Konsep |
  | SRIKANDI | `/jobs/srikandi/register/send` (tanpa `confirm: "KIRIM_KONSEP"` selalu dryRun) | `POST /robot/srikandi/register/:id/send { dryRun?, pin? }` | **Kirim Konsep** konsep terdaftar ke verifikator dari halaman Detail Log; bawaan dryRun (tandai tombol, tanpa klik); kirim wajib PIN setiap kali (`PinService.confirmAction`, hanya sesi login) → `draftSentAt` ([AI-AGENT.md](AI-AGENT.md) §21.15) |
  | SRIKANDI | `/jobs/srikandi/register/update` (body ≤ 40 MB) | `POST /robot/srikandi/register/:id/update { dryRun? }` | **Edit** konsep di Log Naskah Keluar: hanya isian yang berbeda (Perbarui Naskah, Tambah/hapus baris lampiran, tujuan, verifikator, penandatangan); konsep terkirim = `locked`; pengenal perubahan `pushedSignature` ([AI-AGENT.md](AI-AGENT.md) §21.13) |

  Pengaman bersama: `safeClick` menolak tombol berteks kirim/ajukan/submit/hapus; pilihan react-select diklik (tidak
  pernah Enter); setiap job memeriksa ulang status login setelah halaman dimuat. Robot tidak pernah menandatangani,
  mengisi CAPTCHA/OTP, atau mengirim hasil akhir.
- **Robot e-Kinerja untuk agen** (`src/robot/ekinerja-agent.service.ts`, logika murni + test `ekinerja-agent-logic.ts`; keputusan
  user 2026-11-12, [AI-AGENT.md](AI-AGENT.md) §26.1): alat MCP cakupan `ekinerja:robot` — `ekinerja_sync_skp`, `ekinerja_monitor_renaksi`,
  `ekinerja_check_renaksi` (`dryRun`) dijalankan **di latar belakang** (tugas robot bisa melebihi batas waktu MCP Hermes 180 dtk) dan
  hasilnya dibaca lewat `ekinerja_status` (riwayat 10 tugas per user di memori satu proses; Ambil SKP & Pantau juga tercatat di riwayat
  Otomasi dengan pemicu `agent`). Pengisian = `ekinerja_request_fill` → baris `agent_actions` kind `ekinerja_fill` (status `pending`,
  `after` = potret entri bulan itu) → pemilik **Setujui & isi** (`POST /agent/actions/:id/approve` → `RobotService.fillEkinerjaRenaksi`
  dengan isi terkini) atau Tolak.
- **Robot SRIKANDI untuk agen** (`src/robot/srikandi-agent.service.ts`, logika murni + test `srikandi-agent-logic.ts`; keputusan user
  2026-11-13, [AI-AGENT.md](AI-AGENT.md) §26.4): alat MCP cakupan `srikandi:robot` — `srikandi_sync_letters`, `srikandi_sync_references`
  (`classifications`), `srikandi_check_register` (`dryRun`) di latar belakang, dibaca lewat `srikandi_status`. Pendaftaran =
  `srikandi_request_register` → `agent_actions` kind `srikandi_register` (pending, `after` = ringkasan entri) → **Setujui & daftarkan**
  (`RobotService.registerSrikandiOutgoing` dengan isi terkini, berhenti di Simpan) atau Tolak. Workflow agen `placement: "srikandi"` →
  tab SRIKANDI → Workflow.
- **Robot SIMAN untuk agen** (`src/robot/siman-agent.service.ts`, logika murni + test `siman-agent-logic.ts`; keputusan user 2026-11-13,
  [AI-AGENT.md](AI-AGENT.md) §26.5): alat MCP cakupan `siman:robot` — `siman_check_session` (Jaga sesi) & `siman_read_page` (buka satu alamat
  SIMAN, rekam struktur teks tanpa klik; alamat keluar/hapus/kirim/unggah ditolak) di latar belakang, dibaca lewat `siman_status`. Belum ada
  jalur tulis ke SIMAN. Workflow agen `placement: "siman"` → tab SIMAN → Workflow.
- **Usulan renaksi** (`src/robot/renaksi-proposals.service.ts`, logika murni + test `renaksi-candidates.ts`, [AI-AGENT.md](AI-AGENT.md) §26.2):
  kegiatan bulan itu dari Working Space (task/agenda/kegiatan) + SKP & RHK → MCP `ekinerja_renaksi_context`; `ekinerja_propose_renaksi` menyimpan
  `action_plan_entry` bertanda `proposed: true` yang tidak pernah diisikan robot sampai pemilik mencentangnya. Run Hermes dari tombol:
  `POST /agent/ekinerja/renaksi { period }` (skill `renaksi-ekinerja`, tombol "Generate usulan"). **Filter cakupan**: `GET|PUT /robot/ekinerja/renaksi/scope`
  = daftar pengecualian `area:`/`project:`/`loose` di `users.ekinerja_prefs.renaksiExcluded`, disaring di server untuk daftar & agen (§26.3 AI-AGENT).
- **Tautan publik berkas** (`src/uploads/public-links.ts`, tabel `public_links`): `POST/GET /uploads/:id/public-links`
  (pemilik berkas saja; token `lp_<32 byte>` tampil sekali, disimpan hash SHA-256, masa berlaku opsional),
  `DELETE /public-links/:id`, publik `GET /api/v1/public/files/:token` (header sama dengan unduhan: CSP sandbox,
  konten aktif dipaksa attachment, + `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`; hitung akses). Token di
  path disensor dari log request. Dipakai sebagai "link dokumen" e-Kinerja.
- **Brankas digital** (`src/uploads/public-vaults.ts`, logika murni + test `vault-logic.ts`; tabel `public_vaults`,
  `public_vault_files`, `public_vault_accesses`): bukti data dukung **satu poin renaksi = satu tautan** berisi beberapa berkas
  yang terisolasi (token hanya membuka berkas brankas itu). Pemilik: `POST /vaults { title, entryId?, assetIds }` (hanya berkas
  milik sendiri, maks. 30; path `/brankas/bv_<token>` tampil sekali, token disimpan hash), `GET /vaults`, `GET/PATCH/DELETE
  /vaults/:id` (ganti berkas = tautan tetap), `POST /vaults/:id/rotate` (tautan baru, lama mati), `GET /vaults/:id/accesses`.
  Publik (tanpa login, 60/menit): `GET /public/vaults/:token` (isi + catatan akses pengunjung sendiri) dan
  `GET /public/vaults/:token/files/:fileId?download=1` (header unduhan aman + noindex). **Setiap pembukaan, lihat, & unduh
  dicatat**: waktu, IP (`req.ip`; produksi `TRUST_PROXY=true` di belakang Caddy), perkiraan lokasi dari IP (env
  `GEOIP_PROVIDER` = `ipapi` bawaan — layanan ipapi.co tanpa key, IP pengunjung dikirim ke sana, cache 24 jam, timeout 2,5 dtk,
  IP lokal/privat tidak dicari; `none` = hanya IP), peramban, dan **asal pembuka** (tahap 1 pembatasan tautan, 2026-11-12: halaman
  brankas mengirim `document.referrer` sebagai `?ref=`; disimpan hanya origin di `public_vault_accesses.referrer` — `""` = tanpa asal / ditempel,
  NULL = baris lihat/unduh atau catatan lama; log menandai e-Kinerja dari host konektor pemilik (`referrerOrigin`, `referrerLabel`); belum memblokir). Berkas brankas tidak bisa dihapus dari fitur lain
  (`DELETE /uploads/:id` → 409). Entri renaksi yang dihapus menghapus brankasnya (frontend; entri ber-tanda hapus dihapus server
  setelah Kirim perubahan, `removeForEntry`). Brankas dihapus / berkas dikeluarkan (`PATCH assetIds`) → unggahan khusus brankas
  (context `renaksi-vault`) milik pemilik yang tidak dipakai brankas lain ikut dihapus (`vaultFilesToRelease` + test); lampiran
  item dan berkas lain tidak disentuh. Cache lokasi IP maks. 1.000 IP. Halaman publik SPA `/brankas/:token` (`features/vault/public-vault-page.tsx`) memuat
  **Pemberitahuan Pelindungan Data Pribadi** (UU 27/2022 Pasal 65 jo. 67, hanya untuk atasan/penilai/PPK) + pemberitahuan
  pencatatan akses beserta IP/lokasi/peramban pengunjung itu. **Lihat** = modal pratinjau (`vault-file-viewer.tsx`): berkas
  diambil sebagai blob (tercatat "lihat"), PDF digambar pdf.js ke kanvas (`pdf-pages.tsx`, maks. 60 halaman), gambar
  langsung, jenis lain hanya Unduh — tanpa tab baru/unduhan (respons berkas ber-CSP sandbox membuat penampil PDF bawaan
  Chrome mengunduh, dan iframe PDF tidak tampil di HP).

### 3.11 Asisten Agen — Hermes (`src/agent/`, `features/agent/`, service `hermes`)

[AI-AGENT.md](AI-AGENT.md) §22–§23. Hermes (Nous Research) berjalan sebagai container (profile `agent`) dengan API server
OpenAI-compatible (port 8642, Bearer `API_SERVER_KEY` = `HERMES_API_KEY` backend) dan klien MCP ke Akasha (`akasha-api:4000`,
token akses pribadi pemilik di `/opt/data/.env`). Backend `AgentService`: status (`/health`), skill (folder repo
`HERMES_SKILLS_DIR` + skill bawaan dari `/v1/skills` bila berfungsi), chat & skill sebagai **run** asinkron (`POST /v1/runs`
{ input, session_id } → `GET /v1/runs/:id`), hanya untuk `HERMES_OWNER_EMAIL`. Agen bekerja lewat alat MCP (§3.7) sehingga
isolasi data, log aktivitas, dan aturan "agen tidak memutuskan" berlaku sama. Data Hermes (model, memori, sesi) di volume
`hermes-data`, bukan database Akasha.

### 3.12 Otomasi terjadwal (`src/automation/`, tab Connector Laporan Kinerja & SRIKANDI)

Jadwal sinkron robot **baca-saja** per user: e-Kinerja (Ambil SKP & RHK, Pantau Rencana Aksi) dan SRIKANDI (Daftar Naskah
Keluar, referensi, klasifikasi arsip). Pengisian Renaksi & pendaftaran naskah **tidak** bisa dijadwalkan.
- **Sumber kebenaran** = tabel `automation_jobs` (satu baris per user per jenis, `schedule` jsonb terstruktur: `daily`
  (jam + hari) / `hourly` (menit, jam mulai–selesai, hari) / `cron` (menit harus satu angka) + zona waktu WIB/WITA/WIT;
  baris bawaan dibuat nonaktif dengan jadwal bawaan). Logika murni + test `automation-logic.ts` (`parseSchedule`, `toCron`,
  `DEFAULT_SCHEDULES`). Semua bentuk dibatasi **paling sering sekali per jam**.
- **Pelaksana** = BullMQ (bukan n8n / cron OS): antrian `automation`, job scheduler `auto:<userId>:<kind>` (pola cron + `tz`),
  disamakan dengan tabel saat backend start (`reconcile`). Worker **concurrency 1** untuk semua user, satu percobaan (tidak
  mengulang otomatis ke sistem pemerintah), `lockDuration` 10 menit.
- **Kunci per user + sistem** di `RobotService.exclusive` (memori, satu proses backend): tugas kedua pada sistem yang sama
  ditolak 409 — tombol saat jadwal berjalan mendapat pesan "sedang menjalankan …", jadwal yang bertabrakan dicatat
  **Dilewati**. Pengisian Renaksi & pendaftaran naskah ikut memakai kunci yang sama.
- **Pemicu**: jadwal (`schedule`), "Jalankan sekarang" (`manual`, lewat antrian yang sama) dan tombol sinkron di menu asal
  (`button`, tetap sinkron seperti sebelumnya; dicatat lewat kait `RobotService.onJobFinished`). Riwayat `automation_runs`
  (50 terakhir per jenis), ringkasan terakhir di `automation_jobs.last_*`. Run "berjalan" saat backend restart → gagal.
- API: `GET /automation/jobs`, `PATCH /automation/jobs/:kind { enabled?, schedule? }`, `POST /automation/jobs/:kind/run`
  (202), `GET /automation/runs?kind=&take=`.
- Frontend: `features/tools/automation/` (`AutomationJobs systems` = kartu Cara kerja otomasi + jadwal per sistem di sub-tab Otomasi terjadwal tab
  Connector Laporan Kinerja & SRIKANDI; sub menu Tools → Otomasi dihapus 2026-11-06), hook `data/use-automation.ts` (poll 3 dtk selama ada run aktif; run selesai →
  record terkait dimuat ulang, `KIND_RECORDS`).
- **Sesi**: `storageState` disimpan terenkripsi di `robot_connectors` dan diperbarui setiap tugas robot (`saveState`). Jenis
  `*_session` (**Jaga sesi login**) membuka sistem dengan sesi tersimpan agar cookie diperbarui dan sesi habis cepat diketahui.
  Sesi belum ada / kedaluwarsa → worker **melewati** tugas sistem itu (tidak membuka halaman login berulang kali) sampai user
  login ulang (CAPTCHA/OTP tetap diketik user).
- **Notifikasi**: `GET /automation/alerts` (`automationAlerts`: sesi kedaluwarsa, jadwal aktif tanpa sesi, tugas aktif gagal)
  → bagian **Robot & Otomasi** di lonceng, toast sekali per kejadian, dan notifikasi browser bila diizinkan.
- Syarat berjalan: backend + Redis + service robot menyala pada jam jadwal dan sesi Connector masih berlaku.

### Keamanan
- **Access token** JWT 15 menit, dikirim via header `Authorization`, hanya disimpan di memori frontend.
- **Refresh token** JWT (`jti` = `refresh_tokens.id`, DB hanya menyimpan hash SHA-256) dikirim sebagai cookie
  `akasha_rt` — `httpOnly`, `Secure` (production), `SameSite=Strict`, path `/api/v1/auth`. Saat aplikasi dibuka,
  frontend memulihkan sesi lewat `POST /auth/refresh`.
- Rotasi setiap refresh; token hasil rotasi yang dipakai lagi setelah 30 detik (toleransi multi-tab) dianggap
  pencurian → semua sesi user dihapus. Logout, ganti password (sesi lain), dan perubahan password/role oleh admin
  menghapus sesi. Token kedaluwarsa dibersihkan saat login.
- Password Argon2id (`@node-rs/argon2`).
- Berkas upload: diterima ke disk sementara lalu di-stream ke object storage (tidak ditampung di RAM); disajikan dengan
  `Content-Security-Policy: sandbox`, konten aktif (HTML/SVG/JS) dipaksa diunduh. Link unduh memakai secret turunan
  (`JWT_ACCESS_SECRET:download`), berlaku 10 menit, tidak bisa dipakai login.

### 3.13 Sampah & aksi agen (`src/trash/`, `src/agent-actions/`, Tools → Sampah, AI Agent → Riwayat Aksi)

Semua penghapusan (user maupun agen) masuk tabel `trash_items` dan bisa dipulihkan selama 30 hari; pembersihan otomatis tiap 6 jam
menghapus permanen yang kedaluwarsa. Hapus beruntun oleh pelaku yang sama dalam 20 detik = satu kelompok (dipulihkan bersama).

| Jenis | Saat dihapus | Saat dipulihkan | Dihapus permanen |
|---|---|---|---|
| Record domain | `deleted_at` (seperti sebelumnya) + entri | `deleted_at` dikosongkan, diindeks ulang | baris dihapus |
| Berkas | baris + versi + hasil ekstraksi + tautan publik disalin, baris dihapus, objek storage tetap | baris dibuat ulang dengan ID sama, teks hasil baca dipasang lagi (tanpa OCR) | objek storage dihapus |
| Pengajuan | baris disalin, berkasnya ke Sampah (kelompok sama) | baris dibuat ulang | — |
| Notebook | notebook + sumber + catatan + chat disalin, berkas unggahan ke Sampah | dibuat ulang, sumber teks diindeks ulang | — |
| Catatan/folder/base/canvas vault | tetap `.trash` vault + entri | dipindah kembali (nama terpakai → "(pulihan)") | dihapus dari `.trash` |

Tidak masuk Sampah: centang rutinitas & log (`NO_TRASH_RECORD_TYPES`), hapus oleh sinkron robot, dan unggahan yang belum pernah disimpan
(`DELETE /uploads/:id?discard=1`).

**Aksi agen**: alat MCP umum (`describe_record_types`, `list_records`, `get_record`, `create_record`, `update_record`,
`request_delete_record`) menulis lewat `RecordsService` dan mencatat `agent_actions`. Buat/ubah langsung berlaku dan bisa dibatalkan
(isi sebelumnya disimpan; ditolak bila data sudah berubah lagi kecuali dipaksa). Hapus hanya permintaan; disetujui pemilik = item +
turunannya (+ berkas miliknya yang tidak dipakai data lain) masuk Sampah bertanda agen. Setiap hapus yang masuk Sampah mengembalikan
`batchId`; frontend menampilkan notifikasi "Pulihkan" untuk kelompok itu (`lib/trash-toast.ts`). Jenis hasil sinkron robot & log hanya bisa dibaca agen.

### 3.14 Markdown Converter (`services/converter/`, `src/converter/`, Tools → Markdown Converter)

Tujuan: AI tidak membayar token untuk **membaca** berkas. Berkas diubah sekali menjadi Markdown di server sendiri, disimpan di
`asset_extractions.extracted_text`, lalu dipakai ulang oleh semua fitur (ringkasan AI Resource & lampiran, Notes AI, My Notebook,
chatbot & Pencarian Pintar lewat indeks RAG, Approval, alat MCP agen Hermes, berkas PDF vault Obsidian). Markdown juga membuat
pemotongan indeks lebih baik (`chunkStructured` memakai judul).

**Service `services/converter/`** (Python, FastAPI, satu proses, tanpa penyimpanan; dev `127.0.0.1:4200` profile `converter`, produksi
`http://converter:4200` tanpa port publik). `POST /convert` (Bearer `CONVERTER_TOKEN`, multipart `file`, `filename`, `mime_type`,
`mode` auto|markitdown|docling, `pdf_mode`) → `{ markdown, engine, reason, pages, chars, tokens, warnings, durationMs, fallbackFrom }`;
`GET /health` (tanpa token) = versi mesin, bahasa OCR, `ready` (model Docling sudah dimuat; pemanasan di latar saat start).
Logika murni + pytest `services/converter/app/logic.py` (`tests/test_logic.py`, dijalankan di image):
- **Pembagian mesin** (`choose_engine`): gambar (PNG/JPG/WEBP/GIF/BMP/TIFF; selain PNG/JPG diubah ke PNG) **selalu Docling** (OCR
  Tesseract `ind,eng`, `force_full_page_ocr`); dokumen teks (DOCX, XLSX, XLS, PPTX, EPUB, MSG, HTML, CSV, JSON, XML, TXT/MD)
  **MarkItDown**; **PDF** `auto` = profil pypdfium2 (`pdf_profile`): ada halaman < 20 karakter (scan) → Docling; ≥ 25 % halaman berisi
  gambar ≥ 10 % luas halaman (grafik/foto, bukan logo kop) → Docling (kecuali > `DOCLING_MAX_PAGES` 200 halaman); selain itu
  MarkItDown. MarkItDown menghasilkan PDF kosong → diulang dengan Docling. Mesin pilihan gagal pada format yang dikenal keduanya
  (`BOTH_ENGINES`) → mesin lain (`fallbackFrom`).
- **Hemat token** (`compact_markdown`): gambar data URI & penanda `<!-- image -->` dibuang, spasi pengisi sel tabel dirapatkan, kepala
  tabel kosong (DOCX tanpa header) diganti baris pertama, baris kosong beruntun dirapatkan, dan **tabel palsu** dikembalikan menjadi
  teks (`_flatten_fake_tables`: paragraf rata kiri-kanan PDF peraturan yang dibaca pdfplumber MarkItDown sebagai tabel `| | Peraturan | |`;
  ciri ≥ 30 % sel kosong, ± 1 kata per sel, bukan tabel angka), **nomor halaman & kepala/kaki halaman berulang** dibuang (`_drop_page_furniture`: `-2-`, `Halaman 2 dari 9`, baris pendek yang muncul di ≥ separuh halaman PDF), gambar berkas lokal PPTX/DOCX (`![ikon](A2_ikon111.jpg)`) dibuang kecuali alt bermakna (`[Gambar: …]`), penanda slide diringkas `[Slide n]`.
- Docling memakai satu kunci (CPU penuh, satu konversi sekaligus), MarkItDown paralel. Model Docling diunduh saat build
  (`docling-tools models download`, `DOCLING_ARTIFACTS_PATH`), saat jalan `HF_HUB_OFFLINE=1`. MarkItDown tanpa plugin & tanpa klien LLM.
  Jaringan compose sendiri (tidak menjangkau PostgreSQL/Redis/storage).

**Backend** (`src/converter/`): `ConverterClient` (disediakan `ExtractionModule` agar tidak melingkar; mati/401/≥ 500 =
`ConverterUnavailableError`, 4xx lain = `ConverterRejectedError`, batas waktu 15 menit), `ConverterService` + controller
`GET /converter/status`, `GET|PUT /converter/preferences` (`users.converter_prefs` jsonb: `enabled` (bawaan menyala), `pdfMode`,
`aiOcrFallback` (bawaan menyala)), `GET /converter/stats` (jumlah berkas per `metadata.method` + kandidat baca ulang),
`POST /converter/reconvert { scope: ai_ocr |
missing | legacy }` (antrekan ulang ekstraksi berkas milik sendiri, maks. 2.000; teks lama tetap dipakai sampai hasil baru; indeks
RAG ikut diperbarui). Logika murni + test `converter-logic.ts` (`converterHandles` = format yang dikirim — teks polos tidak,
`needsReconvert`, `normalizeConverterPrefs`). **Worker ekstraksi** (`extraction-worker.service.ts`): prefs user menyala + service
terjangkau + format didukung + ukuran ≤ batas → converter; hasil `metadata` = `method: markitdown|docling`, `format: "markdown"`,
`converter: { reason, tokens, durationMs, warnings, fallbackFrom }`. Converter tanpa teks untuk gambar/PDF → OCR AI hanya bila
`aiOcrFallback`; converter mati/menolak → pembaca bawaan (`metadata.converterError` bila tetap tanpa teks). `aiOcrFallback` mati juga
mencegah OCR AI di pembaca bawaan (`reason: ocr_off`).

**Rapikan dengan AI** (opsional, prefs `aiEnhance` bawaan mati + `aiEnhanceScope` `ocr` (hanya hasil Docling, bawaan) | `all`):
`MarkdownEnhancerService` (disediakan `ExtractionModule`) + logika murni & test `markdown-enhance.ts`. Markdown dipotong per judul
(`splitForEnhance`, ± 12 rb karakter, tabel tidak dipotong; maks. 200 rb karakter per berkas), dua bagian paralel ke
`AiService.generate(..., "document")` — tugas AI baru **Rapikan dokumen** di Pembagian tugas (+ cadangan `documentBackup`; kosong =
ikuti tugas Umum). Prompt (`buildEnhancePrompt`) hanya mengizinkan perbaikan struktur (judul, daftar, tabel, paragraf terpotong), kata
terpenggal, dan salah baca OCR yang jelas; dilarang meringkas, menambah, menyusun ulang, mengubah angka/nomor/nama; bagian tak terbaca →
`[tidak terbaca]`. **Penjaga** `checkEnhanced`: huruf+angka hasil 85–115 % asli dan ≥ 95 % angka ≥ 3 digit tetap ada — gagal = bagian
asli dipakai (catatan menyebut angka yang hilang). Angka dibandingkan per **deret digit** (merapikan spasi/pemisah nomor surat diterima, mengganti digit ditolak); kepala/kaki halaman berulang (`boilerplateLines`), nomor halaman, dan gambar berkas lokal tidak dihitung karena boleh dibuang. Semua bagian gagal dipanggil = galat (worker memakai Markdown converter apa adanya,
`metadata.converter.enhanceError`); berhasil = `metadata.converter.enhance` (provider, bagian, ditolak, perkiraan token). Cakupan baca
ulang `unenhanced` = sudah dibaca converter tetapi belum dirapikan. **Bandingkan token** (`POST /converter/documents` `compareTokens`):
`AiService.countTokens` = `countTokens` Gemini (key Gemini langsung, tanpa menjalankan model): berkas mentah (PDF/gambar seperti dikirim ke
AI), Markdown, hasil rapikan, biaya rapikan (overhead prompt × bagian + Markdown masuk, hasil keluar). Gemini di sini hanya **alat hitung** (perapi tetap provider tugas Rapikan dokumen); centang bawaan mati karena isi berkas ikut dikirim ke Google; `countTokens` tidak ditagih.

**Hasil uji token** (2026-11-13, 8 dokumen kerja sungguhan, tokenizer Gemini `countTokens`, rapikan oleh Gemini 3.8 Flash; "langsung" =
PDF dikirim apa adanya ke model; DOCX/PPTX tidak bisa dibaca model langsung):

| Dokumen | Mesin | Langsung | Markdown | Dirapikan | Biaya sekali rapikan |
|---|---|---|---|---|---|
| Permenhub 81/2021 (PDF teks, 30 hlm) | MarkItDown | 16.801 | 11.504 (−32 %) | 9.398 (−44 %) | 22.142 |
| Paparan KSP (PDF slide, 11 hlm) | MarkItDown | 6.161 | 3.507 (−43 %) | 3.619 | 7.440 |
| Quiz Fisika (PDF, 10 hlm, 3 scan) | Docling | 5.601 | 1.225 (−78 %)¹ | 1.106 | 2.682 |
| Surat Bupati (scan, 1 hlm) | Docling | 561 | 379 (−32 %) | 381 | 1.114 |
| Nota Dinas ber-TTE (PDF, 3 hlm) | Docling | 1.681 | 2.440 (+45 %)² | 2.458 | 5.271 |
| Draft SK PSP (DOCX) | MarkItDown | — | 10.478 | 9.416 | 20.809 |
| Paparan KSP (PPTX) | MarkItDown | — | 4.798 | 4.964 (1 dari 2 bagian ditolak) | 10.392 |
| Risalah rapat (DOCX) | MarkItDown | — | 2.477 | 2.509 | 5.299 |

¹ Diagram/gambar soal tidak ikut (Docling membaca teks, bukan isi gambar) — dokumen yang maknanya di gambar kehilangan informasi.
² Gemini menagih PDF ± 560 token per halaman (gambar halaman, teks PDF tidak ditagih terpisah), jadi PDF pendek yang padat teks bisa lebih
murah dibaca langsung oleh Gemini. Provider yang menagih teks **dan** gambar per halaman (Claude, OpenAI) jauh lebih mahal untuk berkas
mentah. Penghematan nyata datang dari pemakaian ulang: Markdown dibuat sekali, lalu setiap ringkasan/chat/notebook/agen hanya membaca teks
(atau potongan RAG-nya). Rapikan AI memakai ± 2× ukuran Markdown sekali per berkas (masuk + keluar), sehingga hanya sepadan untuk hasil OCR
(bawaan cakupan `ocr`) atau dokumen yang sering dibaca; pada uji pertama penjaga menolak 3 dari 4 bagian Permenhub karena AI membuang
kepala halaman berulang — diperbaiki dengan membuang kepala halaman di converter dan mengabaikannya di penjaga.

**Frontend**: Tools → **Markdown Converter** (`features/tools/converter/`, hook `data/use-converter.ts`, logika + test
`converter-utils.ts`): status service, sakelar & cara baca PDF & cadangan OCR AI (sub-tab **Pengaturan**), pustaka **Dokumen** (pilih/seret berkas →
pratinjau / Markdown mentah, salin, unduh `.md`, simpan ke Inbox vault ≤ 100 rb karakter; lihat di bawah), **Berkas tersimpan** (per cara baca + Baca ulang per
cakupan), cara kerja. Fitur yang dulu mengirim berkas mentah ke AI kini memakai teks server lebih dulu: `useFileSummarizer.summarize(file,
uploadId)` (lampiran & form Resource; berkas mentah hanya bila server tidak menghasilkan teks), `ResourceAiDialog` (teks tersimpan),
Notes AI `readFileText` (batas tunggu 5 menit, `ocr_off` tidak dikirim ke AI). Gambar yang dilampirkan di chat My Notebook tetap
dikirim ke AI (pertanyaan visual).

**Pustaka hasil konversi** (2026-11-14, sub-tab **Dokumen**, bawaan): tabel `converted_documents` (milik user, cascade; `title`, `file_name`,
`mime_type`, `size`, `options` mode/enhance/compareTokens, `status` queued → processing → done | failed, `error`, `engine`, `markdown`,
`enhanced_markdown`, `result` = metadata konversi tanpa isi). `POST /converter/documents` (202) → antrean di memori `ConverterLibraryService`
(2 paralel; maks. 10 antre & 500 dokumen per user) → `ConverterService.convert` (termasuk Rapikan & Bandingkan token; format tak didukung ditolak 400 saat unggah; `.md`/`.txt`/`.csv` diterima — `libraryAccepts`). Berkas asal **tidak** disimpan di storage — hanya di memori selama diproses — jadi tidak ada sampah; backend restart = dokumen yang belum
selesai ditandai gagal (unggah ulang). `GET /converter/documents` (tanpa Markdown + ringkasan `librarySummary`), `GET /converter/documents/:id`,
`PATCH` (judul), `DELETE` (permanen, bukan Sampah). Pustaka tidak diindeks RAG dan tidak dibaca agen.

**Sejauh mana converter dipakai** (audit 2026-11-14): semua fitur yang membaca isi berkas memakai teks hasil ekstraksi (Markdown converter bila
service menyala) — indeks RAG (chatbot, Pencarian Pintar, MCP `search_*`), sumber & lampiran dokumen My Notebook, Analisis/Telaah Approval & alat
agen `read_request_files`, PDF di vault Obsidian, dokumen Notes AI, Ringkas dengan AI (lampiran, Resource, dialog AI Resource), ONLYOFFICE,
naskah SRIKANDI, berkas pengajuan WhatsApp. Yang tetap dikirim mentah ke AI: gambar di chat My Notebook (pertanyaan visual), tulisan tangan
(Catatan Bebas), audio (transkrip Gemini), cadangan ringkasan saat server tidak menghasilkan teks, dan OCR AI bila Docling gagal & Cadangan OCR
AI menyala.

### 3.15 PIN keamanan & item terkunci (`src/security/`, Profil Saya → PIN Keamanan)

Keputusan user 2026-11-14: item pribadi dikunci PIN 6 angka; **judul** tetap tampil & bisa dicari, **isi** baru terbuka setelah PIN;
satu kali PIN membuka semua item terkunci **sampai logout** (+ tombol **Kunci sekarang**); AI memakai isi terkunci **hanya saat sesi
sudah memasukkan PIN**; agen Hermes / MCP, bot WhatsApp, dan cermin Obsidian **tidak pernah**. PIN = kunci akses aplikasi, **bukan
enkripsi**: data tetap tersimpan polos di database & indeks RAG (syarat agar bisa dicari) dan ikut backup.

- **PIN per akun**: `users.pin_hash` (argon2), `pin_failed`, `pin_blocked_until` (salah 5× → blokir 15 menit, berlipat tiap 5 kesalahan,
  maks. 24 jam — `pinBlockMs`). Atur/ganti/hapus wajib kata sandi akun (lupa PIN = atur ulang dengan kata sandi). PIN lemah (sama
  semua / berurutan) ditolak. Hapus PIN ditolak 409 bila masih ada item terkunci. `toPublicUser` → `hasPin` (hash tidak pernah keluar).
- **Sesi login berpengenal tetap**: `refresh_tokens.session_id` (claim `sid` di token akses & refresh; rotasi token mempertahankan sid)
  + `pin_unlocked` (disalin saat rotasi). `LockService.isUnlocked(user)` = ada token sesi itu yang belum dicabut/kedaluwarsa dan
  `pin_unlocked` (cache 5 dtk). Logout menghapus semua token sesi itu → tertutup. Atur/ganti/hapus PIN mengunci semua sesi (sesi yang
  mengatur PIN dibiarkan terbuka). Token agen / MCP / pekerjaan latar belakang tidak punya `sid` → selalu terkunci.
- **Item terkunci**: key payload `locked: true` (kolom `extra`) pada `LOCKABLE_TYPES` = para_area, para_project, para_resource, free_note,
  ai_note, list + kolom `notebooks.locked`. `LockService.lockSet(owner)` (cache 30 dtk, dibuang setiap tulis record) = item induk +
  **turunannya** lewat `expandDescendants` Berbagi (Area → Sub Area, Kegiatan, Project, Action/Task, Agenda, Notes AI tertaut) + **berkas**
  yang dirujuk (`collectUploadIds`) + sumber & lampiran chat notebook terkunci.
- **Penegakan** (sesi belum memasukkan PIN): `RecordsService.findMany/findOne` → `sealLocked`: payload = kerangka (`SKELETON_KEYS`:
  judul, tanggal, jam, status, selesai, prioritas, bobot, relasi, warna, ikon, sematan) dan key lain diganti nilai kosong (`""`, `[]`,
  `false`, `0`, `null`) agar kode lama tidak error, ditandai `locked: true` + `partial` = key tersembunyi. Tulis/hapus item terkunci atau
  membuat turunan di dalamnya → **403 `{ code: "PIN_REQUIRED" }`**. Setelah PIN dibuka, tulisan kerangka membawa `preserve` → isi asli
  dipertahankan untuk **semua** key (`preserveFields(..., anyKey)`), bukan hanya field daftar ringan. Mengunci/melepas kunci hanya pemilik;
  mengunci butuh PIN sudah diatur. Berkas: `UploadsService.findAccessible/findWithPermission` (unduh, pratinjau, metadata, ONLYOFFICE)
  → PIN_REQUIRED. Notebook: `NotebookLockGuard` di semua rute `/notebooks/:id`, daftar = judul saja (`sealed`), sumber yang merujuk item/
  berkas terkunci tidak dibaca chat/ringkasan saat terkunci.
- **RAG**: isi tetap terindeks. `AiIndexService.search` membuang sumber terkunci secara bawaan (`includeLocked` = status sesi; dipakai
  chatbot, uji indeks, Notebook) — MCP, agen, bot WhatsApp, Approval tidak pernah. Pencarian Pintar menyertakan item terkunci dengan
  cuplikan kosong + `locked: true`. Cermin 80-Akasha & catatan harian/berkala vault melewati item terkunci sama sekali. Riwayat chatbot
  (`GET /ai/chat/conversations/:id/messages`) mengganti jawaban yang bersitasi sumber terkunci dengan keterangan, dan jawaban itu tidak
  ikut riwayat yang dikirim ke model, selama sesi terkunci.
- **Arsip PARA**: snapshot menyimpan salinan isi, jadi `RecordsService` menandai `data.locked = true` pada `para_archive` yang item asalnya
  (atau turunan di `related`) terkunci; `lockSet` memuat arsip itu + berkasnya, kerangkanya mempertahankan `originalType/originalId/archivedAt`
  dan judul di `data`. Mengarsipkan atau memulihkan (`archivedOrigins`) dari sesi terkunci → 403 biasa (bukan `PIN_REQUIRED`, agar body kerangka
  tidak diulang otomatis). Arsip terkunci ikut menghalangi Hapus PIN (pulihkan lalu lepas kunci).
- **File Control**: Resource berkas yang masuk File Control (`archivalStatus` selain kosong/`none`) tidak bisa dikunci (400) — prosedur
  kearsipan (retensi, penyusutan, berita acara) membutuhkan isinya.
- **Komentar & audit**: `GET/POST /comments` item terkunci → `PIN_REQUIRED`; `GET /archive-audit` mengosongkan `changes` (+ `locked`) untuk item
  terkunci saat sesi belum memasukkan PIN.
- **Tawaran setelah login**: login berhasil + akun ber-PIN + ada item terkunci + sesi belum terbuka → dialog "Masuk dengan PIN?" (Masuk dengan
  PIN / Lanjut tanpa PIN). Tidak muncul saat sesi dipulihkan dari cookie (muat ulang halaman).
- **Berbagi**: penerima item bersama yang terkunci memakai PIN **miliknya sendiri** untuk membukanya (status sesi penerima); tanpa PIN penerima
  diminta mengatur PIN. Komentar item bersama tidak ikut disembunyikan.
- **Batas yang diketahui**: hasil AI yang dibuat saat PIN terbuka di luar chatbot (catatan & chat notebook yang tidak dikunci, salinan ke
  Catatan Bebas / Inbox) dan tautan publik / brankas berkas yang dibuat sebelum item dikunci (sengaja, dibuat untuk dibuka orang lain) tidak
  ikut terkunci.
- **Endpoint** `/security/pin`: `GET` status (`hasPin`, `unlocked`, `blockedUntil`, `lockedItems`, `sessionCapable`), `PUT { password, pin }`,
  `POST unlock { pin }` (throttle 10/menit), `POST lock`, `DELETE { password }`. Logika murni + test `lock-logic.ts`.
- **Frontend**: `lib/api/client.ts` — 403 `PIN_REQUIRED` memanggil penangan `PinUnlockHost` (dialog PIN) lalu mengulang permintaan sekali.
  Item kerangka bertanda `_locked` (`useCollection`, `fetchCompleteItem`). Komponen `features/security/`: `PinLockButton` (gembok header),
  `PinSettingsCard` (Profil Saya `#pin`), `LockToggleButton`, `LockedBadge`, `LockedNotice`, `useSealedGuard` (dialog form task/agenda
  ditutup & minta PIN), `ensureUnlocked`, `withUnlocked` (Arsipkan / Hapus / Pulihkan arsip atas item terkunci meminta PIN dulu — permintaan
  yang diulang otomatis memakai body yang sama, jadi aksi yang menyusun data dari kerangka tidak boleh dijalankan sebelum PIN dibuka). PIN
  dibuka/dikunci → semua query dimuat ulang.

## 4. Database

Konvensi: model Prisma PascalCase, **tabel & kolom snake_case**, timestamp `timestamptz(3)` (UTC), FK ke `users`
dengan `ON DELETE CASCADE`, soft delete `deleted_at` pada tabel domain.

### 4.1 Tabel inti
`users` (+ `ai_provider`, `ai_fallback`, `ai_index_enabled`), `refresh_tokens`, `app_settings`, `assets` (+ `uploaded_by_id`,
`version`, `version_author_id`, `versioned_at`, `office_key`), `asset_versions` (§3.5), `asset_extractions`, `archive_audit_logs`, `ai_credentials` (§3.1), `ai_chunks` (pgvector, §3.2),
`shares` & `record_comments` (§3.3), `public_links`, `public_vaults` / `public_vault_files` / `public_vault_accesses` (§3.10).

### 4.2 Tabel domain (28)

| Record type (API) | Tabel | Kolom utama |
|---|---|---|
| `agenda_type` | `agenda_types` | name, order |
| `schedule` | `schedules` | title, start_date, end_date, start_time, end_time, is_all_day, type, location, media, project_id (project / item area pemilik agenda) (di `extra`: description, resources = dasar pelaksanaan, results + outcome = hasil agenda — format lampiran PARA, seriesId + recurrence = agenda berulang, satu record per pertemuan; reschedules = riwayat jadwal ulang; `media` = link dipisah baris baru) |
| `routine` | `routines` | title, frequency, days, interval, interval_type, month_dates, start_date, active, archived, freeze_periods |
| `todo` | `todos` | title, completed, date, priority |
| `completion` | `routine_completions` | routine_id, date, actual_date, note, completed_at |
| `free_note` | `free_notes` | title, content, color (`kind`, `doc`, `ink`, `pinned`, `orphanUploadIds` di `extra`) |
| `ai_note` | `ai_notes` | title, date, content, ai_summary, audio_transcript, file_context, audio_upload_id, file_attachment |
| `list` | `note_lists` | title, archived, items |
| `para_area` | `areas` | title, description, color |
| `para_project` | `projects` | title, area_id, start_date, deadline, status, progress, linked_notes, resources |
| `para_activity` | `activities` | title, area_id, parent_id (kosong = Sub Area; induk berantai → Kegiatan → Sub Kegiatan), deadline, status, resources |
| `para_task` | `tasks` | project_id, title, due_date, priority, weight, completed, completed_at, resources |
| `para_resource` | `resources` | title, type, url, upload_id, date, tags, ai_summary + **field kearsipan** (archival_status, archive_reg_id, classification_id, jra_id, retention_*_date, status, is_vital, is_auto_dispose, phys_*_id, digital_*, disposition_data) |
| `para_archive` | `para_archives` | original_type, original_id, data, archived_at (turunan yang ikut diarsipkan — `related` — di `extra`) |
| `para_archive_log` | `para_archive_logs` | action (archived/restored), original_type, original_id, archive_id, title, summary, actor_name, at — riwayat arsip & pemulihan PARA (append-only) |
| `skp` | `skps` | external_id (nomor SKP e-Kinerja), start_date, end_date, status, approach, appraiser, synced_at — SKP diambil robot (beberapa per tahun) |
| `skp_target` | `skp_targets` | year, skp_id, name, section (UTAMA/TAMBAHAN), leader, indicators, order — RHK milik SKP (robot) atau manual per tahun |
| `action_plan_entry` | `action_plan_entries` | period (YYYY-MM), skp_id, target_id, description, document_url, source_type/id/title, status (draft/ready/filled), filled_at — rencana aksi e-Kinerja yang dipilih user dari Working Space (di `extra`: realization, time_realization, indicators, pushedSignature + pushed = pengenal perubahan, deleted = hapus tertunda) |
| `action_plan_month` | `action_plan_months` | period, skp_id, status (empty/unavailable/draft/submitted/rated), submitted_at, synced_at — potret bulan Rencana Aksi e-Kinerja (di `extra`: workday, ratings, rows + feedback) |
| `srikandi_reference` | `srikandi_references` | category (signer/recipient/recipient_group/verifier/cc/cc_group/disposition_group/classification/sender_unit), label, fields, order, synced_at — referensi SRIKANDI diambil robot (klasifikasi: label "KODE - Nama", fields.Status) |
| `srikandi_letter` | `srikandi_letters` | number, date, subject, origin, sign_status, send_status, upload_id, imported_at — naskah keluar ber-TTD dari Daftar Naskah Keluar (di `extra`: attachments, resources) |
| `srikandi_outgoing` | `srikandi_outgoings` | form_type, subject, number, status (draft/submitted/done), upload_id, source_type/id, letter_id, submitted_at — Register Naskah Keluar (isian formulir Registrasi, berkas, tujuan, verifikator, penandatangan di `extra`) |
| `archive_classification` | `archive_classifications` | jenis, kode_pokok/sub/item, nama_* |
| `archive_jra` | `archive_retention_schedules` | kategori_utama, sub_kategori, jenis_arsip, retensi_aktif, retensi_inaktif, keterangan |
| `archive_physical_reference` | `archive_locations` | type (location/rack/box/folder), parent_id, code, name |
| `archive_borrowing` | `archive_borrowings` | date, return_date, borrower_name, unit, purpose, items, status, returned_at, cancelled_at |
| `archive_disposition` | `archive_dispositions` | type, status_label, executed_at, form_data, items, executed_by |
| `archive_move_log` | `archive_move_logs` | date, items_count, target_name, performed_by, description, moved_items |

Setiap tabel domain juga punya `id` (cuid), `user_id`, `client_id`, `extra` (jsonb), `created_at`, `updated_at`,
`deleted_at`, `UNIQUE(user_id, client_id)`, indeks `(user_id, deleted_at)` + indeks pola query.

### 4.3 Spesifikasi sebagai sumber tunggal

`apps/akasha/api/src/records/record-schema.ts` mendefinisikan untuk tiap record type: model/tabel, field & jenisnya
(`string | int | float | bool | ymd | dateKey | timestamp | json`), indeks, `titleKey`/`dateKey`, dan apakah diaudit.
Dari spesifikasi ini:
- `prisma/generate-domain-models.mts` menghasilkan model Prisma;
- `record-mapper.ts` mengonversi payload ↔ baris saat runtime.

**Lossless**: nilai yang lolos validasi jenis disimpan di kolom bertipe; nilai lain (format tak terduga, `null`
eksplisit, key tak dikenal) disimpan apa adanya di `extra`. Payload yang dibaca kembali identik dengan yang ditulis.
Format tanggal di API (`YYYY-MM-DD`, `Date.toDateString()`, ISO) tetap seperti yang dipakai frontend, tetapi disimpan
sebagai `date`/`timestamptz` sehingga bisa diindeks & difilter.

**Relasi antar entitas** (mis. `tasks.project_id`) sengaja tidak memakai FK: ID dibuat client, ditulis per item secara
asinkron (urutan tulis tidak dijamin) dan sebagian polimorfik (task → project atau activity). Kolomnya diindeks.

### 4.4 Audit kearsipan

`archive_audit_logs` mencatat `created | updated | deleted` untuk data kearsipan (tabel `archive_*` kecuali move log,
resource yang memiliki `archivalStatus`, dan snapshot PARA berisi file): pemilik, pelaku (`actor_id`), dan
`changes` (`{field: {from, to}}` untuk update, snapshot untuk create/delete). Dicatat dalam transaksi yang sama dengan
perubahan data. API: `GET /api/v1/archive-audit?entityType=&entityId=&take=`.

### 4.5 API records

| Endpoint | Fungsi |
|---|---|
| `GET /records/:type?userId&from&to` | daftar aktif (`from/to` memfilter kolom `dateKey`) |
| `GET /records/:type?light=1` | daftar ringan: field berat (`record-light.ts`) dipotong, record ditandai `partial` |
| `GET /records/:type/:clientId?userId=` | satu record utuh (milik sendiri / dibagikan) |
| `PUT /records/:type/:clientId` `{ payload, userId?, base?, preserve? }` | upsert idempotent (juga membatalkan soft delete); `preserve` = pertahankan key yang tidak utuh di client; `base` = gabungkan perubahan (tipe `MERGE_ARRAY_KEYS`, `record-merge.ts`) |
| `DELETE /records/:type/:clientId?userId=` | soft delete |

Respons: `{ id, clientId, type, userId, title, date, payload, createdAt, updatedAt }`.

## 5. Frontend (`apps/akasha/web/`)

React SPA (komponen & versi di §2.1): Tailwind + shadcn/ui (Radix, ikon lucide), React Router (rute lazy per modul),
TanStack Query, Zustand (sesi & UI), react-hook-form + zod, sonner.

```
src/
  app/          router (rute lazy), providers, query client
  config/       navigation.ts — sumber tunggal modul, path, tab, ikon, role
  types/        tipe API & entitas domain
  lib/          api client (refresh token otomatis), tanggal, deep link, AI (useAi → POST /ai/generate), paket ikon (icons/)
  data/         useCollection + hook koleksi bertipe (collections.ts)
  stores/       auth-store, ui-store
  hooks/        useSearchParam, useToday, usePermissions, useRetained
  components/   ui/ (shadcn), layout/ (AppShell, ModulePage), common/ (komponen bersama)
  features/     overview, planner, notes, working-space, resources, file-control, tools (ONLYOFFICE), settings, assistant,
                focus, auth
```

### Data layer
`useCollection<T>(recordType)` membaca koleksi via TanStack Query dan menulis **per item**: `setItems(updater)` bekerja
seperti `setState`, menghitung diff lalu `PUT`/`DELETE` per item (debounce 500 ms, diserialkan per item, optimistis,
rollback + toast bila gagal). Komponen memakai hook bertipe di `data/collections.ts`.

### Pola UI wajib
- Setiap halaman modul memakai `<ModulePage module="...">` (banner gradient ringkas satu baris + tab URL `/modul/:tab`; aturan tampilan ringkas: CLAUDE.md §8b "Tampilan ringkas").
- Dialog edit/detail yang perlu deep link dikendalikan query string (`?edit=`, `?project=`, `?archive=`, ...).
- Form dialog: state di komponen dalam yang di-mount saat terbuka (tanpa sinkronisasi `useEffect`).
- Konten berat dimuat malas: rute, halaman login, renderer Markdown/KaTeX, pemindai kamera `html5-qrcode`, editor
  Catatan Bebas (Tiptap + kanvas stylus, chunk `free-note-editor`), penampil PDF brankas (pdf.js, chunk `pdf-pages`).
- Cetak dokumen (label/A4/berita acara) lewat `printElement` (jendela baru + stylesheet aplikasi); QR dibuat lokal.

### Design system
Token warna OKLCH di `src/index.css` (terang & gelap via class `.dark`). Warna modul lewat atribut
`data-module` → utility `bg-module`, `text-module`, `bg-module-soft`, `bg-module-gradient`; status
`success | warning | info | destructive`. Dilarang warna hardcoded atau ternary dark mode per elemen
(pengecualian: lembar cetak hitam-putih dan gambar tulisan tangan yang dikirim ke AI). Isi editor Tiptap distyle lewat
kelas `.rich-text` di `index.css`; warna tinta disimpan sebagai ID dan dipetakan ke token. Styling KaTeX hanya menarget class publik (`.katex`, `.katex-display`).

## 6. Deployment & kualitas

```
Internet ─► Caddy :443 (TLS otomatis, HSTS) ─┬─ /api/* ─► backend (non-root, migrasi saat start)
                                             └─ lainnya ─► frontend (nginx: SPA + CSP)
jaringan internal: postgres · redis (password) · SeaweedFS S3 · backup harian (pg_dump + cermin S3 → luar server terenkripsi)
```

- `docker-compose.yml` = infrastruktur development saja; `docker-compose.prod.yml` = stack produksi (operasional di
  DEPLOYMENT.md).
- Image di-pin versinya (§2.1); rotasi log Docker; secret hanya dari `.env`; batas memori per container.
- Backup: dump tervalidasi + berkas lewat API S3, salinan luar server terenkripsi, heartbeat pemantauan
  (DEPLOYMENT.md §4–§5). SeaweedFS `-volume.max=0` agar kapasitas mengikuti disk.
- Pengujian: unit test Vitest (logika murni: record mapper, aturan kearsipan), smoke test end-to-end (±50 skenario
  terhadap server nyata, membuat & menghapus user sementara). CI GitHub Actions menjalankan semuanya + cek drift skema
  + build image; Dependabot untuk pembaruan dependensi (§2.3).

## 7. Konvensi kode

- Bahasa: identifier & commit Inggris; teks UI, pesan error, dan komentar Indonesia.
- Prettier tunggal di root (`printWidth 120`), LF, UTF-8. Lint: oxlint (frontend, 0 warning), ESLint (backend).
- Sebelum commit: `lint` + `typecheck`/`build` + `npm test` di bagian yang diubah; backend: `npm run test:smoke`.

## 8. Rencana berikutnya

- RAG tahap 2 ✅ (§3.6), token akses + MCP ✅ (§3.7), Pengajuan/Approval + mesin templat ✅ (§3.8), bot WhatsApp ✅
  (§3.9), robot e-Kinerja & SRIKANDI termasuk Register Naskah Keluar ✅ (§3.10), Hermes tahap pertama ✅ (§3.11).
  Berikutnya ([AI-AGENT.md](AI-AGENT.md) §22): skill Hermes per jenis dokumen, integrasi OnTrack (SIMAN/MyIntress); RAG
  tahap 3: Redis untuk cache embedding pertanyaan, batas pemakaian harian, penyimpanan throttler.
- Akai ([AKAI.md](AKAI.md) §5): 6a.4 tahap 2 (agen & embedding lewat Akai, Model AI Akasha → tautan ke Akai), lalu chat Akai
  (6b) dan loop agen sendiri (6c).
- Upgrade tech stack yang masih tertunda: lihat [UPGRADE-PLAN.md](UPGRADE-PLAN.md).
