# Kajian: Email, Kalender, dan Drive (Akun Tersambung)

Kajian 2026-11-17 atas permintaan pemilik, setelah menu Aplikasi MCP Akasha dihapus. Kebutuhan: (1) **email** untuk mengirim dan
mengambil email, (2) **kalender** untuk memasang agenda/task Akasha, (3) **drive** (Google Drive / OneDrive) sebagai penyimpanan
tambahan karena disk VPS terbatas, dengan prioritas terakhir tetapi tetap disiapkan. Belum ada kode; dokumen ini menjadi dasar keputusan.

## 1. Ringkasan rekomendasi

1. **Bangun sebagai integrasi native di Akasha**, bukan lewat MCP/AI. Memasang agenda ke kalender, mengambil email, dan memindah berkas
   adalah pekerjaan pasti yang berjalan terjadwal di latar belakang: harus andal, tanpa biaya model, dan tidak boleh "ditafsirkan" model.
   Akasha juga pemilik datanya (agenda, task, berkas).
2. **Satu kali sambung per akun, dipakai bersama**: token Google/Microsoft disimpan terenkripsi di Akasha (pola brankas yang sudah ada).
   Akai **tidak** menyambung ulang — chat/agen Akai memakai kemampuan ini lewat **alat MCP Akasha** (konektor Akasha di Akai sudah ada),
   mis. `list_emails`, `create_calendar_event`, dan `send_email` yang **menunggu persetujuan pemilik** seperti permintaan agen lain.
3. **Mulai dari yang tanpa OAuth** (cepat, hampir tanpa risiko verifikasi Google): langganan kalender ICS, kirim email lewat SMTP milik
   pengguna, ambil email lewat IMAP, salinan backup ke Drive/OneDrive lewat rclone. OAuth Google/Microsoft menyusul untuk sinkron dua arah.
4. **Drive sebagai penyimpanan = paling akhir**: lebih dulu manfaatkan dukungan **S3 yang sudah ada** (Cloudflare R2 / Backblaze B2 murah
   dan cepat). Drive cocok untuk **salinan backup** dan **arsip dingin** (berkas lama jarang dibuka), bukan penyimpanan utama.

## 2. Temuan per penyedia

### 2.1 Google (Gmail, Calendar, Drive)

| Hal | Temuan | Dampak |
| --- | --- | --- |
| Klasifikasi scope | `drive.file` = **tidak sensitif**; `calendar.events` = **sensitif**; `gmail.send` = **sensitif**; `gmail.readonly` / `gmail.compose` / `gmail.modify` = **terbatas (restricted)** | Membaca email lewat Gmail API butuh scope terbatas → verifikasi + audit keamanan tahunan (CASA) bila aplikasi dipakai umum |
| Mode Testing | Aplikasi External dalam mode Testing: **refresh token kedaluwarsa 7 hari** (kecuali scope identitas dasar), maks. 100 test user | Untuk pemakaian pribadi, mode Testing berarti sambung ulang tiap minggu — tidak praktis |
| Mode Production tanpa verifikasi | Laporan pengembang: token tidak lagi kedaluwarsa 7 hari; pengguna melihat layar "aplikasi belum diverifikasi" (batas 100 pengguna) | Layak untuk akun pemilik sendiri; **perlu dicek ulang di dokumentasi Google saat implementasi** |
| Akun Google Workspace kantor | Aplikasi tipe **Internal** di Workspace yang sama tidak perlu verifikasi | Bila email kantor memakai Google Workspace, ini jalur termudah |
| MCP resmi Google | Server MCP Gmail/Drive/Calendar masih **developer preview** (rilis bertahap mulai Mei 2026), butuh OAuth client sendiri | Cocok untuk chat ad-hoc di Akai, belum untuk fitur inti |
| Gmail tanpa OAuth | IMAP/SMTP dengan **sandi aplikasi** (wajib verifikasi 2 langkah) | Ambil & kirim email Gmail tanpa scope terbatas dan tanpa audit |
| Drive sebagai penyimpanan | Kuota upload ± **750 GB/hari per akun** (laporan komunitas, tidak dipublikasikan resmi), batas permintaan API; kuota gratis 15 GB dibagi dengan Gmail | Cukup untuk backup/arsip, tidak untuk penyimpanan utama yang sering diakses |

### 2.2 Microsoft (Outlook, Kalender, OneDrive)

