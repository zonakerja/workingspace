import type { McpConnectionInfo, McpToolSummary } from "@/types/api";

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
export function agentAllowed(connection: Pick<McpConnectionInfo, "agentEnabled" | "allowWrite">, tool: McpToolSummary) {
  if (!connection.agentEnabled) return false;
  const kind = toolKind(tool);
  if (kind === "delete") return false;
  return kind === "read" || connection.allowWrite;
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
