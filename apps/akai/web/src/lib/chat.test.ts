import { describe, expect, it } from "vitest";
import { formatSize, groupConversations, newSseState, readSse, type ConversationSummary } from "./chat";

const conv = (id: string, updatedAt: string, pinned = false): ConversationSummary => ({
  id,
  title: id,
  pinned,
  modelId: null,
  updatedAt,
  createdAt: updatedAt,
});

describe("chat", () => {
  it("membaca SSE lintas potongan & galat di tengah stream", () => {
    const s = newSseState();
    expect(readSse(s, 'data: {"choices":[{"delta":{"content":"Ha"}}]}\n\ndata: {"choi')).toBe(true);
    readSse(s, 'ces":[{"delta":{"content":"lo"}}]}\n\ndata: {"error":{"message":"putus"}}\n\ndata: [DONE]\n\n');
    expect(s.text).toBe("Halo");
    expect(s.error).toBe("putus");
  });

  it("jejak alat diperbarui per id", () => {
    const s = newSseState();
    const run = { id: "c1", connector: "Akasha", tool: "cari", title: null, input: "{}", output: null };
    readSse(s, `data: ${JSON.stringify({ akai_tool: { ...run, status: "running" } })}\n\n`);
    expect(readSse(s, `data: ${JSON.stringify({ akai_tool: { ...run, status: "done", output: "ok" } })}\n\n`)).toBe(
      true,
    );
    expect(s.tools).toEqual([{ ...run, status: "done", output: "ok" }]);
  });

  it("mengelompokkan riwayat per tanggal, disematkan paling atas", () => {
    const now = new Date(2026, 10, 16, 12);
    const groups = groupConversations(
      [
        conv("a", new Date(2026, 10, 16, 9).toISOString()),
        conv("b", new Date(2026, 10, 15, 20).toISOString()),
        conv("c", new Date(2026, 10, 12).toISOString()),
        conv("d", new Date(2026, 8, 1).toISOString()),
        conv("p", new Date(2026, 8, 1).toISOString(), true),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((c) => c.id).join()])).toEqual([
      ["Disematkan", "p"],
      ["Hari ini", "a"],
      ["Kemarin", "b"],
      ["7 hari terakhir", "c"],
      ["Lebih lama", "d"],
    ]);
  });

  it("ukuran berkas", () => {
    expect(formatSize(500)).toBe("500 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
