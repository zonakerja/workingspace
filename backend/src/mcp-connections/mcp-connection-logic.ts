import { isPrivateHost } from "../ai/ai-endpoint";

/** Logika murni koneksi MCP aplikasi luar (diuji di `mcp-connection-logic.spec.ts`). */

export const MCP_AUTH_TYPES = ["none", "token", "oauth"] as const;
export type McpAuthType = (typeof MCP_AUTH_TYPES)[number];

export interface McpPreset {
  key: string;
  name: string;
  description: string;
  url: string;
  authType: McpAuthType;
  icon: string;
  /** Petunjuk singkat cara mendapat akses (untuk token) / catatan */
  hint: string;
}

/**
 * Katalog aplikasi yang punya server MCP resmi (remote, Streamable HTTP). Alamat bisa berubah sewaktu-waktu oleh
 * penyedianya, jadi tetap bisa diubah di formulir. Aplikasi lain = "Alamat sendiri".
 */
export const MCP_PRESETS: McpPreset[] = [
  {
    key: "canva",
    name: "Canva",
    description: "Buat & cari desain, ekspor, isi templat brand.",
    url: "https://mcp.canva.com/mcp",
    authType: "oauth",
    icon: "palette",
    hint: "Masuk dengan akun Canva Anda lewat jendela otorisasi.",
  },
  {
    key: "notion",
    name: "Notion",
    description: "Cari, baca, dan tulis halaman & database Notion.",
    url: "https://mcp.notion.com/mcp",
    authType: "oauth",
    icon: "book-open",
    hint: "Masuk dengan akun Notion dan pilih halaman yang boleh diakses.",
  },
  {
    key: "linear",
    name: "Linear",
    description: "Isu, project, dan siklus kerja tim di Linear.",
    url: "https://mcp.linear.app/mcp",
    authType: "oauth",
    icon: "clipboard-check",
    hint: "Masuk dengan akun Linear.",
  },
  {
    key: "github",
    name: "GitHub",
    description: "Repositori, isu, pull request, dan berkas kode.",
    url: "https://api.githubcopilot.com/mcp/",
    authType: "token",
    icon: "code",
    hint: "Buat Personal Access Token di GitHub → Settings → Developer settings, lalu tempel di sini.",
  },
];

export const findPreset = (key?: string | null) => MCP_PRESETS.find((p) => p.key === key) ?? null;

/**
 * Alamat server MCP: https publik (http / host lokal hanya di luar production, untuk uji), tanpa nama/sandi & tanpa
 * hash. Path & garis miring akhir dipertahankan (beberapa server membedakannya).
 */
export function normalizeMcpUrl(
  raw: string,
  production: boolean,
): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Alamat MCP tidak valid. Contoh: https://mcp.contoh.com/mcp" };
  }
  if (url.username || url.password) return { ok: false, error: "Alamat MCP tidak boleh memuat nama/sandi." };
  const local = isPrivateHost(url.hostname);
  if (production && local) return { ok: false, error: "Alamat MCP harus alamat publik (bukan jaringan lokal)." };
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local && !production)) {
    return { ok: false, error: "Alamat MCP harus diawali https://" };
  }
  url.hash = "";
  return { ok: true, url: url.toString() };
}

/** Slug dari nama (huruf kecil, angka, tanda hubung), unik terhadap slug yang sudah ada. */
export function uniqueSlug(name: string, taken: string[]) {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "aplikasi";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export interface McpToolSummary {
  name: string;
  title: string | null;
  description: string;
  /** Penyedia menandai alat hanya membaca */
  readOnly: boolean;
  /** Penyedia menandai alat bisa menghapus/merusak data */
  destructive: boolean;
}

type RawTool = {
  name: string;
  title?: string;
  description?: string;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean };
};

/** Ringkasan alat dari `tools/list` (tanpa skema input besar); deskripsi dipotong 500 karakter. */
export function summarizeTools(tools: RawTool[]): McpToolSummary[] {
  return tools.map((t) => ({
    name: t.name,
    title: t.title ?? t.annotations?.title ?? null,
    description: (t.description ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
    readOnly: t.annotations?.readOnlyHint === true,
    destructive: t.annotations?.destructiveHint === true,
  }));
}

/**
 * Boleh dipakai agen? Koneksi harus diizinkan untuk agen. Alat bertanda hanya-baca selalu boleh; alat lain (bisa
 * mengubah data, termasuk yang tanpa tanda) hanya bila pemilik menyalakan "izinkan aksi tulis". Alat bertanda merusak
 * (hapus) tidak pernah dijalankan agen — sejalan dengan aturan hapus hanya lewat persetujuan pemilik.
 */
export function agentToolDecision(
  connection: { agentEnabled: boolean; allowWrite: boolean },
  tool: McpToolSummary | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!connection.agentEnabled) return { ok: false, reason: "Koneksi ini belum diizinkan untuk agen oleh pemilik." };
  if (!tool) return { ok: false, reason: "Alat tidak ada di koneksi ini (muat ulang daftar alat)." };
  if (tool.destructive) return { ok: false, reason: "Alat ini bisa menghapus data; agen tidak boleh menjalankannya." };
  if (!tool.readOnly && !connection.allowWrite)
    return { ok: false, reason: "Alat ini bisa mengubah data; pemilik belum mengizinkan aksi tulis untuk agen." };
  return { ok: true };
}

/** Isi hasil alat untuk agen: teks digabung, jenis lain diringkas, dipotong agar tidak membengkak. */
export function toolResultText(
  content: { type: string; text?: string; mimeType?: string; uri?: string }[] | undefined,
  max = 20_000,
) {
  const parts = (content ?? []).map((c) =>
    c.type === "text" ? (c.text ?? "") : `[${c.type}${c.mimeType ? ` ${c.mimeType}` : ""}${c.uri ? ` ${c.uri}` : ""}]`,
  );
  const text = parts.join("\n").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
