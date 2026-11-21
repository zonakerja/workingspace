import {
  FileCode2,
  MailCheck,
  MailX,
  Mails,
  Activity,
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  BookOpen,
  BookOpenText,
  BookUser,
  Bot,
  BotMessageSquare,
  BrainCircuit,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  ClipboardList,
  ClipboardCheck,
  Contact,
  Workflow,
  Database,
  DatabaseZap,
  FilePen,
  FilePlus2,
  FileSignature,
  FileText,
  FileX,
  FolderTree,
  Frame,
  Grid2x2,
  HardDrive,
  HeartPulse,
  Hourglass,
  Inbox,
  Info,
  Landmark,
  Layers,
  LayoutGrid,
  Library,
  ListChecks,
  ListTodo,
  MessageCircle,
  MessagesSquare,
  NotebookPen,
  Package,
  Plug,
  CalendarSync,
  Settings,
  ShieldCheck,
  Settings2,
  Share2,
  Sparkles,
  StickyNote,
  Table2,
  Tag,
  UserRound,
  Users,
  Waypoints,
  Trash2,
  Wrench,
  type LucideIcon,
  History,
} from "lucide-react";
import type { UserRole } from "@/types/api";

export type ModuleKey =
  | "overview"
  | "planner"
  | "email"
  | "notes"
  | "knowledge"
  | "working-space"
  | "files"
  | "requests"
  | "agent"
  | "kinerja"
  | "srikandi"
  | "siman"
  | "custom"
  | "tools"
  | "settings"
  | "profile";

interface ModuleTab {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Role yang boleh melihat tab. Kosong = semua role. */
  roles?: UserRole[];
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
  tabs?: ModuleTab[];
  /** Tidak tampil sebagai modul di sidebar (dibuka dari menu lain, mis. menu user). */
  hiddenInSidebar?: boolean;
  /** Di sidebar tampil sebagai menu yang bisa dibuka berisi sub menu (= tab), seperti Pengaturan. */
  sidebarSubmenu?: boolean;
  /**
   * Kelompok sidebar: `workspace` (default), `ai` (AI Agent: Knowledge, AI Agent, Approval), `connection` (Connection & MCP)
   * atau `system` (Tools, Pengaturan).
   */
  sidebarGroup?: "workspace" | "ai" | "connection" | "system";
}

