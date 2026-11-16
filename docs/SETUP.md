# Setup & Menjalankan Workingspace (Akasha + SSO)

Panduan development lokal untuk monorepo **workingspace**: aplikasi **Akasha** (`apps/akasha`) dan **SSO workingspace.id**
(`apps/auth`, akun satu pintu untuk semua aplikasi — docs/SSO.md). Bagian §1–§6 adalah **petunjuk operasional** (setup awal, menyalakan, mematikan, cek
status) untuk laptop Windows + Docker di WSL; §7 dan seterusnya adalah referensi teknis.

| Mau apa? | Baca |
|---|---|
| Pertama kali memasang di laptop (atau setelah reset) | §3 Setup awal |
| Mulai bekerja hari ini | §4 Menyalakan |
| Selesai bekerja / mau menutup laptop | §5 Mematikan |
| Tidak yakin apa yang sedang menyala | §6 Cek status |
| Port bentrok / bingung port | §2 Aturan port |

Semua perintah di §3–§6 dijalankan di **PowerShell** (Windows Terminal) dari folder proyek
`D:\Development\Application\workingspace`, kecuali disebut lain. (Windows tidak membedakan huruf besar/kecil nama folder:
`Workingspace` dan `workingspace` sama, juga di WSL `/mnt/d/...`.)

## 1. Prasyarat

| Kebutuhan | Versi | Catatan |
|---|---|---|
| Node.js | LTS sesuai `.nvmrc` (npm bawaan) | Disarankan via **nvm** (Windows: nvm-windows). **Arsitektur harus sama dengan Windows** (x64 atau ARM64) — lihat §3 langkah 0 |
| Docker Engine + Compose v2 | terbaru | Docker Desktop **tidak** wajib — Docker Engine di WSL/Linux cukup |
| lazydocker (opsional) | terbaru | Tampilan terminal untuk melihat/menghentikan container & log; dipasang di WSL |
| Git | terbaru | |

Cek cepat (semua harus menampilkan versi):

```powershell
node -v; npm -v; git --version
node -p "process.arch"          # harus sama dengan arsitektur Windows: x64 (Intel/AMD) atau arm64 (Snapdragon)
wsl -e sh -c "docker --version && docker compose version && command -v lazydocker"
```

### Catatan Windows (x64 & ARM64)

Berlaku untuk kedua jenis Windows, kecuali butir bertanda **[ARM64]**. Cek jenis Windows Anda:

```powershell
$env:PROCESSOR_ARCHITECTURE     # AMD64 = Windows x64 (Intel/AMD) · ARM64 = Windows ARM (Snapdragon)
```

- **[ARM64] Node.js harus versi arm64.** nvm-windows memasang versi **x64 secara default**, dan Windows ARM tetap
  bisa menjalankannya lewat emulasi — tanpa pesan error, tetapi lebih lambat, dan paket native (`@node-rs/argon2`,
  esbuild, oxlint, rolldown) ikut terpasang versi x64. Selalu sebut `arm64` pada `nvm install` dan `nvm use` (§3
  langkah 0), lalu pastikan `node -p "process.arch"` menampilkan `arm64`.
- Docker Engine dijalankan di **WSL Ubuntu**; CLI `docker` tidak ada di PATH Windows. Jalankan perintah compose lewat:
  ```powershell
  wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose up -d"
  ```
  Port container tetap bisa diakses dari Windows lewat `localhost`.
- WSL berhenti sendiri saat tidak ada proses yang berjalan di dalamnya, sehingga container ikut mati. Selama bekerja,
  biarkan satu jendela WSL tetap terbuka: **lazydocker** (`wsl -e lazydocker`) atau `wsl -e sh -c "sleep infinity"`.
- Docker di WSL menyala otomatis setiap WSL hidup (systemd). Container ber-`restart: unless-stopped`: container yang
  **tidak** dihentikan dengan `docker compose stop` akan ikut menyala lagi saat WSL hidup kembali.
- **[ARM64]** Paket native tanpa prebuilt win32-arm64 akan gagal dipasang. Proyek ini sudah memakai alternatif yang aman
  (`@node-rs/argon2`, Prisma tanpa engine Rust + adapter `pg`; lihat ARCHITECTURE.md §2.2).
- npm 11 memblokir install script yang belum disetujui; daftar yang diizinkan ada di field `allowScripts`
  pada `package.json` **root** (monorepo). Paket baru yang butuh postinstall: `npm approve-scripts <pkg>` lalu `npm rebuild <pkg>`.

## 2. Aturan port (berlaku di semua terminal & semua thread Claude)

Setiap komponen Akasha memakai **port default yang tetap** (proyek lain di laptop memakai port sendiri, lihat butir 5). Port ini
tidak boleh diganti per sesi/thread — konfigurasi (`.env`, proxy Vite, CORS, compose, `.claude/launch.json`, smoke
test) semuanya mengandalkan angka yang sama.

