# SSO workingspace.id & halaman depan (tahap B no. 5)

Dokumen kerja, dimulai 2026-11-16. Rencana besar & urutan tahap: `docs/AKASHA-PLAN.md`. Keputusan pemilik dicatat di §1 lalu
di CLAUDE.md §12.

## 1. Keputusan pemilik (2026-11-16)

| No | Pertanyaan | Keputusan |
|---|---|---|
| SSO-1 | Mesin SSO | **Dibangun sendiri** (`apps/auth/api`, NestJS, stack sama dengan Akasha), bukan Keycloak / Authentik / Zitadel |
| SSO-2 | Pendaftaran akun | **Daftar sendiri dengan email + masuk dengan Google.** Email verifikasi & lupa kata sandi dikirim dari `noreply@workingspace.id` lewat **Titan Email** (layanan milik pemilik) |
| SSO-3 | Role | **Role per aplikasi**: SSO menyimpan akun + super admin ekosistem + aplikasi yang boleh dibuka & role-nya per aplikasi |
| SSO-4 | PIN keamanan | **Pindah ke akun SSO**: satu PIN untuk semua aplikasi; status "terbuka" tetap per sesi tiap aplikasi |

## 2. Rancangan

### 2.1 Komponen

| Komponen | Folder | Dev | Produksi |
|---|---|---|---|
| Layanan SSO (API + OIDC) | `apps/auth/api` (`@workingspace/auth-api`) | `http://localhost:4300` | `auth.workingspace.id/api/*`, `/oidc/*` |
| Halaman masuk/daftar/akun | `apps/auth/web` (`@workingspace/auth-web`) | `http://auth.localhost:5175` | `auth.workingspace.id` |
| Halaman depan | `apps/landing` (`@workingspace/landing`) | `http://localhost:5176` | `workingspace.id` |
| Database SSO | DB `workingspace_auth` (+ `workingspace_auth_shadow`) di server PostgreSQL yang sama | 5432 | container postgres produksi yang sama |

Port baru (4300, 5175, 5176) ditambahkan ke aturan port CLAUDE.md §2. `*.localhost` otomatis menuju 127.0.0.1 di Chrome/Edge,
jadi asal halaman SSO berbeda dari Akasha (`localhost:5173`) tanpa mengubah berkas hosts — sama seperti produksi.

### 2.2 Protokol: OpenID Connect

- Mesin OIDC = pustaka **`oidc-provider`** (panva, MIT, pure JS, tersertifikasi OpenID) di dalam `apps/auth/api`; akun, halaman,
  email, Google, role, dan PIN = kode sendiri. Menulis protokol OIDC dari nol ditolak: rawan celah keamanan.
- Klien = **`openid-client`** (panva) di backend tiap aplikasi.
- Alur = **authorization code + PKCE**, klien **confidential** (backend aplikasi memegang `client_secret`). Token tidak pernah
  sampai ke JavaScript browser.
- Kunci tanda tangan = RS256/ES256 dengan **JWKS** (`/oidc/jwks`), dirotasi lewat env; aplikasi memverifikasi `id_token` tanpa
  memanggil SSO.
- Klien terdaftar statis di konfigurasi SSO (env per aplikasi: `client_id`, secret, redirect URI). Aplikasi baru = satu entri.

### 2.3 Sesi

- **Sesi SSO**: cookie httpOnly di host `auth.workingspace.id` saja (host-only, `SameSite=Lax`), bukan `Domain=.workingspace.id`
  — aplikasi lain tidak bisa membaca/menimpa sesi SSO.
- **Sesi aplikasi tetap milik aplikasi**: Akasha tetap memakai access JWT 15 menit + refresh cookie `akasha_rt` berotasi yang sudah
  ada. Yang berubah hanya cara masuk: `GET /auth/sso/start` → SSO → `GET /auth/sso/callback` (tukar kode, cocokkan akun, buat sesi
  Akasha). Sudah masuk SSO = langsung kembali tanpa mengetik kata sandi (single sign-on).
- **Keluar**: keluar dari Akasha menghapus sesi Akasha lalu mengarahkan ke `end_session` SSO (keluar dari semua aplikasi di
  perangkat itu). Sesi Akasha di perangkat lain tetap sampai kedaluwarsa / dicabut dari halaman akun.
