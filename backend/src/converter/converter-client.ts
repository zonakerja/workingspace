import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ConverterEngine, ConverterMode, ConverterPdfMode } from "./converter-logic";

/** Docling membaca scan per halaman di CPU → satu berkas besar bisa beberapa menit. */
const CONVERT_TIMEOUT_MS = 15 * 60_000;

export interface ConverterResult {
  markdown: string;
  engine: ConverterEngine;
  reason: string;
  fallbackFrom: ConverterEngine | null;
  pages: number | null;
  chars: number;
  rawChars: number;
  tokens: number;
  warnings: string[];
  durationMs: number;
}

export interface ConverterHealth {
  ok: boolean;
  ready: boolean;
  engines: Record<string, string>;
  ocrLanguages: string[];
  maxMb: number;
  doclingMaxPages: number;
  converted: number;
}

/** Service tidak menyala / tidak terjangkau → pemanggil memakai pembaca bawaan. */
export class ConverterUnavailableError extends Error {}
/** Service menolak berkas (format, ukuran, isi rusak) → pesan untuk user. */
export class ConverterRejectedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Klien HTTP ke service converter (container `converter`, `converter/app/main.py`). */
@Injectable()
export class ConverterClient {
  constructor(private readonly config: ConfigService) {}

  get configured() {
    return !!(this.config.get<string>("CONVERTER_URL") && this.config.get<string>("CONVERTER_TOKEN"));
  }

  get maxBytes() {
    return this.config.getOrThrow<number>("CONVERTER_MAX_MB") * 1024 * 1024;
  }

  private get base() {
    return this.config.get<string>("CONVERTER_URL")!.replace(/\/+$/, "");
  }

  async health(): Promise<ConverterHealth | null> {
    if (!this.configured) return null;
    try {
      const response = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(3_000) });
      return response.ok ? ((await response.json()) as ConverterHealth) : null;
    } catch {
      return null;
    }
  }

  async convert(
    data: Buffer,
    fileName: string,
    mimeType: string,
    options: { mode?: ConverterMode; pdfMode?: ConverterPdfMode } = {},
  ): Promise<ConverterResult> {
    if (!this.configured) throw new ConverterUnavailableError("Service converter belum diatur.");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: mimeType || "application/octet-stream" }), "berkas");
    form.append("filename", fileName);
    form.append("mime_type", mimeType);
    form.append("mode", options.mode ?? "auto");
    form.append("pdf_mode", options.pdfMode ?? "auto");
    let response: Response;
    try {
      response = await fetch(`${this.base}/convert`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.get<string>("CONVERTER_TOKEN")}` },
        body: form,
        signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ConverterUnavailableError(
        `Service converter tidak dapat dihubungi: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.ok) return (await response.json()) as ConverterResult;
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : `HTTP ${response.status}`;
    // 401 = token salah, ≥ 500 = service bermasalah → anggap tidak tersedia (pakai pembaca bawaan)
    if (response.status === 401 || response.status >= 500) {
      throw new ConverterUnavailableError(`Service converter: ${detail}`);
    }
    throw new ConverterRejectedError(detail, response.status);
  }
}
