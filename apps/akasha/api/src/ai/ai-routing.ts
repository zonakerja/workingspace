import type { AiErrorKind } from "./ai-errors";

/**
 * Tugas AI Akasha yang dijawab gateway Akai (pembagian tugas di Akai → Model): chat (asisten & My Notebook), fitur AI umum
 * (ringkasan, Notes AI, ikon, AI di editor dokumen), model agen Hermes, rapikan Markdown (Markdown Converter), dan OCR.
 */
export type AiTask = "chat" | "general" | "agent" | "document" | "ocr";

/**
 * Error sementara yang boleh dicoba lagi nanti (antrian indeks / ekstraksi): kuota/limit habis atau layanan tidak
 * terjangkau. Penolakan & permintaan tidak valid tidak diulang.
 */
export const isFallbackError = (kind: AiErrorKind) =>
  kind === "quota" || kind === "unavailable" || kind === "credential";