/** Sumber tunggal navigasi: sidebar, router, breadcrumb, hero halaman. */
export const MODULES: ModuleDef[] = [
  {
    key: "overview",
    label: "Overview",
    description: "Ringkasan hari ini: agenda, rutinitas, tugas, dan progres proyek.",
    path: "/",
    icon: LayoutGrid,
  },
  {
    key: "planner",
    label: "Planner",
    description: "Agenda harian, jadwal, rutinitas, dan referensi tipe agenda.",
    path: "/planner",
    icon: CalendarDays,
    tabs: [
      { id: "daily", label: "Harian", icon: Activity },
      { id: "schedule", label: "Jadwal", icon: CalendarRange },
      { id: "routines", label: "Rutinitas", icon: Settings2 },
      { id: "references", label: "Referensi", icon: Tag },
    ],
  },
  {
    key: "email",
    label: "Email",
    description: "Kotak masuk semua akun email Anda: tagihan & jadwal dikenali otomatis, jadikan to-do atau agenda.",
    path: "/email",
    icon: Mails,
    tabs: [
      { id: "inbox", label: "Kotak Masuk", icon: Inbox },
      { id: "done", label: "Selesai", icon: MailCheck },
      { id: "ignored", label: "Diabaikan", icon: MailX },
    ],
  },
  {
    key: "notes",
    label: "Notes Space",
    description: "Catatan bebas, daftar, catatan berbasis AI, dan notebook riset AI dari sumber Anda.",
    path: "/notes",
    icon: StickyNote,
    tabs: [
      { id: "free", label: "Catatan Bebas", icon: NotebookPen },
      { id: "lists", label: "List Bebas", icon: ListChecks },
      { id: "ai", label: "Notes AI", icon: Sparkles },
      { id: "notebook", label: "My Notebook", icon: BookOpenText },
    ],
  },
  {
    key: "working-space",
    label: "Working Space",
    description: "Metode PARA: Projects, Areas, Resources, dan Archives.",
    path: "/working-space",
    icon: Layers,
    tabs: [
      { id: "overview", label: "Overview", icon: LayoutGrid },
      { id: "projects", label: "Projects", icon: Layers },
      { id: "areas", label: "Areas", icon: Grid2x2 },
      { id: "resources", label: "Resources", icon: BookOpen },
      { id: "archives", label: "Archives", icon: Archive },
    ],
  },
  {
    key: "files",
    label: "File Control",
    description: "Manajemen kearsipan: pemberkasan, penataan, sirkulasi, dan penyusutan.",
    path: "/file-control",
    icon: ArchiveRestore,
    tabs: [
      { id: "pending", label: "Gantung", icon: Hourglass },
      { id: "physical", label: "Fisik", icon: Package },
      { id: "digital", label: "Digital", icon: HardDrive },
      { id: "arrangement", label: "Penataan", icon: FolderTree },
      { id: "transactions", label: "Transaksi", icon: ArrowRightLeft },
      { id: "static", label: "Statis", icon: Archive },
      { id: "destroyed", label: "Musnah", icon: FileX },
      { id: "references", label: "Referensi", icon: Tag },
      { id: "shared", label: "Dibagikan", icon: Users },
    ],
  },
  {
    key: "knowledge",
    sidebarGroup: "ai",
    label: "Knowledge",
    description: "Vault Obsidian Anda di Akasha: jelajahi, sunting, graf tautan, tabel properti, dan kurasi Inbox.",
    path: "/knowledge",
    icon: BrainCircuit,
    tabs: [
      { id: "notes", label: "Catatan", icon: FileText },
      { id: "graph", label: "Graf", icon: Waypoints },
      { id: "table", label: "Tabel", icon: Table2 },
      { id: "bases", label: "Bases", icon: Database },
      { id: "canvas", label: "Canvas", icon: Frame },
      { id: "tasks", label: "Tugas", icon: ListChecks },
      { id: "inbox", label: "Inbox", icon: Inbox },
      { id: "health", label: "Kesehatan", icon: HeartPulse },
    ],
  },
  {
    key: "agent",
    sidebarGroup: "ai",
    label: "AI Agent",
    description:
      "Agen AI Hermes yang bekerja dengan data Akasha: chat dan workflow — hasilnya selalu Anda periksa di Approval.",
    path: "/agent",
    icon: BotMessageSquare,
    tabs: [
      { id: "chat", label: "Chat", icon: MessagesSquare },
      { id: "workflow", label: "Workflow", icon: Workflow },
      { id: "actions", label: "Riwayat Aksi", icon: History },
      { id: "status", label: "Status & Skill", icon: Activity },
    ],
  },
  {
    key: "requests",
    sidebarGroup: "ai",
    label: "Approval",
    description:
      "Pengajuan & surat dari satker, instansi, atau masyarakat — lewat aplikasi, agen, atau bot WhatsApp: analisis kelengkapan, telaah, konsep jawaban, dan dokumen dari templat — semua menunggu persetujuan Anda.",
    path: "/requests",
    icon: Inbox,
    tabs: [
      { id: "queue", label: "Antrian Verifikasi", icon: ListTodo },
      { id: "done", label: "Selesai", icon: CheckCheck },
      { id: "whatsapp", label: "Percakapan WA", icon: MessageCircle },
      { id: "contacts", label: "Grup & Kontak", icon: Contact },
      { id: "policies", label: "Kebijakan Otomatis", icon: Workflow },
      { id: "proposals", label: "Usulan Agen", icon: ShieldCheck },
    ],
  },
  {
    key: "kinerja",
    label: "e-Kinerja",
    description:
      "Rencana aksi bulanan e-Kinerja yang Anda pilih dari Working Space, dipetakan ke RHK SKP yang diambil robot — robot hanya mengisikan draf.",
    path: "/kinerja",
    icon: ClipboardList,
    sidebarGroup: "connection",
    tabs: [
      { id: "plan", label: "Rencana Aksi", icon: ClipboardList },
      { id: "assessment", label: "Penilaian", icon: ClipboardCheck },
      { id: "workflow", label: "Workflow", icon: Workflow },
      { id: "connector", label: "Connector", icon: Bot },
    ],
  },
  {
    key: "srikandi",
    label: "SRIKANDI",
    description:
      "Naskah masuk & disposisi dari SRIKANDI, register naskah keluar sebelum didaftarkan, dan naskah ber-TTD yang diambil robot — tanda tangan & pengiriman tetap oleh Anda.",
    path: "/srikandi",
    icon: FileSignature,
    sidebarGroup: "connection",
    tabs: [
      { id: "inbox", label: "Naskah Masuk", icon: Inbox },
      { id: "register", label: "Register Naskah Keluar", icon: FilePlus2 },
      { id: "outgoing", label: "Daftar Naskah Keluar", icon: FileSignature },
      { id: "references", label: "Referensi", icon: BookUser },
      { id: "workflow", label: "Workflow", icon: Workflow },
      { id: "connector", label: "Connector", icon: Bot },
    ],
  },
  {
    key: "siman",
    label: "SIMAN",
    description:
      "Koneksi ke SIMAN: mengecek tiket pengajuan dari satker dan memasukkan surat keputusan yang sudah jadi.",
    path: "/siman",
    icon: Landmark,
    sidebarGroup: "connection",
    tabs: [
      { id: "requests", label: "Permohonan", icon: Inbox },
      { id: "workflow", label: "Workflow", icon: Workflow },
      { id: "process", label: "Cara Kerja", icon: Info },
      { id: "connector", label: "Connector", icon: Bot },
    ],
  },
  {
    key: "custom",
    label: "Connection & MCP",
    description: "Koneksi buatan agen yang sudah Anda setujui.",
    path: "/custom",
    icon: Bot,
    hiddenInSidebar: true,
  },
  {
    key: "tools",
    label: "Tools",
    description:
      "Alat bantu kerja yang dipakai di seluruh aplikasi: editor dokumen ONLYOFFICE, Markdown Converter, basis pengetahuan, indeks pengetahuan AI (RAG), dan Sampah.",
    path: "/tools",
    icon: Wrench,
    sidebarSubmenu: true,
    sidebarGroup: "system",
    tabs: [
      { id: "onlyoffice", label: "ONLYOFFICE", icon: FilePen },
      { id: "converter", label: "Markdown Converter", icon: FileCode2 },
      { id: "knowledge", label: "Basis Pengetahuan", icon: Library },
      { id: "index", label: "Indeks Pengetahuan", icon: DatabaseZap },
      { id: "trash", label: "Sampah", icon: Trash2 },
    ],
  },
  {
    key: "settings",
    label: "Pengaturan",
    description:
      "Branding aplikasi, pengguna, berbagi, model AI (lewat Akai), dan integrasi agen AI, serta kalender & email tersambung.",
    path: "/settings",
    icon: Settings,
    sidebarSubmenu: true,
    sidebarGroup: "system",
    tabs: [
      { id: "app", label: "Aplikasi", icon: Settings2, roles: ["super_admin", "admin"] },
      { id: "users", label: "Manajemen User", icon: Users, roles: ["super_admin", "admin"] },
      { id: "sharing", label: "Berbagi", icon: Share2 },
      { id: "api", label: "Model AI", icon: Sparkles },
      { id: "integrations", label: "Integrasi", icon: Plug },
      { id: "accounts", label: "Akun Tersambung", icon: CalendarSync },
    ],
  },
  {
    key: "profile",
    label: "Profil Saya",
    description: "Profil, PIN keamanan, dan akun Workingspace Anda.",
    path: "/profile",
    icon: UserRound,
    hiddenInSidebar: true,
  },
];

export const getModule = (key: ModuleKey) => MODULES.find((m) => m.key === key)!;

export const visibleTabs = (module: ModuleDef, role?: UserRole) =>
  (module.tabs ?? []).filter((tab) => !tab.roles || (role && tab.roles.includes(role)));

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  member: "Member",
};
