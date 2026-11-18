/**
 * Format artifact dokumen Akai (docs/AKAI.md §8, 6b.9): lembar kerja (`sheet` = CSV), slide (`slides` = Markdown dipisah `---`),
 * papan tulis (`whiteboard` = JSON Canvas 1.0). Format tulisan model = instruksi `ARTIFACT_INSTRUCTIONS`
 * (apps/akai/api/src/chat/chat-logic.ts) — ubah keduanya bersamaan. Logika murni, diuji di artifact-formats.test.ts; dipakai tampilan
 * panel (artifact-views.tsx) dan ekspor (artifact-export.ts).
 */
import type { ArtifactType } from "./artifacts";

/* ───────────────────────────── Lembar kerja ───────────────────────────── */

export interface SheetTable {
  name: string;
  rows: string[][];
}

const SHEET_MARKER = /^#\s*(?:sheet|lembar)\s*:\s*(.+)$/i;
export const SHEET_LIMITS = { sheets: 10, rows: 5000, columns: 60 };

function detectDelimiter(lines: string[]) {
  const sample = lines.slice(0, 5).join("\n");
  const count = (ch: string) => sample.split(ch).length - 1;
  const tabs = count("\t");
  const semis = count(";");
  const commas = count(",");
  if (tabs > commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

/** CSV (RFC 4180: kutip ganda, "" di dalam kutip, baris baru di dalam kutip) → baris sel. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const sep = delimiter ?? detectDelimiter(text.split("\n"));
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

/** Isi artifact sheet → satu atau beberapa lembar (penanda baris `# Sheet: Nama`). Baris dirapikan agar sama lebar. */
export function parseSheet(content: string): SheetTable[] {
  const sheets: { name: string; lines: string[] }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const line of content.split(/\r?\n/)) {
    const marker = SHEET_MARKER.exec(line.trim());
    if (marker) {
      current = { name: marker[1].trim().slice(0, 31), lines: [] };
      sheets.push(current);
      continue;
    }
    if (!current) {
      current = { name: "Sheet1", lines: [] };
      sheets.push(current);
    }
    current.lines.push(line);
  }
  return sheets
    .slice(0, SHEET_LIMITS.sheets)
    .map((s, index) => {
      const rows = parseCsv(s.lines.join("\n"))
        .slice(0, SHEET_LIMITS.rows)
        .map((r) => r.slice(0, SHEET_LIMITS.columns));
      const width = Math.max(0, ...rows.map((r) => r.length));
      return {
        name: s.name || `Sheet${index + 1}`,
        rows: rows.map((r) => [...r, ...Array<string>(width - r.length).fill("")]),
      };
    })
    .filter((s) => s.rows.length);
}

export type SheetCell =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "number"; value: number; percent?: boolean }
  | { kind: "formula"; formula: string };

const NUMBER = /^-?\d+(?:\.\d+)?$/;
const PERCENT = /^-?\d+(?:\.\d+)?%$/;

/** Arti satu sel: angka (titik desimal, tanpa pemisah ribuan), persen, rumus (`=…`), atau teks. */
export function sheetCell(raw: string): SheetCell {
  const text = raw.trim();
  if (!text) return { kind: "empty" };
  if (text.startsWith("=") && text.length > 1) return { kind: "formula", formula: text };
  if (NUMBER.test(text) && !/^-?0\d/.test(text)) return { kind: "number", value: Number(text) };
  if (PERCENT.test(text)) return { kind: "number", value: Number(text.slice(0, -1)) / 100, percent: true };
  return { kind: "text", text };
}