| Hal | Temuan | Dampak |
| --- | --- | --- |
| API | **Microsoft Graph** untuk Mail, Calendar, OneDrive; satu pendaftaran aplikasi (Entra ID) melayani akun kerja/sekolah **dan** akun pribadi (Outlook.com) | Satu integrasi untuk tiga kebutuhan |
| Izin | `Mail.Read`/`Mail.Send`, `Calendars.ReadWrite`, `Files.ReadWrite` (izin delegasi, disetujui pengguna sendiri) | Tanpa audit seperti CASA Google |
| Token | Access token ± 1 jam, **refresh token 90 hari bergulir** (tiap refresh memberi token baru); kebijakan masa token tidak berlaku untuk akun pribadi | Selama dipakai rutin, koneksi tetap hidup; simpan token terbaru setiap refresh |
| MCP resmi Microsoft | Server Outlook Mail/Calendar resmi (Work IQ, Agent 365) **memerlukan lisensi Microsoft 365 Copilot**, tidak ada untuk Outlook.com pribadi; server komunitas (Softeria) memakai Graph | Jangan bergantung pada MCP Microsoft; pakai Graph langsung |
| IMAP/SMTP | Outlook.com & Exchange Online sudah mematikan sandi biasa (basic auth) → wajib OAuth | Untuk Outlook, IMAP tidak menghindarkan OAuth; Graph lebih tepat |
| OneDrive | Kuota gratis 5 GB, 1 TB dengan Microsoft 365 | Sama seperti Drive: cocok untuk backup/arsip |

### 2.3 Standar umum (email kantor, Zimbra, server lain)

- **IMAP/SMTP** (ambil & kirim) dan **CalDAV** (kalender dua arah) didukung hampir semua server email, termasuk Zimbra yang lazim dipakai
  instansi pemerintah, Fastmail, iCloud (sandi aplikasi). Menjadi jalur cadangan bila email kantor bukan Google/Microsoft.
- **ICS (iCalendar) feed**: Akasha menerbitkan alamat rahasia `…/calendar/<token>.ics` berisi agenda & task; Google Calendar, Outlook, dan
  kalender HP cukup **berlangganan** alamat itu. Tanpa OAuth sama sekali, satu arah (Akasha → kalender), diperbarui berkala oleh
  kalendernya (Google ± beberapa jam, tidak real-time). Jalan tercepat untuk "agenda Akasha tampil di kalender HP".

## 3. Kecocokan dengan arsitektur yang sudah ada

| Bagian Akasha/Akai | Dipakai untuk |
| --- | --- |
| Brankas kredensial robot (`credential-vault.ts`, AES-256-GCM + AAD) & `AiCrypto` | Menyimpan sandi aplikasi IMAP/SMTP dan token OAuth terenkripsi |
| Otomasi terjadwal BullMQ (`src/automation/`) | Tarik email & sinkron kalender berkala, dengan riwayat & notifikasi gagal yang sudah ada |
| Agenda (`schedule`), To-do, Task Working Space | Sumber acara kalender (ICS / push) |
| Approval + bot WhatsApp (`requests`, pola `source`) | Email masuk dari satker → pengajuan (`source: email`), pola sama dengan WhatsApp |
| Aksi agen menunggu persetujuan (`agent_actions`, `APPROVAL_KINDS`) | `send_email` dari agen hanya setelah pemilik menyetujui |
| `ObjectStorageService` (satu titik akses S3) | Titik sambung "tingkat penyimpanan" Drive kelak (arsip dingin) tanpa mengubah fitur lain |
| Backup rclone (`infra/backup/`, remote `offsite`) | rclone sudah mendukung Google Drive & OneDrive → salinan backup luar server ke Drive cukup tambahan konfigurasi |
| Pola OAuth + `safe-fetch` (Konektor Akai 6b.10) | Dipakai ulang untuk OAuth Google/Microsoft di Akasha |
| Konektor Akasha di Akai | Jalur chat/agen Akai memakai email & kalender tanpa sambung ulang |

## 4. Usulan tahapan

