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
| Halaman masuk/daftar/akun | `apps/auth/web` (`@workingspace/auth-web`) | `http://auth.workingspace.localhost:5175` | `auth.workingspace.id` |
| Halaman depan | `apps/landing` (`@workingspace/landing`) | `http://workingspace.localhost:5176` | `workingspace.id` |
| Database SSO | DB `workingspace_auth` (+ `workingspace_auth_shadow`) di server PostgreSQL yang sama | 5432 | container postgres produksi yang sama |

Port baru (4300, 5175, 5176) ditambahkan ke aturan port CLAUDE.md §2. `*.localhost` otomatis menuju 127.0.0.1 di Chrome/Edge,
jadi asal halaman SSO berbeda dari Akasha (`localhost:5173`) tanpa mengubah berkas hosts — sama seperti produksi. Host dev SSO
`auth.workingspace.localhost` & halaman depan `workingspace.localhost` sengaja satu "situs" (`workingspace.localhost`, sama seperti
`workingspace.id` / `auth.workingspace.id`) agar cookie SSO terkirim ke permintaan status dari halaman depan (§2.11). Resolver Windows
tidak mengenal `*.localhost`, jadi proses Node (backend Akasha dev, `sso-smoke.mjs`) memetakan nama itu ke `localhost`
(`apps/akasha/api/src/common/localhost-dns.ts`, hanya di luar production).

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

