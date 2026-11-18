/**
 * Ekspor artifact Akai (6b.9, docs/AKAI.md §8): Word, Excel, PowerPoint, PDF (lewat dialog cetak peramban), PNG/JPG/SVG, dan
 * berkas sumber. Seluruh modul dimuat malas (`import()` dari panel artifact) agar pustaka docx/pptxgenjs/write-excel-file tidak
 * memperbesar chunk utama. Semua berjalan di peramban — isi artifact tidak dikirim ke server.
 */
import PptxGenJS from "pptxgenjs";
import { renderToStaticMarkup } from "react-dom/server";
import writeXlsxFile from "write-excel-file/browser";
import type { Cell } from "write-excel-file/browser";
import type { Nodes, Root } from "mdast";
import { createElement } from "react";
import { Markdown } from "@/components/chat/markdown";
import {
  type ExportFormat,
  computeSheet,
  parseSheet,
  parseSlides,
  parseWhiteboard,
  sheetCell,
  svgSize,
  toCsv,
  whiteboardSvg,
} from "./artifact-formats";
import { type Artifact, downloadInfo } from "./artifacts";
import { markdownToDocx, parseMarkdown, plainText } from "./markdown-docx";

/* ───────────────────────────── Umum ───────────────────────────── */

export function fileBase(a: Artifact) {
  const name = a.title
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return name || a.identifier;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const textBlob = (text: string, mime: string) => new Blob([text], { type: `${mime};charset=utf-8` });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Gaya dokumen cetak / HTML: salinan ringkas gaya Markdown Akai dalam warna terang. */
const DOC_CSS = `
*{box-sizing:border-box}
body{font-family:"Plus Jakarta Sans","Segoe UI",Arial,sans-serif;color:#1b1f3b;line-height:1.6;font-size:11pt;margin:0;padding:0}
main{max-width:180mm;margin:0 auto;padding:16mm 0}
h1,h2,h3,h4{line-height:1.3;margin:1.1em 0 .45em;break-after:avoid}
h1{font-size:20pt}h2{font-size:15pt}h3{font-size:12.5pt}
p,ul,ol,blockquote,pre,table{margin:.6em 0}
ul,ol{padding-left:1.4em}
a{color:#4b45d6}
blockquote{border-left:3px solid #c6cae0;padding-left:.9em;color:#5b6080}
code{font-family:Consolas,monospace;font-size:.9em;background:#f1f2f8;border-radius:4px;padding:.05em .3em}
pre{background:#f1f2f8;border-radius:8px;padding:10px;white-space:pre-wrap}
pre code{background:none;padding:0}
.akai-code-head{display:none}
table{border-collapse:collapse;width:100%;font-size:10pt}
th,td{border:1px solid #c6cae0;padding:5px 8px;text-align:left;vertical-align:top}
th{background:#e8e9f7}
tr{break-inside:avoid}
img{max-width:100%}
td.num{text-align:right;font-variant-numeric:tabular-nums}
`;

function htmlDocument(title: string, body: string, css = DOC_CSS) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

/**
 * PDF lewat dialog cetak peramban ("Simpan sebagai PDF"). Dokumen cetak dimuat di iframe ber-sandbox TANPA allow-scripts (atribut
 * on* di isi tidak pernah jalan); isinya pun hanya HTML hasil render Akai / gambar raster, bukan HTML mentah dari model.
 */
async function printDocument(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument;
    if (doc) await Promise.all(Array.from(doc.images).map((img) => img.decode().catch(() => undefined)));
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  } finally {
    // print() menahan sampai dialog ditutup di Chrome/Edge; beri jeda untuk peramban yang tidak menahan
    setTimeout(() => frame.remove(), 1500);
  }
}

/* ───────────────────────────── Gambar ───────────────────────────── */

/** Atribut width/height elemen <svg> akar diganti ukuran piksel pasti (gambar butuh ukuran intrinsik untuk digambar). */
function withSize(svg: string, width: number, height: number) {
  return svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    const ns = /xmlns\s*=/.test(cleaned) ? "" : ' xmlns="http://www.w3.org/2000/svg"';
    return `<svg${cleaned}${ns} width="${width}" height="${height}">`;
  });
}

