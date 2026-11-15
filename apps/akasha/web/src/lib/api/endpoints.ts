import { withTrashToast } from "@/lib/trash-toast";
import { withOfficeKeptToast } from "@/lib/office-kept-toast";
import { apiUrl, request } from "@/lib/api/client";
import { useAuthStore } from "@/stores/auth-store";
import type {
  ConverterMode,
  ConverterPrefs,
  ConverterReconvertScope,
  ConverterStats,
  ConvertedDocument,
  ConvertedDocumentSummary,
  ConverterStatus,
  AgentPolicy,
  AgentPolicyInput,
  AgentPolicyList,
  AddNotebookSourceInput,
  RequestDetail,
  PublicLinkInfo,
  PublicVaultView,
  VaultAccess,
  VaultDetail,
  AutomationAlert,
  AutomationJob,
  AutomationKind,
  AutomationRun,
  AutomationSchedule,
  RobotConnector,
  RobotInput,
  RobotLoginStep,
  RobotPageInfo,
  RobotRun,
  RobotSystem,
  ContactGroup,
  ContactGroupInput,
  WaBotProfile,
  WaContact,
  WaContactInput,
  WaConversation,
  WaMessage,
  WhatsappStatus,
  RequestDocument,
  RequestInput,
  RequestStatus,
  RequestSummary,
  RequestTemplateFields,
  RequestUpdate,
  AgentActivity,
  ApiScope,
  ApiTokenInfo,
  CreatedApiToken,
  AiChatMessage,
  AiChatResult,
  AiConversation,
  AiGenerateResult,
  KnowledgeNoteDetail,
  KnowledgeGraph,
  KnowledgeHealth,
  KnowledgeNoteListItem,
  KnowledgePrefs,
  KnowledgeSearchHit,
  KnowledgeSource,
  KnowledgeTree,
  KnowledgeSimilar,
  KnowledgeBaseFile,
  KnowledgeBaseListItem,
  KnowledgeNoteVersion,
  KnowledgeNoteVersionDetail,
  KnowledgeTasks,
  KnowledgeUnlinkedMention,
  KnowledgeExport,
  KnowledgeExportKind,
  KnowledgeStatus,
  NotebookChatResult,
  NotebookDetail,
  NotebookListItem,
  NotebookMessagePage,
  NotebookUsage,
  NotebookNote,
  NotebookSource,
  NotebookSummary,
  OfficeConfigResult,
  OfficeDiagnostics,
  OfficeFonts,
  OfficeFormat,
  OfficeLinkBadges,
  OfficeLinkedFile,
  OfficeLinks,
  OfficePreferences,
  OfficeTemplate,
  OfficeWorkspaceDocument,
  OfficeStatus,
  OfficeVersions,
  AiIndexStatus,
  AiSearchHit,
  SmartSearchMode,
  TrashItemInfo,
  AgentActionInfo,
  McpAuthType,
  McpConnectionInfo,
  McpPreset,
  SmartSearchResponse,
  AiProviderId,
  AiProviderInput,
  AiRouting,
  AiSettings,
  AiTranscribeJob,
  ApiRecord,
  AppSettings,
  AppSettingsInput,
  AssetMetadata,
  AuthSession,
  PinStatus,
  PublicUser,
  RecordComment,
  RecordType,
  ShareableType,
  ShareEntry,
  SharePermission,
  UploadedAsset,
  UserRole,
  UserStats,
  UserSummary,
  KnowledgeExtractInput,
  KnowledgeSplitInput,
  KnowledgeSplitPreview,
  KnowledgeSplitResult,
  KnowledgeMergeInput,
  KnowledgePeriod,
} from "@/types/api";

