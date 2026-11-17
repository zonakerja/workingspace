/** Klien Plugin JavaScript Akai (6b.7, docs/AKAI.md §8). */
import { request } from "./api";

export interface PluginTool {
  name: string;
  description: string;
  input: Record<string, unknown>;
  readOnly: boolean;
  destructive: boolean;
  /** Boleh dipakai Akai di chat (izin baca/ubah) */
  usable: boolean;
}

export interface PluginConfigField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  description: string;
}

/** Konektor bawaan paket (dibuat bersama paket; token diisi pemilik di halaman Konektor). */
export interface PackageConnectorStatus {
  id: string;
  name: string;
  kind: string;
  status: string;
  statusMessage: string | null;
  hasToken: boolean;
  enabled: boolean;
  tools: number;
}

export interface PluginItem {
  id: string;
  name: string;
  /** code = JavaScript di sandbox; package = paket JSON (instruksi + skill + konektor), seperti plugin Claude */
  kind: "code" | "package";
  instructions: string;
  connectors: PackageConnectorStatus[];
  title: string;
  description: string;
  version: string;
  enabled: boolean;
  allowWrite: boolean;
  hosts: string[];
  tools: PluginTool[];
  skills: { name: string; description: string; files: number }[];
  configFields: PluginConfigField[];
  /** Nilai pengaturan (rahasia = "••••••" bila terisi) */
  config: Record<string, string>;
  missingConfig: string[];
  updatedAt: string;
}

export interface PluginDetail extends PluginItem {
  code: string;
}

export interface PluginList {
  plugins: PluginItem[];
  catalog: { key: string; title: string; description: string; installed: boolean; kind: "code" | "package" }[];
  template: string;
  packageTemplate: string;
}

/** Status konektor paket untuk ditampilkan. */
export function connectorStatusLabel(c: Pick<PackageConnectorStatus, "status" | "hasToken" | "enabled">) {
  if (!c.enabled) return "Mati";
  if (c.status === "connected") return "Tersambung";
  if (c.status === "auth_required") return c.hasToken ? "Token ditolak" : "Perlu token";
  if (c.status === "error") return "Gagal tersambung";
  return "Belum dicek";
}

export interface PluginTestResult {
  isError: boolean;
  text: string;
  logs: string[];
  ms: number;
}

export const pluginsApi = {
  list: () => request<PluginList>("GET", "/api/plugins"),
  get: (id: string) => request<PluginDetail>("GET", `/api/plugins/${id}`),
  install: (body: { code?: string; catalogKey?: string }) => request<PluginDetail>("POST", "/api/plugins", body),
  update: (
    id: string,
    body: { code?: string; enabled?: boolean; allowWrite?: boolean; config?: Record<string, string> },
  ) => request<PluginDetail>("PATCH", `/api/plugins/${id}`, body),
  test: (id: string, tool: string, input: Record<string, unknown>) =>
    request<PluginTestResult>("POST", `/api/plugins/${id}/test`, { tool, input }),
  remove: (id: string) => request<void>("DELETE", `/api/plugins/${id}`),
};

/** Tanda jenis alat (sama dengan konektor): Baca / Ubah / Hapus. */
export const toolKind = (t: Pick<PluginTool, "readOnly" | "destructive">) =>
  t.destructive ? "Hapus" : t.readOnly ? "Baca" : "Ubah";

/** Contoh masukan JSON dari skema input alat (properti wajib diisi nilai contoh sesuai tipe). */
export function sampleInput(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const out: Record<string, unknown> = {};
  for (const [key, p] of Object.entries(props))
    out[key] =
      p.type === "number" || p.type === "integer" ? 0 : p.type === "boolean" ? false : p.type === "array" ? [] : "";
  return JSON.stringify(out, null, 2);
}
