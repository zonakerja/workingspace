/**
 * Masa akses Akasha dari SSO workingspace.id (logika murni, diuji di access-state.spec.ts). Aturan masa akses sendiri ada di
 * SSO (`apps/auth/api/src/access/access-logic.ts`); Akasha hanya menyimpan tanggal yang dikirim SSO:
 * akses habis (`access_expires_at`) → baca saja sampai `access_delete_at` → data akun dihapus.
 */

export type AccessState = "active" | "read_only" | "ended";

export function accessState(expiresAt: Date | null, deleteAt: Date | null, now = new Date()): AccessState {
  if (!expiresAt || now < expiresAt) return "active";
  return deleteAt && now >= deleteAt ? "ended" : "read_only";
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Permintaan tulis yang tetap boleh saat baca saja: sesi (keluar/refresh), buka/kunci PIN, tautan unduh berkas, membuka
 * editor ONLYOFFICE (dipaksa mode lihat), dan MCP (alat tulis ditolak di dalam MCP sendiri). Path tanpa prefix `/api/v1`.
 */
const ALLOWED = [
  /^\/auth\/(logout|refresh|sso\/)/,
  /^\/security\/pin\/(unlock|lock)$/,
  /^\/uploads\/[^/]+\/link$/,
  /^\/office\/config$/,
  /^\/mcp$/,
  /^\/public\//,
  /^\/whatsapp\/webhook$/,
];

/** Boleh dijalankan oleh akun berstatus baca saja? */
export function allowedWhileReadOnly(method: string, path: string): boolean {
  if (!MUTATING.has(method.toUpperCase())) return true;
  const clean = path.split("?")[0].replace(/^\/api\/v1/, "");
  return ALLOWED.some((re) => re.test(clean));
}

export const READ_ONLY_MESSAGE =
  "Masa akses Anda ke Akasha sudah berakhir: data hanya bisa dibaca. Ajukan perpanjangan akses di akun Workingspace.";

/** Filter Prisma user yang masa aksesnya masih aktif — pekerjaan latar belakang (sinkron, otomasi) melewati akun beku. */
export const activeAccessWhere = (now = new Date()) => ({
  OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }],
});
