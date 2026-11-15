# Rencana Rebrand Akasha, Akai, Router Model, dan Struktur Repo

Dokumen kerja (2026-11-15). Permintaan pemilik: domain **workingspace.id** sudah dibeli untuk ekosistem banyak aplikasi
dengan satu akun (SSO `auth.workingspace.id`) dan halaman depan `workingspace.id`. LifeOS berganti nama total menjadi
**Akasha** ("ruang" untuk mengelola pekerjaan, kehidupan, dan sumber daya) di `akasha.workingspace.id`. Agen Hermes
dikembangkan menjadi **Akasha AI / Akai** (chat sekaligus agen, backend sendiri) di `akai.workingspace.id` yang juga dipakai
dari dalam aplikasi lain. Aplikasi berikutnya: **Cendikia** (ruang kerja sekolah/kuliah), lalu aplikasi lain.

Status: **rencana, belum ada kode yang diubah.** Keputusan pemilik dicatat di §5 lalu di CLAUDE.md §12.

## 1. Inventaris istilah LifeOS (per 2026-11-15)

± 1.530 kemunculan di 225 berkas terlacak git (backend 92, frontend 90, robot 14, infra 10, docs 7, lainnya). Kelompoknya:

| Kelompok | Contoh | Dampak bila diganti |
|---|---|---|
| Teks UI, komentar, dokumen | "LifeOS", judul halaman, pesan error | Aman |
| Nama paket & berkas | `lifeos-mcp.service.ts`, `lifeos-context.ts`, `lifeos-ai-bridge.js`, `package.json` name | Aman (impor ikut diubah) |
| Infra dev | container `lifeos-*`, volume `lifeos-postgres18-data`, `lifeos-redis-data`, `lifeos-storage-data`, image `lifeos-robot`/`lifeos-onlyoffice`/`lifeos-converter`, alias `lifeos-api`, env `LIFEOS_*_TAG` | Volume Docker tidak bisa diganti nama → **disalin** ke volume baru (data dev tetap ada) |
| Database & storage | DB `lifeos` + `lifeos_shadow`, bucket `lifeos-assets` | DB di-rename (`ALTER DATABASE`), bucket disalin objeknya |
| Sesi & token | cookie `lifeos_rt`, prefix token `lifeos_pat_` | Semua sesi logout sekali; token akses pribadi lama tidak berlaku (token Hermes memakai `HERMES_API_KEY`, aman) |
| Browser | kunci localStorage `lifeos.*` (graf, agen, robot alert, pending uploads, …) | Preferensi per browser kembali bawaan sekali |
| MCP & agen | nama server MCP `lifeos`, folder skill `/opt/data/skills/lifeos`, sesi Hermes `lifeos-<user>-…`, `infra/hermes/lifeos-mcp.yaml` | Hermes dikonfigurasi ulang (`up.sh`), riwayat sesi Hermes lama tidak tersambung |
| Vault Obsidian | folder cermin `80-LifeOS/`, frontmatter `sumber: lifeos`, `lifeos_id`, `lifeos:` | Folder cermin dipindah ke `80-Akasha/` + frontmatter ditulis ulang (sinkron cermin berikutnya); tautan di catatan user ke `80-LifeOS/…` perlu diperbarui (fitur pindah folder yang sudah ada memperbarui `[[tautan]]`) |
| **Konstanta kriptografi** | `lifeos:mcp-connection:v1`, `lifeos:robot-session:v1`, AAD `lifeos:robot-credential:…` | **Mengubah = data terenkripsi tidak terbaca** (token aplikasi MCP, sesi robot, kredensial robot) |
| Luar repo | repo GitHub `zonakerja/lifeos`, folder `D:\…\LifeOS` | Dikerjakan pemilik (GitHub → Settings → Rename; folder lokal setelah semua proses mati) |

Keputusan pemilik: **rebrand total** — konstanta & kunci enkripsi diganti, dan karena database & storage dimulai dari nol
(tahap A §4), tidak perlu enkripsi ulang; volume/bucket/DB lama tidak disalin, cukup dibuat baru. Kolom "Dampak" di atas
yang menyebut penyalinan data menjadi tidak relevan.

Waktu terbaik rebrand = **sekarang**, sebelum VPS & produksi ada: belum ada data produksi yang harus dimigrasikan.

## 2. Pemilihan model lewat router (Classai, OpenRouter, OmniRoute, lainnya)