/** "B12" → { col: 1, row: 11 } (berbasis 0; baris 1 = baris pertama CSV, biasanya judul kolom). */
export function cellRef(ref: string) {
  const m = /^([A-Z]{1,3})(\d{1,6})$/.exec(ref.toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

export function columnName(index: number) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

type Token = { t: "num"; v: number } | { t: "ref"; v: string } | { t: "fn"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  const re =
    /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z]{1,3}\d{1,6}(?::[A-Za-z]{1,3}\d{1,6})?)(?![A-Za-z(])|([A-Za-z]+)\s*(?=\()|([-+*/(),;:]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) return null;
    if (m[1]) out.push({ t: "num", v: Number(m[1]) });
    else if (m[2]) out.push({ t: "ref", v: m[2].toUpperCase() });
    else if (m[3]) out.push({ t: "fn", v: m[3].toUpperCase() });
    else out.push({ t: "op", v: m[4] === ";" ? "," : m[4] });
    pos = re.lastIndex;
  }
  return out;
}

const FUNCTIONS: Record<string, (args: number[]) => number> = {
  SUM: (a) => a.reduce((s, x) => s + x, 0),
  AVERAGE: (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN),
  MIN: (a) => (a.length ? Math.min(...a) : 0),
  MAX: (a) => (a.length ? Math.max(...a) : 0),
  COUNT: (a) => a.length,
  ROUND: (a) => {
    const f = 10 ** (a[1] ?? 0);
    return Math.round((a[0] ?? 0) * f) / f;
  },
  ABS: (a) => Math.abs(a[0] ?? 0),
};
FUNCTIONS.AVG = FUNCTIONS.AVERAGE;
FUNCTIONS.JUMLAH = FUNCTIONS.SUM;
FUNCTIONS["RATA"] = FUNCTIONS.AVERAGE;

/**
 * Menghitung rumus sederhana untuk pratinjau: angka, sel (A1), rentang dalam fungsi (A1:B3), + - * / ( ), fungsi SUM AVERAGE MIN
 * MAX COUNT ROUND ABS. Rumus lain → null (pratinjau menampilkan rumusnya; berkas XLSX tetap menyimpan rumus asli untuk Excel).
 */
export function evaluateFormula(formula: string, lookup: (col: number, row: number) => number | null): number | null {
  const tokens = tokenize(formula.replace(/^=/, ""));
  if (!tokens?.length) return null;
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const fail = () => {
    throw new Error("rumus");
  };
  const refValues = (ref: string): number[] => {
    const [a, b] = ref.split(":");
    const start = cellRef(a);
    const end = cellRef(b ?? a);
    if (!start || !end) return fail();
    const values: number[] = [];
    for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++)
      for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
        const v = lookup(c, r);
        // NaN = sel rumus yang galat / melingkar → rumus ini ikut galat (seperti #REF! di Excel)
        if (v !== null && Number.isNaN(v)) fail();
        if (v !== null) values.push(v);
      }
    if (values.length > 100_000) fail();
    return values;
  };
  const expr = (): number => {
    let v = term();
    while (isOp("+") || isOp("-")) v = tokens[i++].v === "+" ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (isOp("*") || isOp("/")) v = tokens[i++].v === "*" ? v * factor() : v / factor();
    return v;
  };
  const factor = (): number => {
    const tok = tokens[i++];
    if (!tok) return fail();
    if (tok.t === "op" && tok.v === "-") return -factor();
    if (tok.t === "op" && tok.v === "+") return factor();
    if (tok.t === "num") return tok.v;
    if (tok.t === "ref") {
      if (tok.v.includes(":")) return fail();
      return refValues(tok.v)[0] ?? 0;
    }
    if (tok.t === "op" && tok.v === "(") {
      const v = expr();
      if (!isOp(")")) fail();
      i++;
      return v;
    }
    if (tok.t === "fn") {
      const fn = FUNCTIONS[tok.v];
      if (!fn || !isOp("(")) return fail();
      i++;
      const args: number[] = [];
      while (!isOp(")")) {
        const next = peek();
        if (next?.t === "ref" && next.v.includes(":")) {
          i++;
          args.push(...refValues(next.v));
        } else args.push(expr());
        if (isOp(",")) i++;
        else if (!isOp(")")) fail();
      }
      i++;
      return fn(args);
    }
    return fail();
  };
  try {
    const value = expr();
    if (i !== tokens.length || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export type ComputedCell = SheetCell & { display: string; numeric: number | null };

const formatNumber = (n: number, percent?: boolean) =>
  percent
    ? `${(n * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`
    : n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

/** Seluruh lembar dihitung untuk pratinjau (rumus saling merujuk dihitung berantai; rujukan melingkar = tampil rumusnya). */
export function computeSheet(rows: string[][]): ComputedCell[][] {
  const cells = rows.map((r) => r.map(sheetCell));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const valueAt = (col: number, row: number): number | null => {
    const cell = cells[row]?.[col];
    if (!cell) return null;
    if (cell.kind === "number") return cell.value;
    if (cell.kind !== "formula") return null;
    const key = `${col}:${row}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) return NaN;
    visiting.add(key);
    const v = evaluateFormula(cell.formula, valueAt) ?? NaN;
    visiting.delete(key);
    memo.set(key, v);
    return v;
  };
  return cells.map((r, row) =>
    r.map((cell, col): ComputedCell => {
      if (cell.kind === "number")
        return { ...cell, display: formatNumber(cell.value, cell.percent), numeric: cell.value };
      if (cell.kind === "formula") {
        const v = valueAt(col, row);
        const ok = v !== null && !Number.isNaN(v);
        return { ...cell, display: ok ? formatNumber(v) : cell.formula, numeric: ok ? v : null };
      }
      return { ...cell, display: cell.kind === "text" ? cell.text : "", numeric: null };
    }),
  );
}

/** Kembali ke CSV (ekspor CSV per lembar). */
export function toCsv(rows: string[][]) {
  return rows.map((r) => r.map((c) => (/[",\n;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");
}

/* ───────────────────────────── Slide ───────────────────────────── */

export interface Slide {
  title: string;
  /** true = slide judul (heading `#` di slide pertama) */
  cover: boolean;
  body: string;
  notes: string;
}

const NOTES_LINE = /^(?:catatan|notes?)\s*(?:pembicara)?\s*:\s*/i;

/** Markdown dipisah baris `---` (di luar blok kode) → slide; heading pertama = judul, baris `Catatan:` dst. = catatan pembicara. */
export function parseSlides(content: string): Slide[] {
  const chunks: string[][] = [[]];
  let fence = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^\s*-{3,}\s*$/.test(line)) {
      chunks.push([]);
      continue;
    }
    chunks[chunks.length - 1].push(line);
  }
  const slides: Slide[] = [];
  chunks.forEach((lines, index) => {
    let title = "";
    let level = 0;
    const body: string[] = [];
    const notes: string[] = [];
    let inNotes = false;
    for (const line of lines) {
      if (inNotes) {
        notes.push(line);
        continue;
      }
      const heading = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
      if (!title && heading) {
        title = heading[2].trim();
        level = heading[1].length;
        continue;
      }
      if (NOTES_LINE.test(line.trim())) {
        inNotes = true;
        notes.push(line.trim().replace(NOTES_LINE, ""));
        continue;
      }
      body.push(line);
    }
    const text = body.join("\n").trim();
    if (!title && !text) return;
    slides.push({
      title,
      cover: slides.length === 0 && level === 1 && index === 0,
      body: text,
      notes: notes.join("\n").trim(),
    });
  });
  return slides.slice(0, 80);
}

/* ───────────────────────────── Papan tulis ───────────────────────────── */

export interface BoardNode {
  id: string;
  type: "text" | "group";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export interface BoardEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  label?: string;
  color?: string;
  toEnd: boolean;
  fromEnd: boolean;
}

type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];

