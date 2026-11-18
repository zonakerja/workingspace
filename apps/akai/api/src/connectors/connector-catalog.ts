/**
 * Katalog aplikasi yang punya server MCP remote resmi (6b.10, docs/AKAI.md §8). Setiap alamat diperiksa 2026-11-17 (tanpa login:
 * 401 + metadata OAuth, atau 200 untuk server publik) dan dicatat apakah server otorisasinya mendukung pendaftaran klien dinamis
 * (DCR). Tanpa DCR → pemilik mengisi Client ID & Secret dari OAuth client yang ia daftarkan sendiri (`needsClient`). Alamat bisa
 * berubah oleh penyedianya, jadi tetap bisa diubah pemilik di halaman Konektor.
 */

export type ConnectorAuth = "none" | "token" | "oauth";

export const CATALOG_CATEGORIES = {
  kerja: "Kerja & dokumen",
  google: "Google Workspace",
  desain: "Desain & presentasi",
  komunikasi: "Komunikasi & pertemuan",
  file: "Penyimpanan berkas",
  dev: "Pengembang",
  bisnis: "Bisnis & situs",
  riset: "Riset & referensi",
} as const;
export type CatalogCategory = keyof typeof CATALOG_CATEGORIES;

export interface CatalogEntry {
  key: string;
  name: string;
  description: string;
  url: string;
  auth: ConnectorAuth;
  category: CatalogCategory;
  /** Petunjuk cara masuk / memperoleh akses */
  hint: string;
  /** Kelompok penyedia: layanan sekelompok memakai OAuth client yang sama (semua layanan Google) */
  group?: string;
  /** Server otorisasi tanpa DCR → Client ID & Secret milik pemilik wajib diisi */
  needsClient?: boolean;
  /** Scope bawaan (dipisah spasi); kosong = semua scope yang diumumkan server */
  scope?: string;
}

const oauth = (hint = "Masuk dengan akun Anda di jendela izin aplikasi itu.") => ({ auth: "oauth" as const, hint });

const G = "https://www.googleapis.com/auth/";
const google = (...scopes: string[]) => scopes.map((x) => (x.startsWith("https://") ? x : G + x)).join(" ");
const GOOGLE_HINT =
  "Butuh OAuth client Google milik Anda (Google Cloud Console → APIs & Services → Credentials → OAuth client ID jenis Web application, Authorized redirect URI = alamat callback di formulir ini) dan API MCP layanannya diaktifkan. Server MCP Google masih Developer Preview: akun harus terdaftar di Google Workspace Developer Preview Program. Satu client dipakai untuk semua layanan Google.";

const GOOGLE: CatalogEntry[] = [
  ["gmail", "Gmail", "Cari & baca email, buat draf.", "gmailmcp", google("gmail.readonly", "gmail.compose")],
  [
    "google-calendar",
    "Google Calendar",
    "Lihat kalender, cari waktu kosong, buat & ubah acara.",
    "calendarmcp",
    google("calendar.calendarlist.readonly", "calendar.events", "calendar.events.freebusy"),
  ],
  [
    "google-drive",
    "Google Drive",
    "Cari & baca berkas Drive, simpan berkas baru.",
    "drivemcp",
    google("drive.readonly", "drive.file"),
  ],
  ["google-docs", "Google Docs", "Baca, buat, dan sunting dokumen.", "docsmcp", google("documents", "drive.readonly")],
  [
    "google-sheets",
    "Google Sheets",
    "Baca, buat, dan isi spreadsheet.",
    "sheetsmcp",
    google("spreadsheets", "drive.readonly"),
  ],
  [
    "google-slides",
    "Google Slides",
    "Baca, buat, dan sunting presentasi.",
    "slidesmcp",
    google("presentations", "drive.readonly"),
  ],
  [
    "google-chat",
    "Google Chat",
    "Baca ruang & pesan, kirim pesan.",
    "chatmcp",
    google("chat.spaces.readonly", "chat.memberships.readonly", "chat.messages.readonly", "chat.messages.create"),
  ],
  [
    "google-contacts",
    "Google Kontak",
    "Cari kontak & direktori organisasi.",
    "people",
    google("contacts.readonly", "directory.readonly", "userinfo.profile"),
  ],
].map(([key, name, description, host, scope]) => ({
  key,
  name,
  description,
  url: `https://${host}.googleapis.com/mcp/v1`,
  scope,
  auth: "oauth" as const,
  category: "google" as const,
  group: "google",
  needsClient: true,
  hint: GOOGLE_HINT,
}));