/** SVG → kanvas (lewat <img>, jadi skrip/tautan di SVG tidak pernah jalan). Skala 2× (dibatasi ±32 juta piksel). */
async function svgToCanvas(svg: string, background?: string) {
  const { width, height } = svgSize(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withSize(svg, width, height))}`;
  await img.decode().catch(() => {
    throw new Error("Gambar SVG tidak bisa dibaca peramban.");
  });
  const scale = Math.min(2, Math.sqrt(32_000_000 / (width * height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d")!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { canvas, width, height };
}

function canvasBlob(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg") {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gambar gagal dibuat."))), type, 0.92),
  );
}

async function exportImage(svg: string, format: "png" | "jpg" | "svg" | "pdf", name: string, title: string) {
  if (format === "svg") return saveBlob(textBlob(svg, "image/svg+xml"), `${name}.svg`);
  const { canvas, width, height } = await svgToCanvas(svg, format === "png" ? undefined : "#ffffff");
  if (format === "pdf") {
    const landscape = width > height;
    const css = `@page{size:A4 ${landscape ? "landscape" : "portrait"};margin:10mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}`;
    return printDocument(htmlDocument(title, `<img src="${canvas.toDataURL("image/png")}" alt="">`, css));
  }
  saveBlob(await canvasBlob(canvas, format === "png" ? "image/png" : "image/jpeg"), `${name}.${format}`);
}

let mermaidLoader: Promise<typeof import("mermaid").default> | null = null;

/** Diagram Mermaid → SVG terang tanpa label HTML (foreignObject membuat kanvas "tercemar" dan gagal disimpan sebagai PNG). */
async function mermaidSvg(code: string) {
  mermaidLoader ??= import("mermaid").then((m) => m.default);
  const mermaid = await mermaidLoader;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "default",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  });
  try {
    const { svg } = await mermaid.render(`akai-export-${Date.now()}`, code);
    return svg;
  } finally {
    // Kembalikan pengaturan pratinjau (label HTML) untuk render berikutnya di panel
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  }
}

/* ───────────────────────────── Dokumen ───────────────────────────── */

const markdownHtml = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

/* ───────────────────────────── Lembar kerja ───────────────────────────── */

/** "=ROUND(A1;2)" → "ROUND(A1,2)"; titik koma di dalam teks berkutip dibiarkan. */
export function excelFormula(formula: string) {
  return formula
    .replace(/^=/, "")
    .split('"')
    .map((part, i) => (i % 2 === 0 ? part.replace(/;/g, ",") : part))
    .join('"');
}

export function sheetXlsxData(rows: string[][]) {
  return rows.map((row, r) =>
    row.map((raw): Cell => {
      const cell = sheetCell(raw);
      const header = r === 0 ? { fontWeight: "bold" as const, backgroundColor: "#E8E9F7" } : {};
      switch (cell.kind) {
        case "empty":
          return r === 0 ? { value: "", type: String, ...header } : null;
        case "number":
          return {
            value: cell.value,
            type: Number,
            ...(cell.percent
              ? { format: Number.isInteger(cell.value * 100) ? "0%" : "0.0#%" }
              : Number.isInteger(cell.value) && Math.abs(cell.value) >= 1000
                ? { format: "#,##0" }
                : {}),
            ...header,
          };
        case "formula":
          // OOXML menyimpan rumus tanpa "=" dan dengan pemisah argumen koma (rumus gaya Excel Indonesia memakai ";")
          return { value: excelFormula(cell.formula), type: "Formula", ...header };
        default:
          return { value: cell.text, type: String, wrap: cell.text.length > 60, ...header };
      }
    }),
  );
}

async function exportSheet(a: Artifact, format: ExportFormat, name: string) {
  const sheets = parseSheet(a.content);
  if (!sheets.length) throw new Error("Lembar kerja kosong.");
  if (format === "csv") {
    const csv =
      sheets.length === 1
        ? toCsv(sheets[0].rows)
        : sheets.map((s) => `# Sheet: ${s.name}\r\n${toCsv(s.rows)}`).join("\r\n\r\n");
    // BOM agar Excel membaca huruf non-ASCII dengan benar
    return saveBlob(textBlob(String.fromCharCode(0xfeff) + csv, "text/csv"), `${name}.csv`);
  }
  if (format === "xlsx") {
    const blob = await writeXlsxFile(
      sheets.map((s) => ({
        sheet: s.name,
        data: sheetXlsxData(s.rows),
        stickyRowsCount: 1,
        columns: (s.rows[0] ?? []).map((_, c) => ({
          width: Math.max(8, Math.min(50, Math.max(...s.rows.map((r) => (r[c] ?? "").length)) + 2)),
        })),
      })),
    ).toBlob();
    return saveBlob(blob, `${name}.xlsx`);
  }
  const body = sheets
    .map((s) => {
      const computed = computeSheet(s.rows);
      const rows = computed
        .map(
          (row, r) =>
            `<tr>${row.map((c) => (r === 0 ? `<th>${escapeHtml(c.display)}</th>` : `<td${c.numeric !== null ? ' class="num"' : ""}>${escapeHtml(c.display)}</td>`)).join("")}</tr>`,
        )
        .join("");
      return `${sheets.length > 1 ? `<h2>${escapeHtml(s.name)}</h2>` : ""}<table>${rows}</table>`;
    })
    .join("");
  const wide = Math.max(...sheets.map((s) => s.rows[0]?.length ?? 0)) > 6;
  const css = `${DOC_CSS}@page{size:A4 ${wide ? "landscape" : "portrait"};margin:12mm}main{max-width:none;padding:0}`;
  return printDocument(htmlDocument(a.title, `<main><h1>${escapeHtml(a.title)}</h1>${body}</main>`, css));
}