| Komponen | Port | Alamat | Diatur di |
|---|---|---|---|
| Frontend (Vite dev server) | **5173** | http://localhost:5173 | `apps/akasha/web/vite.config.ts` (`strictPort`) |
| Backend (NestJS API) | **4000** | http://localhost:4000/api/v1 · Swagger `/api/docs` | `apps/akasha/api/.env` `PORT` |
| SSO API (NestJS + OIDC) | **4300** | http://localhost:4300/api/health | `apps/auth/api/.env` `PORT` |
| SSO halaman masuk & akun (Vite) | **5175** | **http://auth.localhost:5175** (bukan `localhost:5175`) | `apps/auth/web/vite.config.ts` (`strictPort`) |
| Halaman depan workingspace.id (Vite, direncanakan) | 5176 | — | `apps/landing` (belum dibuat) |
| PostgreSQL | **5432** | db `akasha` (+ `akasha_shadow`), `workingspace_auth` (+ `workingspace_auth_shadow`) | `docker-compose.yml` |
| Redis | **6379** | — | `docker-compose.yml` |
| SeaweedFS S3 API / filer UI | **8333** / **8888** | filer: http://localhost:8888 | `docker-compose.yml` |
| ONLYOFFICE Docs (opsional, profile `office`) | **8080** | http://localhost:8080 (`/healthcheck` → `true`) | `docker-compose.yml` |
| Service robot Playwright (opsional, profile `robot`) | **4100** (hanya 127.0.0.1) | http://localhost:4100/health | `docker-compose.yml` |
| Agen Hermes (opsional, profile `agent`) | **8642** (hanya 127.0.0.1) | http://localhost:8642/health | `docker-compose.yml` |
| Markdown Converter (opsional, profile `converter`) | **4200** (hanya 127.0.0.1) | http://localhost:4200/health | `docker-compose.yml` |
| Prisma Studio (opsional) | 5555 | `npm --prefix apps/akasha/api run prisma:studio` | default Prisma |
| Vite preview build (opsional) | 4173 | `npm --prefix apps/akasha/web run preview` | default Vite |
| Stack produksi uji lokal (opsional) | 80 / 443 | http://localhost | `docker-compose.prod.yml` (Caddy) |

Aturan main:

1. **Satu komponen = satu proses.** Sebelum menyalakan apa pun, cek dulu (§6). Bila port sudah dipakai, berarti
   komponen itu **sudah menyala** (dari terminal lain, lazydocker, atau thread Claude lain) — pakai yang sudah ada,
   jangan menyalakan salinan kedua.
2. **Port tidak pernah "pindah".** Vite dikunci `strictPort: true` dan NestJS memakai `PORT` tetap; bila port sudah
   dipakai, server **gagal start** dengan pesan `Port 5173 is already in use` / `EADDRINUSE :::4000` — bukan diam-diam
   pindah ke 5174/4001. Pesan itu artinya: matikan proses lama (§5) atau pakai yang sudah berjalan.
3. **Thread Claude** mengikuti aturan yang sama (CLAUDE.md §2a): Claude mengecek status lebih dulu, memakai server yang
   sudah berjalan bila ada, dan hanya menyalakan yang belum aktif (lewat `.claude/launch.json`, port sama).
4. **SSO dibuka di `http://auth.localhost:5175`.** Alamat `*.localhost` otomatis menuju laptop sendiri (Chrome, Edge, Node) tanpa
   mengubah berkas hosts; alamat SSO dan cookie-nya terikat ke nama itu, jadi `http://localhost:5175` **tidak** dipakai.
5. Port 80/443 hanya dipakai stack produksi uji; matikan stack itu (`docker compose -p <nama> down -v`) setelah selesai.
6. **Proyek lain di laptop yang sama**: OnTrack Data Hub (sumber data SIMAN/MyIntress, docs/AI-AGENT.md §16) memakai port
   sendiri — web **5174**, API/MCP **3000**, PostgreSQL **5433**, Redis **6380** (keputusan 2026-10-24) — sehingga bisa
   menyala bersamaan dengan Akasha. Bila container OnTrack masih memakai 5432/6379 (versi lama), PostgreSQL/Redis Akasha
   menyala **tanpa port**: hentikan `docker stop ontrack_postgres ontrack_redis` lalu `docker restart akasha-postgres
   akasha-redis`.

## 3. Setup awal (sekali saja)

Lakukan sekali di laptop baru, setelah `git clone`, atau setelah reset total. Butuh koneksi internet (± 10–15 menit
untuk unduhan image Docker dan paket npm).

**Langkah 0 — Node.js** (major sesuai `.nvmrc`, saat ini 24). Pilih cabang sesuai hasil
`$env:PROCESSOR_ARCHITECTURE` (§1). Perintah `nvm use` mengubah symlink sistem, jadi jalankan di PowerShell
**Run as administrator** bila muncul error izin.

*Cabang A — Windows ARM64 (`ARM64`, Snapdragon):*

```powershell
cd D:\Development\Application\workingspace
nvm install 24 arm64            # pasang Node 24 terbaru versi arm64
nvm list                        # catat nomor versi lengkapnya, mis. 24.21.0
nvm use 24.21.0 arm64           # WAJIB menyebut arm64; tanpa itu nvm mencari versi x64 ("Version not installed")
node -p "process.version + ' ' + process.arch"   # harus berakhir "arm64"
```

*Cabang B — Windows x64 (`AMD64`, Intel/AMD):*