export interface Board {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const COLOR = /^(?:[1-6]|#[0-9a-f]{3}|#[0-9a-f]{6})$/i;

/** JSON Canvas 1.0 → papan yang aman digambar (jenis file/link ditampilkan sebagai kartu teks; garis ke node yang tidak ada dibuang). */
export function parseWhiteboard(content: string): { board: Board | null; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { board: null, error: "Isi papan bukan JSON yang sah." };
  }
  const raw = (data ?? {}) as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(raw.nodes)) return { board: null, error: "Papan tidak punya daftar nodes." };
  const nodes: BoardNode[] = [];
  const ids = new Set<string>();
  for (const item of raw.nodes.slice(0, 400)) {
    const n = (item ?? {}) as Record<string, unknown>;
    const id = str(n.id, 80);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const kind = n.type === "group" ? "group" : "text";
    const text =
      kind === "group"
        ? str(n.label, 200)
        : str(n.text, 4000) || str(n.label, 400) || str(n.file, 400) || str(n.url, 400);
    nodes.push({
      id,
      type: kind,
      text,
      x: Math.max(-1e5, Math.min(1e5, finite(n.x, 0))),
      y: Math.max(-1e5, Math.min(1e5, finite(n.y, 0))),
      width: Math.max(40, Math.min(5000, finite(n.width, 240))),
      height: Math.max(30, Math.min(5000, finite(n.height, 120))),
      color: typeof n.color === "string" && COLOR.test(n.color) ? n.color : undefined,
    });
  }
  const edges: BoardEdge[] = [];
  if (Array.isArray(raw.edges))
    for (const item of raw.edges.slice(0, 800)) {
      const e = (item ?? {}) as Record<string, unknown>;
      const fromNode = str(e.fromNode, 80);
      const toNode = str(e.toNode, 80);
      if (!ids.has(fromNode) || !ids.has(toNode) || fromNode === toNode) continue;
      edges.push({
        id: str(e.id, 80) || `${fromNode}-${toNode}`,
        fromNode,
        toNode,
        fromSide: SIDES.includes(e.fromSide as Side) ? (e.fromSide as Side) : undefined,
        toSide: SIDES.includes(e.toSide as Side) ? (e.toSide as Side) : undefined,
        label: str(e.label, 200) || undefined,
        color: typeof e.color === "string" && COLOR.test(e.color) ? e.color : undefined,
        toEnd: e.toEnd !== "none",
        fromEnd: e.fromEnd === "arrow",
      });
    }
  if (!nodes.length) return { board: null, error: "Papan masih kosong." };
  return { board: { nodes, edges } };
}

