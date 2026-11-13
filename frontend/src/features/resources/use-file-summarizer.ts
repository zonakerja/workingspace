import { useState } from "react";
import { toast } from "sonner";
import { useAi } from "@/lib/ai/use-ai";
import { ApiError, errorMessage } from "@/lib/api/client";
import { uploadsApi } from "@/lib/api/endpoints";

export type SummaryStatus = "idle" | "processing" | "done" | "error";

const FILE_SUMMARY_PROMPT =
  "Ekstrak dan buat ringkasan komprehensif dari dokumen ini untuk keperluan knowledge-base AI masa depan. Gunakan format Markdown yang rapi dan sertakan poin-poin penting. Gunakan delimiter $$ untuk blok rumus matematika.";

/**
 * Tunggu teks hasil baca server (Markdown Converter / pembaca bawaan) selesai — maks. ± 5 menit, karena Docling membaca
 * scan per halaman. `reason` = alasan tidak ada teks (mis. `too_large`, `ocr_off`).
 */
async function extractedText(uploadId: string): Promise<{ text: string; reason?: string }> {
  for (let i = 0; i < 200; i++) {
    const { extraction } = await uploadsApi.metadata(uploadId);
    if (extraction && extraction.status !== "pending" && extraction.status !== "extracting") {
      const text = extraction.status === "completed" ? (extraction.extractedText ?? "").trim() : "";
      return { text, reason: extraction.metadata?.reason };
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { text: "" };
}

const summaryPrompt = (text: string) =>
  [FILE_SUMMARY_PROMPT, "<dokumen>", text.slice(0, 150_000), "</dokumen>"].join("\n");

const isAiReadable = (mime?: string) =>
  !!mime && (mime === "application/pdf" || mime.startsWith("image/") || mime === "text/plain");

/**
 * Ringkasan AI otomatis untuk file yang baru diunggah (form task/project/resource).
 * Status: processing → done ("AI Ready") / error ("No AI").
 */
export function useFileSummarizer() {
  const ai = useAi();
  const [status, setStatus] = useState<SummaryStatus>("idle");

  /**
   * Ringkas berkas yang baru diunggah. Bila `uploadId` ada, AI menerima Markdown hasil baca server (Markdown Converter:
   * tanpa token untuk membaca berkas). Berkas mentah hanya dikirim ke AI bila server tidak menghasilkan teks.
   */
  const summarize = async (file: File, uploadId?: string): Promise<string | undefined> => {
    if (!ai.isConfigured) {
      setStatus("error");
      return undefined;
    }
    if (uploadId) {
      setStatus("processing");
      const { text, reason } = await extractedText(uploadId).catch(() => ({ text: "", reason: undefined }));
      if (text) return run(() => ai.generate(summaryPrompt(text), []));
      // ocr_off = user melarang berkas dibaca AI (Tools → Markdown Converter)
      if (reason === "ocr_off" || reason === "too_large") {
        setStatus("error");
        toast.info("Isi berkas tidak terbaca", {
          description:
            reason === "ocr_off"
              ? "Cadangan OCR AI dimatikan di Tools → Markdown Converter."
              : "Berkas terlalu besar untuk dibaca.",
        });
        return undefined;
      }
    }
    if (!isAiReadable(file.type)) {
      setStatus("error");
      toast.error("Format tidak didukung", { description: "Gunakan PDF, gambar, atau teks untuk ekstraksi AI." });
      return undefined;
    }
    return run(() => ai.generate(FILE_SUMMARY_PROMPT, [file]));
  };

  /**
   * Ringkas berkas yang sudah tersimpan di server dari teks hasil ekstraksi backend (DOCX/XLSX/PPTX/PDF, dsb.) — dipakai
   * dokumen yang dibuat/diedit di ONLYOFFICE (isinya ada di server, bukan berkas lokal).
   */
  const summarizeUpload = async (uploadId: string): Promise<string | undefined> => {
    if (!ai.isConfigured) {
      setStatus("error");
      return undefined;
    }
    setStatus("processing");
    const { text } = await extractedText(uploadId).catch(() => ({ text: "" }));
    if (!text) {
      setStatus("error");
      toast.info("Belum ada isi untuk diringkas", {
        description: "Tulis isi dokumen lalu tutup editor untuk meringkas.",
      });
      return undefined;
    }
    return run(() => ai.generate(summaryPrompt(text), []));
  };

  const run = async (generate: () => Promise<string>): Promise<string | undefined> => {
    setStatus("processing");
    try {
      const summary = await generate();
      setStatus("done");
      return summary;
    } catch (error) {
      setStatus("error");
      const msg = errorMessage(error);
      if (error instanceof ApiError && error.status === 429) {
        toast.error("Limit API Tercapai ⚠️", {
          description:
            "File tetap terlampir dengan status 'No AI'. Simpan dulu, lalu gunakan ikon robot pada tabel untuk mengekstrak ulang nanti.",
        });
      } else {
        toast.error("Ekstraksi AI gagal", { description: msg });
      }
      return undefined;
    }
  };

  return { status, setStatus, summarize, summarizeUpload };
}