```powershell
cd D:\Development\Application\workingspace
nvm install 24                  # default nvm-windows = 64-bit (x64)
nvm list                        # catat nomor versi lengkapnya
nvm use <versi>                 # mis. nvm use 24.18.0
node -p "process.version + ' ' + process.arch"   # harus berakhir "x64"
```

**Salah arsitektur?** (mis. di Windows ARM terpasang x64: `nvm list` menampilkan *Currently using 64-bit
executable*). Pindah ke versi yang benar dulu, baru hapus yang salah — bila versi yang sedang aktif dihapus, perintah
`node` hilang sampai `nvm use` berikutnya:

```powershell
nvm install 24 arm64            # bila belum ada versi arm64
nvm use <versi-arm64> arm64
nvm uninstall <versi-x64>
```

Bila `node_modules` sudah pernah dipasang dengan Node arsitektur lain, hapus lalu pasang ulang agar paket native
sesuai: `Remove-Item -Recurse -Force node_modules` (folder `node_modules` di root; bila ada, juga di `apps\*\*\node_modules`) → ulangi
langkah 4.

Setelah `nvm install`, nvm menyarankan `nvm use <versi>` **tanpa** `arm64` — abaikan saran itu. nvm-windows tidak
mengingat pilihan arsitektur: setiap `nvm install`/`nvm use` di Windows ARM selalu ditambah `arm64`
(juga saat upgrade Node nanti, mis. ke 26).

**Langkah 1 — jaga WSL tetap hidup.** Buka tab terminal baru dan biarkan terbuka selama bekerja:

```powershell
wsl -e lazydocker       # tampilan container (tekan q untuk keluar)
```

Jalankan dari folder proyek: lazydocker membaca `docker-compose.yml` di folder itu, sehingga panel *Services*
langsung menampilkan `postgres`, `redis`, `storage` (status `none` = container belum dibuat; normal sebelum langkah 2).
(Tanpa lazydocker: `wsl -e sh -c "sleep infinity"`.)

**Langkah 2 — nyalakan infrastruktur** (PostgreSQL, Redis, SeaweedFS) di tab terminal utama:

```powershell
wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose up -d --wait"
```

Pertama kali, Docker mengunduh image (beberapa menit). Selesai bila ketiga container berstatus *Healthy/Started*.

**Langkah 3 — buat database tambahan** (sekali saja): `akasha_shadow` (cek drift skema Akasha), `workingspace_auth` (akun SSO) dan
`workingspace_auth_shadow`:

```powershell
wsl -e sh -c "docker exec akasha-postgres psql -U postgres -c 'CREATE DATABASE akasha_shadow' -c 'CREATE DATABASE workingspace_auth' -c 'CREATE DATABASE workingspace_auth_shadow'"
```

Pesan `already exists` untuk salah satunya aman diabaikan.

**Langkah 4 — Akasha**: file env, paket semua workspace, tabel database, akun demo.

```powershell
Copy-Item apps\akasha\api\.env.example apps\akasha\api\.env
npm install                                         # semua workspace (satu package-lock.json di root) + Prisma Client
npm --prefix apps/akasha/api run prisma:deploy      # membuat semua tabel Akasha
npm --prefix apps/akasha/api run prisma:seed        # pengaturan + akun demo
```

Isi kunci rahasia di `apps/akasha/api/.env` yang masih contoh (mis. `AI_ENCRYPTION_KEY`, `CREDENTIAL_ENCRYPTION_KEY`) dengan nilai
acak: `node -p "require('crypto').randomBytes(32).toString('hex')"`.

**Langkah 5 — SSO workingspace.id**: env (kunci dibuat otomatis), tabel, akun demo.

```powershell
npm run setup:dev -w @workingspace/auth-api         # membuat apps/auth/api/.env + mengisi SSO_* di apps/akasha/api/.env
npm --prefix apps/auth/api run prisma:deploy        # membuat tabel SSO (DB workingspace_auth)
npm --prefix apps/auth/api run prisma:seed          # aplikasi Akasha + akun demo SSO (sama dengan akun Akasha)
```

`setup:dev` aman dijalankan ulang: berkas yang sudah ada tidak diubah. Email (verifikasi, lupa kata sandi) di development tidak
dikirim, melainkan ditulis ke folder `apps/auth/api/.mail/`.

**Langkah 6 — coba jalankan** mengikuti §4, buka http://localhost:5173 lalu **Masuk dengan akun Workingspace** (atau kata sandi lokal di
bawahnya): `admin@workingspace.id` / `123` (akun kedua untuk uji berbagi: `user@workingspace.id` / `123`). Halaman akun SSO:
http://auth.localhost:5175. Opsional, pastikan semuanya sehat:

```powershell
npm run check                                       # Turborepo: lint, typecheck, test, build semua workspace
npm --prefix apps/akasha/api run test:smoke         # butuh backend Akasha yang sedang berjalan
npm --prefix apps/auth/api run test:smoke           # butuh SSO API yang sedang berjalan
node apps/akasha/api/test/sso-smoke.mjs             # Akasha ↔ SSO (± 3 menit); butuh keempat dev server
```

