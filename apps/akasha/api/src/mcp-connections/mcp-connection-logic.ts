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
  /** Kelompok penyedia: koneksi sekelompok memakai OAuth client yang sama (mis. semua layanan Google) */
  group?: string;
  /**
   * Server OAuth-nya tidak mendukung pendaftaran klien dinamis → pemilik wajib mengisi Client ID & Secret dari OAuth
   * client yang ia daftarkan sendiri (Google Cloud Console, GitHub OAuth App).
   */
  needsClient?: boolean;
  /** Scope bawaan (dipisah spasi); kosong = semua scope yang diumumkan server */
  scope?: string;
  /**
   * Domain tempat aplikasi menaruh berkas hasil (tautan ekspor/unduh) yang boleh disimpan agen ke Akasha
   * (`save_app_file`). Kosong = domain dasar alamat server MCP.
   */
  fileHosts?: string[];
}

const G = "https://www.googleapis.com/auth/";
const google = (...scopes: string[]) => scopes.map((x) => (x.startsWith("https://") ? x : G + x)).join(" ");
const GOOGLE_HINT =
  "Butuh OAuth client Google (Google Cloud Console → APIs & Services → Credentials → OAuth client ID jenis Web application, Authorized redirect URI = alamat callback di formulir) + aktifkan API MCP layanan ini. Server MCP Google masih Developer Preview: akun Anda harus terdaftar di Google Workspace Developer Preview Program.";

/** Server MCP resmi Google Workspace (Developer Preview, docs.cloud.google.com/mcp/supported-products). */
const GOOGLE_PRESETS: McpPreset[] = [
  {
    key: "gmail",
    name: "Gmail",
    description: "Cari & baca email, buat draf.",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    scope: google("gmail.readonly", "gmail.compose"),
    icon: "mail",
  },
  {
    key: "google-calendar",
    name: "Google Calendar",
    description: "Lihat kalender, cari waktu kosong, buat & ubah acara.",
    url: "https://calendarmcp.googleapis.com/mcp/v1",
    scope: google("calendar.calendarlist.readonly", "calendar.events", "calendar.events.freebusy"),
    icon: "calendar-days",
  },
  {
    key: "google-drive",
    name: "Google Drive",
    description: "Cari & baca berkas Drive, simpan berkas baru.",
    url: "https://drivemcp.googleapis.com/mcp/v1",
    scope: google("drive.readonly", "drive.file"),
    icon: "cloud",
  },
  {
    key: "google-docs",
    name: "Google Docs",
    description: "Baca, buat, dan sunting dokumen.",
    url: "https://docsmcp.googleapis.com/mcp/v1",
    scope: google("documents", "drive.readonly"),
    icon: "file-text",
  },
  {
    key: "google-sheets",
    name: "Google Sheets",
    description: "Baca, buat, dan isi spreadsheet.",
    url: "https://sheetsmcp.googleapis.com/mcp/v1",
    scope: google("spreadsheets", "drive.readonly"),
    icon: "chart-bar",
  },
  {
    key: "google-slides",
    name: "Google Slides",
    description: "Baca, buat, dan sunting presentasi.",
    url: "https://slidesmcp.googleapis.com/mcp/v1",
    scope: google("presentations", "drive.readonly"),
    icon: "presentation",
  },
  {
    key: "google-chat",
    name: "Google Chat",
    description: "Baca ruang & pesan, kirim pesan.",
    url: "https://chatmcp.googleapis.com/mcp/v1",
    scope: google(
      "chat.spaces.readonly",
      "chat.memberships.readonly",
      "chat.messages.readonly",
      "chat.messages.create",
    ),
    icon: "messages-square",
  },
  {
    key: "google-contacts",
    name: "Google Kontak",
    description: "Cari kontak & direktori organisasi.",
    url: "https://people.googleapis.com/mcp/v1",
    scope: google("contacts.readonly", "directory.readonly", "userinfo.profile"),
    icon: "users",
  },
  {
    key: "google-search",
    name: "Google Workspace Search",
    description: "Satu pencarian di Gmail, Drive, Calendar, dan Chat.",
    url: "https://workspacemcp.googleapis.com/mcp/v1",
    scope: google(
      "gmail.readonly",
      "drive.readonly",
      "calendar.readonly",
      "chat.messages.readonly",
      "chat.spaces.readonly",
    ),
    icon: "globe",
  },
].map((p) => ({
  ...p,
  authType: "oauth" as const,
  group: "google",
  needsClient: true,
  hint: GOOGLE_HINT,
  fileHosts: ["googleusercontent.com", "googleapis.com"],
}));

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
    // Ekspor = export-download.canva.com, gambar mini & hasil AI = *.canva.ai
    fileHosts: ["canva.com", "canva.ai"],
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
    fileHosts: ["github.com", "githubusercontent.com"],
    hint: "Buat Personal Access Token di GitHub → Settings → Developer settings (classic: centang repo, read:org, read:user; fine-grained: pilih repositori + izin Contents, Issues, Pull requests, Metadata), lalu tempel di sini. Atau pilih cara masuk OAuth dan isi Client ID & Secret dari GitHub OAuth App (Authorization callback URL = alamat callback di formulir). Token organisasi bisa ditolak bila organisasi membatasi akses token.",
  },
  ...GOOGLE_PRESETS,
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