| Tahap | Isi | OAuth? | Perkiraan |
| --- | --- | --- | --- |
| **0 — cepat, tanpa OAuth** | (a) **Langganan kalender ICS** agenda + task (alamat rahasia, bisa diganti/dicabut); (b) **Kirim email** dari Akasha lewat SMTP milik pengguna (ringkasan harian, kabar pengajuan, ekspor); (c) **Backup luar server ke Google Drive/OneDrive** lewat rclone | Tidak | kecil |
| **1 — email masuk** | Kotak masuk lewat **IMAP** (Gmail sandi aplikasi, Zimbra, dll.): baca berkala, aturan per pengirim/label → jadikan to-do, pengajuan (Approval), atau catatan; lampiran → berkas Akasha (dibaca Markdown Converter) | Tidak (IMAP) | sedang |
| **2 — Microsoft Graph & Google API** | "Akun tersambung" OAuth (client milik pemilik): Outlook mail/kalender/OneDrive lewat Graph; Google Calendar (`calendar.events`) & Gmail kirim (`gmail.send`). **Kalender dua arah**: kalender khusus "Akasha" di akun, acara Akasha dipasang & diperbarui, acara luar bisa diimpor sebagai agenda | Ya | sedang–besar |
| **3 — untuk Akai/agen** | Alat MCP Akasha: `list_emails`, `read_email`, `create_calendar_event`, `find_free_time`, `send_email` (**menunggu persetujuan**), `save_to_drive` | — | kecil |
| **4 — drive (paling akhir)** | (a) Lampirkan berkas dari Drive/OneDrive ke Resource (pilih → salin ke Akasha); (b) **Tingkat penyimpanan arsip dingin**: berkas lama/besar yang jarang dibuka dipindah ke Drive (`drive.file`) atau R2/B2, Akasha menyimpan metadata & mengambilnya saat dibuka | Ya | besar |

Catatan penyimpanan: sebelum tahap 4, cara termurah menambah ruang adalah mengisi `S3_*` ke **Cloudflare R2** (tanpa biaya keluar data) atau
**Backblaze B2** — sudah didukung tanpa kode baru, cepat, dan cocok untuk penyimpanan utama. Drive tidak memakai protokol S3, punya kuota
harian, dan lebih lambat untuk dibuka berulang.

## 5. Risiko & batasan

- **Verifikasi Google**: membaca Gmail lewat API = scope terbatas → audit CASA bila aplikasi dipakai banyak orang. Untuk pemakaian
  sendiri: IMAP + sandi aplikasi, atau aplikasi Production tanpa verifikasi (≤ 100 pengguna, layar peringatan) — dicek ulang saat membangun.
- **Kirim email atas nama pemilik** = tindakan keluar: dari agen wajib persetujuan; pengiriman massal tidak disediakan.
- **Kebijakan instansi**: email/kalender kantor bisa melarang akses aplikasi pihak ketiga atau sandi aplikasi; perlu dicek ke admin TI.
- **Privasi**: isi email & lampiran masuk ke database/indeks Akasha → ikut aturan kunci PIN, berbagi, dan bidang aktif yang ada; email tidak
  dikirim ke model kecuali pemilik bertanya / aturan agen memintanya.
- **Kuota & keandalan Drive**: batas harian dan pembatasan laju; jangan jadikan satu-satunya salinan berkas.

## 6. Keputusan pemilik (2026-11-17)

1. **Akun**: Gmail pribadi dan Outlook.com pribadi (keduanya, bisa lebih dari satu akun).
2. **Kalender**: **dua arah** (tahap 2); ICS satu arah dipasang dulu di tahap 0.
3. **Email masuk**: dibaca, bisa ditanyakan di chat, dan dijadikan to-do (mis. tagihan, jadwal); **wajib multi akun** (tahap 1).
4. **Urutan**: mulai tahap 0.

Catatan teknis dari keputusan itu: Outlook.com tidak menerima login kata sandi (SMTP/IMAP) sejak September 2024, jadi akun Outlook baru bisa
dipakai setelah login Microsoft (Graph, tahap 2). Gmail bisa langsung dengan **Sandi Aplikasi** (SMTP tahap 0, IMAP tahap 1).

## 7. Status tahap 0 (dibangun 2026-11-17)

- **Langganan kalender ICS** — `src/calendar-feed/` (logika murni + test `ics-logic.ts`): tabel `calendar_feeds` (satu per akun; token `cal_…`
  disimpan hash SHA-256 + terenkripsi kunci turunan `akasha:calendar-feed:v1` agar alamat bisa ditampilkan lagi). Endpoint `GET|PUT|DELETE
  /calendar-feed`, `POST /calendar-feed/rotate`, publik `GET /api/v1/public/calendar/<token>.ics` (text/calendar). Isi: agenda (berjam →
  UTC dari zona feed WIB/WITA/WIT; tanpa jam / multi-hari = sepanjang hari), Action/Task (tanggal tenggat, + nama Project/item Area), to-do
  (tanggalnya); rentang 60 hari ke belakang s.d. 365 hari ke depan, maks. 3.000 per jenis; hanya milik sendiri. Item terkunci PIN = judul saja
  (tanpa lokasi, keterangan, tautan). Pilihan isi (agenda/task/to-do) & zona waktu per akun.