Setelah ini, cukup ikuti §4 setiap mulai bekerja.

**Setelah `git pull` / setelah Claude mengubah kode** (backend dimatikan dulu untuk langkah 2):

| Bila berubah | Jalankan |
|---|---|
| `package-lock.json` / `package.json` workspace mana pun | `npm install` (di root) |
| Folder baru di `apps/akasha/api/prisma/migrations/` | `npm --prefix apps/akasha/api run prisma:deploy` (lalu `npm --prefix apps/akasha/api run prisma:generate`) |
| Folder baru di `apps/auth/api/prisma/migrations/` | `npm --prefix apps/auth/api run prisma:deploy` (lalu `npm --prefix apps/auth/api run prisma:generate`) |
| `apps/auth/api/.env.example` punya variabel baru | Salin variabelnya ke `apps/auth/api/.env` |
| `apps/akasha/api/.env.example` punya variabel baru | Salin variabelnya ke `apps/akasha/api/.env` (backend menolak start bila env wajib kosong, §13) |
| `services/robot/` (kode robot) | `wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose --profile robot up -d --build --wait robot"` |
| `services/converter/` (kode converter) | `wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose --profile converter up -d --build --wait converter"` |
| `infra/onlyoffice/` | `wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose --profile office up -d --build --wait onlyoffice"` |
| `apps/akai/agent/hermes/` atau `apps/akai/agent/skills/` | Jalankan ulang `apps/akai/agent/hermes/up.sh` (§4 langkah 11) |

## 4. Menyalakan (setiap mulai bekerja)

**Ringkas** (lima tab PowerShell di folder proyek; langkah lengkap di bawah):

| Tab | Perintah | Biarkan terbuka |
|---|---|---|
| A | `wsl -e lazydocker` (atau `wsl -e sh -c "sleep infinity"`) | ya — menjaga WSL & Docker hidup |
| A2 / tab mana saja | `wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose up -d --wait"` | tidak (selesai sendiri) |
| B | `npm --prefix apps/akasha/api run dev` | ya — backend Akasha (4000) |
| C | `npm --prefix apps/akasha/web run dev` | ya — frontend Akasha (5173) |
| D | `npm --prefix apps/auth/api run dev` | ya — SSO API (4300) |
| E | `npm --prefix apps/auth/web run dev` | ya — halaman SSO (5175) |

Lalu buka http://localhost:5173 → **Masuk dengan akun Workingspace** (login `admin@workingspace.id` / `123`). Halaman akun & admin
SSO: http://auth.localhost:5175. Tanpa tab D & E Akasha tetap bisa dimasuki dengan kata sandi lokal (hanya di development).

0. **Cek status dulu** (§6) — nyalakan hanya yang belum aktif.
1. **Tab A — WSL & Docker**: `wsl -e lazydocker` (atau `wsl -e sh -c "sleep infinity"`). Biarkan terbuka.
2. **Infrastruktur** (aman dijalankan walau sebagian sudah menyala):
   ```powershell
   wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose up -d --wait"
   ```
3. **Tab B — backend** (tunggu sampai muncul log `Nest application successfully started`):
   ```powershell
   npm --prefix apps/akasha/api run dev
   ```
4. **Tab C — frontend**:
   ```powershell
   npm --prefix apps/akasha/web run dev
   ```
5. **Tab D — SSO API** (tunggu `Nest application successfully started`):
   ```powershell
   npm --prefix apps/auth/api run dev
   ```
6. **Tab E — halaman SSO**:
   ```powershell
   npm --prefix apps/auth/web run dev
   ```
7. Buka http://localhost:5173. Cek API: http://localhost:4000/api/v1/health dan http://localhost:4300/api/health (keduanya
   `"status":"ok"`). Halaman akun SSO: http://auth.localhost:5175 (bila super admin: menu **Kelola akun**).
8. **Opsional — ONLYOFFICE** (editor dokumen, menu Tools → ONLYOFFICE; butuh ± 1–2 GB RAM, start pertama ± 1–2 menit):
   ```powershell
   wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose --profile office up -d --wait onlyoffice"
   ```
   Pertama kali, perintah ini **membangun image** `akasha-onlyoffice:10.0` (image resmi + plugin AI ONLYOFFICE yang
   memakai AI Akasha, `infra/onlyoffice/Dockerfile`; butuh internet ± 1 menit). Font tambahan diunggah admin dari Tools → ONLYOFFICE (`apps/akasha/api/.env` perlu
   `ONLYOFFICE_FONTS_DIR`, lihat `apps/akasha/api/.env.example`).
   Cek: http://localhost:8080/healthcheck menampilkan `true`. Tanpa langkah ini aplikasi tetap jalan, hanya editor
   ONLYOFFICE yang tidak tersedia. `apps/akasha/api/.env` harus berisi variabel `ONLYOFFICE_*` (salin dari
   `apps/akasha/api/.env.example`, lalu restart backend). Detail: [ONLYOFFICE.md](ONLYOFFICE.md).

