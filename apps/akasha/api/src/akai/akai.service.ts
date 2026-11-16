import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiAttachment } from "../ai/providers/ai-client";
import type { AiTask } from "../ai/ai-routing";
import { akaiMessage, akaiTaskFor, completionText, parseStatus, toAkaiMessages } from "./akai-logic";

/** Status model per tugas di Akai di-cache sebentar (Pengaturan di Akai web berlaku ≤ 30 dtk kemudian). */
const STATUS_TTL_MS = 30_000;
const CHAT_TIMEOUT_MS = 180_000;

/** Akun yang dipakai memanggil Akai (Akai mengenali akun dari sub SSO). */
export interface AkaiUser {
  ssoSubject: string | null;
  email?: string | null;
  name?: string | null;
}

/** Galat dari Akai: `status` = 429 (kuota) / 422 (lainnya); `unreachable` = Akai tidak dapat dihubungi. */
export class AkaiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly unreachable = false,
  ) {
    super(message);
  }
}

/**
 * Klien Akai API untuk Akasha (server ke server: HTTP Basic klien `akasha` + `X-Akai-Subject`). Dipakai `AiService` untuk
 * tugas teks yang sudah diatur pemilik di Akai web; env kosong / akun tanpa SSO = tidak pernah dipakai. docs/AKAI.md §4.
 */
@Injectable()
export class AkaiService {
  private readonly logger = new Logger(AkaiService.name);
  private readonly baseUrl?: string;
  private readonly auth?: string;
  readonly webUrl: string | null;
  private readonly statusCache = new Map<string, { at: number; value: Record<string, number> | null }>();

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>("AKAI_URL")?.replace(/\/+$/, "");
    const secret = config.get<string>("AKAI_CLIENT_SECRET");
    const id = config.get<string>("AKAI_CLIENT_ID") ?? "akasha";
    if (this.baseUrl && secret) this.auth = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
    this.webUrl = config.get<string>("AKAI_WEB_URL")?.replace(/\/+$/, "") ?? null;
  }

  get enabled() {
    return !!this.auth;
  }

  private headers(user: AkaiUser): Record<string, string> {
    return {
      Authorization: this.auth!,
      "X-Akai-Subject": user.ssoSubject!,
      ...(user.email ? { "X-Akai-Email": user.email } : {}),
      // Header HTTP hanya ASCII: nama beraksen diganti agar tidak ditolak fetch
      ...(user.name ? { "X-Akai-Name": user.name.replace(/[^\x20-\x7e]/g, "?").slice(0, 200) } : {}),
    };
  }

  /**
   * Jumlah model per tugas milik akun di Akai, atau null (Akai tidak aktif / akun tanpa SSO / Akai tidak dapat dihubungi).
   * `fresh` = abaikan cache (halaman Pengaturan).
   */
  async status(user: AkaiUser, fresh = false): Promise<Record<string, number> | null> {
    if (!this.enabled || !user.ssoSubject) return null;
    const cached = this.statusCache.get(user.ssoSubject);
    if (!fresh && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;
    let value: Record<string, number> | null = null;
    try {
      const res = await fetch(`${this.baseUrl}/gateway/v1/status`, {
        headers: this.headers(user),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) value = parseStatus(await res.json());
      else this.logger.warn(`Status Akai ${res.status}`);
    } catch (error) {
      this.logger.warn(`Akai tidak dapat dihubungi: ${String(error)}`);
    }
    this.statusCache.set(user.ssoSubject, { at: Date.now(), value });
    if (this.statusCache.size > 5000) this.statusCache.clear();
    return value;
  }

  /** Fitur AI umum bisa dipakai lewat Akai (tugas Umum atau Chat sudah punya model) — penanda `aiViaAkai` user. */
  async ready(user: AkaiUser): Promise<boolean> {
    const status = await this.status(user);
    return !!status && ((status.general ?? 0) > 0 || (status.chat ?? 0) > 0);
  }

  /** Tugas ini dijawab lewat Akai? (akun sudah mengatur model untuk tugas itu di Akai) */
  async handles(user: AkaiUser, task: AiTask): Promise<boolean> {
    const akaiTask = akaiTaskFor(task);
    if (!akaiTask) return false;
    const status = await this.status(user);
    return !!status && (status[akaiTask] ?? 0) > 0;
  }

  /**
   * Jawab prompt lewat gateway Akai (model & cadangan dipilih Akai menurut pembagian tugas akun). null = lampiran tidak bisa
   * lewat gateway (audio). Galat → `AkaiError`.
   */
  async generate(user: AkaiUser, task: AiTask, prompt: string, attachments: AiAttachment[]) {
    const messages = toAkaiMessages(prompt, attachments);
    if (!messages) return null;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/gateway/v1/chat/completions`, {
        method: "POST",
        headers: { ...this.headers(user), "Content-Type": "application/json" },
        body: JSON.stringify({ task: akaiTaskFor(task), messages }),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`Akai tidak dapat dihubungi: ${String(error)}`);
      throw new AkaiError(422, "Akai tidak dapat dihubungi. Coba lagi sebentar.", true);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new AkaiError(res.status === 429 ? 429 : 422, akaiMessage(body, res.status));
    const text = completionText(body);
    if (!text) throw new AkaiError(422, "Akai: model tidak memberikan jawaban.");
    const decode = (value: string | null) => (value ? decodeURIComponent(value) : null);
    return {
      text,
      model: decode(res.headers.get("x-akai-model")) ?? String((body as { model?: unknown }).model ?? "akai"),
      fallbackFrom: decode(res.headers.get("x-akai-fallback-from")),
    };
  }
}
