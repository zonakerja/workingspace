// Smoke test Akai API (jalankan saat API menyala): node test/smoke.mjs
// Env: AKAI_URL (bawaan http://localhost:4400), AKAI_ENV (bawaan .env di folder ini; dibaca untuk AKAI_CLIENTS & DATABASE_URL).
// Memakai router tiruan lokal (tanpa key sungguhan), akun sementara smoke-akai-* yang dihapus di akhir.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

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
  let anthropicBody = null;
  let replayedThinking = null;
  let embedDims = null;
  let lastChatBody = null;
  const server = createServer(async (req, res) => {
    const [, name, , ...rest] = req.url.split("?")[0].split("/");
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
      anthropicBody = body;
      if (body.stream) {
        // SDK Anthropic (jalur agen) selalu streaming: event SSE Messages API
        const last = body.messages.at(-1);
        const toolTurn = Array.isArray(last?.content) && last.content.some((b) => b.type === "tool_result");
        if (toolTurn) {
          const assistant = body.messages.at(-2);
          replayedThinking = Array.isArray(assistant?.content)
            ? (assistant.content.find((b) => b.type === "thinking")?.signature ?? null)
            : null;
        }
        const useTool = !toolTurn && Array.isArray(body.tools) && body.tools.length > 0;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const ev = (type, data) =>
          res.write(`event: ${type}
data: ${JSON.stringify({ type, ...data })}

`);
        ev("message_start", {
          message: {
            id: "msg_s",
            type: "message",
            role: "assistant",
            model: body.model,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 },
          },
        });
        if (useTool) {
          ev("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
          ev("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "pikir" } });
          ev("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig-123" } });
          ev("content_block_stop", { index: 0 });
          ev("content_block_start", {
            index: 1,
            content_block: { type: "tool_use", id: "toolu_1", name: "cari", input: {} },
          });
          ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"q":"x"}' } });
          ev("content_block_stop", { index: 1 });
        } else {
          ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
          ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "jawaban " } });
          ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "C" } });
          ev("content_block_stop", { index: 0 });
        }
        ev("message_delta", { delta: { stop_reason: useTool ? "tool_use" : "end_turn" }, usage: { output_tokens: 3 } });
        ev("message_stop", {});
        return res.end();
      }
      return json(200, {
        id: "msg_1",
        content: [{ type: "text", text: "jawaban C" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 3 },
      });
    }
    if (name === "a" && path === "/chat/completions") {
      lastChatBody = body;
      if (body.stream) {
        streamUsageAsked = body.stream_options?.include_usage === true;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = (delta, extra = {}) =>
          `data: ${JSON.stringify({ id: "s1", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;
        const lastMsg = body.messages?.at(-1);
        const searchTool = (body.tools ?? []).find((t) => t.function?.name?.endsWith("__cari_catatan"));
        const skillTool = (body.tools ?? []).find((t) => t.function?.name === "akai__skill");
        const skillAsk = /UJI-SKILL ([a-z0-9-]+)/.exec(JSON.stringify(lastMsg?.role === "user" ? lastMsg.content : ""));
        if (skillTool && skillAsk) {
          res.write(
            chunk({
              tool_calls: [
                {
                  index: 0,
                  id: "call_skill",
                  type: "function",
                  function: { name: "akai__skill", arguments: JSON.stringify({ name: skillAsk[1] }) },
                },
              ],
            }),
          );
          return res.end("data: [DONE]\n\n");
        }
        if (lastMsg?.role === "tool") {
          res.write(chunk({ content: `Hasil alat: ${lastMsg.content}` }));
          return res.end("data: [DONE]\n\n");
        }
        if (searchTool) {
          res.write(chunk({ content: "Saya cek dulu." }));
          res.write(
            chunk({
              tool_calls: [
                {
                  index: 0,
                  id: "call_s1",
                  type: "function",
                  function: { name: searchTool.function.name, arguments: '{"q":' },
                },
              ],
            }),
          );
          res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: '"alfa"}' } }] }));
          return res.end("data: [DONE]\n\n");
        }
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
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              // Prompt pencatat memori (6b.3) → jawaban JSON
              content: JSON.stringify(body.messages ?? []).includes("memori_sekarang")
                ? '{"add": ["Pengguna bekerja sebagai penguji smoke Akai."], "remove": []}'
                : "jawaban A",
            },
            finish_reason: "stop",
          },
        ],
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
    lastChatBody: () => lastChatBody,
    lastAnthropicBody: () => anthropicBody,
    lastReplayedThinking: () => replayedThinking,
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

  r = await call("POST", `/api/sources/${sourceId}/clone`, { apiFormat: "anthropic" });
  ok(
    "clone router source to anthropic (key copied)",
    r.s === 201 && r.d.apiFormat === "anthropic" && r.d.keyHint === "6789" && !("keyEnc" in r.d),
    r.d,
  );
  const cloneId = r.d.id;
  r = await call("POST", `/api/sources/${sourceId}/clone`, { apiFormat: "anthropic" });
  ok("clone duplicate format 400", r.s === 400, r);
  r = await call("POST", `/api/sources/${sourceId}/clone`, { apiFormat: "openai" });
  ok("clone same format 400", r.s === 400, r);
  await call("DELETE", `/api/sources/${cloneId}`);

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

  await call("PUT", "/api/tasks/document", { modelIds: [mC] });
  r = await chat({
    task: "document",
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
  r = await chat({ task: "document", messages: [{ role: "user", content: "hai" }], stream: true });
  ok("stream carries X-Akai-Model", r.h.get("x-akai-model") === "claude-x", r.h.get("x-akai-model"));
  ok(
    "anthropic-format stream as SSE",
    r.s === 200 && r.text.includes("jawaban C") && r.text.includes("[DONE]"),
    r.text.slice(0, 200),
  );

  // Tugas Agen: Messages API native lewat SDK (cache per blok, pemikiran antar giliran, stream sungguhan), cadangan dari /b
  await call("PUT", "/api/tasks/agent", { modelIds: [mB, mC] });
  r = await chat({
    task: "agent",
    store: false,
    messages: [
      { role: "system", content: "Singkat." },
      { role: "user", content: "hai" },
    ],
  });
  const agentSystem = gw.lastAnthropicSystem();
  ok(
    "agent: native Claude via backup (cache marks, usage with cache)",
    r.s === 200 &&
      r.d.choices?.[0]?.message?.content === "jawaban C" &&
      Array.isArray(agentSystem) &&
      agentSystem[0]?.cache_control?.type === "ephemeral" &&
      r.d.usage?.prompt_tokens === 100 &&
      r.d.usage?.prompt_tokens_details?.cached_tokens === 90 &&
      decodeURIComponent(r.h.get("x-akai-fallback-from") ?? "") === "model-b" &&
      !("store" in (gw.lastAnthropicBody() ?? {})),
    { s: r.s, d: r.d, system: agentSystem },
  );
  r = await chat({ task: "agent", messages: [{ role: "user", content: "hai" }], stream: true });
  ok(
    "agent: real SSE stream",
    r.s === 200 &&
      r.text.includes('"content":"jawaban "') &&
      r.text.includes("[DONE]") &&
      r.text.includes('"cached_tokens":90'),
    r.text.slice(0, 300),
  );
  const tools = [{ type: "function", function: { name: "cari", parameters: { type: "object", properties: {} } } }];
  await call("PATCH", `/api/models/${mC}`, { tools: true });
  r = await chat({ task: "agent", tools, messages: [{ role: "user", content: "cari x" }] });
  const toolCall = r.d.choices?.[0]?.message?.tool_calls?.[0];
  ok("agent: tool call returned", r.s === 200 && toolCall?.function?.name === "cari", r.d);
  r = await chat({
    task: "agent",
    tools,
    messages: [
      { role: "user", content: "cari x" },
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", tool_call_id: toolCall?.id, content: "hasil" },
    ],
  });
  ok("agent: thinking block replayed on next turn", r.s === 200 && gw.lastReplayedThinking() === "sig-123", {
    s: r.s,
    replayed: gw.lastReplayedThinking(),
  });

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
  r = await call("POST", "/gateway/v1/embeddings", { input: "tiga", model: "embed-a" });
  ok("embeddings with explicit model", r.s === 200 && r.d.model === "embed-a", r.d?.model ?? r);
  r = await call("POST", "/gateway/v1/embeddings", { input: "tiga", model: "model-a" });
  ok("embeddings refuse chat model 422", r.s === 422 && /bukan model embedding/.test(r.d.message), r);

  r = await call("GET", "/gateway/v1/status");
  const statusChat = r.d?.tasks?.find((t) => t.task === "chat");
  ok("status counts models per task", r.s === 200 && statusChat?.models === 2, r.d);
  const statusEmbed = r.d?.tasks?.find((t) => t.task === "embedding");
  ok("status names primary embedding model", statusEmbed?.primary === "embed-a", statusEmbed);

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
  // ---------------------------------------------------------------- chat Akai web (6b.1): sesi web dibuat langsung di DB.
  // SSO aktif (lokal) = Akai memeriksa akun ke SSO, jadi dipakai akun dev user@workingspace.id (dihapus lagi dari Akai bila
  // sebelumnya belum ada); SSO mati (CI) = akun smoke.
  {
    const ssoOn = (await fetch(`${BASE}/api/auth/config`).then((y) => y.json())).sso;
    let webSubject = `smoke-akai-${stamp}`;
    let webAccountExisted = true;
    if (ssoOn) {
      const authDb = new pg.Client({
        connectionString: env.DATABASE_URL.replace(/\/akai(\?|$)/, "/workingspace_auth$1").replace(
          /\?schema=public$/,
          "",
        ),
      });
      await authDb.connect();
      webSubject = (await authDb.query("SELECT id FROM accounts WHERE email = 'user@workingspace.id'")).rows[0]?.id;
      await authDb.end();
      const probe = new pg.Client({ connectionString: env.DATABASE_URL.replace(/\?schema=public$/, "") });
      await probe.connect();
      webAccountExisted =
        (await probe.query("SELECT 1 FROM accounts WHERE sso_subject = $1", [webSubject])).rowCount > 0;
      await probe.end();
      // Sumber & rute tiruan untuk akun itu (lewat API aplikasi)
      const asWeb = (method, path, body) => call(method, path, body, webSubject);
      const src = (
        await asWeb("POST", "/api/sources", {
          kind: "router",
          preset: "custom",
          baseUrl: gw.url("a"),
          apiKey: "sk-router-a-000000000000",
          label: "Smoke chat A",
        })
      ).d;
      const srcB2 = (
        await asWeb("POST", "/api/sources", {
          kind: "router",
          preset: "custom",
          baseUrl: gw.url("b"),
          apiKey: "sk-router-b-000000000000",
          label: "Smoke chat B",
        })
      ).d;
      const a2 = (await asWeb("POST", "/api/models", { sourceId: src.id, modelId: "model-a", tools: true })).d;
      const b2 = (await asWeb("POST", "/api/models", { sourceId: srcB2.id, modelId: "model-b" })).d;
      await asWeb("PUT", "/api/tasks/chat", { modelIds: [b2.id, a2.id] });
      await asWeb("PUT", "/api/tasks/general", { modelIds: [a2.id] });
      globalThis.__chatCleanup = async () => {
        await asWeb("DELETE", `/api/sources/${src.id}`);
        await asWeb("DELETE", `/api/sources/${srcB2.id}`);
      };
    }
    const db = new pg.Client({ connectionString: env.DATABASE_URL.replace(/\?schema=public$/, "") });
    await db.connect();
    const token = `smoke-${stamp}-${Math.random().toString(36).slice(2)}`;
    const { createHash } = await import("node:crypto");
    await db.query(
      `INSERT INTO web_sessions (id, account_id, token_hash, expires_at)
       SELECT 'smoke-ws-' || $2, id, $1, now() + interval '1 day' FROM accounts WHERE sso_subject = $3`,
      [createHash("sha256").update(token).digest("hex"), stamp, webSubject],
    );
    await db.end();
    const web = async (method, path, body, extra = {}) => {
      const isForm = body instanceof FormData;
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          Cookie: `akai_sid=${token}`,
          "X-Akai-Web": "1",
          ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
          ...extra,
        },
        body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      });
      const text = await res.text();
      let d = text;
      try {
        d = JSON.parse(text);
      } catch {}
      return { s: res.status, d, text };
    };
    const skillsBefore = (await web("GET", "/api/skills")).d ?? {};
    const builtinNames = (skillsBefore.builtin ?? []).map((b) => b.name);
    const builtinWasOff = new Set((skillsBefore.builtin ?? []).filter((b) => !b.enabled).map((b) => b.name));
    const customWasOn = (skillsBefore.custom ?? []).filter((c) => c.enabled).map((c) => c.id);
    for (const n of builtinNames) await web("PATCH", `/api/skills/builtin/${n}`, { enabled: false });
    for (const id of customWasOn) await web("PATCH", `/api/skills/${id}`, { enabled: false });
    const messagesOf = async (id, count) => {
      let got = [];
      for (let i = 0; i < 15; i++) {
        got = (await web("GET", `/api/chat/conversations/${id}`)).d.messages ?? [];
        if (got.length >= count && got.at(-1)?.role === "assistant") break;
        await new Promise((r) => setTimeout(r, 200));
      }
      return got;
    };
    let x = await web("POST", "/api/chat/conversations", {});
    ok("chat: create conversation", x.s === 201 && x.d.title === "Percakapan baru", x.d);
    const conv = x.d.id;
    const form = new FormData();
    form.append("file", new Blob(["isi catatan rahasia"], { type: "text/plain" }), "catatan.txt");
    x = await web("POST", "/api/chat/attachments", form);
    ok("chat: upload text attachment", x.s === 201 && x.d.kind === "text", x.d);
    const attachment = x.d.id;
    const bad = new FormData();
    bad.append("file", new Blob(["PK"], { type: "application/zip" }), "a.zip");
    x = await web("POST", "/api/chat/attachments", bad);
    ok("chat: unsupported attachment 400", x.s === 400, x.d);
    x = await web("POST", `/api/chat/conversations/${conv}/messages`, {
      content: "Halo Akai",
      attachmentIds: [attachment],
    });
    ok(
      "chat: send streams answer (backup on quota)",
      x.s === 200 && x.text.includes('"content":"jaw"') && x.text.includes("[DONE]"),
      x.text.slice(0, 200),
    );
    const msgs = await messagesOf(conv, 2);
    ok(
      "chat: messages saved (user + assistant with model)",
      msgs.length === 2 &&
        msgs[0].attachments?.[0]?.name === "catatan.txt" &&
        msgs[1].content === "jawaban A" &&
        msgs[1].model === "model-a" &&
        msgs[1].fallbackFrom === "model-b",
      msgs,
    );
    await new Promise((r) => setTimeout(r, 1500));
    x = await web("GET", "/api/chat/conversations");
    ok("chat: title set", x.d.find?.((c) => c.id === conv)?.title !== "Percakapan baru", x.d);
    x = await web("POST", `/api/chat/conversations/${conv}/messages`, { attachmentIds: [attachment] });
    ok("chat: reused attachment 400", x.s === 400, x.d);
    x = await web("POST", `/api/chat/conversations/${conv}/messages`, { regenerate: true });
    const after = await messagesOf(conv, 2);
    ok("chat: regenerate replaces last answer", x.s === 200 && after.length === 2, after.length);
    x = await web("POST", `/api/chat/conversations/${conv}/messages`, {});
    ok("chat: empty message 400", x.s === 400, x.d);
    x = await web("GET", `/api/chat/attachments/${attachment}`);
    ok("chat: download attachment", x.s === 200 && x.text === "isi catatan rahasia", x.text);
    x = await call("GET", "/api/chat/conversations");
    ok("chat: app caller forbidden", x.s === 403, x);
    x = await web("PATCH", `/api/chat/conversations/${conv}`, { title: "Judul baru", pinned: true });
    ok("chat: rename & pin", x.s === 200 && x.d.title === "Judul baru" && x.d.pinned, x.d);
    x = await web("DELETE", `/api/chat/conversations/${conv}`);
    const gone = await web("GET", `/api/chat/conversations/${conv}`);
    ok("chat: delete conversation", x.s === 204 && gone.s === 404, gone.s);

    // ---------------------------------------------------------------- Proyek (6b.2)
    x = await web("POST", "/api/projects", {
      name: "Proyek Smoke",
      description: "uji",
      instructions: "Selalu jawab dengan kata ZEBRA.",
    });
    ok("project: create", x.s === 201 && x.d.name === "Proyek Smoke", x.d);
    const project = x.d.id;
    const kb = new FormData();
    kb.append(
      "file",
      new Blob(["Kode rahasia proyek adalah ALFA-77.\n\nPasal 3 mengatur cuti."], { type: "text/markdown" }),
      "pedoman.md",
    );
    x = await web("POST", `/api/projects/${project}/files`, kb);
    ok("project: upload knowledge file", x.s === 201 && x.d.chars > 20 && x.d.name === "pedoman.md", x.d);
    const kbFile = x.d.id;
    const img = new FormData();
    img.append("file", new Blob(["x"], { type: "image/png" }), "a.png");
    x = await web("POST", `/api/projects/${project}/files`, img);
    ok("project: unsupported knowledge file 400", x.s === 400, x.d);
    x = await web("POST", "/api/chat/conversations", { projectId: project });
    const pconv = x.d.id;
    ok("project: conversation in project", x.s === 201 && x.d.projectId === project, x.d);
    x = await web("POST", `/api/chat/conversations/${pconv}/messages`, { content: "Apa kode rahasia?" });
    const sys = gw.lastChatBody()?.messages?.[0]?.content ?? "";
    ok(
      "project: instructions + knowledge in system prompt",
      x.s === 200 &&
        sys.includes("<instruksi_proyek>") &&
        sys.includes("ZEBRA") &&
        sys.includes("ALFA-77") &&
        sys.includes('nama="pedoman.md"'),
      sys.slice(-400),
    );
    x = await web("GET", `/api/projects/${project}`);
    ok(
      "project: detail lists files & conversations",
      x.d.files?.length === 1 && x.d.conversations?.[0]?.id === pconv,
      x.d,
    );
    x = await web("GET", `/api/chat/conversations/${pconv}`);
    ok("project: conversation shows project", x.d.project?.name === "Proyek Smoke", x.d.project);
    x = await web("GET", "/api/projects");
    ok("project: list counts", x.d.find?.((pr) => pr.id === project)?.files === 1, x.d);
    x = await call("GET", "/api/projects");
    ok("project: app caller forbidden", x.s === 403, x);
    x = await web("DELETE", `/api/projects/${project}/files/${kbFile}`);
    ok("project: delete knowledge file", x.s === 204, x);
    x = await web("DELETE", `/api/projects/${project}`);
    const kept = await web("GET", `/api/chat/conversations/${pconv}`);
    ok(
      "project: delete keeps conversations (out of project)",
      x.s === 204 && kept.s === 200 && kept.d.projectId === null,
      kept.d,
    );
    await web("DELETE", `/api/chat/conversations/${pconv}`);

    // ---------------------------------------------------------------- Memori (6b.3)
    await web("DELETE", "/api/memory");
    await web("PATCH", "/api/memory/settings", { enabled: true });
    x = await web("POST", "/api/chat/conversations", {});
    const mconv = x.d.id;
    await web("POST", `/api/chat/conversations/${mconv}/messages`, {
      content: "Saya bekerja sebagai penguji smoke Akai di kantor.",
    });
    let memories = [];
    for (let i = 0; i < 10 && memories.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 500));
      memories = (await web("GET", "/api/memory")).d.items ?? [];
    }
    ok(
      "memory: learned automatically (task general fallback)",
      memories[0]?.content === "Pengguna bekerja sebagai penguji smoke Akai." && memories[0]?.source === "auto",
      memories,
    );
    x = await web("GET", `/api/chat/conversations/${mconv}`);
    ok(
      "memory: update marked on assistant message",
      x.d.messages?.[1]?.memoryUpdates?.[0]?.op === "add",
      x.d.messages?.[1],
    );
    await web("POST", `/api/chat/conversations/${mconv}/messages`, { content: "Tolong bantu buat rencana uji." });
    ok(
      "memory: used in system prompt",
      (gw.lastChatBody()?.messages?.[0]?.content ?? "").includes("<memori_pengguna>"),
      gw.lastChatBody()?.messages?.[0]?.content?.slice(0, 300),
    );
    x = await web("POST", "/api/memory", { content: "Pengguna suka jawaban berupa tabel." });
    ok("memory: add manual", x.s === 201 && x.d.source === "manual", x.d);
    const manual = x.d.id;
    x = await web("POST", "/api/memory", { content: "PIN saya 123456" });
    ok("memory: sensitive rejected 400", x.s === 400, x.d);
    x = await web("PATCH", `/api/memory/${manual}`, { content: "Pengguna suka jawaban singkat berupa tabel." });
    ok("memory: edit", x.s === 200 && x.d.content.includes("singkat"), x.d);
    x = await web("DELETE", `/api/memory/${manual}`);
    ok("memory: delete", x.s === 204, x);
    x = await web("PATCH", "/api/memory/settings", { enabled: false });
    await web("POST", `/api/chat/conversations/${mconv}/messages`, { content: "Satu pertanyaan lagi untuk uji ya." });
    ok(
      "memory: disabled = not in prompt",
      x.d.enabled === false && !(gw.lastChatBody()?.messages?.[0]?.content ?? "").includes("<memori_pengguna>"),
      x.d,
    );
    await web("PATCH", "/api/memory/settings", { enabled: true });
    x = await web("DELETE", "/api/memory");
    const left = await web("GET", "/api/memory");
    ok("memory: clear all", x.s === 204 && left.d.items.length === 0, left.d);
    x = await call("GET", "/api/memory");
    ok("memory: app caller forbidden", x.s === 403, x);
    await web("DELETE", `/api/chat/conversations/${mconv}`);

    // ---------------------------------------------------------------- Konektor MCP & loop alat (6b.5)
    let mcpCalls = 0;
    const mcpHttp = createServer(async (req, res) => {
      if (req.headers.authorization !== "Bearer smoke-mcp-token-123") {
        res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"unauthorized"}');
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const server = new McpServer({ name: "smoke-mcp", version: "1.0.0" });
      server.registerTool(
        "cari_catatan",
        { description: "Cari catatan", inputSchema: { q: z.string() }, annotations: { readOnlyHint: true } },
        async ({ q }) => {
          mcpCalls++;
          return { content: [{ type: "text", text: `Catatan ALFA-99 cocok dengan ${q}` }] };
        },
      );
      server.registerTool("buat_todo", { description: "Buat to-do", inputSchema: { judul: z.string() } }, async () => ({
        content: [{ type: "text", text: "dibuat" }],
      }));
      server.registerTool(
        "hapus_semua",
        { description: "Hapus semua", inputSchema: {}, annotations: { destructiveHint: true } },
        async () => ({ content: [{ type: "text", text: "terhapus" }] }),
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    });
    await new Promise((r) => mcpHttp.listen(0, "127.0.0.1", r));
    const mcpUrl = `http://127.0.0.1:${mcpHttp.address().port}/mcp`;
    try {
      x = await web("POST", "/api/connectors", {
        kind: "custom",
        name: "Smoke",
        url: mcpUrl,
        token: "smoke-mcp-token-123",
      });
      ok(
        "connector: create & list tools",
        x.s === 201 && x.d.status === "connected" && x.d.tools?.length === 3 && x.d.hasToken && !("tokenEnc" in x.d),
        x.d,
      );
      const connector = x.d.id;
      x = await web("POST", "/api/chat/conversations", {});
      const tconv = x.d.id;
      x = await web("POST", `/api/chat/conversations/${tconv}/messages`, { content: "Cari catatan alfa" });
      ok(
        "connector: tool loop streams tool events & final answer",
        x.s === 200 &&
          x.text.includes('"akai_tool"') &&
          x.text.includes('"status":"done"') &&
          x.text.includes("ALFA-99") &&
          mcpCalls === 1,
        x.text.slice(0, 600),
      );
      const firstTools = gw.lastChatBody()?.tools;
      x = await web("GET", `/api/chat/conversations/${tconv}`);
      const answer = x.d.messages?.[1];
      ok(
        "connector: answer saved with tool run",
        answer?.toolRuns?.[0]?.tool === "cari_catatan" &&
          answer.toolRuns[0].status === "done" &&
          answer.content.includes("Saya cek dulu.") &&
          answer.content.includes("ALFA-99"),
        answer,
      );
      void firstTools;
      x = await web("PATCH", `/api/connectors/${connector}`, { allowWrite: true });
      ok("connector: allow write", x.s === 200 && x.d.allowWrite === true, x.d);
      await web("POST", `/api/chat/conversations/${tconv}/messages`, { content: "Cari catatan alfa lagi" });
      const names = (gw.lastChatBody()?.tools ?? []).map((t) => t.function.name);
      // Putaran kedua (setelah hasil alat) tetap membawa daftar alat; periksa daftarnya
      ok(
        "connector: write tools offered only when allowed, destructive never",
        names.includes("smoke__buat_todo") &&
          names.includes("smoke__cari_catatan") &&
          !names.some((n) => n.includes("hapus")),
        names,
      );
      x = await web("PATCH", `/api/connectors/${connector}`, { enabled: false });
      await web("POST", `/api/chat/conversations/${tconv}/messages`, { content: "Halo tanpa alat" });
      ok(
        "connector: disabled = no tools",
        x.d.enabled === false && !gw.lastChatBody()?.tools,
        gw.lastChatBody()?.tools,
      );
      x = await web("PATCH", `/api/connectors/${connector}`, { token: "salah-token-0000000" });
      ok("connector: wrong token → auth_required", x.d.status === "auth_required", x.d);
      x = await call("GET", "/api/connectors");
      ok("connector: app caller forbidden", x.s === 403, x);
      x = await web("DELETE", `/api/connectors/${connector}`);
      ok("connector: delete", x.s === 204, x);
      await web("DELETE", `/api/chat/conversations/${tconv}`);
    } finally {
      mcpHttp.close();
    }

    // ---- Skill (6b.6)
    try {
      x = await web("GET", "/api/skills");
      ok(
        "skill: list builtin",
        x.s === 200 && x.d.builtin.length >= 4 && x.d.builtin.every((b) => b.name.startsWith("akai-")),
        x.d,
      );
      x = await call("GET", "/api/skills");
      ok("skill: app caller forbidden", x.s === 403, x.d);
      x = await web("PATCH", "/api/skills/builtin/akai-notulen-rapat", { enabled: true });
      ok("skill: builtin toggle", x.d.builtin?.find((b) => b.name === "akai-notulen-rapat")?.enabled === true, x.d);
      const md = `---\nname: uji-surat-${stamp}\ndescription: Menyusun surat pengantar uji skill smoke\n---\n\n# Surat pengantar\nPENANDA-SKILL-INSTRUKSI`;
      x = await web("POST", "/api/skills", { skillMd: md, files: [{ path: "contoh.md", content: "ISI-CONTOH" }] });
      ok(
        "skill: create from SKILL.md",
        x.s === 201 &&
          x.d.name === `uji-surat-${stamp}` &&
          x.d.files?.[0]?.path === "contoh.md" &&
          x.d.skillMd?.includes("PENANDA-SKILL-INSTRUKSI"),
        x.d,
      );
      const skillId = x.d.id;
      const skillName = x.d.name;
      x = await web("POST", "/api/skills", { skillMd: md });
      ok("skill: duplicate 409", x.s === 409, x.d);
      x = await web("POST", "/api/skills", { name: "akai-palsu", description: "x", instructions: "y" });
      ok("skill: builtin prefix rejected", x.s === 400, x.d);
      x = await web("POST", "/api/skills", {
        name: "uji-path",
        description: "x",
        instructions: "y",
        files: [{ path: "../x", content: "" }],
      });
      ok("skill: bad file path rejected", x.s === 400, x.d);

      const sconv = (await web("POST", "/api/chat/conversations", {})).d.id;
      x = await web("POST", `/api/chat/conversations/${sconv}/messages`, { content: `UJI-SKILL ${skillName}` });
      const sys = gw.lastChatBody()?.messages?.[0]?.content ?? "";
      ok(
        "skill: catalog in prompt & tool offered",
        sys.includes("<skill_tersedia>") &&
          sys.includes(skillName) &&
          sys.includes("akai-notulen-rapat") &&
          !sys.includes("akai-naskah-dinas") &&
          (gw.lastChatBody()?.tools ?? []).some((t) => t.function.name === "akai__skill"),
        sys.slice(-500),
      );
      ok(
        "skill: loaded via tool, answer uses instructions",
        x.s === 200 && x.text.includes('"akai_tool"') && x.text.includes("PENANDA-SKILL-INSTRUKSI"),
        x.text.slice(0, 500),
      );
      const smsgs = await messagesOf(sconv, 2);
      ok(
        "skill: run saved on message",
        smsgs[1]?.toolRuns?.[0]?.connector === "Skill" && smsgs[1].toolRuns[0].tool === skillName,
        smsgs[1],
      );

      // Model tanpa dukungan alat → skill yang cocok disisipkan langsung ke prompt sistem
      const models = (await web("GET", "/api/models")).d;
      const ma = (Array.isArray(models) ? models : []).find((m) => m.modelId === "model-a" && m.tools);
      if (ma) {
        await web("PATCH", `/api/models/${ma.id}`, { tools: false });
        x = await web("POST", `/api/chat/conversations/${sconv}/messages`, {
          content: "Tolong susun surat pengantar uji skill smoke",
        });
        const sys2 = gw.lastChatBody()?.messages?.[0]?.content ?? "";
        ok(
          "skill: model without tools → matching skill inlined",
          x.s === 200 && !gw.lastChatBody()?.tools && sys2.includes(`<skill name="${skillName}">`),
          sys2.slice(-400),
        );
        await web("PATCH", `/api/models/${ma.id}`, { tools: true });
      } else ok("skill: model-a with tools found", false, models);

      x = await web("PATCH", `/api/skills/${skillId}`, { enabled: false });
      await web("POST", `/api/chat/conversations/${sconv}/messages`, { content: "Halo lagi" });
      ok(
        "skill: disabled skill not in catalog",
        x.d.enabled === false && !(gw.lastChatBody()?.messages?.[0]?.content ?? "").includes(skillName),
        x.d,
      );
      x = await web("DELETE", `/api/skills/${skillId}`);
      ok("skill: delete", x.s === 204, x.d);
      await web("DELETE", `/api/chat/conversations/${sconv}`);
    } finally {
      for (const n of builtinNames)
        await web("PATCH", `/api/skills/builtin/${n}`, { enabled: !builtinWasOff.has(n) });
      for (const id of customWasOn) await web("PATCH", `/api/skills/${id}`, { enabled: true });
    }

    if (globalThis.__chatCleanup) await globalThis.__chatCleanup();
    const cleanDb = new pg.Client({ connectionString: env.DATABASE_URL.replace(/\?schema=public$/, "") });
    await cleanDb.connect();
    await cleanDb.query("DELETE FROM web_sessions WHERE id = $1", [`smoke-ws-${stamp}`]);
    if (!webAccountExisted) await cleanDb.query("DELETE FROM accounts WHERE sso_subject = $1", [webSubject]);
    else
      await cleanDb.query(
        "DELETE FROM ai_task_routes r USING accounts a WHERE a.id = r.account_id AND a.sso_subject = $1 AND r.model_ids = '[]'::jsonb",
        [webSubject],
      );
    await cleanDb.end();
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