/* ───────────────────────────── Presentasi ───────────────────────────── */

type Run = PptxGenJS.TextProps;

function pptRuns(node: Nodes, options: PptxGenJS.TextPropsOptions = {}): Run[] {
  switch (node.type) {
    case "text":
      return [{ text: node.value.replace(/\n/g, " "), options }];
    case "inlineCode":
      return [{ text: node.value, options: { ...options, fontFace: "Consolas" } }];
    case "strong":
      return node.children.flatMap((c) => pptRuns(c, { ...options, bold: true }));
    case "emphasis":
      return node.children.flatMap((c) => pptRuns(c, { ...options, italic: true }));
    case "delete":
      return node.children.flatMap((c) => pptRuns(c, { ...options, strike: "sngStrike" }));
    case "link":
      return /^https?:/i.test(node.url)
        ? [{ text: plainText(node), options: { ...options, hyperlink: { url: node.url } } }]
        : node.children.flatMap((c) => pptRuns(c, options));
    case "break":
      return [{ text: "", options: { ...options, breakLine: true } }];
    default:
      return "children" in node ? (node.children as Nodes[]).flatMap((c) => pptRuns(c, options)) : [];
  }
}

/** Blok Markdown slide → paragraf PowerPoint (butir bertingkat, nomor, kutipan) + tabel terpisah. */
function slideBody(tree: Root) {
  const paragraphs: Run[] = [];
  const tables: PptxGenJS.TableRow[][] = [];
  const push = (runs: Run[], para: PptxGenJS.TextPropsOptions) => {
    if (!runs.length) return;
    runs.forEach((run, i) => {
      run.options = { ...para, ...run.options, ...(i === runs.length - 1 ? { breakLine: true } : {}) };
    });
    paragraphs.push(...runs);
  };
  const walk = (node: Nodes, level: number, ordered?: boolean) => {
    switch (node.type) {
      case "paragraph":
        push(
          pptRuns(node),
          level >= 0 ? { bullet: ordered ? { type: "number" } : true, indentLevel: level } : { paraSpaceAfter: 6 },
        );
        break;
      case "heading":
        push(pptRuns(node, { bold: true, fontSize: 20 }), { paraSpaceAfter: 6 });
        break;
      case "list":
        for (const item of node.children)
          item.children.forEach((child, i) => {
            if (child.type === "paragraph" && i === 0) walk(child, level + 1, node.ordered ?? false);
            else walk(child, level + 1);
          });
        break;
      case "blockquote":
        node.children.forEach((c) =>
          c.type === "paragraph" ? push(pptRuns(c, { italic: true, color: "5B6080" }), {}) : walk(c, level),
        );
        break;
      case "code":
        push([{ text: node.value, options: { fontFace: "Consolas", fontSize: 14 } }], {});
        break;
      case "table":
        tables.push(
          node.children.map((row, r) =>
            row.children.map((cell) => ({
              text: plainText(cell),
              options: r === 0 ? { bold: true, fill: { color: "E8E9F7" } } : {},
            })),
          ),
        );
        break;
      default:
        break;
    }
  };
  // tingkat -1 = paragraf biasa; daftar menaikkan ke 0, 1, …
  for (const node of tree.children) walk(node, -1);
  return { paragraphs, tables };
}

const INK = "1B1F3B";