const PRESET: Record<string, { light: [string, string]; dark: [string, string] }> = {
  // [isian, garis]
  "1": { light: ["#fde2e1", "#e5484d"], dark: ["#3b1719", "#f2555a"] },
  "2": { light: ["#ffe8d4", "#f76b15"], dark: ["#3a2010", "#ff8b3e"] },
  "3": { light: ["#fff4c2", "#d6a400"], dark: ["#352b07", "#f5d90a"] },
  "4": { light: ["#dcf5e3", "#30a46c"], dark: ["#12301f", "#3dd68c"] },
  "5": { light: ["#d6f3fb", "#0894b3"], dark: ["#0d2d35", "#4ccce6"] },
  "6": { light: ["#ebe4ff", "#6e56cf"], dark: ["#261f45", "#9e8cfc"] },
};

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Teks kartu dipecah per baris menurut lebar (perkiraan lebar huruf), Markdown ringan dibuang; judul `#` ditebalkan. */
export function wrapText(text: string, width: number, fontSize: number) {
  const max = Math.max(4, Math.floor(width / (fontSize * 0.56)));
  const lines: { text: string; bold: boolean }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const bold = /^#{1,6}\s/.test(rawLine);
    const clean = rawLine
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\s*[-*+]\s+/, "• ")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a);
    if (!clean.trim()) {
      lines.push({ text: "", bold: false });
      continue;
    }
    let line = "";
    for (const word of clean.split(/\s+/)) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length > max && line) {
        lines.push({ text: line, bold });
        line = word;
      } else line = candidate;
      while (line.length > max) {
        lines.push({ text: line.slice(0, max), bold });
        line = line.slice(max);
      }
    }
    if (line) lines.push({ text: line, bold });
  }
  return lines;
}

