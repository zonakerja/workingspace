import { BadRequestException, HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../generated/prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import { AiCrypto } from "./ai-crypto";
import { isFallbackError, providerCandidates } from "./ai-routing";
import { AiService, type AiFile } from "./ai.service";
import type { AiIndexQueueService } from "./index/ai-index-queue.service";
import { AkaiError, type AkaiService } from "../akai/akai.service";
import { AiProviderError } from "./providers/ai-client";

// Klien provider diganti mock: tidak ada panggilan jaringan
const clients = vi.hoisted(() => ({ gemini: vi.fn(), anthropic: vi.fn(), openai: vi.fn() }));
vi.mock("./providers/gemini.client", () => ({ geminiClient: clients.gemini }));
vi.mock("./providers/anthropic.client", () => ({ anthropicClient: clients.anthropic }));
vi.mock("./providers/openai.client", () => ({ openaiClient: clients.openai }));

const KEY = "c".repeat(64);
const crypto = new AiCrypto(KEY);

/** Akai mati (bawaan) kecuali tes Akai mengisi `akai`. */
let akai = { handles: vi.fn().mockResolvedValue(false), generate: vi.fn() };

function setup(active: AiProvider | null, configured: AiProvider[], fallback = true) {
  const credentials = configured.map((provider) => ({
    id: provider,
    userId: "u1",
    provider,
    encryptedKey: crypto.encrypt(`key-${provider}`),
    keyHint: "",
    model: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const prisma = {
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ aiProvider: active, aiFallback: fallback }) },
    aiCredential: { findMany: vi.fn().mockResolvedValue(credentials) },
  } as unknown as PrismaService;
  const config = { getOrThrow: () => KEY, get: () => undefined } as unknown as ConfigService;
  const indexQueue = { enqueueRebuild: vi.fn(), enqueuePurge: vi.fn() } as unknown as AiIndexQueueService;
  return new AiService(prisma, indexQueue, akai as unknown as AkaiService, config);
}

const audio: AiFile = { originalname: "rekaman.webm", mimetype: "audio/webm", size: 10, buffer: Buffer.from("x") };
const quota = () => new AiProviderError("quota", "Resource exhausted");

beforeEach(() => {
  for (const fn of Object.values(clients)) fn.mockReset().mockResolvedValue("jawaban");
  akai = { handles: vi.fn().mockResolvedValue(false), generate: vi.fn() };
});

describe("providerCandidates", () => {
  it("provider aktif lebih dulu, lalu yang punya key sesuai urutan katalog", () => {
    expect(providerCandidates("openai", ["gemini", "openai", "anthropic"], [], true)).toEqual([
      "openai",
      "gemini",
      "anthropic",
    ]);
  });
  it("tanpa cadangan hanya provider aktif", () => {
    expect(providerCandidates("openai", ["gemini", "openai"], [], false)).toEqual(["openai"]);
  });
  it("melewati provider yang tidak mendukung lampiran", () => {
    expect(providerCandidates("anthropic", ["anthropic", "gemini"], ["audio"], true)).toEqual(["gemini"]);
    expect(providerCandidates("anthropic", ["anthropic", "gemini"], ["audio"], false)).toEqual([]);
  });
  it("hanya kuota, provider tak terjangkau, dan kredensial yang dialihkan", () => {
    expect(["quota", "unavailable", "credential"].every((k) => isFallbackError(k as never))).toBe(true);
    expect(["auth", "model", "invalid", "refusal"].some((k) => isFallbackError(k as never))).toBe(false);
  });
});

describe("AiService.generate", () => {
  it("memakai provider aktif bila berhasil", async () => {
    const result = await setup("anthropic", ["anthropic", "gemini"]).generate("u1", "halo");
    expect(result).toMatchObject({ text: "jawaban", provider: "anthropic", fallback: null });
    expect(clients.anthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "key-anthropic" }));
    expect(clients.gemini).not.toHaveBeenCalled();
  });

  it("kuota habis → dialihkan ke provider cadangan", async () => {
    clients.anthropic.mockRejectedValue(quota());
    const result = await setup("anthropic", ["anthropic", "gemini"]).generate("u1", "halo");
    expect(result).toMatchObject({ provider: "gemini", fallback: { from: "anthropic", reason: "quota" } });
    expect(result.fallback?.message).toContain("Google Gemini");
  });

  it("key ditolak tidak dialihkan (masalah konfigurasi harus terlihat)", async () => {
    clients.anthropic.mockRejectedValue(new AiProviderError("auth", "invalid x-api-key"));
    await expect(setup("anthropic", ["anthropic", "gemini"]).generate("u1", "halo")).rejects.toThrow(/ditolak/);
    expect(clients.gemini).not.toHaveBeenCalled();
  });

  it("cadangan dimatikan → error kuota provider aktif (429)", async () => {
    clients.anthropic.mockRejectedValue(quota());
    const error = await setup("anthropic", ["anthropic", "gemini"], false)
      .generate("u1", "halo")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(clients.gemini).not.toHaveBeenCalled();
  });

  it("semua provider gagal → error provider aktif + keterangan cadangan", async () => {
    clients.anthropic.mockRejectedValue(quota());
    clients.gemini.mockRejectedValue(new AiProviderError("unavailable", "timeout"));
    await expect(setup("anthropic", ["anthropic", "gemini"]).generate("u1", "halo")).rejects.toThrow(
      /Anthropic Claude.*cadangan juga gagal/,
    );
  });

  it("audio dengan provider aktif Claude → diproses Gemini", async () => {
    const result = await setup("anthropic", ["anthropic", "gemini"]).generate("u1", "transkrip", [audio]);
    expect(result).toMatchObject({ provider: "gemini", fallback: { reason: "attachment" } });
    expect(clients.anthropic).not.toHaveBeenCalled();
  });

  it("audio tanpa provider yang mendukung → 400 dengan saran", async () => {
    await expect(setup("anthropic", ["anthropic", "openai"]).generate("u1", "x", [audio])).rejects.toThrow(
      BadRequestException,
    );
    await expect(setup("anthropic", ["anthropic", "gemini"], false).generate("u1", "x", [audio])).rejects.toThrow(
      /Cadangan otomatis/,
    );
  });

  it("AI belum diatur → 400", async () => {
    await expect(setup(null, []).generate("u1", "halo")).rejects.toThrow(/belum diatur/);
  });
});

