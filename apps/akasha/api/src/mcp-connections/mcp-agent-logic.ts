import { findPreset, type McpAuthType, MCP_AUTH_TYPES, normalizeMcpUrl } from "./mcp-connection-logic";

/**
 * Logika murni Aplikasi MCP yang dipakai agen (Hermes) lewat MCP — diuji di `mcp-agent-logic.spec.ts`.
 *
 * Aplikasi MCP adalah fitur terbuka untuk agen (keputusan user 2026-11-13, pola sama dengan e-Kinerja/SRIKANDI/SIMAN):
 * agen boleh menambah workflow di dalamnya (penempatan `mcp`), memakai alat aplikasi yang diizinkan, dan **meminta**
 * koneksi aplikasi baru atau perubahan izin agen. Permintaan baru berlaku setelah pemilik menyetujuinya di Approval →
 * Usulan Agen. Agen tidak pernah memegang kredensial: masuk (OAuth) / token tetap diisi pemilik di halaman aplikasinya.
 */

/** Jenis aksi agen (tabel `agent_actions`): sambungkan aplikasi baru, ubah izin agen atas koneksi. */
export const MCP_CONNECT_KIND = "mcp_connect";
export const MCP_ACCESS_KIND = "mcp_access";
export const MCP_ACTION_RECORD = "mcp_connection";

export interface ConnectProposalInput {
  name?: string;
  url?: string;
  preset?: string;
  authType?: string;
}

export interface ConnectProposal {
  name: string;
  url: string;
  preset: string | null;
  authType: McpAuthType;
  icon: string;
}

/**
 * Usulan koneksi dari agen → isian koneksi yang akan dibuat bila disetujui, atau alasan ditolak (bahasa Indonesia agar
 * agen bisa memperbaikinya). Katalog (`preset`) mengisi alamat & cara masuk resmi; alamat lain wajib https publik.
 */
export function connectProposal(
  input: ConnectProposalInput,
  production: boolean,
): { ok: true; proposal: ConnectProposal } | { ok: false; error: string } {
  const preset = input.preset ? findPreset(input.preset) : null;
  if (input.preset && !preset) return { ok: false, error: `Aplikasi katalog '${input.preset}' tidak dikenal.` };
  const name = (input.name ?? preset?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Nama aplikasi wajib diisi." };
  const rawUrl = input.url?.trim() || preset?.url || "";
  if (!rawUrl) return { ok: false, error: "Alamat server MCP wajib diisi (atau pilih aplikasi katalog)." };
  const url = normalizeMcpUrl(rawUrl, production);
  if (!url.ok) return { ok: false, error: url.error };
  const authType = (input.authType ?? preset?.authType ?? "none") as McpAuthType;
  if (!(MCP_AUTH_TYPES as readonly string[]).includes(authType))
    return { ok: false, error: "Cara masuk harus none, token, atau oauth." };
  return {
    ok: true,
    proposal: { name, url: url.url, preset: preset?.key ?? null, authType, icon: preset?.icon ?? "plug" },
  };
}

export const connectRequestTitle = (p: Pick<ConnectProposal, "name">) => `Sambungkan aplikasi MCP: ${p.name}`;

export interface AccessChange {
  agentEnabled?: boolean;
  allowWrite?: boolean;
  /** Alat bertanda Hapus yang diminta diizinkan (hanya menambah) */
  allowTools?: string[];
}

/**
 * Perubahan izin agen yang diminta: hanya key yang berbeda dari keadaan sekarang. "Izinkan aksi tulis" tanpa izin agen
 * tidak berarti apa-apa, jadi ikut menyalakan izin agen. Kosong = tidak ada yang perlu disetujui.
 */
export function accessChange(
  current: { agentEnabled: boolean; allowWrite: boolean; agentTools?: string[]; destructiveTools?: string[] },
  wanted: AccessChange,
): AccessChange | { error: string } {
  const next = { ...wanted };
  if (next.allowTools?.length) {
    const known = new Set(current.destructiveTools ?? []);
    const unknown = next.allowTools.filter((t) => !known.has(t));
    if (unknown.length)
      return {
        error: `Bukan alat bertanda Hapus di koneksi ini: ${unknown.join(", ")}. Alat lain cukup lewat allowWrite.`,
      };
    // Alat bertanda Hapus hanya berjalan bila aksi tulis juga menyala
    if (next.allowWrite === undefined && !current.allowWrite) next.allowWrite = true;
  }
  if (next.allowWrite === true && next.agentEnabled === undefined && !current.agentEnabled) next.agentEnabled = true;
  if (next.allowWrite === true && next.agentEnabled === undefined && !current.agentEnabled) next.agentEnabled = true;
  if (next.agentEnabled === false && next.allowWrite === true)
    return { error: "Aksi tulis tidak bisa diizinkan sambil mematikan izin agen." };
  const change: AccessChange = {};
  if (next.agentEnabled !== undefined && next.agentEnabled !== current.agentEnabled)
    change.agentEnabled = next.agentEnabled;
  if (next.allowWrite !== undefined && next.allowWrite !== current.allowWrite) change.allowWrite = next.allowWrite;
  const added = [...new Set(next.allowTools ?? [])].filter((t) => !(current.agentTools ?? []).includes(t));
  if (added.length) change.allowTools = added;
  if (!Object.keys(change).length) return { error: "Izin agen untuk koneksi ini sudah seperti yang diminta." };
  return change;
}

/** Ringkasan perubahan izin untuk judul & kartu persetujuan. */
export function accessChangeLabel(change: AccessChange) {
  const parts: string[] = [];
  if (change.agentEnabled !== undefined) parts.push(change.agentEnabled ? "izinkan agen" : "cabut izin agen");
  if (change.allowWrite !== undefined) parts.push(change.allowWrite ? "izinkan aksi tulis" : "cabut aksi tulis");
  if (change.allowTools?.length) parts.push(`izinkan alat ${change.allowTools.join(", ")}`);
  return parts.join(" + ");
}

export const accessRequestTitle = (name: string, change: AccessChange) =>
  `Izin agen ${name}: ${accessChangeLabel(change)}`;