function anchor(n: BoardNode, side: Side) {
  switch (side) {
    case "top":
      return { x: n.x + n.width / 2, y: n.y };
    case "bottom":
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case "left":
      return { x: n.x, y: n.y + n.height / 2 };
    default:
      return { x: n.x + n.width, y: n.y + n.height / 2 };
  }
}

function autoSide(from: BoardNode, to: BoardNode): Side {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const NORMAL: Record<Side, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

/** Papan → SVG mandiri (tanpa skrip, teks di-escape) untuk pratinjau, ekspor SVG/PNG/PDF. */
export function whiteboardSvg(board: Board, options: { dark?: boolean } = {}) {
  const dark = !!options.dark;
  const pad = 40;
  const minX = Math.min(...board.nodes.map((n) => n.x)) - pad;
  const minY = Math.min(...board.nodes.map((n) => n.y)) - pad;
  const maxX = Math.max(...board.nodes.map((n) => n.x + n.width)) + pad;
  const maxY = Math.max(...board.nodes.map((n) => n.y + n.height)) + pad;
  const width = Math.round(maxX - minX);
  const height = Math.round(maxY - minY);
  const ink = dark ? "#e8eaf6" : "#1b1f3b";
  const muted = dark ? "#9aa0c3" : "#5b6080";
  const paper = dark ? "#11142a" : "#ffffff";
  const card = dark ? "#1b1f3b" : "#ffffff";
  const line = dark ? "#3d4370" : "#c6cae0";
  const colors = (color?: string): [string, string] => {
    if (!color) return [card, line];
    if (color.startsWith("#")) return [!dark && color.length === 7 ? `${color}22` : card, color];
    return PRESET[color][dark ? "dark" : "light"];
  };
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  const groupLabels: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="Plus Jakarta Sans, Segoe UI, Arial, sans-serif">`,
    `<defs><marker id="akai-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${muted}"/></marker></defs>`,
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${paper}"/>`,
  );
  for (const g of board.nodes.filter((n) => n.type === "group")) {
    const [fill, stroke] = colors(g.color);
    parts.push(
      `<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="16" fill="${g.color ? fill : dark ? "#161a33" : "#f6f7fc"}" fill-opacity="0.7" stroke="${stroke}" stroke-dasharray="6 5"/>`,
    );
    // Label kelompok di sudut kiri atas bagian dalam, digambar setelah garis agar tidak tertimpa label garis
    if (g.text)
      groupLabels.push(
        `<text x="${g.x + 14}" y="${g.y + 24}" font-size="14" font-weight="700" fill="${muted}" paint-order="stroke" stroke="${paper}" stroke-width="4">${escapeXml(g.text)}</text>`,
      );
  }
  for (const e of board.edges) {
    const from = byId.get(e.fromNode)!;
    const to = byId.get(e.toNode)!;
    const fs = e.fromSide ?? autoSide(from, to);
    const ts = e.toSide ?? (e.fromSide ? OPPOSITE[fs] : autoSide(to, from));
    const a = anchor(from, fs);
    const b = anchor(to, ts);
    const dist = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 2.5);
    const c1 = { x: a.x + NORMAL[fs][0] * dist, y: a.y + NORMAL[fs][1] * dist };
    const c2 = { x: b.x + NORMAL[ts][0] * dist, y: b.y + NORMAL[ts][1] * dist };
    const stroke = e.color ? colors(e.color)[1] : muted;
    parts.push(
      `<path d="M${a.x} ${a.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}" fill="none" stroke="${stroke}" stroke-width="2"${e.toEnd ? ' marker-end="url(#akai-arrow)"' : ""}${e.fromEnd ? ' marker-start="url(#akai-arrow)"' : ""}/>`,
    );
    if (e.label) {
      const mx = (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8;
      const my = (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8;
      const w = Math.min(260, e.label.length * 7.2 + 16);
      parts.push(
        `<rect x="${mx - w / 2}" y="${my - 12}" width="${w}" height="24" rx="8" fill="${paper}" stroke="${line}"/>`,
        `<text x="${mx}" y="${my + 4.5}" font-size="12.5" text-anchor="middle" fill="${ink}">${escapeXml(e.label)}</text>`,
      );
    }
  }
  parts.push(...groupLabels);
  for (const n of board.nodes.filter((x) => x.type === "text")) {
    const [fill, stroke] = colors(n.color);
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="${n.color ? 2 : 1.2}"/>`,
    );
    const fontSize = 14;
    const lineHeight = fontSize * 1.4;
    const lines = wrapText(n.text, n.width - 28, fontSize);
    const fit = Math.max(1, Math.floor((n.height - 24) / lineHeight));
    const shown = lines.slice(0, fit);
    if (lines.length > fit && shown.length)
      shown[shown.length - 1] = { ...shown[shown.length - 1], text: `${shown[shown.length - 1].text}…` };
    const top = n.y + Math.max(14, (n.height - shown.length * lineHeight) / 2) + fontSize;
    shown.forEach((l, i) => {
      if (!l.text) return;
      parts.push(
        `<text x="${n.x + 14}" y="${top + i * lineHeight}" font-size="${l.bold ? fontSize + 1 : fontSize}"${l.bold ? ' font-weight="700"' : ""} fill="${ink}">${escapeXml(l.text)}</text>`,
      );
    });
  }
  parts.push("</svg>");
  return { svg: parts.join(""), width, height };
}

/* ───────────────────────────── Ukuran SVG ───────────────────────────── */

/** Ukuran gambar dari elemen <svg> (width/height, atau viewBox); dipakai saat mengubah SVG menjadi PNG/JPG. */
export function svgSize(svg: string) {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const num = (name: string) => {
    // "100%" bukan ukuran piksel → diabaikan (dihitung dari viewBox)
    const m = new RegExp(`\\s${name}\\s*=\\s*["']?([\\d.]+)(?:px)?(?=["'\\s/>])`, "i").exec(root);
    return m ? Number(m[1]) : NaN;
  };
  let width = num("width");
  let height = num("height");
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(root);
  if (box) {
    const bw = Number(box[1]);
    const bh = Number(box[2]);
    if (!(width > 0) && !(height > 0)) [width, height] = [bw, bh];
    else if (!(height > 0)) height = (width * bh) / bw;
    else if (!(width > 0)) width = (height * bw) / bh;
  }
  if (!(width > 0) || !(height > 0)) return { width: 1024, height: 768 };
  return { width: Math.min(width, 8000), height: Math.min(height, 8000) };
}

/* ───────────────────────────── Pilihan ekspor ───────────────────────────── */

export type ExportFormat =
  "md" | "docx" | "pdf" | "html" | "xlsx" | "csv" | "pptx" | "svg" | "png" | "jpg" | "mmd" | "canvas" | "source";

export const EXPORT_LABELS: Record<ExportFormat, string> = {
  docx: "Word (.docx)",
  xlsx: "Excel (.xlsx)",
  pptx: "PowerPoint (.pptx)",
  pdf: "PDF (lewat cetak)",
  png: "Gambar PNG",
  jpg: "Gambar JPG",
  svg: "Gambar SVG",
  md: "Markdown (.md)",
  html: "HTML (.html)",
  csv: "CSV (.csv)",
  mmd: "Kode Mermaid (.mmd)",
  canvas: "Canvas Obsidian (.canvas)",
  source: "Berkas asli",
};

/** Format ekspor per jenis artifact, yang paling sering dipakai di atas. */
export function exportFormats(type: ArtifactType): ExportFormat[] {
  switch (type) {
    case "markdown":
      return ["docx", "pdf", "md", "html"];
    case "sheet":
      return ["xlsx", "csv", "pdf"];
    case "slides":
      return ["pptx", "pdf", "md"];
    case "svg":
      return ["png", "jpg", "svg", "pdf"];
    case "mermaid":
      return ["png", "svg", "pdf", "mmd"];
    case "whiteboard":
      return ["png", "svg", "pdf", "canvas"];
    case "html":
      return ["html"];
    default:
      return ["source"];
  }
}
