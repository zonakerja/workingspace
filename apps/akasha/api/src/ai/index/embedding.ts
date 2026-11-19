import { AiProviderError } from "../ai-errors";
import { documentEmbeddingText, queryEmbeddingText } from "./index-text";

/**
 * Embedding indeks pengetahuan lewat gateway Akai (tugas Embedding di Akai → Model, 768 dimensi). Ruang vektor tiap model
 * berbeda: potongan menyimpan nama model (`akai/<ID>`), dan pencarian hanya membandingkan vektor dari model yang sama.
 */

export interface EmbeddingDocument {
  title: string;
  content: string;
}

/** Format teks per keluarga model: Gemini Embedding memakai format tugas (`title: … | text: …`), model lain teks biasa. */
type TextFormat = "gemini" | "plain";

const documentText = (format: TextFormat, doc: EmbeddingDocument) =>
  format === "gemini" ? documentEmbeddingText(doc.title, doc.content) : `${doc.title}\n${doc.content}`;
const queryText = (format: TextFormat, query: string) => (format === "gemini" ? queryEmbeddingText(query) : query);

/** Model Gemini Embedding (resmi atau lewat router di Akai) tetap memakai format tugas Gemini. */
export const textFormatOf = ({ model }: Pick<EmbeddingTarget, "model">): TextFormat =>
  /gemini-embedding/i.test(model) ? "gemini" : "plain";

/** Vektor + nama model yang benar-benar menjawab (Akai bisa pindah ke cadangan) — dicatat per potongan. */
export interface EmbeddingResult {
  vectors: number[][];
  model: string;
}

/** Model utama tugas Embedding di Akai (`akai/<ID>`) + pemanggil gateway (`remote`, key tidak dipegang Akasha). */
export interface EmbeddingTarget {
  model: string;
  remote?: (texts: string[]) => Promise<EmbeddingResult>;
}

export function embedDocuments(embedding: EmbeddingTarget, docs: EmbeddingDocument[]) {
  const format = textFormatOf(embedding);
  return embed(
    embedding,
    docs.map((doc) => documentText(format, doc)),
  );
}

export async function embedQuery(embedding: EmbeddingTarget, query: string) {
  const { vectors, model } = await embed(embedding, [queryText(textFormatOf(embedding), query)]);
  return { vector: vectors[0], model };
}

async function embed({ model, remote }: EmbeddingTarget, texts: string[]): Promise<EmbeddingResult> {
  if (texts.length === 0) return { vectors: [], model };
  if (!remote) throw new AiProviderError("unavailable", "Akai tidak aktif.");
  return remote(texts);
}