- **Akun email** — `src/mail/` (logika murni + test `mail-logic.ts`): tabel `mail_accounts` (maks. 10 per akun, alamat unik per akun), preset
  Gmail (smtp.gmail.com:465, Sandi Aplikasi), Outlook (ditolak: butuh OAuth), SMTP lain (port 465/587/25/2525; host privat ditolak di production,
  juga setelah DNS diselesaikan). Kata sandi dienkripsi kunci turunan `akasha:mail-account:v1`, tidak pernah dikembalikan (`hasPassword`).
  Endpoint `/mail/presets`, `/mail/accounts` (CRUD), `POST /mail/accounts/:id/test`, `POST /mail/accounts/:id/digest` (kirim ringkasan hari ini
  sekarang). `MailService.send(userId, mail, accountId?)` untuk fitur berikutnya (akun utama bila tanpa id). Galat SMTP → 400 dengan pesan yang
  bisa ditindaklanjuti + status akun `error`.
- **Ringkasan harian** — per akun email: jam (HH:mm) + zona waktu; penjadwal di proses backend (tiap menit, klaim bersyarat `digest_last_sent`
  = tanggal lokal → sekali per hari). Isi: agenda hari ini (urut jam), to-do & task hari ini yang belum selesai, task terlambat ≤ 60 hari (maks.
  20); item terkunci PIN tidak dikirim. Gagal kirim dicatat di status akun dan dicoba lagi hari berikutnya.
- **Frontend** — Pengaturan → **Akun Tersambung** (`connected-accounts-tab.tsx`, hook `data/use-connected-accounts.ts`).
- **Backup ke Google Drive / OneDrive** — `infra/backup/backup.sh`: `OFFSITE_DRIVE_TYPE=drive|onedrive` + `OFFSITE_DRIVE_TOKEN` (JSON dari
  `rclone authorize`), dipakai bila `OFFSITE_S3_BUCKET` kosong; tetap lewat rclone crypt (`BACKUP_ENCRYPTION_PASSWORD`). Google Drive memakai
  scope `drive.file` (rclone hanya melihat berkas buatannya). Detail: DEPLOYMENT §4.1b.
## 8. Status tahap 1 — kotak masuk (dibangun 2026-11-18)

- **Sinkron IMAP per akun** (`src/mail/mail-inbox.service.ts`, logika murni + test `inbox-logic.ts`, pustaka `imapflow` + `mailparser`): sakelar
  **Kotak masuk** per akun email (multi akun), Gmail = `imap.gmail.com:993` dengan Sandi Aplikasi yang sama dengan SMTP, email lain = server/port isian
  (993 TLS / 143). Penjadwal di proses backend tiap menit menyinkron akun yang terakhir disinkron > 10 menit; sinkron pertama = email *n* hari terakhir
  (3/7/14/30/60), berikutnya hanya UID baru; maks. 100 email per sinkron (sisanya menyusul), maks. 2.000 per akun (yang tertua & belum ditindaklanjuti
  dibuang). **Hanya membaca**: kotak surat dibuka read-only, isi diambil tanpa menandai dibaca, tidak memindah/menghapus apa pun di server (diuji).
  Host privat ditolak di production (juga setelah DNS).
- **Tabel `mail_messages`**: salinan teks (HTML → teks, kutipan balasan panjang dibuang, maks. 60 rb karakter), nama & ukuran lampiran (berkas tidak
  disimpan), status `new | done | ignored`, `linked` (to-do / agenda yang dibuat). Unik per akun + UIDVALIDITY + UID.
- **Petunjuk otomatis tanpa AI** (`detectHints`): **tagihan** = kata kunci (tagihan, jatuh tempo, invoice, virtual account, cicilan, …) + nominal
  rupiah → nominal terbesar + tanggal jatuh tempo; **jadwal** = kata kunci (undangan, rapat, zoom, pukul, …) + tanggal → tanggal & jam. Tanggal
  Indonesia/Inggris (`25 November 2026`, `1 Des`, `25/11/2026`, ISO), hanya tanggal yang tidak sebelum tanggal email.
- **Jadikan to-do / agenda**: `POST /mail/messages/:id/todo|agenda` membuat record `todo` / `schedule` milik user lewat `RecordsService` (ID tetap
  `mail-<id>`: membuat ulang = memperbarui), usulan judul/tanggal/prioritas dari petunjuk (tagihan → "Bayar tagihan Rp …", prioritas tinggi).
