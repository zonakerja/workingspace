/** Klien Proyek Akai (6b.2, docs/AKAI.md §8). */
import { ApiError, request } from "./api";
import type { ConversationSummary } from "./chat";

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  instructions: string;
  files: number;
  conversations: number;
  updatedAt: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  chars: number;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  updatedAt: string;
  files: ProjectFile[];
  conversations: ConversationSummary[];
}

/** Pengetahuan sampai batas ini dikirim utuh; lebih besar → potongan relevan (sama dengan server). */
export const FULL_KNOWLEDGE_CHARS = 120_000;
export const PROJECT_MAX_CHARS = 2_000_000;

export const projectsApi = {
  list: () => request<ProjectSummary[]>("GET", "/api/projects"),
  create: (body: { name: string; description?: string; instructions?: string }) =>
    request<Project>("POST", "/api/projects", body),
  get: (id: string) => request<Project>("GET", `/api/projects/${id}`),
  update: (id: string, body: { name?: string; description?: string; instructions?: string }) =>
    request<Project>("PATCH", `/api/projects/${id}`, body),
  remove: (id: string) => request<void>("DELETE", `/api/projects/${id}`),
  removeFile: (id: string, fileId: string) => request<void>("DELETE", `/api/projects/${id}/files/${fileId}`),
  async addFile(id: string, file: File): Promise<ProjectFile & { truncated: boolean }> {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch(`/api/projects/${id}/files`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Akai-Web": "1" },
        body: form,
      });
    } catch {
      throw new ApiError(0, "Server Akai tidak dapat dihubungi.");
    }
    const data = (await res.json().catch(() => null)) as { message?: unknown } | null;
    if (!res.ok) {
      const message = Array.isArray(data?.message) ? data.message.join(" ") : data?.message;
      throw new ApiError(res.status, typeof message === "string" ? message : "Berkas gagal diunggah.");
    }
    return data as ProjectFile & { truncated: boolean };
  },
};

/** Ringkas jumlah karakter (± token = karakter / 4). */
export const formatChars = (chars: number) =>
  chars >= 1_000_000
    ? `${(chars / 1_000_000).toFixed(1)} jt`
    : chars >= 1000
      ? `${Math.round(chars / 1000)} rb`
      : `${chars}`;
