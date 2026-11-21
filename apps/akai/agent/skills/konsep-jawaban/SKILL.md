---
name: konsep-jawaban
description: Menyusun konsep jawaban / surat balasan untuk satu pengajuan di Akasha (Approval) berdasarkan analisis kelengkapan & telaah yang sudah ada — meminta kelengkapan, menyampaikan tindak lanjut, atau menjawab pertanyaan pemohon. Pakai bila diminta membuat konsep jawaban/balasan pengajuan tertentu. Untuk PSP yang dokumennya dibuat workflow Penetapan SIMAN, konsep keputusan sudah dibuat skill penetapan-siman — skill ini hanya untuk surat balasan.
---

# Konsep jawaban pengajuan

Tujuan: konsep surat balasan yang siap disunting pemilik. Anda **tidak** mengirim, menyetujui, atau memberi nomor/tanggal naskah.

## Langkah

1. `get_request { requestId }` — baca `analysis` (checklist + tanda cek manual pemilik), `review` (telaah), `notes`, riwayat.
   - Belum ada analisis kelengkapan / telaah → jalankan skill **telaah-pengajuan** dulu (atau minta pemilik).
   - Riwayat memuat "telaah ulang sebelum memutuskan" (dokumen dibuat ulang) → telaah lama mungkin usang: jalankan
     telaah-pengajuan dulu.
   - Butir checklist `check.result = "lolos"` = sudah aman; `"bermasalah"` = masuk permintaan perbaikan/kelengkapan.
2. Tentukan jenis jawaban dari rekomendasi telaah: **permintaan kelengkapan** (sebut tiap kekurangan dengan jelas),
   **penyampaian tindak lanjut** (pengajuan diproses / diteruskan), atau **jawaban pertanyaan** (dasar hukum hanya dari
   `search_knowledge` berstatus berlaku, dengan sumber).
3. Susun konsep (Markdown, Bahasa Indonesia surat dinas): perihal, isi singkat, penutup; **tanpa** nomor/tanggal naskah, tanda
   tangan, atau penanda SRIKANDI. Bila ada templat surat yang cocok (`list_templates`), sebut namanya di laporan — pengisian
   templat dilakukan pemilik / `create_request_document` atas permintaan.
4. `update_request { requestId, draftReply, note: "Konsep jawaban disusun AI agent" }` (boleh `submitForReview: true`).
5. Laporkan ringkas: jenis jawaban, butir yang disebut, hal yang Anda ragukan.

## Batas

- Hanya alat MCP `akasha`. Tidak mengarang fakta, nomor peraturan, atau nama pejabat.
- Tidak mengirim email / WhatsApp / SRIKANDI.