- **Bisa ditanya AI** (opsional per akun, bawaan mati): email masuk indeks RAG (`sourceType = mail_message`, koleksi `workspace`) → chatbot & Pencarian
  Pintar (modul **Email**). Dimatikan / akun dihapus = potongan indeks dibuang.
- **Endpoint**: `PATCH /mail/accounts/:id/inbox`, `POST /mail/accounts/:id/inbox/sync`, `GET /mail/messages` (filter akun/status/cari, 50 per halaman),
  `GET|PATCH /mail/messages/:id`, `POST /mail/messages/:id/todo`, `POST /mail/messages/:id/agenda`.
- **Frontend**: menu **Email** (`/email/inbox|done|ignored`, `?message=<id>`): daftar gabungan semua akun + detail (petunjuk, Jadikan to-do / agenda,
  Selesai / Abaikan / Kembalikan, tautan ke to-do/agenda, nama lampiran); pengaturan per akun di Pengaturan → Akun Tersambung.
- **Diuji** dengan server email tiruan GreenMail di Docker (bukan akun sungguhan): sinkron, tanpa ganda, email baru, petunjuk, to-do & agenda,
  isolasi akun, hapus akun, email tetap belum dibaca di server.
- Belum: Outlook (Graph, tahap 2), aturan otomatis per pengirim/label, lampiran → berkas Akasha, jadikan pengajuan Approval, AI merangkum/mengusulkan,
  alat MCP (tahap 3).

## 9. Status tahap 2 — Google & Microsoft (dibangun 2026-11-18)

- **Akun OAuth** (`src/connections/`, logika murni + test `oauth-logic.ts`): tombol **Sambungkan Google / Microsoft** di Pengaturan → Akun Tersambung →
  halaman izin resmi penyedia (kode + PKCE S256, `state` sekali pakai 10 menit di memori) → callback publik
  `GET /api/v1/connections/oauth/callback` (lewat alamat frontend, sama seperti SSO) → tabel `oauth_accounts` (token terenkripsi kunci turunan
  `akasha:oauth-account:v1`, diperbarui otomatis; izin dicabut = status error "sambungkan ulang"). OAuth client **milik pemilik**: env
  `GOOGLE_OAUTH_CLIENT_ID/_SECRET`, `MICROSOFT_OAUTH_CLIENT_ID/_SECRET`, `MICROSOFT_OAUTH_TENANT` (bawaan `consumers` = Outlook.com pribadi).
- **Scope minimum**: Google hanya `calendar.app.created` (membuat kalender "Akasha" & mengelola acaranya; kalender lain tidak terbaca; Gmail tetap IMAP +
  Sandi Aplikasi karena scope baca Gmail butuh audit Google). Microsoft: `Calendars.ReadWrite`, `Mail.Read`, `Mail.Send`, `offline_access`.
- **Kalender dua arah** (`calendar-sync.service.ts`, logika murni + test `calendar-sync-logic.ts`): **Sambungkan kalender dua arah** membuat kalender baru
  **"Akasha"** di Google Calendar / Outlook (`calendar_connections`). Sinkron tiap ± 5 menit + tombol: (1) **tarik** perubahan acara di kalender itu
  (Google `syncToken`, Graph `calendarView/delta`; token kedaluwarsa = sinkron penuh) → buat / ubah / hapus agenda Planner (hapus = Sampah); (2) **kirim**
  agenda Akasha (30 hari ke belakang s.d. 365 hari ke depan, maks. 300 per sinkron) yang berubah sejak sinkron terakhir → buat / ubah / hapus acara.
  Pasangan agenda ↔ acara di `calendar_event_links` (etag/changeKey + sidik jari isi). **Bentrok** (berubah di kedua sisi) = yang lebih baru menang.
  Waktu dikirim dengan zona langganan kalender (WIB/WITA/WIT, bawaan WIB), sepanjang hari = tanggal akhir eksklusif. Agenda terkunci PIN dikirim judul &
  waktu saja dan tidak diubah dari kalender luar. Agenda berulang = tiap pertemuan satu acara. Putuskan kalender / akun = sinkron berhenti; agenda &
  kalender "Akasha" di penyedia tidak dihapus.