export interface ProfileInput {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface UserInput {
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  phone?: string;
  address?: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    request<AuthSession>("/auth/login", { method: "POST", body: { email, password }, auth: false }),
  /** `ssoLogoutUrl` = halaman keluar akun Workingspace (SSO aktif) — frontend mengarahkan ke sana. */
  logout: () =>
    request<{ success: boolean; ssoLogoutUrl?: string | null }>("/auth/logout", { method: "POST", auth: false }),
  /** Cara masuk yang tersedia (SSO workingspace.id / kata sandi lokal). */
  ssoConfig: () =>
    request<{ enabled: boolean; passwordLogin: boolean; accountUrl: string | null }>("/auth/sso/config", {
      auth: false,
    }),
  me: () => request<PublicUser>("/auth/me"),
  updateMe: (input: ProfileInput) => request<PublicUser>("/auth/me", { method: "PATCH", body: input }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>("/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    }),
};

/** PIN keamanan: membuka item terkunci selama sesi login (sampai logout / Kunci sekarang). */
export const securityApi = {
  status: () => request<PinStatus>("/security/pin"),
  setPin: (password: string, pin: string) =>
    request<PinStatus>("/security/pin", { method: "PUT", body: { password, pin } }),
  unlock: (pin: string) => request<PinStatus>("/security/pin/unlock", { method: "POST", body: { pin } }),
  lock: () => request<PinStatus>("/security/pin/lock", { method: "POST" }),
  removePin: (password: string) => request<PinStatus>("/security/pin", { method: "DELETE", body: { password } }),
};

export const settingsApi = {
  get: () => request<AppSettings>("/settings/app", { auth: false }),
  update: (input: AppSettingsInput) => request<AppSettings>("/settings/app", { method: "PATCH", body: input }),
};

export const usersApi = {
  list: () => request<PublicUser[]>("/users"),
  create: (input: UserInput) => request<PublicUser>("/users", { method: "POST", body: input }),
  update: (id: string, input: Partial<UserInput>) =>
    request<PublicUser>(`/users/${id}`, { method: "PATCH", body: input }),
  remove: (id: string) => request<{ success: boolean }>(`/users/${id}`, { method: "DELETE" }),
  /** Statistik pemakaian per user (admin) — tanpa isi data */
  stats: () => request<UserStats[]>("/users/stats"),
  /** Cari akun penerima berbagi (min. 3 huruf) */
  directory: (q: string) => request<UserSummary[]>("/users/directory", { query: { q } }),
};

export const sharesApi = {
  /** Penerima satu item milik sendiri */
  forItem: (recordType: ShareableType, recordId: string) =>
    request<ShareEntry[]>("/shares", { query: { recordType, recordId } }),
  outgoing: () => request<ShareEntry[]>("/shares/outgoing"),
  incoming: () => request<ShareEntry[]>("/shares/incoming"),
  create: (input: { recordType: ShareableType; recordId: string; email: string; permission: SharePermission }) =>
    request<ShareEntry>("/shares", { method: "POST", body: input }),
  update: (id: string, permission: SharePermission) =>
    request<ShareEntry>(`/shares/${id}`, { method: "PATCH", body: { permission } }),
  /** Pemilik mencabut, atau penerima keluar dari berbagi */
  remove: (id: string) => request<{ success: boolean }>(`/shares/${id}`, { method: "DELETE" }),
};

export interface CommentTarget {
  recordType: RecordType;
  recordId: string;
  /** Pemilik item; kosong = milik sendiri */
  ownerId?: string;
}

export const commentsApi = {
  list: (target: CommentTarget) => request<RecordComment[]>("/comments", { query: { ...target } }),
  create: (target: CommentTarget, body: string) =>
    request<RecordComment>("/comments", { method: "POST", body: { ...target, body } }),
  update: (id: string, body: string) => request<RecordComment>(`/comments/${id}`, { method: "PATCH", body: { body } }),
  remove: (id: string) => request<{ success: boolean }>(`/comments/${id}`, { method: "DELETE" }),
};

export const recordsApi = {
  /** `light` = daftar ringan: field berat dipotong & ditandai `partial` (lengkapi lewat `get`). */
  list: <T>(type: RecordType, query?: { from?: string; to?: string; light?: "1" }) =>
    request<ApiRecord<T>[]>(`/records/${type}`, { query }),
  /** Satu record utuh; `userId` = pemilik item yang dibagikan. */
  get: <T>(type: RecordType, clientId: string, userId?: string) =>
    request<ApiRecord<T>>(`/records/${type}/${encodeURIComponent(clientId)}`, { query: { userId } }),
  /**
   * `base` = isi item sebelum perubahan (server menggabungkan perubahan, lihat `lib/record-merge.ts`);
   * `preserve` = key yang tidak utuh di client (nilai tersimpan dipertahankan).
   */
  upsert: <T>(
    type: RecordType,
    clientId: string,
    payload: T,
    userId?: string,
    options: { base?: unknown; preserve?: string[] } = {},
  ) =>
    request<ApiRecord<T>>(`/records/${type}/${encodeURIComponent(clientId)}`, {
      method: "PUT",
      body: { payload, userId, ...options },
    }),
  remove: (type: RecordType, clientId: string, userId?: string) =>
    withTrashToast(
      request<{ success: boolean; batchId?: string | null }>(`/records/${type}/${encodeURIComponent(clientId)}`, {
        method: "DELETE",
        query: { userId },
      }),
    ),
};

export const uploadsApi = {
  /** `ownerId` = pemilik item bersama (izin edit) tempat berkas dilampirkan; kosong = milik sendiri. */
  upload: (file: File, context?: string, ownerId?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (context) form.append("context", context);
    if (ownerId) form.append("ownerId", ownerId);
    return request<UploadedAsset>("/uploads", { method: "POST", body: form });
  },
  list: (take = 50) => request<UploadedAsset[]>("/uploads", { query: { take } }),
  /** Hapus berkas tersimpan → Sampah (bisa dipulihkan 30 hari). */
  remove: (id: string) =>
    withTrashToast(request<{ success: boolean; batchId?: string }>(`/uploads/${id}`, { method: "DELETE" })),
  /**
   * Buang permanen unggahan yang belum pernah disimpan (batal unggah, form ditutup) — tidak masuk Sampah. Dokumen yang
   * sudah disunting di ONLYOFFICE tidak dibuang server, tetapi dipindah ke Tools → ONLYOFFICE → Dokumen (`kept`).
   */
  discard: (id: string) =>
    withOfficeKeptToast(
      request<{ success: boolean; kept?: boolean }>(`/uploads/${id}`, { method: "DELETE", query: { discard: 1 } }),
    ),
  /** Metadata + hasil ekstraksi teks (PDF/DOCX/XLSX/teks; gambar lewat OCR Gemini) yang dikerjakan backend. */
  metadata: (id: string) => request<AssetMetadata>(`/uploads/${id}/metadata`),
  /** Link sementara (10 menit) yang bisa dibuka di tab baru / <img>. */
  createLink: async (id: string) => {
    const { url } = await request<{ url: string; expiresIn: number }>(`/uploads/${id}/link`, {
      method: "POST",
    });
    return apiUrl(url);
  },
};

/** Editor dokumen ONLYOFFICE (menu Tools → ONLYOFFICE). */
/** Tools → Markdown Converter (MarkItDown + Docling di server; docs/ARCHITECTURE.md §3.14). */
export const converterApi = {
  status: () => request<ConverterStatus>("/converter/status"),
  preferences: () => request<ConverterPrefs>("/converter/preferences"),
  updatePreferences: (input: Partial<ConverterPrefs>) =>
    request<ConverterPrefs>("/converter/preferences", { method: "PUT", body: input }),
  stats: () => request<ConverterStats>("/converter/stats"),
  documents: () => request<ConvertedDocumentSummary[]>("/converter/documents"),
  document: (id: string) => request<ConvertedDocument>(`/converter/documents/${id}`),
  /** Unggah ke pustaka: dikonversi di latar belakang, hasil disimpan (berkas asal tidak). */
  createDocument: (file: File, options: { mode?: ConverterMode; enhance?: boolean; compareTokens?: boolean } = {}) => {
    const form = new FormData();
    form.append("file", file);
    if (options.mode) form.append("mode", options.mode);
    if (options.enhance) form.append("enhance", "true");
    if (options.compareTokens) form.append("compareTokens", "true");
    return request<ConvertedDocumentSummary>("/converter/documents", { method: "POST", body: form });
  },
  renameDocument: (id: string, title: string) =>
    request<{ id: string; title: string }>(`/converter/documents/${id}`, { method: "PATCH", body: { title } }),
  /** Hapus permanen (bukan ke Sampah). */
  removeDocument: (id: string) => request<{ deleted: boolean }>(`/converter/documents/${id}`, { method: "DELETE" }),
  reconvert: (scope: ConverterReconvertScope) =>
    request<{ queued: number }>("/converter/reconvert", { method: "POST", body: { scope } }),
};

export const officeApi = {
  status: () => request<OfficeStatus>("/office/status"),
  /**
   * Dokumen baru (berkas milik user; dijadikan Resource Global oleh pemanggil): kosong sesuai `format`, atau salinan
   * berkas templat (`templateId`, format mengikuti templat). `context`/`ownerId` sama seperti upload lampiran.
   */
  createDocument: (
    source: { format: OfficeFormat } | { templateId: string },
    options: { title?: string; context?: string; ownerId?: string } = {},
  ) => request<UploadedAsset>("/office/documents", { method: "POST", body: { ...source, ...options } }),
  /** Ruang kerja dokumen (Tools → ONLYOFFICE → Dokumen); dokumen baru di sini memakai context `office-workspace`. */
  workspace: () => request<OfficeWorkspaceDocument[]>("/office/workspace"),
  renameWorkspace: (id: string, title: string) =>
    request<{ id: string; originalName: string; name: string }>(`/office/workspace/${id}`, {
      method: "PATCH",
      body: { title },
    }),
  preferences: () => request<OfficePreferences>("/office/preferences"),
  updatePreferences: (input: { ai: boolean }) =>
    request<OfficePreferences>("/office/preferences", { method: "PATCH", body: input }),
  fonts: () => request<OfficeFonts>("/office/fonts"),
  /** Admin: unggah font .ttf/.otf/.ttc ke folder font bersama ONLYOFFICE. */
  uploadFont: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ name: string }>("/office/fonts", { method: "POST", body: form });
  },
  deleteFont: (name: string) =>
    request<{ files: unknown[] }>(`/office/fonts/${encodeURIComponent(name)}`, { method: "DELETE" }),
  /** Konsep & dokumen final yang tertaut dengan satu berkas. */
  links: (uploadId: string) => request<OfficeLinks>(`/office/files/${uploadId}/links`),
  /** Tautkan berkas `finalId` (dokumen final) ke konsep `draftId`; `null` = lepaskan. */
  setDraft: (finalId: string, draftId: string | null) =>
    request<OfficeLinks>(`/office/files/${finalId}/draft`, { method: "PUT", body: { draftId } }),
  linkBadges: (ids: string[]) => request<OfficeLinkBadges>("/office/links", { query: { ids: ids.join(",") } }),
  /** Berkas milik user yang bisa dipilih sebagai konsep (`draft`) / dokumen final (`final`). */
  linkCandidates: (role: "draft" | "final", q?: string) =>
    request<OfficeLinkedFile[]>("/office/link-candidates", { query: { role, ...(q ? { q } : {}) } }),
  /** Templat milik user; unggah lewat `uploadsApi.upload(file, "office-template")`, hapus lewat `uploadsApi.remove`. */
  templates: () => request<OfficeTemplate[]>("/office/templates"),
  diagnostics: () => request<OfficeDiagnostics>("/office/diagnostics"),
  /** Simpan paksa sesi edit yang terbuka (modal editor ditutup); menunggu sampai versi tersimpan. */
  forceSave: (uploadId: string) =>
    request<{ status: "saved" | "pending" | "no-changes" | "no-session" }>(`/office/files/${uploadId}/forcesave`, {
      method: "POST",
    }),
  config: (input: {
    uploadId: string;
    mode?: "edit" | "view";
    theme?: "light" | "dark";
    /** Origin aplikasi: plugin AI Akasha dimuat dari sini */
    appOrigin?: string;
  }) => request<OfficeConfigResult>("/office/config", { method: "POST", body: input }),
  versions: (uploadId: string) => request<OfficeVersions>(`/office/files/${uploadId}/versions`),
  restore: (uploadId: string, version: number) =>
    request<OfficeVersions>(`/office/files/${uploadId}/versions/${version}/restore`, { method: "POST" }),
  /** Isi versi lama sebagai Blob (butuh header Authorization, jadi diunduh lewat fetch). */
  versionBlob: async (uploadId: string, version: number) => {
    const response = await fetch(apiUrl(`/office/files/${uploadId}/versions/${version}`), {
      headers: { Authorization: `Bearer ${useAuthStore.getState().accessToken ?? ""}` },
      credentials: "include",
    });
    if (!response.ok) throw new Error(`Versi tidak dapat diunduh (status ${response.status}).`);
    return response.blob();
  },
};

export interface McpConnectionInput {
  name?: string;
  url?: string;
  preset?: string;
  authType?: McpAuthType;
  token?: string;
  icon?: string;
  agentEnabled?: boolean;
  allowWrite?: boolean;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScope?: string;
  agentTools?: string[];
}

/** Koneksi aplikasi MCP luar (Canva, Notion, …). */
export const mcpConnectionsApi = {
  presets: () => request<McpPreset[]>("/mcp-connections/presets"),
  list: () => request<McpConnectionInfo[]>("/mcp-connections"),
  get: (idOrSlug: string) => request<McpConnectionInfo>(`/mcp-connections/${encodeURIComponent(idOrSlug)}`),
  create: (input: McpConnectionInput) =>
    request<McpConnectionInfo>("/mcp-connections", { method: "POST", body: input }),
  update: (id: string, input: McpConnectionInput) =>
    request<McpConnectionInfo>(`/mcp-connections/${id}`, { method: "PATCH", body: input }),
  remove: (id: string) => request<{ success: boolean }>(`/mcp-connections/${id}`, { method: "DELETE" }),
  connect: (id: string) =>
    request<{ connection?: McpConnectionInfo; authorizationUrl?: string }>(`/mcp-connections/${id}/connect`, {
      method: "POST",
    }),
  refresh: (id: string) => request<McpConnectionInfo>(`/mcp-connections/${id}/refresh`, { method: "POST" }),
  call: (id: string, tool: string, args: Record<string, unknown>) =>
    request<{ isError: boolean; text: string }>(`/mcp-connections/${id}/call`, {
      method: "POST",
      body: { tool, arguments: args },
    }),
};

export const agentActionsApi = {
  list: (status?: AgentActionInfo["status"]) =>
    request<AgentActionInfo[]>("/agent/actions", { query: status ? { status } : undefined }),
  pendingCount: () => request<{ count: number }>("/agent/actions/pending-count"),
  undo: (id: string, force = false) =>
    request<{ status: string }>(`/agent/actions/${id}/undo`, { method: "POST", body: { force } }),
  approve: (id: string) =>
    request<{ status: string; removed: number; files?: number; filled?: number; added?: number; message?: string }>(
      `/agent/actions/${id}/approve`,
      { method: "POST" },
    ),
  reject: (id: string, note?: string) =>
    request<{ status: string }>(`/agent/actions/${id}/reject`, { method: "POST", body: { note } }),
};

export const trashApi = {
  list: () => request<TrashItemInfo[]>("/trash"),
  restore: (selector: { ids?: string[]; batchId?: string }) =>
    request<{ restored: string[]; failed: { id: string; title: string; message: string }[] }>("/trash/restore", {
      method: "POST",
      body: selector,
    }),
  purge: (selector: { ids?: string[]; batchId?: string; all?: boolean }) =>
    request<{ purged: number }>("/trash/purge", { method: "POST", body: selector }),
};

export const aiApi = {
  settings: () => request<AiSettings>("/ai/settings"),
  update: (input: {
    activeProvider?: AiProviderId | null;
    fallbackEnabled?: boolean;
    indexEnabled?: boolean;
    routing?: AiRouting;
  }) => request<AiSettings>("/ai/settings", { method: "PATCH", body: input }),
  /** `apiKey` kosong = pertahankan key tersimpan; `model` null = model default provider. */
  saveProvider: (provider: AiProviderId, input: AiProviderInput) =>
    request<AiSettings>(`/ai/settings/${provider}`, { method: "PUT", body: input }),
  removeProvider: (provider: AiProviderId) => request<AiSettings>(`/ai/settings/${provider}`, { method: "DELETE" }),
  indexStatus: () => request<AiIndexStatus>("/ai/index"),
  rebuildIndex: () => request<{ queued: boolean }>("/ai/index/rebuild", { method: "POST" }),
  searchIndex: (q: string, limit = 8) => request<AiSearchHit[]>("/ai/index/search", { query: { q, limit } }),
  /** Pencarian Pintar (Ctrl+K): `text` tanpa AI, `meaning` = satu embedding pertanyaan */
  smartSearch: (q: string, mode: SmartSearchMode) => request<SmartSearchResponse>("/ai/search", { query: { q, mode } }),
  test: (provider: AiProviderId) => request<AiGenerateResult>(`/ai/settings/${provider}/test`, { method: "POST" }),
  /** Mulai transkrip berkas audio tersimpan (pekerjaan latar belakang; berkas yang sama tidak dikerjakan dua kali). */
  startTranscribe: (uploadId: string) =>
    request<AiTranscribeJob>("/ai/transcribe", { method: "POST", body: { uploadId } }),
  transcribeStatus: (uploadId: string) => request<AiTranscribeJob>(`/ai/transcribe/${uploadId}`),
  /** Prompt + lampiran (PDF/gambar/audio/teks) diproses di backend dengan provider aktif user. */
  generate: (prompt: string, files: Blob[] = []) => {
    const form = new FormData();
    form.append("prompt", prompt);
    files.forEach((file, i) => form.append("files", file, file instanceof File ? file.name : `lampiran-${i + 1}`));
    return request<AiGenerateResult>("/ai/generate", { method: "POST", body: form });
  },
};

/** Chatbot Akasha: RAG atas basis pengetahuan (vault Obsidian) + data kerja, riwayat permanen, profil kerja. */
export const aiChatApi = {
  send: (input: { conversationId?: string; message: string; snapshot?: string; today?: string }) =>
    request<AiChatResult>("/ai/chat", { method: "POST", body: input }),
  conversations: () => request<AiConversation[]>("/ai/chat/conversations"),
  messages: (id: string, take = 100) =>
    request<{ messages: AiChatMessage[]; hasMore: boolean }>(`/ai/chat/conversations/${id}/messages`, {
      query: { take },
    }),
  remove: (id: string) => request<{ success: boolean }>(`/ai/chat/conversations/${id}`, { method: "DELETE" }),
  profile: () => request<{ profile: string | null }>("/ai/profile"),
  saveProfile: (profile: string | null) =>
    request<{ profile: string | null }>("/ai/profile", { method: "PUT", body: { profile } }),
};

/** Pengaturan → Integrasi: token akses pribadi untuk agen AI (MCP) + log aktivitas agen. */
export const integrationsApi = {
  scopes: () => request<{ id: ApiScope; label: string }[]>("/integrations/scopes"),
  tokens: () => request<ApiTokenInfo[]>("/integrations/tokens"),
  createToken: (input: { name: string; scopes: ApiScope[]; expiresInDays: number | null }) =>
    request<CreatedApiToken>("/integrations/tokens", { method: "POST", body: input }),
  revokeToken: (id: string) => request<{ success: boolean }>(`/integrations/tokens/${id}`, { method: "DELETE" }),
  activity: (take = 50) => request<AgentActivity[]>("/integrations/activity", { query: { take } }),
};

/** Basis pengetahuan: vault Obsidian milik user (Tools → Basis Pengetahuan). */
export const knowledgeApi = {
  status: () => request<KnowledgeStatus>("/knowledge/status"),
  folders: () => request<string[]>("/knowledge/folders"),
  setVault: (folder: string | null) =>
    request<KnowledgeStatus>("/knowledge/vault", { method: "PUT", body: { folder } }),
  createVault: (folder: string) =>
    request<KnowledgeStatus>("/knowledge/vault/create", { method: "POST", body: { folder } }),
  scan: () => request<KnowledgeStatus>("/knowledge/scan", { method: "POST" }),
  notes: (q?: string) => request<KnowledgeNoteListItem[]>("/knowledge/notes", { query: q ? { q } : undefined }),
  note: (id: string) => request<KnowledgeNoteDetail>(`/knowledge/notes/${id}`),
  addToInbox: (input: { title: string; content: string; question?: string }) =>
    request<{ path: string }>("/knowledge/inbox", { method: "POST", body: input }),
  tree: () => request<KnowledgeTree>("/knowledge/tree"),
  /** Cermin hasil kerja Akasha → folder 80-Akasha di vault */
  exportSettings: () => request<KnowledgeExport>("/knowledge/export"),
  updateExport: (input: { enabled?: boolean; kinds?: Partial<Record<KnowledgeExportKind, boolean>> }) =>
    request<KnowledgeExport>("/knowledge/export", { method: "PUT", body: input }),
  runExport: () => request<KnowledgeExport>("/knowledge/export/run", { method: "POST" }),
  clearExport: () => request<KnowledgeExport>("/knowledge/export/files", { method: "DELETE" }),
  graph: () => request<KnowledgeGraph>("/knowledge/graph"),
  search: (q: string, mode: "text" | "semantic") =>
    request<KnowledgeSearchHit[]>("/knowledge/search", { query: { q, mode } }),
  health: () => request<KnowledgeHealth>("/knowledge/health"),
  prefs: () => request<KnowledgePrefs>("/knowledge/prefs"),
  setPrefs: (prefs: KnowledgePrefs) => request<KnowledgePrefs>("/knowledge/prefs", { method: "PUT", body: prefs }),
  source: (id: string) => request<KnowledgeSource>(`/knowledge/notes/${id}/source`),
  save: (id: string, input: { content: string; baseHash: string }) =>
    request<KnowledgeSource>(`/knowledge/notes/${id}`, { method: "PUT", body: input }),
  setProperties: (id: string, input: { set?: Record<string, unknown>; remove?: string[]; baseHash: string }) =>
    request<KnowledgeSource>(`/knowledge/notes/${id}/properties`, { method: "PATCH", body: input }),
  createNote: (input: { folder?: string; title: string; content?: string; templateId?: string }) =>
    request<{ id: string | null; path: string }>("/knowledge/notes", { method: "POST", body: input }),
  moveNote: (id: string, input: { path: string; updateLinks?: boolean }) =>
    request<{ id: string | null; path: string; updatedLinks: number }>(`/knowledge/notes/${id}/move`, {
      method: "POST",
      body: input,
    }),
  /** Ganti nama tag di semua catatan vault (termasuk turunan) */
  assignField: (field: string) =>
    request<{ notes: number; failed: string[] }>("/knowledge/fields/assign", { method: "POST", body: { field } }),
  renameTag: (input: { from: string; to: string }) =>
    request<{ notes: number; occurrences: number; failed?: string[] }>("/knowledge/tags/rename", {
      method: "POST",
      body: input,
    }),
  /** Note composer: gabung catatan ke catatan lain / baru */
  mergeNote: (id: string, input: KnowledgeMergeInput) =>
    request<{ id: string | null; path: string; updatedLinks: number; updatedCanvases: number; trash: string }>(
      `/knowledge/notes/${id}/merge`,
      { method: "POST", body: input },
    ),
  /** Note composer: ekstrak pilihan teks ke catatan lain / baru */
  splitPreview: (id: string, input: KnowledgeSplitInput) =>
    request<KnowledgeSplitPreview>(`/knowledge/notes/${id}/split`, {
      method: "POST",
      body: { ...input, dryRun: true },
    }),
  splitNote: (id: string, input: KnowledgeSplitInput) =>
    request<KnowledgeSplitResult>(`/knowledge/notes/${id}/split`, { method: "POST", body: input }),
  extractNote: (id: string, input: KnowledgeExtractInput) =>
    request<{ id: string | null; path: string; updatedLinks: number }>(`/knowledge/notes/${id}/extract`, {
      method: "POST",
      body: input,
    }),
  deleteNote: (id: string) =>
    withTrashToast(request<{ trash: string; batchId?: string }>(`/knowledge/notes/${id}`, { method: "DELETE" })),
  unlinked: (id: string) => request<KnowledgeUnlinkedMention[]>(`/knowledge/notes/${id}/unlinked`),
  similar: (id: string) => request<KnowledgeSimilar>(`/knowledge/notes/${id}/similar`),
  tasks: () => request<KnowledgeTasks>("/knowledge/tasks"),
  versions: (id: string) => request<KnowledgeNoteVersion[]>(`/knowledge/notes/${id}/versions`),
  version: (id: string, versionId: string) =>
    request<KnowledgeNoteVersionDetail>(`/knowledge/notes/${id}/versions/${versionId}`),
  restoreVersion: (id: string, versionId: string, baseHash: string) =>
    request<KnowledgeSource>(`/knowledge/notes/${id}/versions/${versionId}/restore`, {
      method: "POST",
      body: { baseHash },
    }),
  bases: () => request<KnowledgeBaseListItem[]>("/knowledge/bases"),
  canvases: () => request<KnowledgeBaseListItem[]>("/knowledge/canvases"),
  canvasFile: (path: string) => request<KnowledgeBaseFile>(`/knowledge/canvases/file?path=${encodeURIComponent(path)}`),
  createCanvas: (input: { folder?: string; name: string }) =>
    request<KnowledgeBaseFile>("/knowledge/canvases", { method: "POST", body: input }),
  saveCanvas: (input: { path: string; data: Record<string, unknown>; baseHash: string }) =>
    request<KnowledgeBaseFile>("/knowledge/canvases/file", { method: "PUT", body: input }),
  deleteCanvas: (path: string) =>
    withTrashToast(
      request<{ trash: string; batchId?: string }>(`/knowledge/canvases/file?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
      }),
    ),
  baseFile: (path: string) => request<KnowledgeBaseFile>(`/knowledge/bases/file?path=${encodeURIComponent(path)}`),
  createBase: (input: { folder?: string; name: string }) =>
    request<KnowledgeBaseFile>("/knowledge/bases", { method: "POST", body: input }),
  saveBase: (input: { path: string; data: Record<string, unknown>; baseHash: string }) =>
    request<KnowledgeBaseFile>("/knowledge/bases/file", { method: "PUT", body: input }),
  deleteBase: (path: string) =>
    withTrashToast(
      request<{ trash: string; batchId?: string }>(`/knowledge/bases/file?path=${encodeURIComponent(path)}`, {
        method: "DELETE",
      }),
    ),
  /** Centang / buka lagi tugas vault → ditulis balik ke berkasnya */
  toggleTask: (input: { noteId: string; index: number; raw: string; done: boolean; today: string }) =>
    request<{ ok: true; line: number }>("/knowledge/tasks/toggle", { method: "POST", body: input }),
  /** Catatan harian `Harian/YYYY-MM-DD.md` / mingguan `Mingguan/YYYY-Www.md` / bulanan `Bulanan/YYYY-MM.md` (dibuat sekali) */
  openDaily: ({ date, period = "day" }: { date: string; period?: KnowledgePeriod }) =>
    request<{ id: string | null; path: string; created: boolean }>("/knowledge/daily", {
      method: "POST",
      body: { date, period },
    }),
  linkMention: (id: string, sourceId: string) =>
    request<{ ok: true }>(`/knowledge/notes/${id}/link-mention`, { method: "POST", body: { sourceId } }),
  createFolder: (path: string) => request<{ path: string }>("/knowledge/folders", { method: "POST", body: { path } }),
  moveFolder: (from: string, to: string) =>
    request<{ path: string }>("/knowledge/folders/move", { method: "POST", body: { from, to } }),
  deleteFolder: (path: string) =>
    withTrashToast(
      request<{ trash: string; batchId?: string }>("/knowledge/folders", { method: "DELETE", query: { path } }),
    ),
};

/** My Notebook: sumber + chat RAG bersitasi + ringkasan Studio + catatan notebook. */
export const notebooksApi = {
  list: () => request<NotebookListItem[]>("/notebooks"),
  create: (input: { title: string; description?: string; icon?: string }) =>
    request<NotebookDetail>("/notebooks", { method: "POST", body: input }),
  get: (id: string) => request<NotebookDetail>(`/notebooks/${id}`),
  update: (
    id: string,
    input: { title?: string; description?: string | null; icon?: string | null; locked?: boolean },
  ) => request<NotebookDetail>(`/notebooks/${id}`, { method: "PATCH", body: input }),
  remove: (id: string) =>
    withTrashToast(request<{ success: boolean; batchId?: string }>(`/notebooks/${id}`, { method: "DELETE" })),
  addSource: (id: string, input: AddNotebookSourceInput) =>
    request<NotebookSource>(`/notebooks/${id}/sources`, { method: "POST", body: input }),
  updateSource: (id: string, sourceId: string, input: { enabled?: boolean; title?: string }) =>
    request<NotebookSource>(`/notebooks/${id}/sources/${sourceId}`, { method: "PATCH", body: input }),
  refreshSource: (id: string, sourceId: string) =>
    request<NotebookSource>(`/notebooks/${id}/sources/${sourceId}/refresh`, { method: "POST" }),
  removeSource: (id: string, sourceId: string) =>
    request<{ success: boolean }>(`/notebooks/${id}/sources/${sourceId}`, { method: "DELETE" }),
  /** `take` pesan terbaru (urut lama → baru) + apakah masih ada pesan lebih lama. */
  messages: (id: string, take: number) =>
    request<NotebookMessagePage>(`/notebooks/${id}/messages`, { query: { take } }),
  /** Item Akasha & berkas yang menjadi sumber notebook milik user. */
  usage: () => request<NotebookUsage[]>("/notebooks/usage"),
  clearMessages: (id: string) => request<{ success: boolean }>(`/notebooks/${id}/messages`, { method: "DELETE" }),
  chat: (id: string, message: string, fileIds: string[] = []) =>
    request<NotebookChatResult>(`/notebooks/${id}/chat`, { method: "POST", body: { message, fileIds } }),
  summarize: (id: string) =>
    request<{
      summary: NotebookSummary;
      summaryAt: string;
      summaryStale: boolean;
      fallback: AiGenerateResult["fallback"];
    }>(`/notebooks/${id}/summary`, { method: "POST" }),
  notes: (id: string) => request<NotebookNote[]>(`/notebooks/${id}/notes`),
  createNote: (id: string, input: { title: string; content: string; origin?: NotebookNote["origin"] }) =>
    request<NotebookNote>(`/notebooks/${id}/notes`, { method: "POST", body: input }),
  updateNote: (id: string, noteId: string, input: { title?: string; content?: string }) =>
    request<NotebookNote>(`/notebooks/${id}/notes/${noteId}`, { method: "PATCH", body: input }),
  removeNote: (id: string, noteId: string) =>
    request<{ success: boolean }>(`/notebooks/${id}/notes/${noteId}`, { method: "DELETE" }),
};

export const requestsApi = {
  list: (status?: RequestStatus) => request<RequestSummary[]>("/requests", { query: status ? { status } : undefined }),
  get: (id: string) => request<RequestDetail>(`/requests/${id}`),
  create: (input: RequestInput) => request<RequestDetail>("/requests", { method: "POST", body: input }),
  update: (id: string, input: RequestUpdate) =>
    request<RequestDetail>(`/requests/${id}`, { method: "PATCH", body: input }),
  remove: (id: string) =>
    withTrashToast(request<{ success: boolean; batchId?: string }>(`/requests/${id}`, { method: "DELETE" })),
  analyze: (id: string) =>
    request<{ request: RequestDetail; fallback?: unknown }>(`/requests/${id}/analyze`, { method: "POST" }),
  review: (id: string) =>
    request<{ request: RequestDetail; fallback?: unknown }>(`/requests/${id}/review`, { method: "POST" }),
  templateFields: (templateId: string) => request<RequestTemplateFields>(`/requests/templates/${templateId}/fields`),
  suggestValues: (id: string, templateId: string) =>
    request<{ values: Record<string, string> }>(`/requests/${id}/suggest-values`, {
      method: "POST",
      body: { templateId },
    }),
  createDocument: (id: string, input: { templateId: string; values: Record<string, string>; name?: string }) =>
    request<{ document: RequestDocument; request: RequestDetail }>(`/requests/${id}/documents`, {
      method: "POST",
      body: input,
    }),
  removeDocument: (id: string, uploadId: string) =>
    request<RequestDetail>(`/requests/${id}/documents/${uploadId}`, { method: "DELETE" }),
};

export const whatsappApi = {
  status: () => request<WhatsappStatus>("/whatsapp/status"),
  profile: () => request<WaBotProfile>("/whatsapp/profile"),
  updateProfile: (input: Partial<WaBotProfile>) =>
    request<WaBotProfile>("/whatsapp/profile", { method: "PUT", body: input }),
  groups: () => request<ContactGroup[]>("/whatsapp/groups"),
  createGroup: (input: ContactGroupInput) => request<ContactGroup>("/whatsapp/groups", { method: "POST", body: input }),
  updateGroup: (id: string, input: Partial<ContactGroupInput>) =>
    request<ContactGroup>(`/whatsapp/groups/${id}`, { method: "PATCH", body: input }),
  removeGroup: (id: string) => request<{ success: boolean }>(`/whatsapp/groups/${id}`, { method: "DELETE" }),
  contacts: () => request<WaContact[]>("/whatsapp/contacts"),
  createContact: (input: WaContactInput) => request<WaContact>("/whatsapp/contacts", { method: "POST", body: input }),
  updateContact: (id: string, input: Partial<WaContactInput>) =>
    request<WaContact>(`/whatsapp/contacts/${id}`, { method: "PATCH", body: input }),
  removeContact: (id: string) => request<{ success: boolean }>(`/whatsapp/contacts/${id}`, { method: "DELETE" }),
  conversations: () => request<WaConversation[]>("/whatsapp/conversations"),
  messages: (phone: string) => request<WaMessage[]>(`/whatsapp/conversations/${phone}`),
  reply: (phone: string, input: { text: string; saveToInbox?: { title: string; question?: string } }) =>
    request<WaMessage[]>(`/whatsapp/conversations/${phone}/reply`, { method: "POST", body: input }),
  resolve: (phone: string) =>
    request<{ resolved: number }>(`/whatsapp/conversations/${phone}/resolve`, { method: "POST" }),
  simulate: (input: { phone: string; text?: string; uploadIds?: string[] }) =>
    request<WaMessage>("/whatsapp/simulate", { method: "POST", body: input }),
};

const authHeader = () => ({ Authorization: `Bearer ${useAuthStore.getState().accessToken ?? ""}` });

/** Penyiapan agen tanpa terminal: izin (token "Agen Hermes"), model lewat Akasha, panggilan model terakhir. */
export interface AgentSetupState {
  /** HERMES_API_KEY di server berbentuk valid (huruf/angka/_/-, 24–128 karakter) */
  keyValid: boolean;
  token: { id: string; scopes: ApiScope[]; lastUsedAt: string | null; createdAt: string } | null;
  model: { provider: AiProviderId; model: string } | null;
  lastModelCall: {
    at: string;
    ok: boolean;
    provider: string;
    model: string;
    error?: string;
    usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
    /** Provider tugas Agen yang gagal sebelum cadangan ini dipakai */
    fallbackFrom?: { provider: string; error: string };
  } | null;
}

export interface AgentStatus {
  configured: boolean;
  owner: boolean;
  reachable: boolean;
  setup?: AgentSetupState;
  health?: string;
  model?: string | null;
  skills?: number;
  akashaSkills?: number;
  error?: string;
}
export interface AgentSkill {
  name: string;
  description: string;
  category: string;
  akasha: boolean;
}
export interface AgentRun {
  runId: string;
  status: string;
  done: boolean;
  output: string | null;
  error: string | null;
  requestId?: string;
  skill?: string;
}
export interface AgentMenuField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "select";
  required?: boolean;
  options?: string[];
  help?: string;
}

/** Fitur non-native buatan agen: workflow di AI Agent atau koneksi di Connection & MCP. */
export interface AgentMenu {
  id: string;
  slug: string;
  label: string;
  description: string;
  icon: string;
  skill: string;
  instructions: string;
  /**
   * workflow = AI Agent → Workflow; connection = menu di Connection & MCP; ekinerja = e-Kinerja → Workflow;
   * srikandi = SRIKANDI → Workflow; siman = SIMAN → Workflow; mcp = Aplikasi MCP → Workflow
   */
  placement: "workflow" | "connection" | "ekinerja" | "srikandi" | "siman" | "mcp";
  form: AgentMenuField[];
  status: "draft" | "active";
  createdAt: string;
  updatedAt: string;
}

export interface AgentMenuRun {
  runId: string;
  startedAt: string;
  status: string;
  output: string | null;
  error: string | null;
}

export interface AgentRunSummary {
  runId: string;
  kind: "chat" | "skill";
  skill: string | null;
  requestId: string | null;
  input: string | null;
  startedAt: string;
  status: string;
  trigger?: "button" | "policy" | "chat";
  error?: string | null;
}

/** Asisten Agen (Hermes lewat backend; docs/AI-AGENT.md §23). */
export const agentApi = {
  status: () => request<AgentStatus>("/agent/status"),
  skills: () => request<AgentSkill[]>("/agent/skills"),
  runs: () => request<AgentRunSummary[]>("/agent/runs"),
  setup: (scopes?: ApiScope[]) => request<AgentStatus>("/agent/setup", { method: "POST", body: { scopes } }),
  run: (runId: string) => request<AgentRun>(`/agent/runs/${encodeURIComponent(runId)}`),
  /** e-Kinerja → Rencana Aksi: Hermes memetakan kegiatan bulan itu ke RHK & menyusun usulan narasi */
  renaksi: (period: string) =>
    request<{ runId: string; status: string }>("/agent/ekinerja/renaksi", { method: "POST", body: { period } }),
  stop: (runId: string) =>
    request<{ stopping: boolean }>(`/agent/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }),
  chat: (message: string, conversation?: string) =>
    request<{ runId: string; status: string }>("/agent/chat", { method: "POST", body: { message, conversation } }),
  runSkill: (requestId: string, skill: string) =>
    request<{ runId: string; status: string }>(`/agent/requests/${requestId}/run`, { method: "POST", body: { skill } }),
  menus: () => request<AgentMenu[]>("/agent/menus"),
  setMenuStatus: (id: string, status: AgentMenu["status"]) =>
    request<AgentMenu>(`/agent/menus/${id}`, { method: "PATCH", body: { status } }),
  removeMenu: (id: string) => request<{ ok: boolean }>(`/agent/menus/${id}`, { method: "DELETE" }),
  runMenu: (id: string, body: { values?: Record<string, string>; note?: string }) =>
    request<{ runId: string; status: string }>(`/agent/menus/${id}/run`, { method: "POST", body }),
  menuRuns: (id: string) => request<AgentMenuRun[]>(`/agent/menus/${id}/runs`),
  policies: () => request<AgentPolicyList>("/agent/policies"),
  createPolicy: (input: AgentPolicyInput) => request<AgentPolicy>("/agent/policies", { method: "POST", body: input }),
  updatePolicy: (id: string, input: AgentPolicyInput) =>
    request<AgentPolicy>(`/agent/policies/${id}`, { method: "PATCH", body: input }),
  removePolicy: (id: string) => request<{ ok: boolean }>(`/agent/policies/${id}`, { method: "DELETE" }),
  pausePolicies: (paused: boolean) =>
    request<{ paused: boolean }>("/agent/policies/pause", { method: "POST", body: { paused } }),
  cancelAuto: (requestId: string) =>
    request<{ ok: boolean }>(`/agent/requests/${requestId}/auto/cancel`, { method: "POST" }),
};

/** Otomasi (tab Connector): jadwal sinkron robot (baca-saja) + riwayat. */
export const automationApi = {
  jobs: () => request<AutomationJob[]>("/automation/jobs"),
  alerts: () => request<AutomationAlert[]>("/automation/alerts"),
  update: (kind: AutomationKind, input: { enabled?: boolean; schedule?: AutomationSchedule }) =>
    request<AutomationJob>(`/automation/jobs/${kind}`, { method: "PATCH", body: input }),
  run: (kind: AutomationKind) => request<AutomationRun>(`/automation/jobs/${kind}/run`, { method: "POST" }),
  runs: (kind: AutomationKind, take = 20) => request<AutomationRun[]>(`/automation/runs?kind=${kind}&take=${take}`),
};

export const robotApi = {
  status: () => request<{ configured: boolean; reachable: boolean; vault: boolean }>("/robot/status"),
  setCredentials: (
    system: RobotSystem,
    input: { username: string; password: string; accountPassword?: string; accountPin?: string },
  ) => request<RobotConnector>(`/robot/connectors/${system}/credentials`, { method: "POST", body: input }),
  deleteCredentials: (system: RobotSystem) =>
    request<RobotConnector>(`/robot/connectors/${system}/credentials`, { method: "DELETE" }),
  autoLogin: (system: RobotSystem) =>
    request<RobotLoginStep>(`/robot/connectors/${system}/auto-login`, { method: "POST" }),
  answer: (sessionId: string, kind: "captcha" | "otp", value: string) =>
    request<RobotLoginStep>(`/robot/sessions/${sessionId}/answer`, { method: "POST", body: { kind, value } }),
  connectors: () => request<RobotConnector[]>("/robot/connectors"),
  update: (system: RobotSystem, input: { baseUrl?: string; extraHosts?: string[]; loginMarkers?: string[] }) =>
    request<RobotConnector>(`/robot/connectors/${system}`, { method: "PATCH", body: input }),
  forget: (system: RobotSystem) => request<RobotConnector>(`/robot/connectors/${system}/session`, { method: "DELETE" }),
  check: (system: RobotSystem) => request<RobotConnector>(`/robot/connectors/${system}/check`, { method: "POST" }),
  capture: (system: RobotSystem, url: string) =>
    request<RobotRun>(`/robot/connectors/${system}/capture`, { method: "POST", body: { url } }),
  startLogin: (system: RobotSystem) =>
    request<RobotPageInfo & { sessionId: string }>(`/robot/connectors/${system}/login`, { method: "POST" }),
  /** Tayangan browser jarak jauh (JPEG + info halaman dari header). */
  frame: async (sessionId: string) => {
    const response = await fetch(apiUrl(`/robot/sessions/${sessionId}/frame`), {
      headers: authHeader(),
      credentials: "include",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `Tayangan gagal dimuat (status ${response.status}).`);
    }
    const decode = (name: string) => decodeURIComponent(response.headers.get(name) ?? "");
    return {
      blob: await response.blob(),
      url: decode("x-robot-url"),
      title: decode("x-robot-title"),
      loggedIn: response.headers.get("x-robot-logged-in") === "true",
    };
  },
  input: (sessionId: string, input: RobotInput) =>
    request<RobotPageInfo>(`/robot/sessions/${sessionId}/input`, { method: "POST", body: input }),
  syncLetters: () =>
    request<{
      letters: number;
      signed: number;
      imported: number;
      attachments: number;
      resources: number;
      missed: string[];
    }>("/robot/srikandi/letters/sync", {
      method: "POST",
    }),
  /** Naskah Masuk, Tembusan, Disposisi, Koordinasi, Arahan (hanya daftar; detail tidak dibuka agar status baca tetap). */
  syncInbox: () =>
    request<{
      counts: Partial<Record<"masuk" | "tembusan" | "disposisi" | "koordinasi" | "arahan", number>>;
      total: number;
      added: number;
      updated: number;
      newUnread: number;
      summary: string;
    }>("/robot/srikandi/inbox/sync", { method: "POST" }),
  /** Daftarkan entri Register ke SRIKANDI (SIMPAN = konsep di Log Naskah Keluar); `dryRun` = isi tanpa menyimpan. */
  registerOutgoing: (id: string, dryRun = false) =>
    request<{
      status: "saved" | "exists" | "preview";
      filled: string[];
      draft: { number: string; subject: string; sendStatus: string } | null;
      runId: string;
    }>(`/robot/srikandi/register/${encodeURIComponent(id)}`, { method: "POST", body: { dryRun } }),
  /**
   * Perbarui konsep entri yang sudah terdaftar lewat Edit di Log Naskah Keluar (hanya isian yang berubah; Kirim Konsep
   * tetap oleh user). `dryRun` = rencana perubahan tanpa klik.
   */
  /**
   * Kirim Konsep entri terdaftar ke verifikator. `dryRun` (bawaan) = robot hanya memeriksa konsep & tombol tanpa
   * mengklik; mengirim wajib PIN keamanan setiap kali.
   */
  sendOutgoing: (id: string, options: { dryRun: boolean; pin?: string }) =>
    request<{ status: "ready" | "sent"; message: string; runId: string }>(
      `/robot/srikandi/register/${encodeURIComponent(id)}/send`,
      { method: "POST", body: options },
    ),
  updateOutgoing: (id: string, dryRun = false) =>
    request<{
      status: "updated" | "unchanged" | "preview";
      plan: string[];
      warnings: string[];
      remaining: string[];
      runId: string;
    }>(`/robot/srikandi/register/${encodeURIComponent(id)}/update`, { method: "POST", body: { dryRun } }),
  /** Instansi Pengirim = pilihan "Dikirimkan melalui" formulir Registrasi (± 2 menit) → referensi kategori sender_unit */
  syncSenderUnits: () =>
    request<{ counts: Record<string, number>; totals: Record<string, number> }>("/robot/srikandi/sender-units/sync", {
      method: "POST",
    }),
  /** Klasifikasi arsip SRIKANDI (±1.000 baris, beberapa menit) → referensi kategori classification */
  syncClassifications: () =>
    request<{ counts: Record<string, number>; totals: Record<string, number>; pages: Record<string, number> }>(
      "/robot/srikandi/classifications/sync",
      { method: "POST" },
    ),
  syncReferences: () =>
    request<{ counts: Record<string, number>; totals: Record<string, number>; pages: Record<string, number> }>(
      "/robot/srikandi/references/sync",
      { method: "POST" },
    ),
  syncSkp: (year: number) =>
    request<{ year: number; skps: number; detailed: number; rhk: number }>("/robot/ekinerja/skp/sync", {
      method: "POST",
      body: { year },
    }),
  /** Isi Rencana Aksi bulan itu ke e-Kinerja (draf; robot tidak pernah mengirim ke atasan). */
  /** Samakan Rencana Aksi bulan itu dengan Akasha (baca → impor → tambah / tulis ulang); `dryRun` = rencana saja. */
  /** Cakupan Working Space yang dikecualikan dari renaksi: "area:<id>", "project:<id>", "loose" (berlaku juga untuk agen) */
  renaksiScope: () => request<{ excluded: string[] }>("/robot/ekinerja/renaksi/scope"),
  setRenaksiScope: (excluded: string[]) =>
    request<{ excluded: string[] }>("/robot/ekinerja/renaksi/scope", { method: "PUT", body: { excluded } }),
  /**
   * Kirim Penilaian Ke Atasan bulan itu. `dryRun` (bawaan) = robot hanya memeriksa bulan & tombol tanpa mengklik;
   * mengirim wajib PIN keamanan setiap kali.
   */
  submitRenaksi: (period: string, options: { dryRun: boolean; pin?: string }) =>
    request<{ status: "ready" | "sent"; message: string; runId: string }>("/robot/ekinerja/renaksi/submit", {
      method: "POST",
      body: { period, ...options },
    }),
  fillRenaksi: (period: string, dryRun = false) =>
    request<{
      period: string;
      added: number;
      filled: number;
      imported: number;
      results: {
        skp: string;
        status: "filled" | "partial" | "submitted" | "preview";
        added: number;
        rewritten: number;
        planned?: number;
        missing: string[];
      }[];
    }>("/robot/ekinerja/renaksi/fill", { method: "POST", body: { period, dryRun } }),
  /** Baca semua bulan Rencana Aksi tahun itu dari e-Kinerja (status, isi, feedback) → potret + impor. */
  syncRenaksi: (year: number) =>
    request<{
      year: number;
      skps: number;
      imported: number;
      months: { skp: string; period: string; status: string; submittedAt?: string }[];
    }>("/robot/ekinerja/renaksi/sync", { method: "POST", body: { year } }),
  captureSession: (sessionId: string) => request<RobotRun>(`/robot/sessions/${sessionId}/capture`, { method: "POST" }),
  finish: (sessionId: string) => request<RobotConnector>(`/robot/sessions/${sessionId}/finish`, { method: "POST" }),
  cancel: (sessionId: string) => request<{ closed: boolean }>(`/robot/sessions/${sessionId}`, { method: "DELETE" }),
  runs: (system?: RobotSystem) => request<RobotRun[]>("/robot/runs", { query: system ? { system } : undefined }),
  run: (id: string) => request<RobotRun>(`/robot/runs/${id}`),
  screenshot: async (id: string) => {
    const response = await fetch(apiUrl(`/robot/runs/${id}/screenshot`), {
      headers: authHeader(),
      credentials: "include",
    });
    if (!response.ok) throw new Error(`Tangkapan layar tidak tersedia (status ${response.status}).`);
    return response.blob();
  },
  removeRun: (id: string) => request<{ success: boolean }>(`/robot/runs/${id}`, { method: "DELETE" }),
};

export const publicLinksApi = {
  list: (uploadId: string) => request<PublicLinkInfo[]>(`/uploads/${uploadId}/public-links`),
  create: (uploadId: string, input: { days?: number | null; label?: string }) =>
    request<PublicLinkInfo>(`/uploads/${uploadId}/public-links`, { method: "POST", body: input }),
  revoke: (id: string) => request<{ success: boolean }>(`/public-links/${id}`, { method: "DELETE" }),
};

/** Brankas digital bukti renaksi (pemilik). Isi tautan = `window.location.origin + path`. */
export const vaultsApi = {
  create: (input: { title: string; description?: string; entryId?: string; assetIds: string[] }) =>
    request<VaultDetail>("/vaults", { method: "POST", body: input }),
  get: (id: string) => request<VaultDetail>(`/vaults/${id}`),
  update: (id: string, input: { title?: string; description?: string; assetIds?: string[] }) =>
    request<VaultDetail>(`/vaults/${id}`, { method: "PATCH", body: input }),
  rotate: (id: string) => request<VaultDetail>(`/vaults/${id}/rotate`, { method: "POST" }),
  remove: (id: string) => request<{ success: boolean }>(`/vaults/${id}`, { method: "DELETE" }),
  accesses: (id: string) => request<VaultAccess[]>(`/vaults/${id}/accesses`),
};

/** Halaman publik brankas (tanpa login): setiap pembukaan & unduhan dicatat server. */
export const publicVaultApi = {
  /** `referrer` = document.referrer halaman brankas (situs tempat tautan diklik), hanya dicatat di log akses */
  open: (token: string, referrer?: string) =>
    request<PublicVaultView>(
      `/public/vaults/${encodeURIComponent(token)}${referrer ? `?ref=${encodeURIComponent(referrer.slice(0, 1000))}` : ""}`,
      { auth: false },
    ),
  fileUrl: (token: string, fileId: string, download = false) =>
    apiUrl(`/public/vaults/${encodeURIComponent(token)}/files/${fileId}${download ? "?download=1" : ""}`),
};
