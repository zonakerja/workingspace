/** Klien Konektor MCP Akai (6b.5, docs/AKAI.md §8). */
import { request } from "./api";

export interface ConnectorTool {
  name: string;
  title: string | null;
  description: string;
  readOnly: boolean;
  destructive: boolean;
}

export interface Connector {
  id: string;
  name: string;
  slug: string;
  kind: "akasha" | "custom";
  /** Aplikasi katalog, null = alamat sendiri / Akasha */
  preset: string | null;
  authType: ConnectorAuth;
  url: string | null;
  /** OAuth: sudah punya izin dari aplikasi */
  authorized?: boolean;
  oauthClientId: string | null;
  hasClientSecret: boolean;
  oauthScope: string | null;
  hasToken: boolean;
  tokenHint: string | null;
  /** Konektor bawaan paket plugin (ikut dimatikan / dihapus bersama paketnya) */
  pluginId?: string | null;
  enabled: boolean;
  allowWrite: boolean;
  tools: ConnectorTool[];
  status: "new" | "connected" | "auth_required" | "error";
  statusMessage: string | null;
  checkedAt: string | null;
}

export type ConnectorAuth = "none" | "token" | "oauth";

/** Aplikasi katalog (sama dengan server connector-catalog.ts). */
export interface CatalogEntry {
  key: string;
  name: string;
  description: string;
  url: string;
  auth: ConnectorAuth;
  category: string;
  hint: string;
  group?: string;
  needsClient?: boolean;
  scope?: string;
}

export interface Catalog {
  categories: Record<string, string>;
  entries: CatalogEntry[];
  redirectUrl: string | null;
}

interface OAuthFields {
  authType?: ConnectorAuth;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScope?: string;
}

export const connectorsApi = {
  list: () =>
    request<{ akashaAvailable: boolean; redirectUrl: string | null; connectors: Connector[] }>(
      "GET",
      "/api/connectors",
    ),
  catalog: () => request<Catalog>("GET", "/api/connectors/catalog"),
  create: (
    body: { kind: "akasha" | "custom"; preset?: string; name?: string; url?: string; token?: string } & OAuthFields,
  ) => request<Connector>("POST", "/api/connectors", body),
  update: (
    id: string,
    body: { name?: string; enabled?: boolean; allowWrite?: boolean; token?: string; url?: string } & OAuthFields,
  ) => request<Connector>("PATCH", `/api/connectors/${id}`, body),
  /** OAuth → alamat halaman izin; lainnya → konektor setelah diuji */
  connect: (id: string) =>
    request<{ authorizationUrl?: string; connector?: Connector }>("POST", `/api/connectors/${id}/connect`),
  refresh: (id: string) => request<Connector>("POST", `/api/connectors/${id}/refresh`),
  remove: (id: string) => request<void>("DELETE", `/api/connectors/${id}`),
};

export type ToolAccess = "read" | "write" | "destructive";

/** Sama dengan server (`toolAccess` di connector-logic.ts). */
export const toolAccess = (t: Pick<ConnectorTool, "readOnly" | "destructive">): ToolAccess =>
  t.destructive ? "destructive" : t.readOnly ? "read" : "write";

/** Alat dipakai Akai? baca selalu, ubah bila diizinkan, hapus tidak pernah (sama dengan server `toolAllowed`). */
export const toolUsable = (t: Pick<ConnectorTool, "readOnly" | "destructive">, allowWrite: boolean) => {
  const access = toolAccess(t);
  return access === "read" || (access === "write" && allowWrite);
};