9. **Opsional — Service robot** (konektor e-Kinerja, SRIKANDI & SIMAN, tab **Connector** di menu grup Connection & MCP;
   ± 300–600 MB RAM saat dipakai). Menyalakan robot **tidak** menjalankan apa pun ke sistem pemerintah; jadwal otomasi
   hanya berjalan bila dinyalakan di tab Connector → Otomasi terjadwal:
   ```powershell
   wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose --profile robot up -d --wait robot"
   ```
   Pertama kali **membangun image** `akasha-robot` (image resmi Playwright + Chromium, unduhan ± 2 GB, ukuran ± 3,5 GB).
   `apps/akasha/api/.env` harus berisi `ROBOT_URL` & `ROBOT_TOKEN` (salin dari `apps/akasha/api/.env.example`, lalu restart backend).
   Cek: http://localhost:4100/health → `{"ok":true,…}`.

10. **Opsional — Markdown Converter** (Tools → Markdown Converter; MarkItDown + Docling, ± 1,2 GB RAM saat menyala). Berkas yang
   diunggah dibaca menjadi Markdown di laptop sendiri sehingga AI tidak memakai token untuk membaca berkas; tanpa converter
   aplikasi tetap jalan (pembaca bawaan + OCR AI):
   ```powershell
   wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose --profile converter up -d --wait converter"
   ```
   Pertama kali **membangun image** `akasha-converter` (± 10–15 menit, unduhan torch CPU + model Docling, ukuran ± 5 GB).
   `apps/akasha/api/.env` harus berisi `CONVERTER_URL` & `CONVERTER_TOKEN` (salin dari `apps/akasha/api/.env.example`, lalu restart backend).
   Cek: http://localhost:4200/health → `"ready": true` (± 20 detik setelah menyala, model Docling dimuat).

11. **Opsional — Agen Hermes** (menu **AI Agent**; ± 300–800 MB RAM; nyalakan setelah backend):
   ```powershell
   wsl -e sh /mnt/d/Development/Application/workingspace/apps/akai/agent/hermes/up.sh
   ```
   Pertama kali mengunduh image `nousresearch/hermes-agent`; skrip juga mengatur Hermes agar memakai model **lewat Akasha**
   (`apps/akai/agent/hermes/configure.sh`, tanpa API key di Hermes). Sekali di Akasha: API key di Pengaturan → Model AI, lalu
   **AI Agent → Status & Skill → Siapkan agen** (docs/TODO-USER.md A7).
   `apps/akasha/api/.env` harus berisi `HERMES_URL`, `HERMES_API_KEY`, `HERMES_OWNER_EMAIL` (salin dari `apps/akasha/api/.env.example`).
   Cek: http://localhost:8642/health → `{"status": "ok", …}`. ± 20 detik pertama Hermes masih menolak tugas (404) — normal.
   Hermes membaca alat MCP saat menyala: setelah izin agen diubah, jalankan
   `wsl -e sh -c "docker restart akasha-hermes"`.

Alternatif: minta Claude menyalakannya — Claude memakai konfigurasi yang sama (`.claude/launch.json`: `backend`, `frontend`,
`auth-api`, `auth-web`; port 4000, 5173, 4300, 5175) setelah mengecek status, jadi tidak akan bentrok dengan yang sudah berjalan.

Catatan: `401` dari `POST /auth/refresh` di console saat membuka aplikasi tanpa sesi, dan `502` pertama saat frontend
dibuka sebelum backend selesai kompilasi, adalah normal.

## 5. Mematikan (selesai bekerja / sebelum menutup laptop)

Data tetap aman — semua langkah di bawah hanya menghentikan proses, tidak menghapus data.

**Ringkas**: `Ctrl+C` di tab E, D, C, B → jalankan perintah di bawah → `q` di lazydocker (tab A) → opsional `wsl --shutdown`.

```powershell
wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose --profile office --profile robot --profile agent --profile converter stop"
```

1. **Dev server**: tekan `Ctrl+C` di Tab E, D, C, dan B (jawab `Y` bila ditanya *Terminate batch job*). Bila dinyalakan Claude,
   minta Claude "matikan semua".
2. **Infrastruktur Docker**:
   ```powershell
   wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose --profile office --profile robot --profile agent --profile converter stop"
   ```
   (`--profile office --profile robot --profile agent --profile converter` ikut menghentikan ONLYOFFICE, robot, Hermes & Markdown Converter bila menyala; aman walau tidak menyala. Di lazydocker: pilih container → tekan `s` untuk stop.) Gunakan **`stop`**, bukan `down -v` — `-v` menghapus data.
3. **Tab A**: keluar dari lazydocker (`q`) atau tekan `Ctrl+C` pada `sleep infinity`.
4. Opsional, membebaskan RAM laptop: `wsl --shutdown`.
5. Pastikan semua sudah mati dengan §6 (tidak ada port tersisa).

Menutup laptop tanpa langkah di atas juga tidak merusak data, tetapi dev server tetap memegang port. Bila nanti muncul
`Port 5173 is already in use` / `EADDRINUSE`, ada proses lama yang masih hidup — lihat §6 lalu hentikan.

### 5.1 Reset data development (opsional)

Data dev hanya data dummy dan boleh dihapus kapan saja (backend harus mati dulu):

