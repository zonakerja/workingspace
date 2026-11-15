import type { IncomingMessage } from "node:http";
import https from "node:https";
import { safeLookup } from "../notebooks/web-source";
import { appFileUrlError, MAX_APP_FILE_BYTES } from "./app-file-logic";

const TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;

export class AppFileError extends Error {}

function get(url: URL): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    // Tanpa kredensial aplikasi: tautan ekspor bertanda tangan sudah cukup; token koneksi tidak pernah dikirim ke sini
    const req = https.get(
      url,
      { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { "User-Agent": "LifeOS/1.0" } },
      resolve,
    );
    req.on("timeout", () => req.destroy(new AppFileError("Aplikasi terlalu lama mengirim berkas.")));
    req.on("error", reject);
  });
}

/**
 * Unduh satu berkas hasil aplikasi MCP: https saja, host (juga setiap pengalihan) harus milik aplikasi itu, alamat IP
 * jaringan lokal ditolak saat koneksi (`safeLookup`), maks. `MAX_APP_FILE_BYTES`.
 */
export async function downloadAppFile(raw: string, hosts: string[]) {
  let current = raw;
  for (let redirects = 0; ; redirects++) {
    const error = appFileUrlError(current, hosts);
    if (error) throw new AppFileError(error);
    const url = new URL(current);
    const res = await get(url);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (redirects >= MAX_REDIRECTS) throw new AppFileError("Terlalu banyak pengalihan.");
      current = new URL(res.headers.location, url).toString();
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new AppFileError(
        `Berkas tidak dapat diambil (status ${status}). Tautan ekspor mungkin kedaluwarsa — ekspor ulang lalu coba lagi.`,
      );
    }
    const tooBig = `Berkas lebih dari ${MAX_APP_FILE_BYTES / 1024 / 1024} MB.`;
    if (Number(res.headers["content-length"] ?? 0) > MAX_APP_FILE_BYTES) {
      res.resume();
      throw new AppFileError(tooBig);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_APP_FILE_BYTES) {
        res.destroy();
        throw new AppFileError(tooBig);
      }
      chunks.push(chunk);
    }
    if (!size) throw new AppFileError("Berkas kosong.");
    return { url: current, contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) };
  }
}