- Sakelar admin/akun: akun dinonaktifkan atau akses aplikasi dicabut di SSO → refresh sesi Akasha berikutnya ditolak (Akasha
  memeriksa status akun ke SSO saat refresh, di-cache singkat).

### 2.4 Data

**SSO** (DB `workingspace_auth`): `accounts` (email unik, nama, hash kata sandi argon2 — boleh kosong untuk akun Google saja,
email terverifikasi, status aktif, super admin ekosistem), `account_identities` (Google `sub`), `apps` (kunci aplikasi, nama,
alamat), `app_memberships` (akun × aplikasi × role `admin | member`), `email_tokens` (verifikasi / reset, hash, kedaluwarsa,
sekali pakai), `account_pins` (hash PIN, hitungan salah, blokir — aturan blokir bertahap dipindah dari Akasha), tabel penyimpanan
`oidc-provider` (sesi, grant, kode; adapter Prisma sendiri), log keamanan (masuk, gagal, ganti kata sandi, reset).

**Akasha** tetap menyimpan profil & data aplikasinya di `users`; kolom baru `sso_subject` (unik) menautkan ke akun SSO.
`password_hash`, `pin_*` dihapus setelah migrasi selesai. Nama & email disalin dari klaim token setiap masuk. Role Akasha =
klaim role aplikasi `akasha` dari SSO (super admin ekosistem = `super_admin` Akasha). Akun SSO yang belum pernah membuka Akasha
dibuatkan baris `users` saat pertama masuk (bila punya akses aplikasi `akasha`).

Isolasi data tidak berubah: setiap aplikasi tetap hanya memberi data milik user itu + yang dibagikan; super admin hanya
mengelola akun, tidak melihat isi data.

### 2.5 Pendaftaran, verifikasi, lupa kata sandi

- Daftar: nama, email, kata sandi (min. 8 karakter, cek kata sandi umum) → email verifikasi (tautan sekali pakai, 24 jam). Belum
  terverifikasi = tidak bisa masuk aplikasi.
- Akses aplikasi bawaan untuk akun baru diatur super admin per aplikasi (`apps.self_signup`: tidak ada / member). Usulan awal:
  Akasha **tidak** otomatis (super admin memberi akses), aplikasi lain menyusul.
- Lupa kata sandi: email tautan reset (1 jam, sekali pakai); berhasil = semua sesi SSO & refresh token aplikasi dicabut.
- Respons daftar / lupa kata sandi tidak membedakan email terdaftar atau tidak (tidak membocorkan keberadaan akun); rate limit.
- Email = **nodemailer** ke SMTP Titan (`smtp.titan.email`, port 465 TLS) dengan env `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASSWORD`, `MAIL_FROM="Workingspace <noreply@workingspace.id>"`. Kosong (dev) = email ditulis ke log & folder
  `apps/auth/api/.mail/` (tidak ikut git) agar alur bisa diuji tanpa mengirim. Kata sandi SMTP diisi pemilik di `.env`, tidak
  pernah lewat chat. DNS domain perlu SPF/DKIM/DMARC Titan agar email tidak masuk spam (TODO pemilik).

### 2.6 Masuk dengan Google

- OAuth client Google milik pemilik (Google Cloud Console → Credentials → OAuth client "Web application", redirect URI
  `https://auth.workingspace.id/api/google/callback` + dev `http://localhost:4300/api/google/callback`), env
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; kosong = tombol Google disembunyikan.
- Scope `openid email profile` saja. Email Google terverifikasi yang sama dengan akun email yang sudah ada → **ditautkan hanya
  setelah pemilik akun memasukkan kata sandinya sekali** (mencegah pengambilalihan akun lewat email yang sama).

### 2.7 PIN di SSO

- PIN diatur/diganti/direset (dengan kata sandi akun) di halaman akun SSO.
- Aplikasi memeriksa PIN lewat API server-ke-server SSO (`POST /api/pin/verify`, autentikasi klien aplikasi + `sub`); blokir
  bertahap dihitung SSO (satu hitungan untuk semua aplikasi).
- Status terbuka tetap di aplikasi (Akasha: `refresh_tokens.pin_unlocked` per sesi), jadi logout tetap mengunci. Kirim Konsep /
  Kirim Penilaian tetap meminta PIN setiap kali, kini diverifikasi SSO.
