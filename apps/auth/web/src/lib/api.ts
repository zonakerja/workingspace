/** Klien API layanan SSO (same-origin: /api, /interaction). Cookie sesi httpOnly dikirim otomatis. */

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Pesan galat dari respons Nest: string, array pesan validasi, atau kosong. */
export function messageOf(body: unknown, fallback: string): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.map(String).join(" ");
  if (typeof message === "string" && message) return message;
  return fallback;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const fallback =
      res.status === 429 ? "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi." : "Permintaan gagal. Coba lagi.";
    throw new ApiError(res.status, messageOf(data, fallback), (data as { code?: string } | null)?.code);
  }
  return data as T;
}

export const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : "Terjadi kesalahan. Coba lagi.";

/** Masa akses aplikasi: active, read_only (habis, baca saja 180 hari), ended (data dihapus aplikasi). */
export interface AccessInfo {
  state: "active" | "read_only" | "ended";
  expiresAt: string | null;
  deleteAt: string | null;
}

export interface AppAccess {
  key: string;
  name: string;
  url: string;
  role: "admin" | "member";
  access: AccessInfo;
}

export interface Account {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  superAdmin: boolean;
  hasPassword: boolean;
  hasPin: boolean;
  google: boolean;
  phone: string | null;
  address: string | null;
  occupation: string | null;
  workplace: string | null;
  apps: AppAccess[];
}

export interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface InteractionInfo {
  app: { key: string; name: string };
  account: { name: string; email: string } | null;
  accessError: string | null;
}

export type AppRole = "admin" | "member";

export interface AdminAccount {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  disabled: boolean;
  superAdmin: boolean;
  hasPassword: boolean;
  google: boolean;
  phone: string | null;
  occupation: string | null;
  workplace: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  apps: Record<string, AppRole>;
  access: Record<string, AccessInfo>;
}

export interface AdminApp {
  key: string;
  name: string;
  url: string;
  description: string | null;
  selfSignup: AppRole | null;
  members: number;
}