Halaman statis ringan (Vite + React + `@workingspace/ui`): hero aurora, kartu aplikasi (Akasha tersedia; Akai, Cendekia "segera
hadir"), keunggulan (satu akun, PIN bersama, data milik pemilik, Bahasa Indonesia, AI dengan kunci sendiri), sorotan modul
Akasha, tiga langkah mulai, tanya jawab, ajakan daftar; tombol Masuk / Daftar ke SSO, pengatur tema. Tanpa backend dan tanpa
membaca sesi (asal berbeda). Alamat dari env build `VITE_AUTH_URL`, `VITE_AKASHA_URL` (`src/config.ts`). Setelah masuk,
halaman akun SSO menampilkan aplikasi yang boleh dibuka.

### 2.9 Produksi

Caddy: satu blok per host (`ROOT_DOMAIN`, `www` → dialihkan, `AUTH_DOMAIN`, `APP_DOMAIN`; kelak `akai`, `cendekia`).
`SITE_SCHEME` (bawaan https) = http hanya untuk uji stack di laptop dengan `*.localhost` (SSO menerima http hanya untuk
`localhost`/`*.localhost`, `secureOrLocal`). Backend Akasha memanggil SSO lewat alamat publiknya; di jaringan Docker nama
`AUTH_DOMAIN` adalah alias Caddy. Rahasia SSO dibuat `apps/auth/api/scripts/generate-prod-secrets.mjs`. Panduan: DEPLOYMENT §16.
`auth.workingspace.id`: `/api/*`, `/oidc/*`, `/interaction/*` → `auth-api:4300`, selebihnya → `auth-web` (nginx). Image:
`apps/auth/api/Dockerfile` (migrasi saat start) dan `apps/auth/web/Dockerfile` + `nginx.conf` (CSP ketat, `frame-ancestors 'none'`).
Service baru `auth-api` (Node) + `auth-web` & `landing` (nginx statis). Kunci JWKS & secret klien = env. Backup harian ikut
mencadangkan DB `workingspace_auth`. Diuji dengan stack produksi lokal sebelum VPS (tahap D).

### 2.10 Identitas visual (halaman SSO & halaman depan)

Workingspace punya tampilan sendiri, terpisah dari Akasha (keputusan pemilik 2026-11-16), dan dipakai juga oleh halaman depan
`workingspace.id` (B3):

- **Warna**: tinta navy pekat (`ink`) + gradien "aurora" indigo → sian → lime (`--brand-indigo|cyan|lime`, aksen `coral`). Panel
  unggulan (hero, panel kiri halaman masuk, kepala laci) = `bg-aurora` + `bg-grid` dengan teks `text-ink-foreground` di kedua tema.
- **Huruf**: Plus Jakarta Sans (teks), Bricolage Grotesque (judul, `font-display`; `h1–h3` otomatis).
- **Utility** (`apps/auth/web/src/index.css`): `bg-aurora`, `bg-aurora-soft` (latar halaman), `bg-grid`, `text-gradient`,
  `ring-aurora` (tepi bergradien), `shadow-soft`, `shadow-lift`. Nama token shadcn (`--primary`, `--card`, …) tetap.
- **Komponen bersama**: `components/brand.tsx` (`LogoMark`, `Wordmark`, `UserAvatar` berwarna stabil dari id), `components/section.tsx`
  (`Section`, `StatusPill`), `components/account-shell.tsx` (sidebar desktop / menu geser HP, anchor bagian dengan penanda bagian aktif).
- **Subjudul logo** = "Single sign on". **Tema** Terang / Gelap / Ikuti sistem (`lib/theme.ts`, `ThemeToggle`; pilihan per peramban di
  localStorage `workingspace.theme`, bukan per akun karena halaman masuk dipakai sebelum masuk) di sidebar, bilah atas HP, dan panel
  halaman masuk.
- **Profil** (`PATCH /api/auth/me`): nama, nomor HP (dibakukan `+62…`, `profile-logic.ts` + test), alamat, pekerjaan / jabatan, tempat
  bekerja; isian kosong = dihapus. Dibagikan ke aplikasi lewat klaim OIDC: scope `profile` → `occupation`, `workplace` (klaim tambahan
  Workingspace), scope `phone` → `phone_number`, scope `address` → `address.formatted`. Admin melihat HP, pekerjaan, tempat bekerja di
  laci Kelola (alamat tidak).
- **Halaman akun** (`/account`, satu halaman beranchor: `#ringkasan #aplikasi #profil #keamanan` (Kata sandi & PIN, satu menu)
  `#pin #perangkat`): hero dengan skor
  keamanan (`securityChecks`), bagian **Akses** (aplikasi yang bisa dibuka) + aplikasi yang segera hadir (`UPCOMING_APPS`), profil, kata sandi, PIN, perangkat.
- **Halaman admin** (`/admin`, dimuat malas): kartu angka `GET /api/admin/stats` (klik = saring), saring `?status=all|active|unverified|
  disabled|super`, daftar akun, laci Kelola (`Sheet`; anak `SheetContent` wajib `shrink-0` karena isinya digulir), tab Aplikasi.

### 2.11 Keluar lintas aplikasi & status di halaman depan

- **OIDC Back-Channel Logout** (keputusan 2026-11-16, laporan pemilik: keluar dari SSO tetapi Akasha tetap masuk). Klien yang punya
  `backchannel_logout_uri` di `OIDC_CLIENTS` menerima sid di id_token. Saat aplikasi selesai otorisasi, SSO mencatat tabel
  `app_session_links` (sesi SSO `ws_sid` ↔ aplikasi + sid). Setiap sesi SSO berakhir — Keluar di halaman akun, keluarkan perangkat,
  ganti / atur ulang kata sandi, admin menonaktifkan / mengeluarkan akun, `end_session` — SSO mengirim logout token (JWT bertanda
  tangan, `OidcService.notifyLogout`) ke aplikasi itu **sebelum** sesinya dihapus. Proteksi SSRF bawaan oidc-provider (menolak alamat
  privat/loopback) dilewati hanya untuk alamat back-channel klien terdaftar (konfigurasi `fetch`).
- **Akasha** `POST /api/v1/auth/sso/backchannel-logout` (publik, form `logout_token`): tanda tangan diperiksa dengan JWKS SSO (`jose`),
  iss, aud = `akasha`, umur ≤ 5 menit, lalu `logoutTokenClaims` (event, jti, sid, tanpa nonce) → hapus `refresh_tokens` ber-`sso_sid`
  itu. `JwtStrategy` kini menolak access token yang sesinya (`sid`) sudah tidak ada (cache 10 dtk), jadi tab yang masih terbuka ikut
  keluar pada permintaan berikutnya. Sesi Akasha di peramban lain tidak tersentuh.
- **Masuk SSO = masuk aplikasi**: halaman masuk Akasha (tanpa sesi Akasha) otomatis memeriksa SSO secara diam-diam
  (`/auth/sso/start?silent=1` → parameter `ws_silent=1`, `extraParams` oidc-provider). SSO sudah masuk → interaksi langsung
  dilanjutkan (sejak awal: `InteractionController.start` meneruskan sesi `ws_sid` yang sah) dan Akasha masuk tanpa klik; belum masuk / tanpa
  akses → SSO menjawab `login_required` tanpa menampilkan halaman masuk → Akasha `/login?sso_checked=1` (tidak diperiksa ulang).
  `prompt=none` sengaja **tidak** dipakai: masuk di halaman SSO hanya membuat sesi `ws_sid`, sesi oidc-provider baru ada setelah
  interaksi pertama, sehingga `prompt=none` selalu menjawab `login_required`.
- **Keluar aplikasi = keluar SSO tanpa konfirmasi**: `end_session` yang diminta aplikasi terdaftar (`client_id` / `id_token_hint` sah,
  `post_logout_redirect_uri` terdaftar) menampilkan halaman yang mengirim formulir keluar otomatis (skrip ber-nonce, CSP sendiri;
  tanpa JavaScript tetap ada tombol). Dibuka langsung tanpa aplikasi → tetap halaman konfirmasi.
- **Satu alamat dev**: Vite SSO & halaman depan mengalihkan alamat lain (`localhost:5175`, `auth.localhost:5175`, `localhost:5176`)
  ke alamat kanonis (`canonicalHost`, `packages/ui/src/vite-canonical-host.ts`), karena cookie sesi terikat nama host.
- **Status di halaman depan**: SSO `GET /api/auth/status` → `{ signedIn, name }` dengan CORS + cookie hanya untuk `LANDING_URL`; halaman
  depan (`useSsoStatus`) mengganti Masuk/Daftar menjadi **Dashboard** (→ `/account`) dan tombol hero menjadi Buka dashboard / Buka
  Akasha. Produksi: CSP `connect-src` halaman depan diisi `AUTH_ORIGIN` (templat nginx `apps/landing/nginx.conf.template`).
- **Branding ekosistem** (pedoman pemilik 2026-11-18): satu sumber teks di `packages/ui/src/ecosystem.ts` (`ECOSYSTEM`, `PRODUCTS`):
  workingspace.id = *One Space. Infinite Possibilities.* / *Where Work, Mind, and Growth Align.*; **Akasha** = Productivity & Automation,
  *Where Ideas Find Their Place.*; **Akasha AI** (panggilan *Akai*, kunci aplikasi tetap `akai`) = The Intelligence Layer, *Intelligence That
  Moves With You.*; **Cendekia** = Self-Directed Learning, *Master Your Learning Journey.* (segera hadir). Tagline resmi berbahasa Inggris,
  penjelasan berbahasa Indonesia. Tanda produk di `brand.tsx`: `AkashaMark` (kisi 2×2, satu sel lime), `AkaiMark` (monogram A, juga dipakai
  Akai web), `CendekiaMark` (chevron naik), `ProductMark appKey`. Halaman depan, panel masuk SSO, dan kartu Aplikasi di halaman akun memakai
  nama & tagline dari berkas ini; nama aplikasi di tabel `apps` SSO = "Akasha AI" (seed). Halaman depan butuh `VITE_AKAI_URL` (build arg).

### 2.12 Pendaftaran lengkap, pengajuan akses & masa akses (2026-11-18)

Keputusan pemilik: akses aplikasi diberikan **terbatas** — pengguna mengajukan dengan tujuan/kepentingan, super admin memutuskan dan
**memilih lama akses** (30 hari / 3 bulan / 6 bulan / 1 tahun / tanpa batas; akses yang sudah ada sebelumnya = tanpa batas). Setelah masa
akses habis, data aplikasi **dibekukan (baca saja) 180 hari**, lalu **dihapus otomatis** dengan email pengingat; backup ke Google Drive
dibangun di tahap berikutnya (sekarang arahan saja).

- **Daftar** (`/register`, wizard 4 langkah: Akun → Data diri → Akses aplikasi → Periksa): No. HP, pekerjaan, tempat bekerja **wajib**,
  alamat opsional (aturan `profile-logic.ts`); pengajuan akses ikut dikirim (`requests: [{ appKey, purpose }]`, aplikasi
  `selfSignup` = langsung aktif, tidak diajukan). Pengajuan dari pendaftaran dikirim ke super admin **setelah email diverifikasi**.
- **Pengajuan** (`access_requests`: purpose 20–1000 karakter, status pending | approved | rejected, keputusan role + `duration_days` /
  catatan): `GET /api/access/apps` (publik, katalog daftar), `GET /api/access` (akun: semua aplikasi + masa akses + riwayat),
  `POST /api/access/requests`; perpanjangan dibuka 30 hari sebelum habis (atau setelah habis). Admin: `GET /api/admin/access-requests
  ?status=pending|all`, `POST …/:id/approve { role, days }` (perpanjangan selagi aktif dihitung dari akhir masa lama), `POST …/:id/reject
  { note? }`, `PUT /api/admin/accounts/:id/apps/:app { role, days? }` (atur masa langsung, dari hari ini), `stats.pendingRequests`.
  Email: pengajuan → semua super admin (`/admin#pengajuan`), keputusan → pengaju.
- **Masa akses** (`app_memberships.expires_at`, logika murni + test `src/access/access-logic.ts`): `active` → `read_only` (setelah
  `expires_at`, 180 hari) → `ended`. Super admin tidak dibatasi waktu. `ended` = tidak bisa membuka aplikasi (`canOpenApp`, klaim `apps`
  tanpa aplikasi itu) dan `/api/client/account` → `active: false`; `read_only` = masih bisa masuk. `/api/client/account` membawa
  `access { state, expiresAt, deleteAt }`. Pengingat email per tahap (`expiry_notice`): 7 hari sebelum habis, saat habis, 30 / 7 / 1 hari
  sebelum data dihapus — putaran tiap jam, satu email per putaran (klaim bersyarat).
- **Di Akasha**: kolom `users.access_expires_at` / `access_delete_at` diisi dari SSO saat masuk & refresh. Baca saja = penjaga global
  (`ReadOnlyInterceptor`, 403 `ACCESS_READ_ONLY`; yang tetap boleh: keluar/refresh/SSO, buka/kunci PIN, tautan unduh, editor ONLYOFFICE
  dipaksa mode lihat, MCP dengan alat tulis ditolak), pekerjaan latar belakang (sinkron email & kalender, otomasi robot, arsip dingin,
  cermin Obsidian) melewati akun beku, pita di atas konten (hampir habis ≤ 14 hari / dibekukan + tombol Ajukan perpanjangan & Backup ke
  Google Drive "segera"). `AccessCleanupService` (tiap 6 jam) menghapus akun yang `access_delete_at`-nya lewat **setelah** memastikan ulang ke
  SSO bahwa aksesnya `ended` (diperpanjang = tanggal diperbarui, SSO tak terjangkau = dilewati).
- Aplikasi lain (Akai) belum menerapkan baca saja — pola yang sama dipasang saat dibutuhkan.

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
| B3 Halaman depan | ✅ 2026-11-16 `apps/landing` + paket bersama `packages/ui` (token, logo, tema); unit 1, diuji di browser terang/gelap/375 px |
| B4 Produksi | ✅ 2026-11-16 compose (`auth-api`, `auth-web`, `landing`, env SSO Akasha, database `workingspace_auth` + backup), Caddy tiga host, CI (smoke SSO + image); diuji stack produksi lokal (lihat CLAUDE.md §11). VPS belum dibeli |