- **Email Outlook lewat Microsoft Graph**: **Pakai untuk email** membuat akun email `provider = outlook`, `authType = oauth` (tanpa sandi). Kirim (uji,
  ringkasan harian, `MailService.send`) = `POST /me/sendMail`; kotak masuk = `/me/mailFolders/inbox/messages/delta` (baca tidak menandai dibaca) →
  `mail_messages.external_id`, petunjuk tagihan/jadwal & jadikan to-do/agenda sama dengan IMAP.
- **Endpoint**: `GET /connections`, `POST /connections/oauth/start`, `GET /connections/oauth/callback` (publik), `DELETE /connections/:id`,
  `POST|PATCH|DELETE /connections/:id/calendar`, `POST /connections/:id/calendar/sync`, `POST /mail/accounts/outlook`.
- **Diuji** dengan server tiruan Google & Microsoft (OAuth + Calendar v3 + Graph) 26/26: izin & callback, state palsu ditolak, token tidak bocor,
  agenda → Google/Outlook (jam WIB, sepanjang hari), acara dari "HP" → agenda, ubah & hapus dua arah, bentrok, sinkron ulang tanpa perubahan, email
  Outlook kirim & masuk + petunjuk tagihan; plus alur tombol di browser. **Belum** diuji ke Google/Microsoft sungguhan (butuh OAuth client pemilik,
  TODO-USER A49). Env khusus uji `OAUTH_TEST_BASE` (ditolak di production) mengarahkan semua alamat ke server tiruan.
- Belum: impor kalender utama (bukan "Akasha"), Gmail lewat API, kontak, aturan email otomatis.

## 10. Status tahap 3 — alat untuk Akai/agen (dibangun 2026-11-18)

Alat MCP Akasha (dipakai konektor Akasha di Akai dan Hermes) dengan dua cakupan token baru:

| Alat | Cakupan | Fungsi |
| --- | --- | --- |
| `list_emails` | `mail:read` | Daftar email masuk semua akun (filter status, cari), petunjuk tagihan/jadwal — hanya membaca |
| `read_email` | `mail:read` | Isi lengkap satu email + usulan to-do/agenda — hanya membaca |
| `email_to_todo` | `mail:read` + `workspace:write` | Jadikan email to-do di Planner (judul/tanggal/prioritas bawaan dari usulan) |
| `find_free_time` | `workspace:read` | Jam kosong pada satu tanggal (di antara agenda berjam, jam kerja 08–17 bawaan) — hanya membaca |
| `request_send_email` | `mail:send` | **Permintaan** kirim email (penerima ≤ 10, isi ≤ 20 rb karakter) → `agent_actions` kind `send_email` (pending); terkirim dari akun pemilik **hanya** setelah pemilik klik **Setujui & kirim** (Approval → Usulan Agen / menu Email); Tolak = tidak terkirim |

Membuat acara kalender = `create_record` jenis `schedule` (sudah ada); agenda otomatis ikut ke kalender "Akasha" Google/Outlook bila kalender dua
arah tersambung — tidak ada alat kalender terpisah. Logika murni + test: `mail/agent-mail-logic.ts` (`freeSlots`, `checkAgentEmail`).
Diuji smoke (MCP JSON-RPC: waktu luang, daftar kosong, email tak dikenal, permintaan tanpa akun / penerima salah ditolak, permintaan menunggu
persetujuan, tolak). **Belum**: kirim yang disetujui ke penyedia sungguhan (butuh akun email pemilik), Akai/Hermes sungguhan memakai alat baru
(izin token perlu diperbarui, TODO-USER A50).

## 11. Status tahap 4 — Drive sebagai penyimpanan (dibangun 2026-11-18)

Keputusan pemilik: bangun **keduanya** (pilih berkas + arsip dingin), Google lewat **Picker resmi** (izin `drive.file`, bukan izin baca Drive
yang tergolong "terbatas" dan membuat sambungan kedaluwarsa tiap 7 hari selama aplikasi OAuth berstatus Testing).

**Izin Drive** diminta terpisah lewat tombol **Izinkan Google Drive / OneDrive** pada akun di Pengaturan → Akun Tersambung (OAuth ulang dengan
`login_hint`), agar sambungan kalender tetap sempit. Google: `drive.file`; Microsoft: `Files.Read` + `Files.ReadWrite.AppFolder`
(`DRIVE_SCOPES`, `hasDriveScope` di `connections/oauth-logic.ts`).

