import { describe, expect, it } from "vitest";
import { akaiMessage, akaiTaskFor, completionText, parseStatus, toAkaiMessages } from "./akai-logic";

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
    expect(akaiTaskFor("agent")).toBeNull();
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
