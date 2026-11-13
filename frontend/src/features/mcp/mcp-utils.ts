import type { McpConnectionInfo, McpPreset, McpToolSummary } from "@/types/api";

/** Logika murni halaman Aplikasi MCP (diuji di `mcp-utils.test.ts`). */

export const STATUS_LABEL: Record<McpConnectionInfo["status"], string> = {
  new: "Belum disambungkan",
  connected: "Tersambung",
  auth_required: "Perlu masuk",
  error: "Gagal tersambung",
};

export const STATUS_TONE: Record<McpConnectionInfo["status"], string> = {
  new: "bg-muted text-muted-foreground",
  connected: "bg-success/15 text-success",
  auth_required: "bg-warning/15 text-warning",
  error: "bg-destructive/15 text-destructive",
};

export const AUTH_LABEL: Record<McpConnectionInfo["authType"], string> = {
  none: "Tanpa login",
  token: "Token akses",
  oauth: "Masuk dengan akun (OAuth)",
};

/** Jenis alat menurut tanda dari penyedia: baca, ubah (termasuk yang tanpa tanda), hapus. */
export function toolKind(tool: McpToolSummary): "read" | "write" | "delete" {
  if (tool.destructive) return "delete";
  return tool.readOnly ? "read" : "write";
}

export const TOOL_KIND_LABEL = { read: "Baca", write: "Ubah", delete: "Hapus" } as const;
export const TOOL_KIND_TONE = {
  read: "bg-info/15 text-info",
  write: "bg-warning/15 text-warning",
  delete: "bg-destructive/15 text-destructive",
} as const;

/** Jumlah alat per jenis. */
export function toolCounts(tools: McpToolSummary[]) {
  const counts = { read: 0, write: 0, delete: 0 };
  for (const tool of tools) counts[toolKind(tool)] += 1;
  return counts;
}

/** Sama dengan aturan server: boleh dipakai agen? (alat hapus tidak pernah; alat ubah bila diizinkan). */
export function agentAllowed(
  connection: Pick<McpConnectionInfo, "agentEnabled" | "allowWrite"> & { agentTools?: string[] },
  tool: McpToolSummary,
) {
  if (!connection.agentEnabled) return false;
  const kind = toolKind(tool);
  // Alat bertanda Hapus hanya bila diizinkan satu per satu oleh pemilik + aksi tulis menyala (salinan aturan server)
  if (kind === "delete") return connection.allowWrite && (connection.agentTools ?? []).includes(tool.name);
  return kind === "read" || connection.allowWrite;
}

/** Daftar alat Hapus yang diizinkan setelah sakelar satu alat diubah. */
export function toggleAgentTool(current: string[], name: string, on: boolean) {
  const rest = current.filter((t) => t !== name);
  return on ? [...rest, name] : rest;
}

/** Argumen alat dari teks JSON (kosong = {}); galat dalam bahasa pengguna. */
export function parseArgs(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { ok: false, error: 'Argumen harus objek JSON, mis. {"query": "poster"}.' };
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, error: "JSON tidak valid." };
  }
}

/**
 * Nama koneksi sekelompok (mis. layanan Google lain) yang sudah punya OAuth client — backend memakai client itu bila
 * Client ID dikosongkan saat menambah layanan baru. Null = belum ada, client wajib diisi.
 */
export function sharedClientSource(
  preset: Pick<McpPreset, "group"> | null,
  connections: Pick<McpConnectionInfo, "preset" | "name" | "oauthClientId">[],
  presets: Pick<McpPreset, "key" | "group">[],
) {
  if (!preset?.group) return null;
  const keys = new Set(presets.filter((p) => p.group === preset.group).map((p) => p.key));
  return connections.find((c) => c.preset && keys.has(c.preset) && c.oauthClientId)?.name ?? null;
}

/** Katalog dikelompokkan: aplikasi tunggal dulu, lalu per kelompok penyedia (Google Workspace). */
export function groupPresets<T extends Pick<McpPreset, "group">>(presets: T[]) {
  const single = presets.filter((p) => !p.group);
  const groups = new Map<string, T[]>();
  for (const p of presets) if (p.group) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  return { single, groups: [...groups.entries()].map(([key, items]) => ({ key, items })) };
}