**(a) Dari Drive** — tombol di form lampiran (`AttachmentForm`) & form Resource, di samping "Dari MD Converter":
- **OneDrive**: dijelajahi di dialog Akasha (folder, naik, cari) lewat `GET /drive/accounts/:id/items?folder=&q=`.
- **Google Drive**: jendela kecil `/drive-picker` berisi Google Picker (modal aplikasi mengunci fokus & klik, jadi Picker tidak bisa di dalam
  modal); ID berkas dikirim kembali lewat `postMessage` (asal yang sama, penanda permintaan acak). Butuh env `GOOGLE_PICKER_API_KEY` +
  `GOOGLE_PICKER_APP_ID` (nomor project). Token akses akun dikirim ke browser untuk Picker (izinnya hanya kalender Akasha + `drive.file`).
- Berkas dialirkan `GET /drive/accounts/:id/files/:fileId/content` (dokumen Google diekspor ke DOCX/XLSX/PPTX/PDF; Formulir dll. ditolak;
  batas `UPLOAD_MAX_MB`, juga saat dialirkan) lalu diunggah lewat jalur unggah form biasa → Ringkas AI, File Control, dan buang saat Batal tetap
  berlaku. Berkas di Drive tidak berubah.

**(b) Arsip dingin** — kartu di Akun Tersambung (`users.cold_storage`: akun, tidak dibuka selama 3 bulan–2 tahun, ukuran minimum):
- Putaran tiap jam (dan **Pindahkan sekarang**): berkas `assets` yang `COALESCE(last_accessed_at, created_at)` lebih lama dari batas, maks.
  25 berkas / 2 GB per putaran, diunggah bertahap 10 MiB (Google resumable ke folder "Akasha Arsip" / OneDrive `createUploadSession` ke folder
  aplikasi "Arsip dingin"), dicatat di `cold_objects` (kunci = key objek), lalu objek dihapus dari bucket. Dibatalkan bila selama diunggah
  berkas berubah / dibuka / dihapus.
- **Tidak pernah dipindah**: berkas bertautan publik aktif, di brankas digital, konteks `knowledge_vault`, `office-template`, `notebook`.
- **Diambil kembali otomatis**: `ObjectStorageService.getObject/copyObject` → objek tidak ada → pengait `restore` mengunduh dari Drive ke bucket,
  menghapus salinan Drive, lalu membaca seperti biasa — berlaku untuk semua fitur (unduh, pratinjau, ONLYOFFICE, ekstraksi, robot, …). Satu
  pengambilan per key walau dibaca bersamaan. Gagal → 422 dengan pesan (bukan 5xx).
- "Terakhir dibuka" = `assets.last_accessed_at`, dicatat pengait `touched` paling sering sekali per 6 jam per objek.
- Hapus permanen objek (mis. Sampah dikosongkan) → salinan Drive ikut dihapus (pengait `removed`).
- **Kembalikan semua** = semua berkas diunduh kembali & pemindahan otomatis dimatikan. Memutuskan akun ditolak (409) selama masih ada arsip dingin
  di akun itu.
- **Risiko yang diterima**: berkas yang dipindah tidak lagi ada di bucket, jadi backup harian server tidak memuatnya (cermin `storage/current`);
  salinan satu-satunya di Drive pemilik. Kartu & konfirmasi menyebutnya.

Logika murni + test: `drive/drive-logic.ts` (berkas Google/OneDrive, ekspor, pengaturan, batch, nama berkas, potongan). Diuji dengan server tiruan
Google & Microsoft 38/38 (izin, ambil berkas & ekspor, OneDrive lewat pengalihan, pindah → buka → kembali, hapus permanen, berkas 21 MB = 3
potongan, Kembalikan semua, putuskan akun ditolak), smoke penuh, tombol Dari Drive & kartu di browser. **Belum**: Google/Microsoft sungguhan
(butuh OAuth client + API key Picker pemilik, TODO-USER A49 & A51), Picker Google di CSP produksi (domain Google ditambahkan ke `nginx.conf`,
belum diuji dengan Google sungguhan).

### 11a. Backup ke Drive & daftar arsip dingin (dibangun 2026-11-19)