```powershell
wsl -e sh -c "cd /mnt/d/Development/Application/workingspace && docker compose down -v && docker compose up -d --wait"
wsl -e sh -c "docker exec akasha-postgres psql -U postgres -c 'CREATE DATABASE akasha_shadow' -c 'CREATE DATABASE workingspace_auth' -c 'CREATE DATABASE workingspace_auth_shadow'"
npm --prefix apps/akasha/api run prisma:deploy
npm --prefix apps/akasha/api run prisma:seed
npm --prefix apps/auth/api run prisma:deploy
npm --prefix apps/auth/api run prisma:seed
```

Akun SSO & akun Akasha dibuat ulang dengan email yang sama; akun Akasha tertaut lagi ke akun SSO saat pertama kali masuk lewat SSO.

## 6. Cek status (apa yang sedang menyala?)

```powershell
# Port Akasha yang sedang dipakai + prosesnya (wslrelay = container Docker, node = dev server)
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 80,443,4000,4100,4200,4300,5173,5175,5432,6379,8080,8333,8642,8888 } |
  Sort-Object LocalPort -Unique |
  ForEach-Object { "{0}  pid={1}  {2}" -f $_.LocalPort, $_.OwningProcess, (Get-Process -Id $_.OwningProcess).ProcessName }

# Dev server Akasha (node) — termasuk yang dinyalakan Claude
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*workingspace*' } |
  Select-Object ProcessId, CommandLine

# WSL hidup? (bila tidak ada distro berjalan, semua container pasti mati)
wsl --list --running
```

Bila WSL berjalan, lihat container: `wsl -e sh -c "docker ps --format '{{.Names}} {{.Status}} {{.Ports}}'"` (atau
buka lazydocker). Container Akasha yang "Up" tetapi **tanpa port** = port direbut proyek lain (§2 butir 5).

Menghentikan dev server yang tertinggal (terminalnya sudah tertutup): `Stop-Process -Id <pid>` dengan `pid` dari
perintah di atas.

## 7. Infrastruktur (Docker)

```bash
docker compose up -d          # dari root repo (di WSL)
docker compose ps
```

| Service | Host port | Kredensial dev |
|---|---|---|
| PostgreSQL + pgvector | `5432` | db `akasha`, `postgres` / `postgres` |
| Redis | `6379` | — |
| SeaweedFS S3 API | `8333` | `akasha` / `akasha-secret` (`infra/seaweedfs/s3.json`) |
| SeaweedFS filer UI | `8888` | — |

Bucket `akasha-assets` dibuat otomatis oleh backend saat start.

Data PostgreSQL ada di volume Docker `akasha-postgres18-data` (nomor major di nama volume; image 18+ di-mount ke
`/var/lib/postgresql`). Database `akasha_shadow` (untuk cek drift, §10) dibuat manual sekali (§3 langkah 3).

### 7.1 Upgrade major PostgreSQL (data development)

Upgrade major (mis. 18 → 19) memakai volume baru + dump/restore; volume lama dibiarkan untuk rollback. Prosedur
produksi: [DEPLOYMENT.md §8](DEPLOYMENT.md#8-upgrade-major-postgresql-mis-18--19). Untuk data dev (folder
`backups/` di-ignore git):

```bash
# 1. Hentikan backend, backup semua database dari container lama
mkdir -p backups/pg-upgrade
docker exec akasha-postgres pg_dumpall -U postgres > backups/pg-upgrade/dumpall.sql      # cadangan lengkap
for db in akasha akasha_shadow; do
  docker exec akasha-postgres pg_dump -U postgres -Fc $db > backups/pg-upgrade/$db.dump
done

# 2. Ubah docker-compose.yml: tag image + nama volume baru (service postgres & daftar volumes), lalu
docker compose up -d --wait postgres                 # container baru, volume baru kosong

# 3. Restore
docker exec akasha-postgres psql -U postgres -c "CREATE DATABASE akasha_shadow"
for db in akasha akasha_shadow; do
  docker exec -i akasha-postgres pg_restore -U postgres -d $db --no-owner --exit-on-error < backups/pg-upgrade/$db.dump
done
docker exec akasha-postgres psql -U postgres -d akasha -c "ANALYZE"

# 4. Verifikasi: bandingkan jumlah baris per tabel (query COUNT_SQL di DEPLOYMENT.md §8) sebelum & sesudah,
#    lalu (di apps/akasha/api/) npx prisma migrate deploy, cek drift (§10), npm run test:smoke, buka UI.
# 5. Rollback: kembalikan docker-compose.yml lalu docker compose up -d (volume lama masih utuh).
#    Bila sudah stabil: docker volume rm akasha-postgres<lama>-data
```

## 8. Backend

```bash
cd apps/akasha/api
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
npm install
npx prisma migrate deploy       # terapkan semua migrasi
npm run prisma:seed             # pengaturan + akun demo
npm run dev                     # http://localhost:4000/api/v1
```

- Swagger UI: `http://localhost:4000/api/docs` (non-production).
- Health: `GET /api/v1/health` (readiness: database, redis, storage) dan `GET /api/v1/health/live` (liveness).
- Log: format mudah dibaca di development, JSON di production (`LOG_LEVEL`).
- Akun demo (seed development): `admin@workingspace.id` / `123` (super_admin), `user@workingspace.id` / `123` (member, untuk uji
  berbagi). Data setiap akun terisolasi — admin pun tidak melihat data akun lain kecuali dibagikan.
