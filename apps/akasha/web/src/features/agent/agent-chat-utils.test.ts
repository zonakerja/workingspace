import { describe, expect, it } from "vitest";
import type { AgentConversationSummary } from "@/lib/api/endpoints";
import { conversationGroups, filterConversations } from "./agent-chat-utils";

const conv = (id: string, updatedAt: string, extra: Partial<AgentConversationSummary> = {}) =>
  ({
    id,
    title: id,
    pinned: false,
    createdAt: updatedAt,
    updatedAt,
    running: false,
    messages: 2,
    ...extra,
  }) as AgentConversationSummary;

describe("agent-chat-utils", () => {
  const now = new Date(2026, 10, 18, 15, 0);
  it("mengelompokkan per waktu, sematan paling atas", () => {
    const groups = conversationGroups(
      [
        conv("a", new Date(2026, 10, 18, 9).toISOString()),
        conv("b", new Date(2026, 10, 15).toISOString()),
        conv("c", new Date(2026, 9, 30).toISOString()),
        conv("d", new Date(2026, 6, 1).toISOString()),
        conv("p", new Date(2026, 6, 1).toISOString(), { pinned: true }),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["Disematkan", ["p"]],
      ["Hari ini", ["a"]],
      ["7 hari terakhir", ["b"]],
      ["30 hari terakhir", ["c"]],
      ["Lebih lama", ["d"]],
    ]);
  });
  it("menyaring judul per kata", () => {
    const list = [conv("Telaah pengajuan PSP", now.toISOString()), conv("Ringkas notulen", now.toISOString())];
    expect(filterConversations(list, "psp telaah").map((c) => c.id)).toEqual(["Telaah pengajuan PSP"]);
    expect(filterConversations(list, "")).toHaveLength(2);
  });
});