async function exportSlides(a: Artifact, format: ExportFormat, name: string) {
  const slides = parseSlides(a.content);
  if (!slides.length) throw new Error("Presentasi kosong.");
  if (format === "pdf") {
    const pages = slides
      .map((s) =>
        s.cover
          ? `<section class="cover"><h1>${escapeHtml(s.title)}</h1><div class="sub">${markdownHtml(s.body)}</div><i></i></section>`
          : `<section><b></b>${s.title ? `<h2>${escapeHtml(s.title)}</h2>` : ""}<div class="body">${markdownHtml(s.body)}</div></section>`,
      )
      .join("");
    const css = `${DOC_CSS}
@page{size:13.333in 7.5in;margin:0}
body{font-size:17pt}
section{position:relative;width:13.333in;height:7.5in;padding:.55in .8in;overflow:hidden;break-after:page;background:#fff}
section b{position:absolute;left:0;top:0;bottom:0;width:.12in;background:linear-gradient(#5b55f0,#3cc4e2)}
section h2{font-size:28pt;margin:0 0 .3in}
section.cover{background:linear-gradient(135deg,#1d2350,#0f1330);color:#fff;display:flex;flex-direction:column;justify-content:center}
section.cover h1{font-size:40pt;margin:0}
section.cover .sub{opacity:.8;font-size:19pt}
section.cover i{position:absolute;left:0;right:0;bottom:0;height:.18in;background:linear-gradient(90deg,#5b55f0,#3cc4e2,#c3f05a)}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
    return printDocument(htmlDocument(a.title, pages, css));
  }
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = a.title;
  pptx.author = "Akai · workingspace.id";
  const font = "Arial";
  for (const s of slides) {
    const slide = pptx.addSlide();
    const { paragraphs, tables } = slideBody(parseMarkdown(s.body));
    if (s.cover) {
      slide.background = { color: "1D2350" };
      slide.addShape("rect", { x: 0, y: 7.3, w: 13.333, h: 0.2, fill: { color: "3CC4E2" }, line: { color: "3CC4E2" } });
      slide.addText(s.title, {
        x: 0.8,
        y: 2.2,
        w: 11.7,
        h: 1.6,
        fontFace: font,
        fontSize: 40,
        bold: true,
        color: "FFFFFF",
        valign: "bottom",
      });
      if (paragraphs.length)
        slide.addText(
          paragraphs.map((p) => ({ ...p, options: { ...p.options, bullet: false, color: "C7CBEA" } })),
          { x: 0.8, y: 3.95, w: 11.7, h: 1.6, fontFace: font, fontSize: 20, valign: "top" },
        );
    } else {
      slide.background = { color: "FFFFFF" };
      slide.addShape("rect", { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: "5B55F0" }, line: { color: "5B55F0" } });
      if (s.title)
        slide.addText(s.title, {
          x: 0.6,
          y: 0.35,
          w: 12.1,
          h: 0.95,
          fontFace: font,
          fontSize: 28,
          bold: true,
          color: INK,
          valign: "middle",
        });
      const top = s.title ? 1.45 : 0.6;
      const textHeight = tables.length ? (paragraphs.length ? 1.9 : 0) : 7.5 - top - 0.5;
      if (paragraphs.length)
        slide.addText(paragraphs, {
          x: 0.6,
          y: top,
          w: 12.1,
          h: textHeight,
          fontFace: font,
          fontSize: 18,
          color: INK,
          valign: "top",
          paraSpaceAfter: 6,
          fit: "shrink",
        });
      let y = top + textHeight + (paragraphs.length && tables.length ? 0.15 : 0);
      for (const rows of tables) {
        const height = Math.min(7.5 - y - 0.4, 0.42 * rows.length);
        if (height <= 0.3) break;
        slide.addTable(rows, {
          x: 0.6,
          y,
          w: 12.1,
          fontFace: font,
          fontSize: 14,
          color: INK,
          border: { type: "solid", pt: 0.75, color: "C6CAE0" },
          autoPage: false,
        });
        y += height + 0.2;
      }
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  saveBlob(blob, `${name}.pptx`);
}

/* ───────────────────────────── Pintu masuk ───────────────────────────── */

export async function exportArtifact(a: Artifact, format: ExportFormat) {
  const name = fileBase(a);
  switch (a.type) {
    case "markdown":
      if (format === "docx") return saveBlob(await markdownToDocx(a.content, a.title), `${name}.docx`);
      if (format === "pdf") return printDocument(htmlDocument(a.title, `<main>${markdownHtml(a.content)}</main>`));
      if (format === "html")
        return saveBlob(
          textBlob(htmlDocument(a.title, `<main>${markdownHtml(a.content)}</main>`), "text/html"),
          `${name}.html`,
        );
      return saveBlob(textBlob(a.content, "text/markdown"), `${name}.md`);
    case "sheet":
      return exportSheet(a, format, name);
    case "slides":
      if (format === "md") return saveBlob(textBlob(a.content, "text/markdown"), `${name}.md`);
      return exportSlides(a, format, name);
    case "svg":
      return exportImage(a.content, format as "png", name, a.title);
    case "mermaid":
      if (format === "mmd") return saveBlob(textBlob(a.content, "text/plain"), `${name}.mmd`);
      return exportImage(await mermaidSvg(a.content), format as "png", name, a.title);
    case "whiteboard": {
      if (format === "canvas") return saveBlob(textBlob(a.content, "application/json"), `${name}.canvas`);
      const { board, error } = parseWhiteboard(a.content);
      if (!board) throw new Error(error ?? "Papan tidak bisa digambar.");
      return exportImage(whiteboardSvg(board).svg, format as "png", name, a.title);
    }
    default: {
      const { filename, mime } = downloadInfo(a);
      return saveBlob(textBlob(a.content, mime), a.type === "code" ? filename : `${name}.${filename.split(".").pop()}`);
    }
  }
}
