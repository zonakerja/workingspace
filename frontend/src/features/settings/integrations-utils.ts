/** Logika murni Pengaturan → Integrasi (diuji di `integrations-utils.test.ts`). */

/** Alamat MCP server LifeOS dari origin aplikasi (dev: proxy Vite /api → backend; produksi: domain yang sama). */
export const mcpUrl = (origin: string) => `${origin.replace(/\/$/, "")}/api/v1/mcp`;

/** Contoh konfigurasi klien MCP: Claude Desktop / klien JSON umum dan Hermes Agent (`config.yaml`). */
export function mcpConfigSnippets(url: string, token: string) {
  const json = JSON.stringify(
    { mcpServers: { lifeos: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
  const hermes = [
    "mcp_servers:",
    "  lifeos:",
    `    url: "${url}"`,
    "    headers:",
    `      Authorization: "Bearer ${token}"`,
  ].join("\n");
  return { json, hermes };
}

export const EXPIRY_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: "30", label: "30 hari", days: 30 },
  { value: "90", label: "90 hari", days: 90 },
  { value: "365", label: "1 tahun", days: 365 },
  { value: "none", label: "Tanpa batas", days: null },
];

export const TOOL_LABELS: Record<string, string> = {
  search_knowledge: "Cari basis pengetahuan",
  read_knowledge_note: "Buka catatan pengetahuan",
  add_knowledge_inbox: "Tulis ke Inbox vault",
  search_workspace: "Cari data kerja",
  list_agenda: "Daftar agenda",
  list_open_tasks: "To-do & task terbuka",
  create_todo: "Buat to-do",
  ask_lifeos: "Tanya asisten LifeOS",
  list_requests: "Daftar pengajuan",
  get_request: "Buka pengajuan",
  create_request: "Catat pengajuan",
  analyze_request: "Analisis pengajuan",
  list_whatsapp_followups: "Pertanyaan WA perlu dijawab",
  read_request_files: "Baca berkas pengajuan",
  list_templates: "Daftar templat",
  get_template_fields: "Isian templat",
  update_request: "Simpan hasil kerja agen",
  create_request_document: "Buat dokumen dari templat",
  submit_asset_check: "Verifikasi aset",
  list_agent_menus: "Daftar fitur buatan agen",
  propose_agent_menu: "Usulkan fitur buatan agen",
  describe_record_types: "Jenis data kerja",
  list_records: "Daftar data kerja",
  get_record: "Buka data kerja",
  create_record: "Buat data kerja",
  update_record: "Ubah data kerja",
  request_delete_record: "Minta hapus data kerja",
  list_app_tools: "Alat aplikasi tersambung",
  call_app_tool: "Jalankan alat aplikasi",
  ekinerja_status: "Status robot e-Kinerja",
  ekinerja_sync_skp: "Ambil SKP & RHK e-Kinerja",
  ekinerja_monitor_renaksi: "Pantau Rencana Aksi e-Kinerja",
  ekinerja_check_renaksi: "Periksa Rencana Aksi e-Kinerja",
  ekinerja_request_fill: "Minta isi Rencana Aksi e-Kinerja",
  ekinerja_renaksi_context: "Bahan renaksi e-Kinerja",
  ekinerja_propose_renaksi: "Usulkan renaksi e-Kinerja",
};

/** Ringkasan argumen untuk tabel log: "query: sewa · limit: 3". */
export function describeInput(input: unknown) {
  if (!input || typeof input !== "object") return "";
  return Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ")
    .slice(0, 160);
}

/** Waktu ISO sudah lewat (token kedaluwarsa). */
export const isPast = (iso: string | null, now = Date.now()) => !!iso && new Date(iso).getTime() < now;
