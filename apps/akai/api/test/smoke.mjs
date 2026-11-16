// Smoke test Akai API (jalankan saat API menyala): node test/smoke.mjs
// Env: AKAI_URL (bawaan http://localhost:4400), AKAI_ENV (bawaan .env di folder ini; dibaca untuk AKAI_CLIENTS & DATABASE_URL).
// Memakai router tiruan lokal (tanpa key sungguhan), akun sementara smoke-akai-* yang dihapus di akhir.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const HERE = resolve(import.meta.dirname, "..");
const BASE = (process.env.AKAI_URL ?? "http://localhost:4400").replace(/\/+$/, "");
const env = Object.fromEntries(
  readFileSync(process.env.AKAI_ENV ?? join(HERE, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^(['"])(.*)\1$/, "$2")];
    }),
);
const client = JSON.parse(env.AKAI_CLIENTS)[0];
const BASIC = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`;

let failed = 0;
const ok = (name, cond, info) => {
  if (cond) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}`, info === undefined ? "" : JSON.stringify(info).slice(0, 400));
  }
};

// ---------------------------------------------------------------- router tiruan (OpenAI-compatible GET /v1/models)
const ROUTER_KEY = "sk-router-tiruan-0123456789";
const router = createServer((req, res) => {
  if (req.url !== "/v1/models") return res.writeHead(404).end();
  if (req.headers.authorization !== `Bearer ${ROUTER_KEY}`) return res.writeHead(401).end('{"error":"bad key"}');
  res.writeHead(200, { "Content-Type": "application/json" }).end(
    JSON.stringify({
      data: [
        {
          id: "deepseek/deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          context_length: 128000,
          pricing: { prompt: "0.00000027", completion: "0.0000011" },
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
          supported_parameters: ["tools"],
        },
        { id: "vision-model", architecture: { input_modalities: ["text", "image"] } },
        { id: "text-embedding-4" },
      ],
    }),
  );
});
await new Promise((r) => router.listen(0, "127.0.0.1", r));
const ROUTER_URL = `http://127.0.0.1:${router.address().port}/v1`;

/**
 * Router tiruan gateway: /a (OpenAI, menjawab + stream + embedding), /b (kuota habis 429), /c (format Anthropic),
 * /d (key ditolak 401). Menghitung panggilan per router.
 */
