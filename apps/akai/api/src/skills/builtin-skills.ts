import { parseSkillMd, type SkillDef } from "./skill-logic";

/**
 * Skill bawaan Akai (6b.6) dalam format SKILL.md, sama untuk semua akun (pemilik bisa mematikannya per akun). Nama berawalan
 * `akai-` (dilarang untuk skill buatan pemilik). Menambah skill bawaan = entri baru di sini; tanpa migrasi.
 * Isi sengaja tidak menyebut nomor peraturan: format mengikuti kebiasaan umum naskah dinas, aturan instansi pengguna didahulukan.
 */
const SOURCES = [
  `---
name: akai-naskah-dinas
description: Menyusun naskah dinas instansi pemerintah Indonesia — surat dinas, nota dinas, surat undangan, surat edaran, surat tugas, surat keterangan, memo. Pakai saat pengguna minta dibuatkan/diperbaiki surat atau naskah dinas.
---

# Menyusun naskah dinas

1. Tentukan jenis naskah dari permintaan (surat dinas, nota dinas, undangan, edaran, surat tugas, keterangan). Bila tidak jelas dan
   berpengaruh pada format, tanyakan satu kali; selain itu pilih yang paling sesuai dan sebutkan pilihan Anda.
2. Susun bagian baku sesuai jenisnya:
   - **Kepala**: kop instansi (tulis sebagai penanda [KOP INSTANSI] bila tidak diberikan), nomor, sifat, lampiran, hal, tanggal,
     tujuan ("Yth. …").
   - **Batang tubuh**: pembuka (dasar/latar singkat), isi (pokok persoalan, rincian; pakai butir bernomor bila lebih dari dua hal),
     penutup ("Atas perhatian …, kami ucapkan terima kasih.").
   - **Kaki**: jabatan penanda tangan, ruang tanda tangan, nama & NIP (penanda [NAMA] / [NIP] bila tidak diberikan), tembusan bila ada.
   - Nota dinas: Kepada, Dari, Tembusan, Tanggal, Nomor, Sifat, Lampiran, Hal — tanpa kop surat keluar dan tanpa salam pembuka panjang.
   - Undangan: hari/tanggal, waktu (WIB/WITA/WIT), tempat, acara, dan permintaan konfirmasi bila perlu.
3. Bahasa: baku, lugas, kalimat aktif, ejaan sesuai EYD; hindari kata ganti "saya"/"kami" berlebihan; sebutkan tanggal lengkap.
4. Jangan mengarang nomor surat, nama pejabat, NIP, nomor/tahun peraturan, atau angka anggaran. Pakai penanda dalam kurung siku
   untuk data yang belum diketahui dan sebutkan di akhir data apa saja yang perlu dilengkapi.
5. Bila pengguna menyebut pedoman tata naskah instansinya, ikuti pedoman itu dan abaikan format di atas yang bertentangan.
6. Tulis naskah lengkap sebagai artifact type markdown (judul = jenis naskah + hal), lalu ringkas di luar artifact apa yang perlu dicek.
`,
  `---
name: akai-notulen-rapat
description: Menyusun notulen / risalah rapat dari catatan kasar, transkrip, atau rekaman yang sudah ditranskrip. Pakai saat pengguna minta notulen, risalah, atau ringkasan hasil rapat.
---

# Notulen rapat

Susun dengan bagian berikut (lewati bagian yang datanya tidak ada, jangan diisi karangan):

1. **Informasi rapat**: nama/topik rapat, hari & tanggal, waktu, tempat/media, pimpinan rapat, notulis, peserta (atau jumlah peserta).
2. **Agenda**: daftar pokok bahasan bernomor.
3. **Pembahasan**: per agenda, ringkas pendapat/penjelasan penting dengan menyebut pihak yang menyampaikan bila diketahui. Ringkas,
   bukan transkrip ulang.
4. **Kesimpulan / keputusan**: butir bernomor, kalimat tegas.
5. **Tindak lanjut**: tabel | No | Tindak lanjut | Penanggung jawab | Tenggat | — kosongkan sel yang tidak disebut (tulis "–").
6. **Penutup**: waktu rapat ditutup bila diketahui, tempat tanda tangan pimpinan rapat & notulis.

Aturan: pakai Bahasa Indonesia baku; bedakan fakta yang disebut dengan kesimpulan Anda; jangan menambahkan keputusan yang tidak ada di
sumber; bagian sumber yang tidak jelas ditandai "[tidak jelas]". Tulis notulen sebagai artifact type markdown.
`,
  `---
name: akai-telaahan-staf
description: Menyusun telaahan staf (telaah staf) untuk pimpinan — analisis persoalan dengan fakta, praanggapan, analisis, kesimpulan, dan saran tindak. Pakai saat pengguna minta telaahan staf, kajian singkat, atau bahan pertimbangan pimpinan.
---

# Telaahan staf

Format baku (judul tiap bagian bernomor romawi atau angka):

1. **Kepada / Dari / Tanggal / Hal** (penanda bila tidak diberikan).
2. **Persoalan**: satu-dua kalimat inti masalah yang perlu diputuskan pimpinan.
3. **Praanggapan**: asumsi yang dipakai karena data belum lengkap (tandai jelas sebagai asumsi).
4. **Fakta yang mempengaruhi**: data, dasar hukum/kebijakan yang disebut pengguna atau ada di sumber, kondisi lapangan. Jangan
   mengarang dasar hukum; bila perlu rujukan peraturan yang tidak diberikan, tulis "[dasar hukum perlu dilengkapi]".
5. **Analisis**: bandingkan alternatif (minimal dua bila memungkinkan) beserta keuntungan, risiko, dan dampak.
6. **Kesimpulan**: ringkas hasil analisis.
7. **Saran / tindakan yang disarankan**: butir yang bisa langsung diputuskan pimpinan.
8. Ruang tanda tangan penyusun.

Gaya: objektif, padat, tanpa opini yang tidak didukung fakta. Tulis sebagai artifact type markdown, lalu sebutkan data yang perlu
dilengkapi pengguna.
`,
  `---
name: akai-ringkasan-dokumen
description: Meringkas dokumen panjang (peraturan, laporan, kajian, PDF/berkas lampiran) menjadi ringkasan terstruktur dengan poin kunci, angka penting, dan tindak lanjut. Pakai saat pengguna minta ringkasan, intisari, atau poin penting sebuah dokumen.
---

# Ringkasan dokumen

1. Baca seluruh dokumen yang diberikan (lampiran, isi proyek, atau hasil alat) sebelum meringkas.
2. Susun:
   - **Identitas dokumen**: judul, jenis, penerbit/penyusun, nomor & tanggal — hanya yang tertulis di dokumen.
   - **Inti dalam 3 kalimat**.
   - **Poin kunci**: 5–10 butir, urut sesuai struktur dokumen (bab/pasal/bagian), sebut nomor bagian/halaman bila ada.
   - **Angka & tanggal penting**: tabel bila lebih dari tiga.
   - **Kewajiban / tindak lanjut** bagi pembaca bila dokumen mengatur sesuatu.
3. Jangan menambah informasi dari luar dokumen; bila pengguna bertanya hal yang tidak ada di dokumen, katakan tidak ada.
4. Ringkasan pendek (< 15 baris) cukup di jawaban; yang panjang tulis sebagai artifact type markdown.
`,
];

export const BUILTIN_SKILLS: SkillDef[] = SOURCES.map((text) => {
  const parsed = parseSkillMd(text);
  return {
    name: parsed.name ?? "",
    description: parsed.description ?? "",
    instructions: parsed.instructions,
    files: [],
  };
});
