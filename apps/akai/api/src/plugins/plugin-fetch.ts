import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { PLUGIN_LIMITS, hostAllowed, isPrivateAddress } from "./plugin-logic";

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
/** Header yang tidak boleh diatur plugin. */
const BLOCKED_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "cookie",
  "proxy-authorization",
]);

export interface PluginFetchOptions {
  hosts: string[];
  /** Luar production: izinkan http://localhost (uji & smoke). */
  allowLocal: boolean;
}

/**
 * `akai.fetch` untuk plugin: https saja, host wajib ada di izin manifest, alamat hasil DNS tidak boleh jaringan lokal (diperiksa di
 * `lookup` koneksi itu sendiri sehingga tidak bisa diakali DNS rebinding), pengalihan diikuti maks. 3 kali dengan pemeriksaan yang
 * sama, batas waktu & ukuran jawaban, maks. `maxFetches` per pemanggilan alat.
 */
export function createPluginFetch(options: PluginFetchOptions) {
  let count = 0;
  return async (rawUrl: string, initJson: string): Promise<string> => {
    if (++count > PLUGIN_LIMITS.maxFetches)
      throw new Error(`Batas ${PLUGIN_LIMITS.maxFetches} permintaan jaringan per pemanggilan alat terlampaui.`);
    let init: { method?: unknown; headers?: unknown; body?: unknown } = {};
    try {
      init = JSON.parse(initJson) as typeof init;
    } catch {
      // init rusak = GET tanpa header
    }
    const method = typeof init.method === "string" ? init.method.toUpperCase() : "GET";
    if (!METHODS.has(method)) throw new Error(`Metode tidak didukung: ${method}`);
    const headers: Record<string, string> = {};
    if (init.headers && typeof init.headers === "object")
      for (const [k, v] of Object.entries(init.headers as Record<string, unknown>))
        if (!BLOCKED_HEADERS.has(k.toLowerCase())) headers[k] = String(v);
    headers["user-agent"] ??= "Akai-Plugin/1.0";
    const body =
      init.body === undefined || init.body === null
        ? undefined
        : typeof init.body === "string"
          ? init.body
          : JSON.stringify(init.body);

    let url = parseUrl(rawUrl, options);
    for (let hop = 0; hop <= 3; hop++) {
      const res = await send(url, method, headers, hop === 0 ? body : undefined, options);
      if ([301, 302, 303, 307, 308].includes(res.status) && res.location) {
        if (hop === 3) throw new Error("Terlalu banyak pengalihan.");
        url = parseUrl(new URL(res.location, url).toString(), options);
        continue;
      }
      return JSON.stringify({ status: res.status, url: url.toString(), headers: res.headers, body: res.body });
    }
    throw new Error("Terlalu banyak pengalihan.");
  };
}

function parseUrl(raw: string, options: PluginFetchOptions) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Alamat tidak valid: ${raw.slice(0, 200)}`);
  }
  const local = options.allowLocal && url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error("Plugin hanya boleh memakai alamat https.");
  if (url.username || url.password) throw new Error("Alamat berisi kredensial tidak diizinkan.");
  if (!hostAllowed(url.hostname, options.hosts))
    throw new Error(`Host ${url.hostname} tidak ada di izin plugin (hosts).`);
  return url;
}

function safeLookup(options: PluginFetchOptions, hostname: string): LookupFunction {
  const local = options.allowLocal && hostname === "localhost";
  return (host, opts, callback) => {
    dnsLookup(host, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as unknown as LookupAddress[];
      const bad = list.find((a) => isPrivateAddress(a.address));
      if (bad && !local) return callback(new Error(`Alamat ${host} mengarah ke jaringan lokal (ditolak).`), "", 0);
      if (opts.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

function send(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  options: PluginFetchOptions,
) {
  return new Promise<{ status: number; headers: Record<string, string>; body: string; location?: string }>(
    (resolve, reject) => {
      const request = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = request(
        url,
        {
          method,
          headers: body === undefined ? headers : { ...headers, "content-length": String(Buffer.byteLength(body)) },
          lookup: safeLookup(options, url.hostname),
          timeout: PLUGIN_LIMITS.fetchTimeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > PLUGIN_LIMITS.responseBytes) {
              req.destroy(new Error(`Jawaban melebihi ${PLUGIN_LIMITS.responseBytes / 1_000_000} MB.`));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers))
              if (v !== undefined && k !== "set-cookie") out[k] = Array.isArray(v) ? v.join(", ") : v;
            resolve({
              status: res.statusCode ?? 0,
              headers: out,
              body: Buffer.concat(chunks).toString("utf8"),
              location: typeof res.headers.location === "string" ? res.headers.location : undefined,
            });
          });
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("Permintaan jaringan melewati batas waktu.")));
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    },
  );
}
