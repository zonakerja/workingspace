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
  url: string | null;
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

export const connectorsApi = {
  list: () => request<{ akashaAvailable: boolean; connectors: Connector[] }>("GET", "/api/connectors"),
  create: (body: { kind: "akasha" | "custom"; name?: string; url?: string; token?: string }) =>
    request<Connector>("POST", "/api/connectors", body),
  update: (
    id: string,
    body: { name?: string; enabled?: boolean; allowWrite?: boolean; token?: string; url?: string },
  ) => request<Connector>("PATCH", `/api/connectors/${id}`, body),
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
