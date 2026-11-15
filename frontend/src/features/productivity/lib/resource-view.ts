import type { Resource } from "@/types/entities";

/** Jenis tampilan resource: menentukan ikon & warna kartu di tab Resources. */
export type ResourceKind = "pdf" | "doc" | "sheet" | "slide" | "image" | "media" | "archive" | "file" | "link" | "note";

/** Filter jenis di tab Resources (dikelompokkan menurut tipe data, bukan format berkas). */
export type ResourceTypeFilter = "all" | "file" | "link" | "note";

const EXTENSION_KIND: Record<string, ResourceKind> = {
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  odt: "doc",
  rtf: "doc",
  txt: "doc",
  md: "doc",
  xls: "sheet",
  xlsx: "sheet",
  ods: "sheet",
  csv: "sheet",
  ppt: "slide",
  pptx: "slide",
  odp: "slide",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  mp3: "media",
  wav: "media",
  m4a: "media",
  webm: "media",
  mp4: "media",
  mov: "media",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
};

/** Ekstensi berkas (huruf kecil) dari nama, atau "" bila tidak ada. */
export const fileExtension = (name?: string) => {
  const match = /\.([a-z0-9]{1,5})$/i.exec(name?.trim() ?? "");
  return match ? match[1].toLowerCase() : "";
};

/** Jenis tampilan dari tipe resource, ekstensi nama, lalu MIME. */
export function resourceKind(
  res: Pick<Resource, "type" | "title" | "mimeType" | "url" | "uploadId" | "noteId">,
): ResourceKind {
  if (res.type === "link") return "link";
  if (res.type === "note" || (!res.uploadId && !res.url && /^(free|ai|list)-./.test(res.noteId ?? ""))) return "note";
  if (res.type !== "file") return "file";
  const byExtension = EXTENSION_KIND[fileExtension(res.title)];
  if (byExtension) return byExtension;
  const mime = res.mimeType ?? "";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "media";
  if (/sheet|excel|csv/.test(mime)) return "sheet";
  if (/presentation|powerpoint/.test(mime)) return "slide";
  if (/word|document|text\//.test(mime)) return "doc";
  return "file";
}

/** Tipe data resource untuk filter & hitungan (catatan tanpa tipe "note" tetap dihitung catatan). */
export const resourceTypeGroup = (res: Resource): Exclude<ResourceTypeFilter, "all"> => {
  const kind = resourceKind(res);
  return kind === "link" ? "link" : kind === "note" ? "note" : "file";
};

/** Jumlah resource per tipe data. */
export function countResourceTypes(resources: Resource[]) {
  const counts = { all: resources.length, file: 0, link: 0, note: 0 };
  for (const res of resources) counts[resourceTypeGroup(res)]++;
  return counts;
}

/** Host singkat sebuah tautan ("www.jdih.go.id/x" → "jdih.go.id"), atau "" bila tidak valid. */
export const linkHost = (url?: string) => {
  if (!url) return "";
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
