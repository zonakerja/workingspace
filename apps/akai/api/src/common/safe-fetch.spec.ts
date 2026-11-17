import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSafeFetch } from "./safe-fetch";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/json" });
      return res.end();
    }
    if (req.url === "/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: satu\n\n");
      setTimeout(() => res.end("data: dua\n\n"), 20);
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(201, { "Content-Type": "application/json", "X-Uji": "ya" });
      res.end(JSON.stringify({ method: req.method, body, auth: req.headers.authorization ?? null }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe("safe-fetch", () => {
  it("menolak jaringan lokal (nama & IP) bila tidak diizinkan", async () => {
    const guarded = createSafeFetch(false);
    await expect(guarded(`${base}/json`)).rejects.toThrow(/jaringan lokal/);
    await expect(guarded("http://127.0.0.1:1/x")).rejects.toThrow(/jaringan lokal/);
    await expect(guarded("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/jaringan lokal/);
  });

  it("POST + header + jawaban JSON bila diizinkan", async () => {
    const f = createSafeFetch(true);
    const res = await f(`${base}/json`, { method: "POST", headers: { Authorization: "Bearer x" }, body: '{"a":1}' });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-uji")).toBe("ya");
    expect(await res.json()).toEqual({ method: "POST", body: '{"a":1}', auth: "Bearer x" });
  });

  it("pengalihan: follow / error, dan stream", async () => {
    const f = createSafeFetch(true);
    expect((await f(`${base}/redirect`)).status).toBe(201);
    await expect(f(`${base}/redirect`, { redirect: "error" })).rejects.toThrow(/Pengalihan/);
    const text = await (await f(`${base}/stream`)).text();
    expect(text).toBe("data: satu\n\ndata: dua\n\n");
  });

  it("AbortSignal membatalkan permintaan", async () => {
    const f = createSafeFetch(true);
    const controller = new AbortController();
    controller.abort();
    await expect(f(`${base}/json`, { signal: controller.signal })).rejects.toThrow();
  });
});