async function setupGateway() {
  const counts = { a: 0, b: 0, c: 0, d: 0 };
  let streamUsageAsked = false;
  let anthropicSystem = null;
  let embedDims = null;
  const server = createServer(async (req, res) => {
    const [, name, , ...rest] = req.url.split("/");
    const path = `/${rest.join("/")}`;
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    counts[name] = (counts[name] ?? 0) + 1;
    const json = (status, data) =>
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
    if (name === "b") return json(429, { error: { message: "quota exceeded" } });
    if (name === "d") return json(401, { error: { message: "invalid api key" } });
    if (name === "c" && path === "/messages") {
      if (req.headers["x-api-key"] !== "sk-router-c-000000000000") return json(401, { error: { message: "bad" } });
      anthropicSystem = body.system ?? null;
      return json(200, {
        id: "msg_1",
        content: [{ type: "text", text: "jawaban C" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 3 },
      });
    }
    if (name === "a" && path === "/chat/completions") {
      if (body.stream) {
        streamUsageAsked = body.stream_options?.include_usage === true;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = (delta, extra = {}) =>
          `data: ${JSON.stringify({ id: "s1", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;
        res.write(chunk({ role: "assistant", content: "jaw" }));
        res.write(chunk({ content: "aban A" }));
        res.write(
          `data: ${JSON.stringify({ id: "s1", choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } })}\n\n`,
        );
        return res.end("data: [DONE]\n\n");
      }
      return json(200, {
        id: "c1",
        object: "chat.completion",
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "jawaban A" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 2 },
      });
    }
    if (name === "a" && path === "/embeddings") {
      embedDims = body.dimensions ?? null;
      const list = Array.isArray(body.input) ? body.input : [body.input];
      return json(200, {
        object: "list",
        data: list.map((_, index) => ({ object: "embedding", index, embedding: Array(768).fill(0.01) })),
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });
    }
    json(404, { error: { message: "not found" } });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    url: (name) => `http://127.0.0.1:${port}/${name}/v1`,
    calls: (name) => counts[name] ?? 0,
    lastStreamUsageAsked: () => streamUsageAsked,
    lastAnthropicSystem: () => anthropicSystem,
    lastEmbedDims: () => embedDims,
    close: () => server.close(),
  };
}

const stamp = Date.now();
const call = async (method, path, body, subject = `smoke-akai-${stamp}`, auth = BASIC) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(auth ? { Authorization: auth } : {}),
      ...(subject ? { "X-Akai-Subject": subject, "X-Akai-Email": `${subject}@example.test` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let d = text;
  try {
    d = JSON.parse(text);
  } catch {}
  return { s: res.status, d };
};

try {
  let r = await fetch(`${BASE}/api/health`).then(async (x) => ({ s: x.status, d: await x.json() }));
  ok("health", r.s === 200 && r.d.checks.database === "up", r);

  r = await call("GET", "/api/sources", undefined, `smoke-akai-${stamp}`, null);
  ok("no app credentials 401", r.s === 401, r);
  r = await call(
    "GET",
    "/api/sources",
    undefined,
    `smoke-akai-${stamp}`,
    `Basic ${Buffer.from("akasha:salah").toString("base64")}`,
  );
  ok("wrong app secret 401", r.s === 401, r);
  r = await call("GET", "/api/sources", undefined, null);
  ok("missing subject 400", r.s === 400, r);

  // ---------------------------------------------------------------- sesi web (6a.3), tanpa masuk SSO sungguhan
  {
    const raw = (path, init = {}) => fetch(`${BASE}${path}`, { redirect: "manual", ...init });
    let x = await raw("/api/me");
    ok("web: me without session 401", x.status === 401);
    x = await raw("/api/me", { headers: { Cookie: "akai_sid=palsu" } });
    ok("web: unknown session 401", x.status === 401);
    x = await raw("/api/sources/x", { method: "DELETE", headers: { Cookie: "akai_sid=palsu" } });
    ok("web: write without X-Akai-Web 403", x.status === 403);
    const config = await raw("/api/auth/config").then((y) => y.json());
    if (config.sso) {
      x = await raw("/api/auth/sso/start?returnTo=%2Fmodels");
      const location = x.headers.get("location") ?? "";
      ok(
        "web: start redirects to SSO with PKCE + flow cookie",
        x.status === 302 &&
          location.includes("client_id=akai") &&
          location.includes("code_challenge=") &&
          (x.headers.get("set-cookie") ?? "").includes("akai_sso="),
        location,
      );
      x = await raw("/api/auth/sso/callback?code=x&state=y");
      ok(
        "web: callback without flow cookie → /login error",
        x.status === 302 && (x.headers.get("location") ?? "").startsWith("/login?"),
        x.headers.get("location"),
      );
      x = await raw("/api/auth/sso/callback?error=login_required");
      ok(
        "web: silent miss → /login?sso_checked=1",
        x.headers.get("location") === "/login?sso_checked=1",
        x.headers.get("location"),
      );
      x = await raw("/api/auth/sso/backchannel-logout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "logout_token=bukan.token.sah",
      });
      ok("web: invalid logout token 400", x.status === 400);
    } else console.log("SKIP web SSO (SSO_* belum diisi)");
  }

  r = await call("POST", "/api/sources", { kind: "router", preset: "custom", baseUrl: ROUTER_URL, apiKey: ROUTER_KEY });
  ok("create router source (key not returned)", r.s === 201 && r.d.keyHint === "6789" && !("keyEnc" in r.d), r.d);
  const sourceId = r.d.id;
  r = await call("POST", "/api/sources", { kind: "router", preset: "custom", baseUrl: "ftp://x", apiKey: ROUTER_KEY });
  ok("invalid base url 400", r.s === 400, r);

  r = await call("POST", `/api/sources/${sourceId}/test`);
  ok("test connection ok", r.s === 200 && r.d.ok === true && r.d.models === 3, r.d);

  r = await call("POST", `/api/sources/${sourceId}/catalog`);
  ok("refresh catalog", r.s === 200 && r.d.count === 3, r.d);
  r = await call("GET", `/api/sources/${sourceId}/catalog`);
  const deepseek = Array.isArray(r.d) && r.d.find((e) => e.modelId === "deepseek/deepseek-v4-flash");
  ok(
    "catalog prices per 1M tokens",
    deepseek?.priceIn === 0.27 && deepseek?.priceOut === 1.1 && deepseek?.tools,
    deepseek,
  );

  r = await call("POST", "/api/models", { sourceId, modelId: "deepseek/deepseek-v4-flash" });
  ok("enable model from catalog", r.s === 201 && r.d.label === "DeepSeek V4 Flash" && r.d.tools === true, r.d);
  const chatModel = r.d.id;
  r = await call("POST", "/api/models", { sourceId, modelId: "text-embedding-4" });
  const embedModel = r.d.id;
  ok("enable embedding model", r.s === 201 && r.d.embedding === true, r.d);
  r = await call("POST", "/api/models", { sourceId, modelId: "deepseek/deepseek-v4-flash" });
  ok("duplicate model 400", r.s === 400, r);

  r = await call("PUT", "/api/tasks/chat", { modelIds: [chatModel] });
  ok("set chat task", r.s === 200 && r.d.modelIds[0] === chatModel, r.d);
  r = await call("PUT", "/api/tasks/embedding", { modelIds: [chatModel] });
  ok("embedding task refuses chat model 400", r.s === 400, r);
  r = await call("PUT", "/api/tasks/embedding", { modelIds: [embedModel] });
  ok("set embedding task", r.s === 200, r);
  r = await call("PUT", "/api/tasks/tidakada", { modelIds: [] });
  ok("unknown task 404", r.s === 404, r);

  // Isolasi akun: akun lain tidak melihat / mengubah sumber ini
  r = await call("GET", "/api/sources", undefined, `smoke-akai-${stamp}-b`);
  ok("other account sees nothing", r.s === 200 && Array.isArray(r.d) && r.d.length === 0, r.d);
  r = await call("POST", `/api/sources/${sourceId}/test`, undefined, `smoke-akai-${stamp}-b`);
  ok("other account cannot use source 404", r.s === 404, r);

  r = await call("PATCH", `/api/sources/${sourceId}`, { baseUrl: "http://127.0.0.1:9/v1" });
  ok("change address without new key 400", r.s === 400, r);
  r = await call("PATCH", `/api/sources/${sourceId}`, { apiKey: "sk-kunci-salah-000000" });
  r = await call("POST", `/api/sources/${sourceId}/test`);
  ok("wrong key → test reports rejected", r.s === 200 && r.d.ok === false && /ditolak/.test(r.d.error), r.d);

  r = await call("PATCH", `/api/models/${chatModel}`, { enabled: false });
  r = await call("GET", "/api/tasks");
  const chatTask = Array.isArray(r.d) && r.d.find((t) => t.task === "chat");
  ok("disabled model removed from task", chatTask && chatTask.modelIds.length === 0, chatTask);

  r = await call("DELETE", `/api/sources/${sourceId}`);
  ok("delete source", r.s === 204, r);
  r = await call("GET", "/api/models");
  ok("models removed with source", Array.isArray(r.d) && r.d.length === 0, r.d);
  // ---------------------------------------------------------------- gateway (6a.2)
  const gw = await setupGateway();
  const mk = async (url, key, format = "openai", label) =>
    (
      await call("POST", "/api/sources", {
        kind: "router",
        preset: "custom",
        baseUrl: url,
        apiKey: key,
        apiFormat: format,
        label,
      })
    ).d.id;
  const srcA = await mk(gw.url("a"), "sk-router-a-000000000000", "openai", "Router A");
  const srcB = await mk(gw.url("b"), "sk-router-b-000000000000", "openai", "Router B");
  const srcC = await mk(gw.url("c"), "sk-router-c-000000000000", "anthropic", "Router C");
  const srcD = await mk(gw.url("d"), "sk-router-d-000000000000", "openai", "Router D");
  const add = async (sourceId, modelId, extra = {}) =>
    (await call("POST", "/api/models", { sourceId, modelId, ...extra })).d.id;
  const mA = await add(srcA, "model-a", { tools: true });
  const mB = await add(srcB, "model-b");
  const mC = await add(srcC, "claude-x");
  const mD = await add(srcD, "model-d");
  const mE = await add(srcA, "embed-a", { embedding: true });

  r = await call("POST", "/gateway/v1/chat/completions", {
    task: "chat",
    messages: [{ role: "user", content: "hai" }],
  });
  ok("no model for task → 422", r.s === 422 && /Atur di Akai/.test(r.d.message), r);

  await call("PUT", "/api/tasks/chat", { modelIds: [mB, mA] });
  const chat = async (body) => {
    const res = await fetch(`${BASE}/gateway/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: BASIC, "X-Akai-Subject": `smoke-akai-${stamp}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let d = text;
    try {
      d = JSON.parse(text);
    } catch {}
    return { s: res.status, d, h: res.headers, text };
  };
  r = await chat({ task: "chat", messages: [{ role: "user", content: "hai" }] });
  ok(
    "quota on primary → backup answers",
    r.s === 200 &&
      r.d.choices?.[0]?.message?.content === "jawaban A" &&
      decodeURIComponent(r.h.get("x-akai-fallback-from") ?? "") === "model-b",
    { s: r.s, d: r.d, from: r.h.get("x-akai-fallback-from") },
  );

  await call("PUT", "/api/tasks/general", { modelIds: [mA] });
  r = await chat({ messages: [{ role: "user", content: "hai" }], stream: true });
  ok(
    "stream passthrough (default task general)",
    r.s === 200 &&
      r.text.includes('"content":"jaw"') &&
      r.text.trim().endsWith("data: [DONE]") &&
      gw.lastStreamUsageAsked(),
    r.text.slice(0, 200),
  );

  await call("PUT", "/api/tasks/agent", { modelIds: [mC] });
  r = await chat({
    task: "agent",
    messages: [
      { role: "system", content: "Singkat." },
      { role: "user", content: "hai" },
    ],
  });
  ok(
    "anthropic-format source translated both ways",
    r.s === 200 &&
      r.d.choices?.[0]?.message?.content === "jawaban C" &&
      r.d.usage?.prompt_tokens === 12 &&
      gw.lastAnthropicSystem() === "Singkat.",
    r.d,
  );
  r = await chat({ task: "agent", messages: [{ role: "user", content: "hai" }], stream: true });
  ok("stream carries X-Akai-Model", r.h.get("x-akai-model") === "claude-x", r.h.get("x-akai-model"));
  ok(
    "anthropic-format stream as SSE",
    r.s === 200 && r.text.includes("jawaban C") && r.text.includes("[DONE]"),
    r.text.slice(0, 200),
  );

  r = await chat({
    task: "chat",
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }],
  });
  ok("image without vision model → 422", r.s === 422 && /gambar/.test(r.d.message), r.d);

  await call("PUT", "/api/tasks/document", { modelIds: [mD, mA] });
  const callsA = gw.calls("a");
  r = await chat({ task: "document", messages: [{ role: "user", content: "hai" }] });
  ok(
    "rejected key → no fallback, 422 (never 401)",
    r.s === 422 && /ditolak/.test(r.d.message) && gw.calls("a") === callsA,
    r.d,
  );

  r = await chat({ model: "model-a", messages: [{ role: "user", content: "hai" }] });
  ok("explicit model by id", r.s === 200 && r.d.model === "model-a", r.d);
  r = await chat({ model: "tidak-ada", messages: [{ role: "user", content: "hai" }] });
  ok("unknown explicit model 422", r.s === 422, r.d);

  await call("PUT", "/api/tasks/embedding", { modelIds: [mE] });
  r = await call("POST", "/gateway/v1/embeddings", { input: ["satu", "dua"] });
  ok(
    "embeddings 768 dims",
    r.s === 200 && r.d.data?.length === 2 && r.d.data[0].embedding.length === 768 && gw.lastEmbedDims() === 768,
    { s: r.s, n: r.d?.data?.length },
  );

  r = await call("GET", "/gateway/v1/status");
  const statusChat = r.d?.tasks?.find((t) => t.task === "chat");
  ok("status counts models per task", r.s === 200 && statusChat?.models === 2, r.d);

  {
    const db = new pg.Client({ connectionString: env.DATABASE_URL.replace(/\?schema=public$/, "") });
    await db.connect();
    const rows = (
      await db.query(
        "SELECT u.ok, u.fallback_from, u.input_tokens, u.error FROM ai_usage u JOIN accounts a ON a.id = u.account_id WHERE a.sso_subject = $1",
        [`smoke-akai-${stamp}`],
      )
    ).rows;
    await db.end();
    ok(
      "usage logged (fails, fallback, tokens)",
      rows.some((x) => !x.ok && /Kuota/.test(x.error ?? "")) &&
        rows.some((x) => x.ok && x.fallback_from === "model-b") &&
        rows.some((x) => x.ok && x.input_tokens === 7),
      rows.slice(0, 5),
    );
  }
  gw.close();
} finally {
  router.close();
  const db = new pg.Client({ connectionString: env.DATABASE_URL.replace(/\?schema=public$/, "") });
  await db.connect();
  const del = await db.query("DELETE FROM accounts WHERE sso_subject LIKE $1", [`smoke-akai-${stamp}%`]);
  await db.end();
  ok("cleanup smoke accounts", del.rowCount >= 1, del.rowCount);
}

if (failed) {
  console.log(`\n${failed} test gagal`);
  process.exit(1);
}
console.log("\nSemua test lulus");
