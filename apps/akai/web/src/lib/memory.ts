/** Klien Memori Akai (6b.3, docs/AKAI.md §8). */
import { request } from "./api";

export interface MemoryItem {
  id: string;
  content: string;
  source: "auto" | "manual";
  conversationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryState {
  enabled: boolean;
  items: MemoryItem[];
}

export const memoryApi = {
  list: () => request<MemoryState>("GET", "/api/memory"),
  setEnabled: (enabled: boolean) => request<MemoryState>("PATCH", "/api/memory/settings", { enabled }),
  add: (content: string) => request<MemoryItem>("POST", "/api/memory", { content }),
  update: (id: string, content: string) => request<MemoryItem>("PATCH", `/api/memory/${id}`, { content }),
  remove: (id: string) => request<void>("DELETE", `/api/memory/${id}`),
  clear: () => request<void>("DELETE", "/api/memory"),
};
