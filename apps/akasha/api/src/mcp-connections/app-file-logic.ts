/**
 * Logika murni "simpan berkas hasil aplikasi MCP ke Akasha" (diuji di `app-file-logic.spec.ts`).
 *
 * Alat aplikasi (mis. `export-design` Canva) mengembalikan **tautan unduh**, bukan berkas. Agen meminta Akasha mengunduh tautan
 * itu dan menyimpannya sebagai berkas + Resource Global milik pemilik. Agar alat ini tidak menjadi pengunduh bebas (SSRF,
 * menyimpan sembarang berkas), hanya host milik aplikasi itu yang diterima, https saja, tanpa kredensial, dengan batas ukuran.
 */

/** Batas satu berkas hasil aplikasi. */
export const MAX_APP_FILE_BYTES = 50 * 1024 * 1024;

/** Domain tingkat dua yang dipakai sebagai akhiran negara (mis. go.id, co.uk) → domain dasar diambil tiga label. */
const SECOND_LEVEL = new Set([
  "co",
  "go",
  "ac",
  "or",
  "net",
  "com",
  "gov",
  "sch",
  "web",
  "my",
  "biz",
  "org",
  "edu",
  "mil",
]);

/** Domain dasar sebuah host: `export-download.canva.com` → `canva.com`, `a.kemenkeu.go.id` → `kemenkeu.go.id`. */
export function baseDomain(host: string) {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Host yang boleh diunduh untuk satu koneksi: daftar katalog bila ada, selain itu domain dasar alamat server MCP. */
export function fileHostsFor(connectionUrl: string, presetHosts?: string[]) {
  const own = baseDomain(new URL(connectionUrl).hostname);
  return [...new Set([...(presetHosts ?? []), own].map((h) => h.toLowerCase()))];
}

/** Alamat berkas boleh diunduh? https, tanpa nama/sandi, host = salah satu domain atau subdomainnya. */
export function appFileUrlError(raw: string, hosts: string[]): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Alamat berkas tidak valid.";
  }
  if (url.protocol !== "https:") return "Alamat berkas harus https.";
  if (url.username || url.password) return "Alamat berkas tidak boleh memuat nama/sandi.";
  const host = url.hostname.toLowerCase();
  if (!hosts.some((h) => host === h || host.endsWith(`.${h}`)))
    return `Berkas hanya boleh diambil dari domain aplikasi ini (${hosts.join(", ")}), bukan ${host}.`;
  return null;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv",
  "text/plain": ".txt",
};

const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]));

/** Jenis berkas: dari header (tanpa parameter) bila jelas, selain itu dari ekstensi nama. */
export function fileMime(contentType: string | undefined, name: string) {
  const mime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (mime && mime !== "application/octet-stream" && mime !== "binary/octet-stream") return mime;
  const ext = /\.[a-z0-9]{2,5}$/i.exec(name)?.[0].toLowerCase();
  return (ext && MIME_BY_EXT[ext]) || "application/octet-stream";
}

/**
 * Nama berkas aman: dari isian agen bila ada, selain itu dari path alamat; karakter terlarang dibuang, maks. 120
 * karakter, ekstensi ditambahkan sesuai jenis bila belum ada.
 */
export function appFileName(url: string, mime: string, wanted?: string) {
  const fromPath = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  const base = (wanted?.trim() || fromPath || "hasil")
    .split("")
    .map((ch) => (ch.charCodeAt(0) < 32 ? " " : ch))
    .join("")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const ext = EXT_BY_MIME[mime];
  if (!ext || base.toLowerCase().endsWith(ext) || (ext === ".jpg" && /\.jpeg$/i.test(base))) return base || "hasil";
  return `${base || "hasil"}${ext}`;
}
