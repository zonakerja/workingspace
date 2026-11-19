import type { AgentConversationSummary } from "@/lib/api/endpoints";
import { matchesWords, queryWords } from "@/features/planner/lib/planner-search";

/** Saring daftar percakapan per kata judul (tanpa huruf besar/kecil & aksen). */
export function filterConversations(list: AgentConversationSummary[], query: string) {
  const words = queryWords(query);
  return words.length ? list.filter((c) => matchesWords(words, c.title)) : list;
}

/** Kelompok daftar seperti Claude: Disematkan, Hari ini, 7 hari terakhir, 30 hari terakhir, Lebih lama. */
export function conversationGroups(list: AgentConversationSummary[], now: Date) {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const order = ["Disematkan", "Hari ini", "7 hari terakhir", "30 hari terakhir", "Lebih lama"] as const;
  const groups = new Map<string, AgentConversationSummary[]>(order.map((label) => [label, []]));
  for (const c of list) {
    const at = new Date(c.updatedAt).getTime();
    const label = c.pinned
      ? "Disematkan"
      : at >= startOfDay
        ? "Hari ini"
        : at >= startOfDay - 6 * day
          ? "7 hari terakhir"
          : at >= startOfDay - 29 * day
            ? "30 hari terakhir"
            : "Lebih lama";
    groups.get(label)!.push(c);
  }
  return order.map((label) => ({ label, items: groups.get(label)! })).filter((g) => g.items.length > 0);
}