- **Backup data Akasha ke Drive pemilik** (`drive/drive-backup.service.ts`, logika murni + test `backup-logic.ts`, tabel `drive_backups` &
  `drive_backup_files`, `users.drive_backup`): pemicu **tombol Backup sekarang** (kartu Pengaturan → Akun Tersambung `#backup` dan pita masa
  akses), **jadwal** mingguan/bulanan, dan **otomatis saat masa akses tinggal ≤ 7 hari / sudah habis** (sakelar, paling sering sekali seminggu).
  Isi satu backup = folder `Backup YYYY-MM-DD HHmm` (WIB) berisi `akasha-backup.json` (semua record, My Notebook, Pengajuan, pustaka
  Markdown, riwayat AI Agent, daftar berkas) + `README.txt`; isi berkas di folder bersama `berkas` (nama = 12 huruf checksum + nama asli),
  diunggah **sekali** per akun Drive + checksum lalu dipakai ulang. Berkas di arsip dingin hanya dirujuk. Simpan *n* backup terakhir (1–20);
  backup & salinan berkas yang tidak dipakai lagi dihapus dari Drive. Google: folder **Akasha Backup** (scope `drive.file`); OneDrive:
  `Apps › Akasha › Backup` (approot). Boleh jalan saat akun **baca saja** (daftar izin `ReadOnlyInterceptor`). Item terkunci PIN ikut tersalin.
  Endpoint `GET|PUT /drive/backup`, `POST /drive/backup/run`.
- **Mesin unggah bersama** `drive/drive-upload.service.ts` (sesi resumable Google / OneDrive per 10 MiB, folder, hapus) dipakai backup & arsip dingin.
- **Arsip dingin per berkas**: `GET /drive/cold/files` (nama berkas, akun, waktu dipindah & terakhir dibuka) + `POST /drive/cold/files/:id/restore`;
  dialog **Lihat berkas** di kartu Arsip dingin.
- Diuji: unit (logika + orkestrasi dengan tiruan Drive), smoke, kartu di browser (keadaan tanpa akun Drive). **Belum**: Google/Microsoft
  sungguhan (A49, A51, A54).

## 12. Berikutnya

Seluruh tahap 0–4 sudah dibangun. Lanjutan bila dibutuhkan: impor kalender utama (bukan hanya kalender "Akasha"), simpan hasil Akasha ke Drive
(`save_to_drive` untuk agen), aturan otomatis email.

## 13. Keputusan lama yang dibutuhkan dari pemilik (sudah dijawab, lihat §6)

1. **Akun yang dipakai**: Gmail pribadi? Email kantor (Google Workspace / Microsoft 365 / Zimbra / lainnya)? Outlook.com pribadi?
2. **Arah kalender**: cukup Akasha → kalender (ICS, tahap 0), atau dua arah (tahap 2)?
3. **Email masuk dipakai untuk apa**: dibaca/ditanya di chat saja, atau otomatis menjadi to-do / pengajuan Approval?
4. **Urutan**: setuju mulai dari tahap 0 (ICS + SMTP + backup Drive)?

## Sumber

- Klasifikasi scope & verifikasi Google: [Google — Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
  [Google — Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification),
  [Google Docs API scopes (drive.file)](https://developers.google.com/docs/api/auth),
  [Nylas — Google verification & security assessment](https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/),
  [Nango — Google security review](https://nango.dev/docs/api-integrations/google-shared/google-security-review)
- Token 7 hari mode Testing: [Unipile — Google OAuth refresh token](https://www.unipile.com/fr/jeton-dactualisation-google-oauth/),
  [Unipile — 100 user limit](https://www.unipile.com/google-oauth-100-user-limit/),
  [Sailjada — Testing ke Production](https://tech.sailjada.com/posts/2026-05-06-1850.html)
- MCP Google: [Google Workspace Updates (Mei 2026)](https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html),
  [Google Cloud — managed MCP servers](https://cloud.google.com/blog/products/ai-machine-learning/google-managed-mcp-servers-are-available-for-everyone)
- Microsoft: [microsoft/mcp](https://github.com/microsoft/mcp), [Scalekit — Microsoft 365 MCP vs Graph](https://www.scalekit.com/blog/microsoft365-mcp-vs-api),
  [Scalekit — Outlook MCP vs API](https://www.scalekit.com/blog/outlook-mcp-vs-api), [Carly — Outlook MCP gated behind Copilot](https://www.usecarly.com/blog/outlook-mcp/),
  [Microsoft Q&A — refresh token lifetime](https://learn.microsoft.com/en-us/answers/questions/724719/refresh-token-lifetime-and-refresh),
  [Microsoft — configurable token lifetimes](https://learn.microsoft.com/entra/identity-platform/configurable-token-lifetimes)
- Kuota Drive: [rclone forum — 750 GB limit](https://forum.rclone.org/t/what-does-rclone-copy-750gb-limit-apply-to/32672),
  [rclone forum — daily limits](https://forum.rclone.org/t/googledrive-daily-limits-upload-750gb-download-10tb/4145)
