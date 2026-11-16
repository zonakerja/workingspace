import { describe, expect, it } from "vitest";
import {
  agentGatewayBody,
  agentUsage,
  akaiEmbeddingModel,
  akaiMessage,
  akaiTaskFor,
  completionText,
  embeddingResult,
  parsePrimaryModels,
  parseStatus,
  toAkaiMessages,
} from "./akai-logic";

const file = (kind: "image" | "pdf" | "audio" | "text", data = "abc") => ({
  kind,
  mimeType: kind === "image" ? "image/png" : kind === "pdf" ? "application/pdf" : "text/plain",
  name: `f.${kind}`,
  data: Buffer.from(data),
});

describe("akai-logic", () => {
  it("tugas yang lewat Akai", () => {
    expect(akaiTaskFor("chat")).toBe("chat");
    expect(akaiTaskFor("ocr")).toBe("ocr");
    expect(akaiTaskFor("embedding")).toBe("embedding");
    expect(akaiTaskFor("agent")).toBe("agent");
  });

  it("body agen untuk Akai & token dari jawaban", () => {
    expect(
      agentGatewayBody({ model: "akasha-agent", stream: true, messages: [{ role: "user", content: "hai" }] }),
    ).toEqual({
      stream: true,
      messages: [{ role: "user", content: "hai" }],
      task: "agent",
    });
    expect(agentGatewayBody({ messages: [] })).toBeNull();
    expect(agentGatewayBody(null)).toBeNull();
    expect(
      agentUsage({
        prompt_tokens: 100,
        completion_tokens: 3,
        prompt_tokens_details: { cached_tokens: 90 },
        cache_read_input_tokens: 90,
        cache_creation_input_tokens: 5,
      }),
    ).toEqual({ input: 5, output: 3, cacheRead: 90, cacheWrite: 5 });
    expect(agentUsage({ prompt_tokens: 7, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } })).toEqual(
      {
        input: 3,
        output: 2,
        cacheRead: 4,
        cacheWrite: 0,
      },
    );
    expect(agentUsage(undefined)).toBeNull();
  });

  it("model utama & hasil embedding", () => {
    expect(
      parsePrimaryModels({
        tasks: [
          { task: "embedding", primary: "text-embedding-4" },
          { task: "chat", primary: null },
        ],
      }),
    ).toEqual({ embedding: "text-embedding-4" });
    expect(akaiEmbeddingModel("gemini-embedding-2")).toBe("akai/gemini-embedding-2");
    const vec = (n: number) => Array(3).fill(n);
    expect(
      embeddingResult(
        {
          model: "m",
          data: [
            { index: 1, embedding: vec(2) },
            { index: 0, embedding: vec(1) },
          ],
        },
        2,
        3,
      ),
    ).toEqual({ vectors: [vec(1), vec(2)], model: "m" });
    expect(embeddingResult({ model: "m", data: [{ index: 0, embedding: [1, 2] }] }, 1, 3)).toBeNull();
    expect(embeddingResult({ model: "m", data: [] }, 1, 3)).toBeNull();
    expect(embeddingResult({ data: [{ index: 0, embedding: vec(1) }] }, 1, 3)).toBeNull();
  });

  it("prompt + lampiran → pesan OpenAI", () => {
    expect(toAkaiMessages("hai", [])).toEqual([{ role: "user", content: "hai" }]);
    const [message] = toAkaiMessages("ringkas", [file("image"), file("pdf"), file("text", "isi")])!;
    const parts = message.content as { type: string }[];
    expect(parts.map((p) => p.type)).toEqual(["image_url", "file", "text", "text"]);
    expect(JSON.stringify(parts[0])).toContain("data:image/png;base64,YWJj");
    expect(JSON.stringify(parts[1])).toContain("data:application/pdf;base64,YWJj");
    expect(JSON.stringify(parts[2])).toContain("isi");
    expect(parts[3]).toEqual({ type: "text", text: "ringkas" });
    expect(toAkaiMessages("x", [file("audio")])).toBeNull();
  });

  it("membaca jawaban & status", () => {
    expect(completionText({ choices: [{ message: { content: "halo" } }] })).toBe("halo");
    expect(completionText({ choices: [{ message: { content: [{ type: "text", text: "a" }, { text: "b" }] } }] })).toBe(
      "ab",
    );
    expect(completionText({ choices: [] })).toBeNull();
    expect(parseStatus({ tasks: [{ task: "chat", models: 2 }, { task: "x" }] })).toEqual({ chat: 2 });
    expect(parseStatus(null)).toEqual({});
    expect(akaiMessage({ message: "Kuota habis" }, 429)).toBe("Akai: Kuota habis");
    expect(akaiMessage(null, 500)).toBe("Akai menjawab galat 500.");
  });
});