- PIN tetap kunci akses, bukan enkripsi (CLAUDE.md §8 PIN keamanan).
- API (dibangun 2026-11-16): pemilik `GET|PUT|DELETE /api/pin` (sesi halaman SSO; PUT = atur / ganti / atur ulang PIN yang lupa dan
  membuka blokir); aplikasi `POST /api/pin/verify { sub, pin }` → 200 `{ valid }` / 400 `PIN_WRONG` / 409 `PIN_NOT_SET` / 429
  `PIN_BLOCKED` / 403 tanpa akses aplikasi, dan `GET /api/pin/status?sub=` (HTTP Basic klien OIDC).

### 2.8 Halaman depan `workingspace.id`

Halaman statis ringan (Vite + React + token desain yang sama): nama ekosistem, kartu aplikasi (Akasha, Akai, Cendikia — yang belum
ada berlabel "segera"), tombol Masuk / Daftar ke SSO. Tanpa backend. Setelah masuk, halaman akun SSO (`auth.workingspace.id`)
menampilkan aplikasi yang boleh dibuka.

### 2.9 Produksi

Caddy: satu blok per host (`workingspace.id`, `auth.workingspace.id`, `akasha.workingspace.id`, kelak `akai`, `cendikia`).
`auth.workingspace.id`: `/api/*`, `/oidc/*`, `/interaction/*` → `auth-api:4300`, selebihnya → `auth-web` (nginx). Image:
`apps/auth/api/Dockerfile` (migrasi saat start) dan `apps/auth/web/Dockerfile` + `nginx.conf` (CSP ketat, `frame-ancestors 'none'`).
Service baru `auth-api` (Node) + `auth-web` & `landing` (nginx statis). Kunci JWKS & secret klien = env. Backup harian ikut
mencadangkan DB `workingspace_auth`. Diuji dengan stack produksi lokal sebelum VPS (tahap D).

## 3. Urutan kerja

1. **B1 — Layanan SSO**: `apps/auth/api` (DB, akun, daftar + verifikasi email, masuk, lupa kata sandi, OIDC, Google, admin akun &
   akses aplikasi, PIN, log keamanan) + `apps/auth/web` (masuk, daftar, verifikasi, reset, akun, admin) + unit & smoke test.
2. **B2 — Akasha memakai SSO**: OIDC client, tautan akun (`sso_subject`), role dari klaim, PIN lewat SSO, Pengaturan → Manajemen
   User diarahkan ke admin SSO (statistik pemakaian tetap di Akasha), login lama dihapus; smoke Akasha masuk lewat SSO.
3. **B3 — Halaman depan** `apps/landing`.
4. **B4 — Produksi**: compose, Caddy, backup, uji stack produksi lokal.

## 4. TODO pemilik (juga di docs/TODO-USER.md)

- Buat OAuth client Google (§2.6) dan isi `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` di `apps/auth/api/.env`.
- Isi kredensial SMTP Titan untuk `noreply@workingspace.id` di `apps/auth/api/.env`; tambahkan record DNS SPF, DKIM, DMARC dari
  panel Titan ke domain `workingspace.id`.

## 5. Status

| Bagian | Status |
|---|---|
| Rancangan & keputusan | ✅ 2026-11-16 |
| B1 Layanan SSO | 🚧 inti API ✅ 2026-11-16 (akun, email, sesi, OIDC; unit 10, smoke 54) + halaman web ✅ 2026-11-16 (masuk, daftar, verifikasi, lupa/reset, akun; unit 3; diuji di browser termasuk alur OIDC dari "Akasha", akun tanpa akses, Batal, 375 px); + admin ✅ 2026-11-16 (API `/api/admin/*` + halaman `/admin`; unit +5, smoke ± 84 cek, diuji di browser); + PIN ✅ (`/api/pin`, `/api/pin/verify` antar-server; unit +4, smoke PIN 21 cek) + Dockerfile api & web ✅ 2026-11-16 (image dibangun & dijalankan mode production: migrasi, health, discovery, CSP halaman); sisa: Google (A42) |
| B2 Akasha memakai SSO | 🚧 langkah 1 ✅ 2026-11-16 (masuk/keluar lewat SSO, tautan akun, role & pencabutan akses; `test/sso-smoke.mjs` 17/17); langkah 2 ✅ 2026-11-16 (PIN lewat SSO, konfirmasi robot dengan PIN, nama/email/role/kata sandi akun SSO hanya di SSO, tawaran PIN setelah masuk; `sso-smoke.mjs` 30 cek) |
| B3 Halaman depan | belum |
| B4 Produksi | belum |