- Semua env divalidasi saat boot (`src/config/env.validation.ts`); daftar lengkap di `apps/akasha/api/.env.example`.
- **Basis pengetahuan (vault Obsidian)**: `KNOWLEDGE_VAULTS_DIR="../infra/knowledge-vaults"` — setiap subfolder = satu
  vault (tidak ikut git). Buat dari **Tools → Basis Pengetahuan → Buat vault baru dari templat**, lalu buka foldernya di
  Obsidian (*Open folder as vault*). Perubahan di Obsidian terbaca otomatis (± 3 detik). Folder `smoke-vault` dipakai
  ulang oleh smoke test.

| Perintah | Fungsi |
|---|---|
| `npm run dev` | server dengan watch |
| `npm run build` / `npm start` | build ke `dist/` lalu jalankan |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run prisma:generate` | generate Prisma Client |
| `npm run prisma:studio` | GUI database di http://localhost:5555 |
| `npm run db:generate-models` | regenerate model domain dari `src/records/record-schema.ts` |
| `npm run prisma:deploy` | terapkan migrasi |
| `npm run prisma:seed` | seed data |
| `npm test` | unit test (Vitest) |
| `npm run test:smoke` | uji end-to-end terhadap server yang berjalan (user sementara dibuat & dihapus; `API_URL`, `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`) |

## 9. Frontend

```bash
cd apps/akasha/web
npm install
npm run dev                     # http://localhost:5173 (port dikunci, §2)
```

Vite mem-proxy `/api` ke `http://localhost:4000`, sehingga frontend cukup memakai path relatif `/api/v1`
(override dengan `VITE_API_BASE_URL` bila API di host lain).

| Perintah | Fungsi |
|---|---|
| `npm run dev` | dev server + HMR |
| `npm run build` | typecheck + build produksi ke `dist/` |
| `npm run preview` | sajikan hasil build di http://localhost:4173 |
| `npm run lint` | oxlint (harus 0 warning) |
| `npm run format` / `format:check` | Prettier (config di root) |
| `npm test` | unit test (Vitest) |

## 9a. SSO workingspace.id (`apps/auth`)

| Bagian | Isi |
|---|---|
| `apps/auth/api` | NestJS + `oidc-provider`: akun, daftar + verifikasi email, lupa kata sandi, OIDC (kode + PKCE), admin akun, PIN keamanan; DB `workingspace_auth`; port 4300 |
| `apps/auth/web` | Vite + React: masuk, daftar, verifikasi, atur ulang kata sandi, **Akun**, **Admin**; port 5175, dibuka di http://auth.localhost:5175 (Vite meneruskan `/api`, `/oidc`, `/interaction` ke 4300) |

| Perintah (`npm --prefix apps/auth/api run …`) | Fungsi |
|---|---|
| `setup:dev` | membuat `.env` dev SSO + mengisi `SSO_*` Akasha (§3 langkah 5) |
| `dev` / `build` / `start` | server dengan watch / build / jalankan |
| `prisma:deploy` / `prisma:seed` / `prisma:generate` | migrasi, akun demo, Prisma Client |
| `test` / `test:smoke` | unit test / uji end-to-end SSO (akun sementara `smoke-*@example.test` dibuat & dihapus) |

- Rancangan, keputusan, dan status: [SSO.md](SSO.md). Uji Akasha ↔ SSO: `node apps/akasha/api/test/sso-smoke.mjs`.
- Email development ada di `apps/auth/api/.mail/` (berkas `.txt` berisi tautan verifikasi / atur ulang kata sandi).
- Login Google muncul setelah `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` diisi (docs/TODO-USER.md A42).

## 10. Alur kerja database

- Skema: `apps/akasha/api/prisma/schema.prisma`. Model domain (tabel `schedules`, `todos`, `resources`, `archive_*`, ...)
  **dibuat otomatis** dari `apps/akasha/api/src/records/record-schema.ts`.
- Mengubah/menambah field domain:
  1. Edit `record-schema.ts`.
  2. `npm run db:generate-models` (memperbarui `schema.prisma`).
  3. Buat migrasi. Bila `prisma migrate dev` tidak bisa interaktif, buat folder migrasi lalu:
     ```bash
     npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script \
       > prisma/migrations/<timestamp>_<nama>/migration.sql
     ```
     Shadow database diambil dari env `SHADOW_DATABASE_URL` (`.env`, dibaca `prisma.config.ts`); buat sekali:
     `CREATE DATABASE akasha_shadow;` (§3 langkah 3)
  4. `npx prisma migrate deploy` lalu `npx prisma generate`.
  5. Cek tidak ada drift: perintah diff yang sama dengan `--exit-code` (tanpa `--script`) harus keluar 0.
- Prisma: URL koneksi ada di `apps/akasha/api/prisma.config.ts` (bukan di `schema.prisma`). Prisma Client di-generate ke
  `apps/akasha/api/src/generated/prisma` (tidak di-commit) oleh `postinstall`/`npm run prisma:generate`; import dari path itu,
  bukan dari `@prisma/client`. `migrate dev`/`db push` tidak lagi menjalankan generate/seed otomatis.

