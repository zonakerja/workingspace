import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { isPrivateAddress } from "../plugins/plugin-logic";

/**
 * `fetch` pengganti untuk permintaan keluar Akai ke alamat milik pengguna (router model, server MCP). Alamat hasil DNS diperiksa di
 * `lookup` koneksi itu sendiri — bukan sekadar tulisan host — sehingga domain publik yang menunjuk ke IP jaringan lokal (127.x,
 * 10.x, 169.254.169.254, …) ditolak dan tidak bisa diakali DNS rebinding. `allowPrivate` = boleh jaringan lokal (development, atau
 * alamat internal yang ditetapkan server seperti konektor Akasha `http://backend:4000`).
 * Mendukung yang dipakai SDK OpenAI/Anthropic, MCP SDK, dan gateway: metode, header, body string/biner/stream, AbortSignal,
 * `redirect` follow|manual|error (maks. 5, tiap lompatan diperiksa ulang), jawaban stream (SSE).
 */
export function createSafeFetch(allowPrivate: boolean): typeof fetch {
  const safeFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const req = input instanceof Request ? input : null;
    let url = new URL(req ? req.url : String(input));
    const method = (init.method ?? req?.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? req?.headers);
    // Tanpa kompresi: http.request tidak mendekompresi otomatis seperti fetch bawaan
    headers.delete("accept-encoding");
    headers.delete("host");
    const body = await bodyBuffer(
      init.body ?? (req && method !== "GET" && method !== "HEAD" ? await req.arrayBuffer() : null),
    );
    const signal = init.signal ?? req?.signal ?? undefined;
    const redirect = init.redirect ?? "follow";
    for (let hop = 0; hop <= 5; hop++) {
      const res = await send(url, method, headers, hop === 0 ? body : null, signal, allowPrivate);
      const location = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location && redirect !== "manual") {
        res.resume();
        if (redirect === "error") throw new TypeError(`Pengalihan ke ${location} tidak diizinkan.`);
        url = new URL(location, url);
        continue;
      }
      return toResponse(res);
    }
    throw new TypeError("Terlalu banyak pengalihan.");
  };
  return safeFetch as typeof fetch;
}

async function bodyBuffer(body: unknown): Promise<Buffer | null> {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (body instanceof ReadableStream) return Buffer.from(await new Response(body).arrayBuffer());
  throw new TypeError("Jenis body permintaan tidak didukung.");
}

function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (host, options, callback) => {
    dnsLookup(host, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as unknown as LookupAddress[];
      if (!allowPrivate && list.some((a) => isPrivateAddress(a.address)))
        return callback(new Error(`Alamat ${host} mengarah ke jaringan lokal (ditolak).`), "", 0);
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

function send(
  url: URL,
  method: string,
  headers: Headers,
  body: Buffer | null,
  signal: AbortSignal | undefined,
  allowPrivate: boolean,
) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    if (url.protocol !== "https:" && url.protocol !== "http:")
      return reject(new TypeError(`Protokol ${url.protocol} tidak didukung.`));
    // IP ditulis langsung (tanpa DNS) juga diperiksa
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (!allowPrivate && /^[\d.]+$|:/.test(literal) && isPrivateAddress(literal))
      return reject(new Error(`Alamat ${url.hostname} adalah jaringan lokal (ditolak).`));
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Dibatalkan", "AbortError"));
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    if (body) out["content-length"] = String(body.length);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, { method, headers: out, lookup: guardedLookup(allowPrivate) }, resolve);
    const onAbort = () =>
      req.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException("Dibatalkan", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => signal?.removeEventListener("abort", onAbort));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function toResponse(res: IncomingMessage): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  const status = res.statusCode ?? 502;
  const noBody = status === 204 || status === 205 || status === 304;
  if (noBody) res.resume();
  return new Response(noBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
    status,
    statusText: res.statusMessage,
    headers,
  });
}
