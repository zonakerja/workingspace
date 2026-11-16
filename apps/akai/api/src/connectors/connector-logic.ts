/**
 * Aturan Konektor MCP Akai (6b.5, docs/AKAI.md §8). Logika murni, diuji di connector-logic.spec.ts: slug, ringkasan alat dari
 * `tools/list`, alat yang boleh dipakai model (izin baca/ubah/hapus), nama alat untuk model, teks hasil, ringkasan argumen.
 */

export interface ConnectorTool {
  name: string;
  title: string | null;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Penyedia menandai hanya membaca */
  readOnly: boolean;
  /** Penyedia menandai bisa menghapus/merusak data */
  destructive: boolean;
}

type RawTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean };
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Slug konektor (awalan nama alat): huruf kecil, angka, garis bawah; maks. 20. */
export function connectorSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  return slug || "konektor";
}

export function summarizeTools(tools: RawTool[]): ConnectorTool[] {
  return tools.slice(0, 200).map((t) => ({
    name: t.name,
    title: t.title ?? t.annotations?.title ?? null,
    description: (t.description ?? "").replace(/\s+/g, " ").trim().slice(0, 1000),
    inputSchema: isObject(t.inputSchema) ? t.inputSchema : { type: "object", properties: {} },
    readOnly: t.annotations?.readOnlyHint === true,
    destructive: t.annotations?.destructiveHint === true,
  }));
}

export type ToolAccess = "read" | "write" | "destructive";

/** Jenis alat: bertanda hanya-baca = baca; bertanda merusak = hapus; tanpa tanda/lainnya = ubah. */
export const toolAccess = (t: Pick<ConnectorTool, "readOnly" | "destructive">): ToolAccess =>
  t.destructive ? "destructive" : t.readOnly ? "read" : "write";

/**
 * Boleh dipakai model di chat? Alat baca selalu; alat ubah hanya bila pemilik menyalakan "izinkan mengubah data"; alat hapus tidak
 * pernah (aplikasi lain tidak punya Sampah Akai — aksi tidak bisa dibatalkan dari Akai).
 */
export const toolAllowed = (t: Pick<ConnectorTool, "readOnly" | "destructive">, allowWrite: boolean) => {
  const access = toolAccess(t);
  return access === "read" || (access === "write" && allowWrite);
};

/** Nama alat untuk model: `<slug>__<alat>`, hanya [a-zA-Z0-9_-], maks. 64 (batas Anthropic/OpenAI). */
export function modelToolName(slug: string, tool: string) {
  return `${slug}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export interface ToolBinding {
  connectorId: string;
  connectorName: string;
  tool: ConnectorTool;
}

/** Daftar alat format OpenAI + peta nama → konektor/alat (nama bentrok setelah dipotong: yang pertama menang). */
export function buildToolset(
  connectors: { id: string; name: string; slug: string; allowWrite: boolean; tools: ConnectorTool[] }[],
  max = 100,
) {
  const map = new Map<string, ToolBinding>();
  const tools: Record<string, unknown>[] = [];
  for (const c of connectors) {
    for (const tool of c.tools) {
      if (!toolAllowed(tool, c.allowWrite) || tools.length >= max) continue;
      const name = modelToolName(c.slug, tool.name);
      if (map.has(name)) continue;
      map.set(name, { connectorId: c.id, connectorName: c.name, tool });
      tools.push({
        type: "function",
        function: {
          name,
          description: `[${c.name}] ${tool.title ? `${tool.title}: ` : ""}${tool.description}`.slice(0, 1024),
          parameters: tool.inputSchema,
        },
      });
    }
  }
  return { tools, map };
}

/** Isi hasil `tools/call` → teks untuk model (non-teks ditulis sebagai penanda), dipotong. */
export function toolResultText(content: unknown, max = 20_000) {
  const parts = (Array.isArray(content) ? content : []).map((c: { type?: string; text?: string; mimeType?: string }) =>
    c?.type === "text" ? (c.text ?? "") : `[${c?.type ?? "konten"}${c?.mimeType ? ` ${c.mimeType}` : ""}]`,
  );
  const text = parts.join("\n").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Argumen JSON dari model; rusak / bukan objek = {}. */
export function parseArgs(raw: unknown): Record<string, unknown> {
  if (isObject(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw ?? "{}")) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Ringkasan pendek untuk jejak alat di chat (argumen/hasil), maks. `max` karakter. */
export const excerpt = (value: unknown, max = 600) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