export const CATALOG: CatalogEntry[] = [
  // Kerja & dokumen
  {
    key: "notion",
    name: "Notion",
    description: "Cari, baca, dan tulis halaman & database.",
    url: "https://mcp.notion.com/mcp",
    category: "kerja",
    ...oauth("Masuk dengan akun Notion dan pilih halaman yang boleh diakses."),
  },
  {
    key: "atlassian",
    name: "Jira & Confluence",
    description: "Isu Jira, halaman Confluence, dan Compass (Atlassian).",
    url: "https://mcp.atlassian.com/v1/mcp",
    category: "kerja",
    ...oauth("Masuk dengan akun Atlassian dan pilih situs yang boleh diakses."),
  },
  {
    key: "linear",
    name: "Linear",
    description: "Isu, project, dan siklus kerja tim.",
    url: "https://mcp.linear.app/mcp",
    category: "kerja",
    ...oauth(),
  },
  {
    key: "asana",
    name: "Asana",
    description: "Tugas, project, dan portofolio kerja.",
    url: "https://mcp.asana.com/sse",
    category: "kerja",
    ...oauth(),
  },
  {
    key: "monday",
    name: "monday.com",
    description: "Board, item, dan pembaruan kerja tim.",
    url: "https://mcp.monday.com/mcp",
    category: "kerja",
    ...oauth(),
  },
  {
    key: "clickup",
    name: "ClickUp",
    description: "Tugas, daftar, dokumen, dan waktu kerja.",
    url: "https://mcp.clickup.com/mcp",
    category: "kerja",
    ...oauth(),
  },
  {
    key: "airtable",
    name: "Airtable",
    description: "Baca & tulis record dan skema base.",
    url: "https://mcp.airtable.com/mcp",
    category: "kerja",
    ...oauth(),
  },
  {
    key: "todoist",
    name: "Todoist",
    description: "Tugas, project, dan tenggat pribadi.",
    url: "https://ai.todoist.net/mcp",
    category: "kerja",
    ...oauth(),
  },
  {
    key: "zapier",
    name: "Zapier",
    description: "Ribuan aplikasi lewat aksi Zapier yang Anda pilih.",
    url: "https://mcp.zapier.com/api/mcp/mcp",
    category: "kerja",
    ...oauth("Masuk dengan akun Zapier; aksi yang tersedia diatur di mcp.zapier.com."),
  },
  {
    key: "jotform",
    name: "Jotform",
    description: "Formulir dan jawaban yang masuk.",
    url: "https://mcp.jotform.com/",
    category: "kerja",
    ...oauth(),
  },
  // Desain & presentasi
  {
    key: "canva",
    name: "Canva",
    description: "Buat & cari desain, ekspor, isi templat brand.",
    url: "https://mcp.canva.com/mcp",
    category: "desain",
    ...oauth("Masuk dengan akun Canva Anda."),
  },
  {
    key: "figma",
    name: "Figma",
    description: "Baca berkas desain, komponen, dan variabel.",
    url: "https://mcp.figma.com/mcp",
    category: "desain",
    ...oauth(
      "Masuk dengan akun Figma. Figma bisa membatasi aplikasi yang boleh tersambung; bila ditolak, pakai Dev Mode MCP lokal Figma.",
    ),
  },
  {
    key: "gamma",
    name: "Gamma",
    description: "Buat presentasi, dokumen, dan situs dengan Gamma.",
    url: "https://mcp.gamma.app/mcp",
    category: "desain",
    ...oauth(),
  },
  {
    key: "miro",
    name: "Miro",
    description: "Baca & tulis board whiteboard Miro.",
    url: "https://mcp.miro.com/",
    category: "desain",
    ...oauth(),
  },
  // Komunikasi & pertemuan
  {
    key: "slack",
    name: "Slack",
    description: "Cari & baca kanal, kirim pesan, canvas.",
    url: "https://mcp.slack.com/mcp",
    category: "komunikasi",
    auth: "oauth",
    needsClient: true,
    hint: "Slack tidak mendukung pendaftaran otomatis: buat Slack app (api.slack.com/apps) dengan Redirect URL = alamat callback di formulir ini, lalu isi Client ID & Secret-nya.",
  },
  {
    key: "intercom",
    name: "Intercom",
    description: "Percakapan & data pelanggan.",
    url: "https://mcp.intercom.com/mcp",
    category: "komunikasi",
    ...oauth(),
  },
  {
    key: "calendly",
    name: "Calendly",
    description: "Jadwal, tautan pemesanan, dan catatan rapat.",
    url: "https://mcp.calendly.com",
    category: "komunikasi",
    ...oauth(),
  },
  {
    key: "fireflies",
    name: "Fireflies",
    description: "Transkrip & ringkasan rapat.",
    url: "https://api.fireflies.ai/mcp",
    category: "komunikasi",
    ...oauth(),
  },
  // Penyimpanan
  {
    key: "dropbox",
    name: "Dropbox",
    description: "Cari, baca, dan simpan berkas.",
    url: "https://mcp.dropbox.com/mcp",
    category: "file",
    ...oauth(),
  },
  {
    key: "box",
    name: "Box",
    description: "Cari & baca berkas serta folder Box.",
    url: "https://mcp.box.com",
    category: "file",
    auth: "oauth",
    needsClient: true,
    hint: "Box tidak mendukung pendaftaran otomatis: buat aplikasi OAuth 2.0 di Box Developer Console (Redirect URI = alamat callback di formulir ini), lalu isi Client ID & Secret-nya.",
  },
  // Pengembang
  {
    key: "github",
    name: "GitHub",
    description: "Repositori, isu, pull request, dan berkas kode.",
    url: "https://api.githubcopilot.com/mcp/",
    category: "dev",
    auth: "token",
    hint: "Buat Personal Access Token (GitHub → Settings → Developer settings; fine-grained: pilih repositori + izin Contents, Issues, Pull requests, Metadata) lalu tempel. Atau pilih OAuth dan isi Client ID & Secret dari GitHub OAuth App (callback URL = alamat callback di formulir ini). Organisasi bisa menolak token pribadi.",
  },
  {
    key: "vercel",
    name: "Vercel",
    description: "Project, deployment, dan log Vercel.",
    url: "https://mcp.vercel.com",
    category: "dev",
    ...oauth(),
  },
  {
    key: "supabase",
    name: "Supabase",
    description: "Project, database, dan fungsi Supabase.",
    url: "https://mcp.supabase.com/mcp",
    category: "dev",
    ...oauth(),
  },
  {
    key: "sentry",
    name: "Sentry",
    description: "Galat, isu, dan performa aplikasi.",
    url: "https://mcp.sentry.dev/mcp",
    category: "dev",
    ...oauth(),
  },
  {
    key: "netlify",
    name: "Netlify",
    description: "Situs, deploy, dan formulir Netlify.",
    url: "https://netlify-mcp.netlify.app/mcp",
    category: "dev",
    ...oauth(),
  },
  {
    key: "huggingface",
    name: "Hugging Face",
    description: "Cari model, dataset, makalah, dan Spaces.",
    url: "https://huggingface.co/mcp",
    category: "dev",
    auth: "none",
    hint: "Tanpa login untuk alat dasar.",
  },
  // Bisnis & situs
  {
    key: "hubspot",
    name: "HubSpot",
    description: "Kontak, perusahaan, dan deal CRM.",
    url: "https://mcp.hubspot.com/anthropic",
    category: "bisnis",
    auth: "oauth",
    needsClient: true,
    hint: "HubSpot tidak mendukung pendaftaran otomatis: buat aplikasi MCP auth di HubSpot (Development → MCP Auth Apps, redirect = alamat callback di formulir ini), lalu isi Client ID & Secret-nya.",
  },
  {
    key: "stripe",
    name: "Stripe",
    description: "Pelanggan, tagihan, dan pembayaran Stripe.",
    url: "https://mcp.stripe.com",
    category: "bisnis",
    ...oauth(
      "Masuk dengan akun Stripe. Alat yang mengubah data (tagihan, pengembalian dana) hanya dipakai bila Anda mengizinkan.",
    ),
  },
  {
    key: "paypal",
    name: "PayPal",
    description: "Invoice, transaksi, dan katalog PayPal.",
    url: "https://mcp.paypal.com/mcp",
    category: "bisnis",
    ...oauth("Masuk dengan akun PayPal. Alat yang mengubah data hanya dipakai bila Anda mengizinkan."),
  },
  {
    key: "square",
    name: "Square",
    description: "Penjualan, katalog, dan pelanggan Square.",
    url: "https://mcp.squareup.com/sse",
    category: "bisnis",
    ...oauth(),
  },
  {
    key: "webflow",
    name: "Webflow",
    description: "Situs, halaman, dan koleksi CMS Webflow.",
    url: "https://mcp.webflow.com/mcp",
    category: "bisnis",
    ...oauth(),
  },
  {
    key: "wix",
    name: "Wix",
    description: "Situs, toko, dan konten Wix.",
    url: "https://mcp.wix.com/mcp",
    category: "bisnis",
    ...oauth(),
  },
  // Riset & referensi (tanpa login)
  {
    key: "exa",
    name: "Exa",
    description: "Pencarian web & isi halaman untuk riset.",
    url: "https://mcp.exa.ai/mcp",
    category: "riset",
    auth: "none",
    hint: "Tanpa login (kuota gratis terbatas).",
  },
  {
    key: "context7",
    name: "Context7",
    description: "Dokumentasi terbaru pustaka & kerangka pemrograman.",
    url: "https://mcp.context7.com/mcp",
    category: "riset",
    auth: "none",
    hint: "Tanpa login.",
  },
  {
    key: "ms-learn",
    name: "Microsoft Learn",
    description: "Dokumentasi resmi Microsoft (Azure, Office, .NET, …).",
    url: "https://learn.microsoft.com/api/mcp",
    category: "riset",
    auth: "none",
    hint: "Tanpa login.",
  },
  {
    key: "cloudflare-docs",
    name: "Dokumentasi Cloudflare",
    description: "Dokumentasi resmi Cloudflare.",
    url: "https://docs.mcp.cloudflare.com/mcp",
    category: "riset",
    auth: "none",
    hint: "Tanpa login.",
  },
  ...GOOGLE,
];

export const findCatalogEntry = (key?: string | null) => CATALOG.find((e) => e.key === key) ?? null;

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

/** Google hanya memberi refresh token bila diminta `access_type=offline` + persetujuan ulang (tanpa itu putus ± 1 jam). */
export function authorizationExtras(authorizationUrl: URL): Record<string, string> {
  if (authorizationUrl.hostname === "accounts.google.com") return { access_type: "offline", prompt: "consent" };
  return {};
}

/** Pesan galat OAuth yang bisa ditindaklanjuti pemilik. */
export function oauthErrorMessage(message: string) {
  if (/dynamic client registration/i.test(message))
    return "Aplikasi ini tidak mendukung pendaftaran otomatis. Isi Client ID & Client Secret dari OAuth client yang Anda daftarkan di aplikasi itu (atau pakai token bila didukung).";
  if (/invalid_client|unauthorized_client/i.test(message))
    return `Client ID / Secret ditolak aplikasi. Periksa nilainya dan alamat callback yang terdaftar. (${message})`;
  return message;
}