**Keadaan sekarang**: jalur router adalah sifat *kredensial per provider* (Gemini / Claude / OpenAI masing-masing bisa
"langsung" atau "lewat router"). Satu provider = satu model aktif. Akibatnya model murah seperti `deepseek-v4-flash`,
`kimi-k3`, `glm-5.3` hanya bisa dipakai dengan "menumpang" di slot OpenAI, dan tidak bisa memilih banyak model sekaligus.

**Temuan riset**:
- **Classai** (`https://router.classai.id/v1`): OpenAI Chat Completions + Anthropic Messages + `/v1/embeddings` +
  `GET /v1/models` (wajib key). Paket token per model dipakai lebih dulu, lalu kredit untuk ± 55 model. Tarif kredit tidak
  ada di respons API yang dikenal → diisi manual / dari halaman tarif (detail: `docs/ARCHITECTURE.md` §3.1).
- **OpenRouter** (`https://openrouter.ai/api/v1`): `GET /models` publik, memuat `pricing` (USD per token, string),
  `context_length`, modalitas masuk/keluar, `supported_parameters` (mis. `tools`) — cukup untuk menampilkan harga &
  kemampuan otomatis ([dokumentasi models](https://openrouter.ai/docs/guides/overview/models)).
- **OmniRoute**: gateway sumber terbuka (MIT) yang di-*host sendiri*, satu endpoint `/v1` OpenAI-compatible, fallback &
  penerjemahan format. Bagi Akasha cukup diperlakukan sebagai router OpenAI-compatible biasa (alamat milik pemilik).

**Rancangan baru** (usulan):
1. **Router = entitas sendiri** (tabel `ai_routers`): nama, preset (Classai, OpenRouter, OmniRoute, Lainnya), alamat,
   format (OpenAI / Anthropic), key terenkripsi. Provider resmi (Gemini, Claude, OpenAI langsung) tetap ada sebagai
   "sumber" khusus dengan SDK resmi.
2. **Katalog model**: tombol "Muat daftar model" memanggil `GET /models` router → simpan salinan (id, nama, konteks,
   modalitas, dukungan alat, harga bila ada). Pemilik **menyalakan banyak model** dari katalog (tabel `ai_models`:
   sumber + id model + label + kemampuan + harga masukan/keluaran + mata uang/kredit, bisa diubah manual).
3. **Pembagian tugas memilih model, bukan provider**: chat, umum, agen (Akai), rapikan dokumen, OCR, embedding — masing-
   masing satu model utama + **daftar cadangan berurutan** (model apa pun, router apa pun). Aturan cadangan yang sudah
   teruji (kuota/sibuk/tak terjangkau → pindah; key ditolak → tidak) dipakai apa adanya.
4. **Harga terlihat**: kolom harga per 1 jt token di daftar model, urut termurah, label "Paket" untuk model berpaket
   Classai; ringkasan biaya per tugas di kartu pembagian tugas.
5. **Kemampuan dicek sebelum dipakai**: lampiran gambar/PDF hanya ke model yang mendukung, embedding hanya model embedding
   768 dimensi, transkrip audio tetap Gemini langsung (batasan router).
6. Fitur ini dibangun di **`apps/akai/api`** (tahap B), sehingga berlaku untuk semua aplikasi ekosistem. Karena database
   dimulai dari nol, tidak ada migrasi data lama; pemilik memasukkan router & key sekali setelah rebrand.

## 3. Struktur repo

**Temuan riset**: pola umum 2026 = `apps/` (aplikasi yang di-deploy) + `packages/` (kode bersama) dengan **pnpm workspaces +
Turborepo**; Nx untuk skala besar. Untuk repo ini: npm 11 (`allowScripts`), Windows ARM64, Dependabot npm, CI GitHub.

**Struktur yang dipakai** (satu monorepo ekosistem `workingspace`, bisa bertambah banyak aplikasi):

```
workingspace/
├── apps/
│   ├── landing/                   halaman depan workingspace.id (daftar aplikasi, masuk) — baru
│   ├── auth/
│   │   ├── api/                   SSO auth.workingspace.id (akun, sesi, token untuk semua aplikasi) — baru
│   │   └── web/                   halaman masuk/daftar/profil akun
│   ├── akasha/
│   │   ├── api/                   backend NestJS (sekarang backend/)
│   │   └── web/                   frontend React (sekarang frontend/)
│   ├── akai/
│   │   ├── api/                   backend Akai: router & katalog model, percakapan, proyek, memori, artifact, agen — baru
│   │   ├── web/                   aplikasi chat & agen mandiri (akai.workingspace.id) — baru
│   │   └── agent/                 runtime agen: konfigurasi Hermes + skill (sekarang infra/hermes + agents/hermes)
│   ├── cendikia/{api,web}         (prioritas ketiga, dibangun baru di stack yang sama)
│   └── <aplikasi lain>/{api,web}  pola sama untuk setiap aplikasi baru
├── services/
│   ├── robot/                     Playwright (sekarang robot/)
│   └── converter/                 Markdown Converter Python (sekarang converter/, di luar Turborepo)
├── packages/
│   ├── ui/                        komponen shadcn + token desain bersama semua aplikasi
│   ├── auth-client/               verifikasi token SSO (backend) + sesi (frontend) — dipakai semua aplikasi
│   ├── akai-client/               klien API Akai (chat tersemat di Akasha, Cendikia, dll.)
│   └── config/                    tsconfig, oxlint, prettier bersama
├── infra/                         Caddy (satu blok per subdomain), backup, onlyoffice, seaweedfs, knowledge-vaults
├── docker-compose.yml · docker-compose.prod.yml   tetap di root
├── turbo.json · package.json      npm workspaces + Turborepo
└── docs/
```

Catatan rancangan:
- **Setiap aplikasi = `apps/<nama>/{api,web}`** dengan subdomain `<nama>.workingspace.id`, database sendiri (satu server
  PostgreSQL, database per aplikasi), dan memakai `packages/` bersama. Menambah aplikasi = menyalin pola, tanpa mengubah yang lain.
- **SSO `auth.workingspace.id`**: satu akun untuk semua aplikasi. Layanan auth menerbitkan token akses bertanda tangan
  (JWT dengan kunci publik JWKS) + sesi cookie `Domain=.workingspace.id`; setiap backend aplikasi hanya memverifikasi token
  (tanpa menyimpan kata sandi). Hak per aplikasi (role, aplikasi mana yang boleh dibuka) disimpan di layanan auth. Isolasi
  data tetap di masing-masing aplikasi (aturan "admin tidak melihat data user" tetap berlaku).
- **Landing `workingspace.id`**: halaman statis ringan (daftar aplikasi, penjelasan singkat, tombol Masuk ke SSO). Dibangun
  bersama SSO karena keduanya pintu masuk ekosistem.
- **Akai = backend sendiri, "otak" ekosistem**: router & katalog model (§2) tinggal di Akai, sehingga API key & pilihan model
  diatur sekali untuk semua aplikasi. Akasha, Cendikia, dan aplikasi lain menjadi **penyedia alat MCP** bagi Akai (Akasha
  sudah punya MCP server). Fitur AI internal Akasha (Notes AI, OCR, rapikan dokumen, AI ONLYOFFICE) bertahap memanggil gateway
  model Akai. Target fitur ala asisten AI modern: percakapan & proyek tersimpan, lampiran berkas, artifact, memori, konektor
  MCP, pencarian web, tugas agen panjang, banyak model — dirancang dari kebutuhan & dokumentasi publik, **bukan** menyalin
  kode atau API privat produk lain.
- **Turborepo di atas npm workspaces**, dipasang saat restrukturisasi (cache build/test, `turbo prune --docker` untuk image).
  Biner Turborepo Windows ARM64 dicek saat mulai; bila tidak ada, workspaces tetap jalan tanpa Turborepo.
- **Cendikia**: repo lama (`zonakerja/hacktiv8-capstone-cendikia-ai`: NestJS 10, Prisma 6, Better Auth, React 18, Tailwind 3)
  **tidak di-upgrade**; `apps/cendikia` dibangun baru di stack yang sama. Chat/RAG/Gemini lama diganti Akai, Better Auth diganti
  SSO, yang dipindahkan = modul `learning` (Learning Manager) & notebook.
- Port dev tetap (§2 CLAUDE.md); port baru per aplikasi ditetapkan saat aplikasi dibuat (5174 & 3000 dipakai OnTrack).

## 4. Urutan kerja

**Tahap A — Akasha**
1. ✅ Commit pekerjaan tertunda (Overview Working Space + lepas kunci PIN).
2. ✅ **Kumpulkan berkas uji** (`_uji/`, lihat README di dalamnya) ke satu folder di luar git (templat DOCX instansi dari storage akun admin, dokumen uji, isi vault
   dev, dan berkas uji lain yang ditemukan di database/storage), sebelum database dihapus. Folder dihapus setelah pengujian
   rebrand selesai.
3. ✅ **Restrukturisasi monorepo + Turborepo** (2026-11-15): compose tetap di root, `packages/` dibuat saat dibutuhkan, `apps/akai/{api,web}` dibuat di tahap B.
4. ✅ (2026-11-15, kecuali uji ulang dengan `_uji/`) **Rebrand total LifeOS → Akasha** (teks, kode, API, infra, cookie, token, MCP, Hermes, cermin vault, **kunci & konstanta
   enkripsi baru**) dengan **database & storage dimulai dari nol** → seed baru → uji ulang menyeluruh memakai berkas uji →
   hapus folder berkas uji.
   **Termasuk Productivity → Working Space total** (permintaan pemilik 2026-11-15; dulu hanya label): kunci modul
   `productivity` → `working-space`, alamat `/productivity/*` → `/working-space/*` (deep link, `links.*`, tautan cermin),
   folder kode `features/productivity` → `features/working-space`, token warna `--mod-productivity` → `--mod-working-space`,
   modul Pencarian Pintar (`MODULE_BY_SOURCE`), jenis cermin `productivity` → `workingSpace`, folder cermin Obsidian
   `80-LifeOS/Productivity/` → `80-Akasha/Working Space/`, teks UI/AI/MCP/dokumen. Tidak ada endpoint API khusus Productivity
   (datanya lewat `/records/:type`). Istilah metode **PARA** (record type `para_project`, `para_area`, `para_task`, …) tetap,
   karena itu nama metodenya, bukan nama modul.
5a. **Ganti nama folder proyek** `D:\Development\Application\LifeOS` → folder baru ekosistem (nama final: §5) setelah semua
   proses dimatikan (dev server, Docker, WSL); bind mount Docker, skrip WSL (`/mnt/d/...`), `.claude/launch.json`, dan dokumen
   ikut diperbarui; memori Claude lokal disalin ke folder proyek baru; pekerjaan berikutnya dilanjutkan di sesi Claude baru
   yang dibuka di folder itu.
5b. **GitHub**: repo `zonakerja/lifeos` di-rename menjadi `zonakerja/workingspace` (riwayat, CI, Dependabot tetap; alamat
   lama otomatis dialihkan GitHub) lalu `git remote set-url origin`. Repo Cendikia lama dibiarkan sebagai arsip.

**Tahap B — Akai & pintu masuk ekosistem**
5. SSO `auth.workingspace.id` + landing `workingspace.id`; Akasha login lewat SSO.
6. `apps/akai/api`: modul AI/agen dipindah dari Akasha + router & katalog model (§2).
7. `apps/akai/web`: chat & agen mandiri + chat Akai tersemat di Akasha.

**Tahap C — Cendikia** (dibangun baru, modul learning & notebook dipindah dari repo lama).

**Tahap D — Deploy VPS** semua subdomain sekaligus. Konfigurasi produksi (Caddy, compose, backup) diperbarui dan diuji
dengan stack produksi lokal di setiap tahap, sehingga VPS tinggal dipasang.

## 5. Keputusan pemilik

- 2026-11-15: satu repo ekosistem `workingspace` yang bisa memuat banyak aplikasi.
- 2026-11-15: **rebrand total**, termasuk konstanta & kunci enkripsi (mencabut keputusan "dibekukan").
- 2026-11-15: **database dimulai ulang** setelah rebrand; berkas uji dikumpulkan dulu, dihapus setelah diuji.
- 2026-11-15: **Akai punya backend sendiri** (mencabut "pakai API Akasha dulu"), karena Cendikia punya backend sendiri dan
  Akai ditargetkan sekuat asisten AI modern.
- 2026-11-15: **Turborepo** dipasang saat restrukturisasi.
- 2026-11-15: **SSO `auth.workingspace.id`** dan **landing `workingspace.id`**.
- 2026-11-15: Cendikia prioritas ketiga, dibangun baru (bukan upgrade repo lama); deploy VPS setelah semuanya selesai.
- 2026-11-15: folder proyek lokal menjadi **`D:\Development\Application\workingspace`** (tanpa spasi); repo GitHub di-rename
  menjadi `zonakerja/workingspace` (bukan repo baru).
- Domain ditulis `akasha.workingpace.id` di permintaan awal → dianggap salah ketik `akasha.workingspace.id`.
