/** Aturan pembagian tugas model (logika murni, diuji di task-logic.spec.ts). docs/AKAI.md §3. */

export const AI_TASKS = ["chat", "general", "agent", "document", "ocr", "embedding", "transcribe"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const TASK_LABELS: Record<AiTask, string> = {
  chat: "Chat & asisten",
  general: "Umum",
  agent: "Agen",
  document: "Rapikan dokumen",
  ocr: "Baca gambar (OCR)",
  embedding: "Embedding (pencarian makna)",
  transcribe: "Transkrip audio",
};

/** Maksimum model per tugas: 1 utama + 4 cadangan. */
export const MAX_MODELS_PER_TASK = 5;

export interface RoutableModel {
  id: string;
  enabled: boolean;
  vision: boolean;
  embedding: boolean;
  audio: boolean;
  sourceKind: string;
}

/**
 * Pesan galat bila daftar model (utama + cadangan, berurutan) tidak cocok untuk tugas, atau null.
 * Embedding hanya model embedding; OCR butuh baca gambar; transkrip hanya Gemini langsung (batasan router: tanpa audio).
 */
export function taskModelsProblem(task: AiTask, ids: string[], models: Map<string, RoutableModel>): string | null {
  if (ids.length > MAX_MODELS_PER_TASK) return `Maksimal ${MAX_MODELS_PER_TASK} model per tugas.`;
  if (new Set(ids).size !== ids.length) return "Model tidak boleh dipilih dua kali.";
  for (const id of ids) {
    const model = models.get(id);
    if (!model) return "Model tidak ditemukan.";
    if (!model.enabled) return "Model sedang dimatikan.";
    if (task === "embedding" && !model.embedding) return "Tugas embedding hanya bisa memakai model embedding.";
    if (task !== "embedding" && model.embedding) return "Model embedding hanya untuk tugas embedding.";
    if (task === "ocr" && !model.vision) return "Tugas OCR butuh model yang bisa membaca gambar.";
    if (task === "transcribe" && !(model.audio && model.sourceKind === "gemini"))
      return "Transkrip audio hanya bisa memakai model Gemini langsung yang mendukung audio.";
  }
  return null;
}
