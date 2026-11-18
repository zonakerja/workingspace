import { ApiError, GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { EmbeddingProvider } from "../ai-routing";
import { AI_TIMEOUT_MS, AiProviderError, kindFromStatus } from "../providers/ai-client";
import { documentEmbeddingText, EMBEDDING_DIMENSIONS, queryEmbeddingText } from "./index-text";

/**
 * Embedding indeks pengetahuan dengan Gemini atau OpenAI. Keduanya diminta 768 dimensi (kolom `ai_chunks.embedding`),
 * tetapi ruang vektornya berbeda: potongan menyimpan nama model, dan pencarian hanya membandingkan vektor dari model yang
 * sama — ganti provider ⇒ indeks dibangun ulang.
 */
export const EMBEDDING_MODELS: Record<EmbeddingProvider, string> = {
  gemini: "gemini-embedding-2",
  openai: "text-embedding-3-small",
};

/** Jumlah teks per permintaan embedding. */
const BATCH_SIZE = 50;

export interface EmbeddingDocument {
  title: string;
  content: string;
}

const checkDimensions = (vectors: number[][], expected: number, provider: string) => {
  if (vectors.length !== expected || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
    throw new AiProviderError("invalid", `Jumlah/dimensi embedding dari ${provider} tidak sesuai.`);
  }
};

/**
 * Gemini (`gemini-embedding-2`, sudah dinormalisasi): tugas ditulis di teks (`title: … | text: …` /
 * `task: search result | query: …`). Setiap teks dibungkus `Content` sendiri agar menghasilkan embedding terpisah.
 */
async function geminiEmbed(apiKey: string, texts: string[]) {
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: AI_TIMEOUT_MS } });
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const response = await client.models.embedContent({
        model: EMBEDDING_MODELS.gemini,
        contents: batch.map((text) => ({ role: "user", parts: [{ text }] })),
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });
      const values = (response.embeddings ?? []).map((e) => e.values ?? []);
      checkDimensions(values, batch.length, "Gemini");
      vectors.push(...values);
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof ApiError)
        throw new AiProviderError(kindFromStatus(error.status, error.message), error.message);
      throw new AiProviderError("unavailable", error instanceof Error ? error.message : String(error));
    }
  }
  return vectors;
}

/** OpenAI (`text-embedding-3-small`, dinormalisasi) dipotong ke 768 dimensi lewat parameter `dimensions`. */
async function openaiEmbed(apiKey: string, texts: string[], model: string, baseURL?: string) {
  const client = new OpenAI({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 1, ...(baseURL ? { baseURL } : {}) });
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const response = await client.embeddings.create({
        model,
        input: batch,
        dimensions: EMBEDDING_DIMENSIONS,
      });
      const values = [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      checkDimensions(values, batch.length, baseURL ? "router" : "OpenAI");
      vectors.push(...values);
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof OpenAI.APIConnectionError) throw new AiProviderError("unavailable", error.message);
      if (error instanceof OpenAI.APIError) {
        throw new AiProviderError(kindFromStatus(error.status, error.message), error.message);
      }
      throw new AiProviderError("unavailable", error instanceof Error ? error.message : String(error));
    }
  }
  return vectors;
}

/** Teks dokumen sesuai format masing-masing provider. */
const documentText = (provider: EmbeddingProvider, doc: EmbeddingDocument) =>
  provider === "gemini" ? documentEmbeddingText(doc.title, doc.content) : `${doc.title}\n${doc.content}`;
const queryText = (provider: EmbeddingProvider, query: string) =>
  provider === "gemini" ? queryEmbeddingText(query) : query;

/**
 * Format teks mengikuti keluarga model: lewat Akai, model Gemini Embedding (resmi atau lewat router) tetap memakai format
 * tugas Gemini; model lain teks biasa.
 */
export const textFormatOf = ({ provider, model }: Pick<EmbeddingTarget, "provider" | "model">): EmbeddingProvider =>
  provider === "akai" ? (/gemini-embedding/i.test(model) ? "gemini" : "openai") : provider;

/** Vektor + nama model yang benar-benar menjawab (lewat Akai bisa model cadangan) — dicatat per potongan. */
export interface EmbeddingResult {
  vectors: number[][];
  model: string;
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

/**
 * Key, model, dan jalur embedding (lewat router = endpoint OpenAI-compatible `/embeddings` milik router). `provider: "akai"`
 * = gateway Akai lewat `remote` (key tidak dipegang Akasha); `model` = nama model utama di Akai (`akai/<id>`).
 */
export interface EmbeddingTarget {
  provider: EmbeddingProvider | "akai";
  apiKey: string;
  model: string;
  baseUrl?: string | null;
  remote?: (texts: string[]) => Promise<EmbeddingResult>;
}

async function embed(target: EmbeddingTarget, texts: string[]): Promise<EmbeddingResult> {
  const { provider, apiKey, model, baseUrl, remote } = target;
  if (texts.length === 0) return { vectors: [], model };
  if (provider === "akai") {
    if (!remote) throw new AiProviderError("unavailable", "Akai tidak aktif.");
    return remote(texts);
  }
  const vectors = baseUrl
    ? await openaiEmbed(apiKey, texts, model, baseUrl)
    : provider === "gemini"
      ? await geminiEmbed(apiKey, texts)
      : await openaiEmbed(apiKey, texts, model);
  return { vectors, model };
}
