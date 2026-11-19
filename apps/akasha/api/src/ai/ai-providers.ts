/** Jenis lampiran yang dikirim ke model AI. */
export type AttachmentKind = "image" | "pdf" | "audio" | "text";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_TYPES = new Set(["application/json", "application/xml", "application/yaml"]);

/** Jenis lampiran dari MIME type (tanpa parameter seperti `;codecs=opus`), atau null bila tidak didukung. */
export function attachmentKind(mimeType: string): AttachmentKind | null {
  const type = mimeType.split(";")[0].trim().toLowerCase();
  if (IMAGE_TYPES.has(type)) return "image";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("text/") || TEXT_TYPES.has(type)) return "text";
  return null;
}
