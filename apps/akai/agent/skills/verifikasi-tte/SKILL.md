---
name: verifikasi-tte
description: Memverifikasi tanda tangan elektronik (TTE) dokumen PDF pengajuan / kelengkapan SIMAN lewat halaman verifikasi resmi pemerintah tte.komdigi.go.id/verifyPDF (alat verify_digital_signature), lalu mencatat hasil dan masalahnya di analisis kelengkapan pengajuan. Pakai bila diminta memeriksa keabsahan tanda tangan digital, atau sebagai bagian dari telaah-pengajuan untuk dokumen ber-TTE.
---

# Verifikasi tanda tangan elektronik (TTE)

Verifikator: halaman resmi Komdigi https://tte.komdigi.go.id/verifyPDF (tanpa login), dijalankan robot Akasha lewat alat
`verify_digital_signature { uploadId }` (± 20–60 detik per berkas; hasil tersimpan per berkas — panggilan berikutnya memakai hasil itu (`cached: true`) kecuali `refresh: true`). Berkas dikirim ke situs pemerintah itu — verifikasi hanya
berkas yang relevan (yang tampak ber-TTE), satu kali per berkas.

## Langkah

1. `get_request { requestId }` → daftar `files` (uploadId, mimeType). Pilih PDF yang tampak ditandatangani elektronik (teks
   `read_request_files` memuat "ditandatangani secara elektronik", "BSrE", "sertifikat elektronik", atau QR TTE). Untuk tiket
   SIMAN, berkas kelengkapan juga ada di `siman_ticket_result` (berkas → uploadId).
2. `verify_digital_signature { uploadId }` per berkas. Baca hasil:
   - `verdict: "valid"` — dokumen tidak dimodifikasi, identitas penandatangan terverifikasi, stempel waktu valid, sertifikat
     terpercaya, berlaku, tidak dicabut. Catat penandatangan, waktu, PSrE.
   - `verdict: "bermasalah"` — `issues` berisi masalahnya (dokumen dimodifikasi setelah ditandatangani, identitas tidak
     terverifikasi, sertifikat tidak terpercaya / kedaluwarsa / dicabut, stempel waktu tidak valid).
   - `verdict: "tanpa_tte"` — tidak ditemukan tanda tangan digital pada PDF; ini tidak berarti dokumen tidak ditandatangani.
     Bila tanda tangan atau meterai diwajibkan, gunakan `inspect_file` untuk mencatat apa yang tampak dan di halaman mana.
     Pisahkan hasil visual dari verdict Komdigi. Tanda tangan basah atau meterai yang tampak pada pindaian bukan bukti
     keaslian fisik. Jika keaslian hanya bisa dipastikan pemilik, minta pemilik membandingkannya dengan dokumen asli.
   - `verdict: "tidak_terbaca"` — halaman verifikasi tidak memberi hasil jelas → butir "perlu dicek" + `manual: true`.
   - `notes` (mis. tidak mendukung LTV) = informasi, **bukan** masalah keabsahan saat ini.
   - Bandingkan nama penandatangan dengan pejabat yang seharusnya (kepala satker pada surat): catat ketidaksesuaian sebagai masalah administrasi tanpa mengubah verdict Komdigi.
3. **Catat di analisis kelengkapan** (skill telaah-pengajuan): `update_request { analysis: { checklist, missing } }` — kirim
   kembali checklist lama lengkap dengan `id`-nya agar tanda pemilik tetap melekat dan pertahankan kekurangan lain yang masih berlaku.
   Tambahkan atau perbarui butir yang sesuai untuk tiap berkas:
   - valid → butir TTE `status: "ada"` bila penandatangan sesuai; catat penandatangan, waktu, PSrE, dan bahwa dokumen tidak dimodifikasi. Jika nama tidak sesuai, catat masalah administrasi di `missing` dan gunakan `status: "perlu_dicek"`.
   - bermasalah → butir TTE `status: "perlu_dicek"`, `manual: true`, catatan = isi `issues`; tambahkan juga ke `missing`.
   - tanpa_tte → bila TTE memang wajib, catat ketiadaannya sebagai kekurangan di `missing`. Bila tanda tangan basah diperbolehkan,
     catat verdict `tanpa_tte` dan pengamatan visual secara terpisah dalam butir tanda tangan/meterai dokumen, bukan sebagai butir TTE berstatus `ada`.
     Gunakan `status: "ada"` jika syarat dapat dipastikan dari bukti yang tersedia; gunakan `status: "perlu_dicek"` dan `manual: true` jika pemilik perlu memeriksa dokumen asli. Jangan masukkan `tanpa_tte` saja ke `missing` bila TTE tidak diwajibkan.
   - tidak_terbaca → sesuai langkah 2; jangan menyatakan valid atau tidak sah.
   Tambahkan ringkasan ke `notes` dengan `note: "Verifikasi TTE Komdigi dicatat AI agent"` (tanpa mengubah status).
4. Laporkan per berkas: verdict digital, penandatangan & waktu bila tersedia, masalah (bila ada), serta hasil pemeriksaan visual dan tindak lanjut fisik secara terpisah bila relevan.

## Batas

- Hanya membaca & mencatat. Hasil verifikasi apa adanya — jangan menyimpulkan TTE sah tanpa `verdict: "valid"`.
- Robot mati / galat → laporkan pesannya; jangan mengulang lebih dari 2 kali per berkas.
