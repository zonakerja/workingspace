/**
 * Artifact Akai (6b.4, docs/AKAI.md §8): blok `<akai_artifact …>…</akai_artifact>` di jawaban model (format = instruksi
 * `ARTIFACT_INSTRUCTIONS` di apps/akai/api/src/chat/chat-logic.ts — ubah keduanya bersamaan). Logika murni, diuji di
 * artifacts.test.ts: pemisahan teks/artifact (termasuk artifact yang belum selesai saat stream), versi per identifier, nama unduhan.
 */

export type ArtifactType = "markdown" | "html" | "svg" | "mermaid" | "code";
const TYPES: ArtifactType[] = ["markdown", "html", "svg", "mermaid", "code"];

export interface Artifact {
  identifier: string;
  type: ArtifactType;
  title: string;
  language: string;
  content: string;
  /** false = tag penutup belum datang (masih ditulis model) */
  complete: boolean;
}

export type Segment = { kind: "text"; text: string } | { kind: "artifact"; artifact: Artifact };

const OPEN = /<akai_artifact\b([^>]*)>/g;
const CLOSE = "</akai_artifact>";

function attributes(raw: string) {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-zA-Z_]+)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

/** Isi artifact: baris kosong awal/akhir dibuang; satu pembungkus ``` luar (bila model tetap menulisnya) dilepas. */
function cleanContent(text: string) {
  let content = text.replace(/^\s*\n/, "").replace(/\s+$/, "");
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(content.trim());
  if (fenced) content = fenced[1];
  return content;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "artifact";

export function parseArtifacts(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  OPEN.lastIndex = 0;
  for (let match = OPEN.exec(text); match; match = OPEN.exec(text)) {
    if (match.index > cursor) segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    const attrs = attributes(match[1]);
    const start = match.index + match[0].length;
    const end = text.indexOf(CLOSE, start);
    const type = (TYPES.includes(attrs.type as ArtifactType) ? attrs.type : "code") as ArtifactType;
    const title = attrs.title?.trim() || "Artifact";
    segments.push({
      kind: "artifact",
      artifact: {
        identifier: slug(attrs.identifier || title),
        type,
        title,
        language: (attrs.language ?? "").trim().toLowerCase(),
        content: cleanContent(end < 0 ? text.slice(start) : text.slice(start, end)),
        complete: end >= 0,
      },
    });
    cursor = end < 0 ? text.length : end + CLOSE.length;
    OPEN.lastIndex = cursor;
  }
  if (cursor < text.length) {
    // Tag pembuka yang baru sebagian terketik saat stream ("<akai_arti…") tidak ditampilkan
    const rest = text.slice(cursor).replace(/<akai_[^>]*$/, "");
    if (rest) segments.push({ kind: "text", text: rest });
  }
  return segments.filter((s) => s.kind === "artifact" || s.text.trim());
}

export interface ArtifactVersion {
  artifact: Artifact;
  version: number;
  messageId: string;
}

/** Semua versi artifact dalam percakapan (urut kemunculan); identifier sama = versi berikutnya. */
export function collectVersions(messages: { id: string; role: string; content: string }[]) {
  const map = new Map<string, ArtifactVersion[]>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const seg of parseArtifacts(m.content)) {
      if (seg.kind !== "artifact") continue;
      const list = map.get(seg.artifact.identifier) ?? [];
      list.push({ artifact: seg.artifact, version: list.length + 1, messageId: m.id });
      map.set(seg.artifact.identifier, list);
    }
  }
  return map;
}

const CODE_EXT: Record<string, string> = {
  python: "py",
  py: "py",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  jsx: "jsx",
  java: "java",
  go: "go",
  rust: "rs",
  php: "php",
  ruby: "rb",
  sql: "sql",
  bash: "sh",
  shell: "sh",
  sh: "sh",
  json: "json",
  yaml: "yaml",
  css: "css",
  csharp: "cs",
  c: "c",
  cpp: "cpp",
  kotlin: "kt",
  swift: "swift",
};

/** Nama berkas & MIME untuk tombol Unduh. */
export function downloadInfo(a: Artifact) {
  const ext =
    a.type === "markdown"
      ? "md"
      : a.type === "html"
        ? "html"
        : a.type === "svg"
          ? "svg"
          : a.type === "mermaid"
            ? "mmd"
            : (CODE_EXT[a.language] ?? "txt");
  const mime =
    a.type === "html"
      ? "text/html"
      : a.type === "svg"
        ? "image/svg+xml"
        : a.type === "markdown"
          ? "text/markdown"
          : "text/plain";
  return { filename: `${a.identifier}.${ext}`, mime };
}

export const TYPE_LABELS: Record<ArtifactType, string> = {
  markdown: "Dokumen",
  html: "Halaman HTML",
  svg: "Gambar SVG",
  mermaid: "Diagram",
  code: "Kode",
};