describe("generate lewat Akai", () => {
  it("tugas yang diatur di Akai dijawab Akai, key lama tidak dipanggil", async () => {
    const service = setup("gemini", ["gemini"]);
    akai.handles.mockResolvedValue(true);
    akai.generate.mockResolvedValue({ text: "dari akai", model: "Model A", fallbackFrom: "Model B" });
    const result = await service.generate("u1", "halo", [], "chat");
    expect(result).toMatchObject({ text: "dari akai", provider: "akai", model: "Model A", fallback: { from: "akai" } });
    expect(clients.gemini).not.toHaveBeenCalled();
  });

  it("Akai tanpa key lama tetap bisa dipakai", async () => {
    const service = setup(null, []);
    akai.handles.mockResolvedValue(true);
    akai.generate.mockResolvedValue({ text: "ok", model: "M", fallbackFrom: null });
    await expect(service.generate("u1", "halo")).resolves.toMatchObject({ text: "ok", fallback: null });
  });

  it("kuota di Akai → 429, galat lain → 422", async () => {
    const service = setup("gemini", ["gemini"]);
    akai.handles.mockResolvedValue(true);
    akai.generate.mockRejectedValueOnce(new AkaiError(429, "Akai: kuota habis"));
    await expect(service.generate("u1", "x")).rejects.toMatchObject({ status: 429 });
    akai.generate.mockRejectedValueOnce(new AkaiError(422, "Akai: key ditolak"));
    await expect(service.generate("u1", "x")).rejects.toMatchObject({ status: 422 });
    expect(clients.gemini).not.toHaveBeenCalled();
  });

  it("Akai tak terjangkau → key lama; tanpa key lama → 422 berpesan Akai", async () => {
    akai.handles.mockResolvedValue(true);
    akai.generate.mockRejectedValue(new AkaiError(422, "Akai tidak dapat dihubungi.", true));
    await expect(setup("gemini", ["gemini"]).generate("u1", "x")).resolves.toMatchObject({ provider: "gemini" });
    await expect(setup(null, []).generate("u1", "x")).rejects.toThrow(/Akai tidak dapat dihubungi/);
  });
});