export interface SecurityEventRow {
  id: string;
  event: string;
  ip: string | null;
  userAgent: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export type AccountStatus = "all" | "super" | "active" | "unverified" | "disabled";

export interface AdminStats {
  total: number;
  superAdmins: number;
  active30d: number;
  unverified: number;
  disabled: number;
  pendingRequests: number;
}

export interface CatalogApp {
  key: string;
  name: string;
  description: string | null;
  /** Diberikan otomatis saat mendaftar (tanpa pengajuan) */
  autoAccess: boolean;
}

export interface AccessRequestRow {
  id: string;
  appKey: string;
  appName: string;
  purpose: string;
  status: "pending" | "approved" | "rejected";
  role: AppRole | null;
  durationDays: number | null;
  note: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface AccessOverview {
  apps: {
    key: string;
    name: string;
    url: string;
    description: string | null;
    role: AppRole | null;
    access: AccessInfo | null;
    pendingRequestId: string | null;
    canRequest: boolean;
    requestBlock: string | null;
  }[];
  requests: AccessRequestRow[];
}

export interface AdminAccessRequest extends AccessRequestRow {
  account: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    occupation: string | null;
    workplace: string | null;
  };
  current: { role: AppRole; access: AccessInfo } | null;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone: string;
  occupation: string;
  workplace: string;
  address?: string;
  requests?: { appKey: string; purpose: string }[];
}

export const adminApi = {
  stats: () => request<AdminStats>("GET", "/api/admin/stats"),
  accounts: (q: string, page: number, size = 20, status: AccountStatus = "all") =>
    request<{ total: number; page: number; size: number; items: AdminAccount[] }>(
      "GET",
      `/api/admin/accounts?${new URLSearchParams({ q, page: String(page), size: String(size), status })}`,
    ),
  create: (body: {
    name: string;
    email: string;
    password?: string;
    superAdmin?: boolean;
    apps?: Record<string, AppRole>;
  }) => request<{ id: string; invited: boolean }>("POST", "/api/admin/accounts", body),
  update: (id: string, body: { name?: string; disabled?: boolean; superAdmin?: boolean }) =>
    request<{ success: boolean }>("PATCH", `/api/admin/accounts/${encodeURIComponent(id)}`, body),
  passwordLink: (id: string) =>
    request<{ message: string }>("POST", `/api/admin/accounts/${encodeURIComponent(id)}/password-link`),
  signOut: (id: string) => request<void>("POST", `/api/admin/accounts/${encodeURIComponent(id)}/sign-out`),
  /** `days`: lama akses dari sekarang (null = tanpa batas, undefined = tidak diubah) */
  setRole: (id: string, app: string, role: AppRole | null, days?: number | null) =>
    role
      ? request<{ success: boolean }>("PUT", `/api/admin/accounts/${encodeURIComponent(id)}/apps/${app}`, {
          role,
          ...(days !== undefined ? { days } : {}),
        })
      : request<void>("DELETE", `/api/admin/accounts/${encodeURIComponent(id)}/apps/${app}`),
  requests: (status: "pending" | "all") =>
    request<AdminAccessRequest[]>("GET", `/api/admin/access-requests?status=${status}`),
  approve: (id: string, body: { role: AppRole; days: number | null }) =>
    request<{ expiresAt: string | null }>("POST", `/api/admin/access-requests/${encodeURIComponent(id)}/approve`, body),
  reject: (id: string, note?: string) =>
    request<void>("POST", `/api/admin/access-requests/${encodeURIComponent(id)}/reject`, { note }),
  events: (id: string) => request<SecurityEventRow[]>("GET", `/api/admin/accounts/${encodeURIComponent(id)}/events`),
  apps: () => request<AdminApp[]>("GET", "/api/admin/apps"),
  updateApp: (key: string, body: { name?: string; url?: string; description?: string; selfSignup?: AppRole | null }) =>
    request<AdminApp>("PATCH", `/api/admin/apps/${key}`, body),
};

export interface PinStatus {
  hasPin: boolean;
  blockedUntil: string | null;
}

export const api = {
  pinStatus: () => request<PinStatus>("GET", "/api/pin"),
  setPin: (pin: string, password?: string) => request<PinStatus>("PUT", "/api/pin", { pin, password }),
  removePin: (password?: string) => request<PinStatus>("DELETE", "/api/pin", { password }),
  me: () => request<Account>("GET", "/api/auth/me"),
  login: (email: string, password: string) => request<Account>("POST", "/api/auth/login", { email, password }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  register: (body: RegisterInput) => request<{ message: string }>("POST", "/api/auth/register", body),
  accessCatalog: () => request<CatalogApp[]>("GET", "/api/access/apps"),
  access: () => request<AccessOverview>("GET", "/api/access"),
  requestAccess: (requests: { appKey: string; purpose: string }[]) =>
    request<AccessOverview>("POST", "/api/access/requests", { requests }),
  resendVerification: (email: string) =>
    request<{ message: string }>("POST", "/api/auth/resend-verification", { email }),
  verify: (token: string) => request<Account>("POST", "/api/auth/verify", { token }),
  forgot: (email: string) => request<{ message: string }>("POST", "/api/auth/forgot-password", { email }),
  reset: (token: string, password: string) => request<void>("POST", "/api/auth/reset-password", { token, password }),
  updateProfile: (body: { name?: string; phone?: string; address?: string; occupation?: string; workplace?: string }) =>
    request<Account>("PATCH", "/api/auth/me", body),
  changePassword: (current: string | undefined, password: string) =>
    request<void>("POST", "/api/auth/change-password", { current, password }),
  sessions: () => request<SessionRow[]>("GET", "/api/auth/sessions"),
  revokeSession: (id: string) => request<void>("DELETE", `/api/auth/sessions/${encodeURIComponent(id)}`),
  interaction: (uid: string) => request<InteractionInfo>("GET", `/interaction/${encodeURIComponent(uid)}/details`),
  interactionLogin: (uid: string, email: string, password: string) =>
    request<{ redirectTo: string }>("POST", `/interaction/${encodeURIComponent(uid)}/login`, { email, password }),
  interactionContinue: (uid: string) =>
    request<{ redirectTo: string }>("POST", `/interaction/${encodeURIComponent(uid)}/continue`),
  interactionAbort: (uid: string) =>
    request<{ redirectTo: string }>("POST", `/interaction/${encodeURIComponent(uid)}/abort`),
};
