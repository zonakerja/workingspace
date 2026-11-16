import { describe, expect, it } from "vitest";
import {
  MAX_REPLAYED_FILES,
  attachmentKind,
  buildChatMessages,
  cleanTitle,
  fallbackTitle,
  newStreamState,
  readStreamChunk,
  systemPrompt,
  type StoredAttachment,
} from "./chat-logic";

const file = (id: string, kind: StoredAttachment["kind"], text = "isi"): StoredAttachment => ({
  id,
  name: `${id}.${kind === "image" ? "png" : kind === "pdf" ? "pdf" : "txt"}`,
  mimeType: kind === "image" ? "image/png" : kind === "pdf" ? "application/pdf" : "text/plain",
  kind,
  data: Buffer.from(text),
});

describe("chat-logic", () => {
  it("jenis lampiran", () => {
    expect(attachmentKind("image/png", "a.png")).toBe("image");
    expect(attachmentKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(attachmentKind("application/octet-stream", "catatan.md")).toBe("text");
    expect(attachmentKind("application/json", "x")).toBe("text");
    expect(attachmentKind("application/zip", "a.zip")).toBeNull();
    expect(attachmentKind("image/svg+xml", "a.svg")).toBeNull();
  });

  it("prompt sistem memuat tanggal & nama", () => {
    const text = systemPrompt(new Date("2026-11-16T03:00:00Z"), "Yusuf");
    expect(text).toContain("Akai");
    expect(text).toContain("2026");
    expect(text).toContain("Yusuf");
    expect(text).toContain("<akai_artifact identifier=");
  });

  it("riwayat: sistem dulu, jawaban gagal dibuang, peran digabung, mulai dari pengguna", () => {
    const msgs = buildChatMessages(
      "SYS",
      [
        { role: "assistant", content: "sapaan" },
        { role: "user", content: "a" },
        { role: "assistant", content: "", error: "gagal" },
        { role: "user", content: "b" },
        { role: "assistant", content: "jawab" },
      ],
      new Map(),
    );
    expect(msgs).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "jawab" },
    ]);
  });

  it("lampiran: gambar/PDF base64, teks disisipkan, berkas lama jadi nama", () => {
    const files = new Map<string, StoredAttachment>();
    const history = [];
    for (let i = 0; i < MAX_REPLAYED_FILES + 1; i++) {
      files.set(`g${i}`, file(`g${i}`, "image"));
      history.push({ role: "user", content: `q${i}`, attachmentIds: [`g${i}`] }, { role: "assistant", content: "ok" });
    }
    files.set("t", file("t", "text", "catatan penting"));
    files.set("p", file("p", "pdf"));
    history.push({ role: "user", content: "", attachmentIds: ["t", "p"] });
    const msgs = buildChatMessages("S", history, files);
    const first = msgs[1].content as { type: string; text?: string }[];
    expect(first[0]).toEqual({ type: "text", text: "[Lampiran sebelumnya: g0.png]" });
    const last = msgs[msgs.length - 1].content as { type: string; text?: string }[];
    expect(last[0].text).toContain("catatan penting");
    expect(last[1].type).toBe("file");
    expect(last[2]).toEqual({ type: "text", text: "(lihat lampiran)" });
  });

  it("pembaca stream mengumpulkan teks & usage lintas potongan", () => {
    const s = newStreamState();
    readStreamChunk(s, 'data: {"choices":[{"delta":{"content":"Hal"}}]}\n\ndata: {"choices":[{"delta":{"con');
    readStreamChunk(
      s,
      'tent":"o"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
    );
    expect(s.text).toBe("Halo");
    expect(s.usage).toEqual({ input: 5, output: 2 });
  });

  it("judul", () => {
    expect(fallbackTitle("  ")).toBe("Percakapan baru");
    expect(fallbackTitle("x".repeat(100))).toHaveLength(58);
    expect(cleanTitle('Judul: "Rencana Anggaran 2027".')).toBe("Rencana Anggaran 2027");
    expect(cleanTitle("")).toBeNull();
  });
});
