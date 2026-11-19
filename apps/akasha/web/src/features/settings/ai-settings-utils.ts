import type { AiSettings } from "@/types/api";

/** Tugas Akai yang dipakai fitur Akasha (urutan tampil). */
export const AKAI_TASKS = [
  { key: "chat", label: "Chat & asisten", uses: "Chatbot melayang, chat My Notebook" },
  { key: "general", label: "Umum", uses: "Ringkasan Notes AI, Approval, AI di editor, bot WhatsApp, ikon" },
  { key: "document", label: "Rapikan dokumen", uses: "Markdown Converter → Rapikan dengan AI" },
  { key: "ocr", label: "Baca gambar (OCR)", uses: "Teks gambar & PDF hasil scan saat berkas diunggah" },
  { key: "embedding", label: "Embedding", uses: "Indeks pengetahuan, Pencarian Makna, Catatan serupa" },
  { key: "transcribe", label: "Transkrip audio", uses: "Rekaman Notes AI (wajib model Gemini langsung)" },
  { key: "agent", label: "Agen", uses: "AI Agent (Hermes)" },
] as const;

/** Baris status per tugas: jumlah model di Akai (0 = belum diatur). */
export function akaiTaskRows(akai: AiSettings["akai"]) {
  return AKAI_TASKS.map((task) => ({ ...task, models: akai.tasks?.[task.key] ?? 0 }));
}
