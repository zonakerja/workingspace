/**
 * Markdown (GFM) → dokumen Word (.docx) untuk ekspor artifact dokumen (6b.9). Dimuat malas bersama artifact-export.ts.
 * Pohon Markdown dibaca `mdast-util-from-markdown` (+ GFM: tabel, coret, daftar tugas) lalu dipetakan ke elemen `docx`.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import type { Nodes, Parent, PhrasingContent, Root, RootContent, Table as MdTable } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

type Block = Paragraph | Table;
interface Marks {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

export function parseMarkdown(text: string): Root {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** Teks polos sebuah node (untuk alt gambar, judul, dsb.). */
export function plainText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node as Parent).children.map((c) => plainText(c as Nodes)).join("");
  return "";
}

function inline(nodes: PhrasingContent[], marks: Marks = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push(
          new TextRun({
            text: node.value.replace(/\n/g, " "),
            bold: marks.bold,
            italics: marks.italics,
            strike: marks.strike,
            font: marks.code ? "Consolas" : undefined,
          }),
        );
        break;
      case "strong":
        out.push(...inline(node.children, { ...marks, bold: true }));
        break;
      case "emphasis":
        out.push(...inline(node.children, { ...marks, italics: true }));
        break;
      case "delete":
        out.push(...inline(node.children, { ...marks, strike: true }));
        break;
      case "inlineCode":
        out.push(
          new TextRun({
            text: node.value,
            font: "Consolas",
            bold: marks.bold,
            shading: { type: ShadingType.CLEAR, fill: "F1F2F8", color: "auto" },
          }),
        );
        break;
      case "break":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      case "link": {
        const safe = /^(https?:|mailto:)/i.test(node.url);
        const children = inline(node.children, marks).filter((c): c is TextRun => c instanceof TextRun);
        if (safe)
          out.push(
            new ExternalHyperlink({
              link: node.url,
              children: [new TextRun({ text: plainText(node), style: "Hyperlink", bold: marks.bold })],
            }),
          );
        else out.push(...children);
        break;
      }
      case "image":
        if (node.alt) out.push(new TextRun({ text: `[Gambar: ${node.alt}]`, italics: true }));
        break;
      default:
        if ("children" in node) out.push(...inline((node as Parent).children as PhrasingContent[], marks));
        else if ("value" in node) out.push(new TextRun({ text: String(node.value) }));
    }
  }
  return out;
}

class Builder {
  private numberedLists = 0;

  blocks(nodes: RootContent[], depth = 0): Block[] {
    return nodes.flatMap((n) => this.block(n, depth));
  }

  private block(node: RootContent, depth: number): Block[] {
    switch (node.type) {
      case "heading":
        return [new Paragraph({ heading: HEADINGS[node.depth - 1], children: inline(node.children) })];
      case "paragraph":
        return [new Paragraph({ children: inline(node.children), spacing: { after: 120 } })];
      case "list": {
        const instance = node.ordered ? ++this.numberedLists : 0;
        return node.children.flatMap((item) =>
          item.children.flatMap((child, index): Block[] => {
            if (child.type === "list") return this.block(child, depth + 1);
            // Paragraf lanjutan / kode / kutipan di dalam butir: ditulis apa adanya di bawah butirnya
            if (child.type !== "paragraph" || index > 0) return this.block(child, depth + 1);
            const prefix = item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
            const children = [...(prefix ? [new TextRun(prefix)] : []), ...inline(child.children)];
            return [
              node.ordered
                ? new Paragraph({
                    children,
                    numbering: { reference: "akai-numbered", level: Math.min(depth, 8), instance },
                  })
                : new Paragraph({ children, bullet: { level: Math.min(depth, 8) } }),
            ];
          }),
        );
      }
      case "blockquote":
        return node.children.flatMap((child) =>
          child.type === "paragraph"
            ? [
                new Paragraph({
                  children: inline(child.children, { italics: true }),
                  indent: { left: 567 },
                  border: { left: { style: BorderStyle.SINGLE, size: 12, color: "C6CAE0", space: 8 } },
                  spacing: { after: 120 },
                }),
              ]
            : this.block(child, depth),
        );
      case "code":
        return node.value.split("\n").map(
          (line) =>
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: "Consolas", size: 19 })],
              shading: { type: ShadingType.CLEAR, fill: "F1F2F8", color: "auto" },
              spacing: { after: 0 },
            }),
        );
      case "thematicBreak":
        return [
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "C6CAE0", space: 1 } },
            spacing: { after: 200 },
          }),
        ];
      case "table":
        return [this.table(node), new Paragraph({ children: [], spacing: { after: 120 } })];
      case "html":
        return node.value.trim()
          ? [new Paragraph({ children: [new TextRun(node.value.replace(/<[^>]+>/g, ""))] })]
          : [];
      default:
        return [];
    }
  }

  private table(node: MdTable) {
    const align = (i: number) =>
      node.align?.[i] === "center"
        ? AlignmentType.CENTER
        : node.align?.[i] === "right"
          ? AlignmentType.RIGHT
          : AlignmentType.LEFT;
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: node.children.map(
        (row, r) =>
          new TableRow({
            tableHeader: r === 0,
            children: row.children.map(
              (cell, c) =>
                new TableCell({
                  shading: r === 0 ? { type: ShadingType.CLEAR, fill: "E8E9F7", color: "auto" } : undefined,
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                  children: [
                    new Paragraph({ alignment: align(c), children: inline(cell.children, { bold: r === 0 }) }),
                  ],
                }),
            ),
          }),
      ),
    });
  }
}

export async function markdownToDocx(markdown: string, title: string): Promise<Blob> {
  const tree = parseMarkdown(markdown);
  const children = new Builder().blocks(tree.children);
  const doc = new Document({
    title,
    creator: "Akai · workingspace.id",
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: "akai-numbered",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph("")] }],
  });
  return Packer.toBlob(doc);
}