## 11. Continuous Integration

`.github/workflows/ci.yml` menjalankan di setiap push/PR: lint, format check, typecheck, unit test, build (frontend &
backend), smoke test end-to-end terhadap infrastruktur Docker nyata, cek drift skema database, dan build image Docker.
Dependabot memperbarui dependensi npm, image Docker (Dockerfile & `docker-compose*.yml`), dan GitHub Actions setiap
minggu (minor/patch saja; lihat ARCHITECTURE.md §2.3).

## 12. Deployment

Lihat [DEPLOYMENT.md](DEPLOYMENT.md) (VPS dengan `docker-compose.prod.yml`: Caddy + HTTPS otomatis, backup harian).

## 13. Troubleshooting

| Gejala | Solusi |
|---|---|
| `Port 5173 is already in use` / `EADDRINUSE :::4000` | Dev server lama masih berjalan (terminal lain/Claude/terminal yang tertutup). Cek §6: pakai yang sudah ada, atau `Stop-Process -Id <pid>` lalu nyalakan lagi |
| `ECONNREFUSED` ke 5432/6379/8333, `/health` 503 | Container mati (WSL berhenti) → buka lazydocker/`sleep infinity` lalu `docker compose up -d` lagi (§4) |
| `Cannot connect to the Docker daemon` di WSL | Tunggu beberapa detik setelah WSL baru hidup, lalu ulangi |
| `database "akasha_shadow" already exists` | Aman diabaikan (sudah dibuat sebelumnya) |
| Vite menampilkan modul usang setelah banyak perubahan | Restart `npm run dev` frontend |
| `Konfigurasi environment tidak valid` saat backend start | Lengkapi `apps/akasha/api/.env` sesuai `.env.example` (mis. setelah `git pull` menambah variabel baru seperti `AI_ENCRYPTION_KEY`: buat dengan `node -p "require('crypto').randomBytes(32).toString('hex')"`) |
| Fitur AI: "AI belum diatur" / "Model … tidak tersedia" / "API key … ditolak" | Buka **Pengaturan → Model AI**: simpan API key, pilih provider aktif, ganti model bila provider menghentikannya, lalu **Uji koneksi** |
| Prisma error tabel/kolom tidak ada | `npx prisma migrate deploy` lalu `npx prisma generate` |
| `Cannot find module '../generated/prisma/client'` | Prisma Client belum dibuat → `npm install` atau `npm --prefix apps/akasha/api run prisma:generate` |
| Node/npm terasa lambat di Windows ARM, `node -p "process.arch"` = `x64` | Node x64 berjalan lewat emulasi → pasang versi arm64 (§3 langkah 0, "Salah arsitektur?") lalu pasang ulang `node_modules` |
| `nvm use 24.x.x` → `Version not installed` padahal ada di `nvm list` | Versi itu arm64 → `nvm use 24.x.x arm64` |
| `npm install`: beberapa `moderate`/`low` vulnerabilities | Sudah diketahui (UPGRADE-PLAN.md §3): hanya perkakas pengembangan (`minimatch`, `deepmerge` lewat CLI `shadcn`), tidak masuk aplikasi; `npm audit --omit=dev` bersih. **Jangan** `npm audit fix --force` (bisa menurunkan paket utama dan merusak proyek) |
| Backend/WSL menggantung, `/health` timeout, `docker ps` tidak menjawab | Docker macet: `wsl --shutdown`, lalu nyalakan lagi dari §4 langkah 1 (data aman). Bila `wsl --shutdown` ikut menggantung, restart Windows |
| Container `akasha-redis` terus restart setelah `wsl --shutdown` | Berkas AOF Redis rusak di ujungnya — lihat CLAUDE.md §15 (perintah `redis-check-aof --fix`) atau minta Claude |
| Teks merah `NativeCommandError` / `RemoteException` di PowerShell saat `npm install`/Prisma | Bukan error: PowerShell menampilkan output stderr (mis. "Loaded Prisma config…") sebagai merah. Lihat baris terakhir perintah |
| Login gagal `429` | Batas 10 login/menit (mis. smoke test berulang) — tunggu satu menit |
| Halaman SSO: "Sesi masuk sudah kedaluwarsa" / dialihkan terus ke halaman masuk | Buka SSO di **http://auth.localhost:5175**, bukan `localhost:5175` (§2 butir 4); tutup tab lalu masuk ulang dari Akasha |
| Tombol **Masuk dengan akun Workingspace** tidak muncul di Akasha | `SSO_*` di `apps/akasha/api/.env` kosong → `npm run setup:dev -w @workingspace/auth-api` lalu restart backend Akasha |
| Masuk lewat SSO → "Layanan akun Workingspace tidak dapat dihubungi" | Tab D/E (SSO API & halaman SSO) belum menyala (§4 langkah 5–6) |
| Email verifikasi / lupa kata sandi tidak datang (development) | Memang tidak dikirim: buka berkas terbaru di `apps/auth/api/.mail/` |