/** Nama alat bertanda Hapus yang diizinkan pemilik untuk agen (kolom json `agent_tools`). */
export function agentToolList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200))].slice(
    0,
    100,
  );
}

/**
 * Boleh dipakai agen? Koneksi harus diizinkan untuk agen. Alat bertanda hanya-baca selalu boleh; alat lain (bisa
 * mengubah data, termasuk yang tanpa tanda) hanya bila pemilik menyalakan "izinkan aksi tulis". Alat bertanda merusak
 * (hapus) tidak dijalankan agen kecuali pemilik mengizinkan **alat itu satu per satu** (`agentTools`) dan aksi tulis
 * menyala — penanda penyedia kadang terlalu luas (Canva menandai "simpan hasil sunting" sebagai merusak).
 */
export function agentToolDecision(
  connection: { agentEnabled: boolean; allowWrite: boolean; agentTools?: unknown },
  tool: McpToolSummary | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!connection.agentEnabled) return { ok: false, reason: "Koneksi ini belum diizinkan untuk agen oleh pemilik." };
  if (!tool) return { ok: false, reason: "Alat tidak ada di koneksi ini (muat ulang daftar alat)." };
  if (tool.destructive) {
    if (!agentToolList(connection.agentTools).includes(tool.name))
      return {
        ok: false,
        reason: "Alat ini ditandai bisa menghapus/menimpa data; pemilik belum mengizinkan alat ini untuk agen.",
      };
    if (!connection.allowWrite)
      return { ok: false, reason: "Alat ini bisa mengubah data; pemilik belum mengizinkan aksi tulis untuk agen." };
    return { ok: true };
  }
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

/** Scope OAuth dari isian bebas: dipisah spasi/koma/baris, tanpa duplikat, maks. 40. Kosong = null. */
export function normalizeScope(raw: string | null | undefined) {
  const parts = [
    ...new Set(
      (raw ?? "")
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].slice(0, 40);
  return parts.length ? parts.join(" ").slice(0, 2000) : null;
}

/**
 * Parameter tambahan halaman izin. Google hanya memberi refresh token bila diminta `access_type=offline` + persetujuan
 * ulang; tanpa itu koneksi kedaluwarsa setiap ± 1 jam.
 */
export function authorizationExtras(authorizationUrl: URL): Record<string, string> {
  if (authorizationUrl.hostname === "accounts.google.com") return { access_type: "offline", prompt: "consent" };
  return {};
}

/** Pesan galat OAuth yang bisa ditindaklanjuti pemilik. */
export function oauthErrorMessage(message: string) {
  if (/dynamic client registration/i.test(message))
    return "Aplikasi ini tidak mendukung pendaftaran otomatis. Isi Client ID & Client Secret dari OAuth client yang Anda daftarkan di aplikasi itu (atau gunakan token bila didukung).";
  if (/invalid_client|unauthorized_client/i.test(message))
    return `Client ID / Secret ditolak aplikasi. Periksa nilainya dan alamat callback yang terdaftar. (${message})`;
  return message;
}
