import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_TOKENS, completionAsSse, fromAnthropic, toAnthropic } from "./anthropic";

describe("toAnthropic", () => {
  it("sistem dipisah, peran digabung, gambar & alat diterjemahkan", () => {
    const out = toAnthropic(
      {
        messages: [
          { role: "system", content: "Jawab singkat." },
          { role: "developer", content: [{ type: "text", text: "Bahasa Indonesia." }] },
          { role: "user", content: "Halo" },
          {
            role: "user",
            content: [
              { type: "text", text: "Ini gambar" },
              { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
            ],
          },
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "cari", arguments: '{"q":"x"}' } }],
          },
          { role: "tool", tool_call_id: "c1", content: "hasil" },
        ],
        tools: [{ type: "function", function: { name: "cari", description: "Cari", parameters: { type: "object" } } }],
        tool_choice: "required",
        temperature: 0.2,
        stop: "###",
      },
      "claude-sonnet-5-5",
    );
    expect(out).toEqual({
      model: "claude-sonnet-5-5",
      system: "Jawab singkat.\n\nBahasa Indonesia.",
      max_tokens: DEFAULT_MAX_TOKENS,
      temperature: 0.2,
      stop_sequences: ["###"],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Halo" },
            { type: "text", text: "Ini gambar" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          ],
        },
        { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "cari", input: { q: "x" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "hasil" }] },
      ],
      tools: [{ name: "cari", description: "Cari", input_schema: { type: "object" } }],
      tool_choice: { type: "any" },
    });
  });
  it("max_tokens dari permintaan & argumen alat rusak jadi objek kosong", () => {
    const out = toAnthropic(
      {
        max_tokens: 100,
        messages: [{ role: "assistant", tool_calls: [{ id: "c", function: { name: "f", arguments: "{rusak" } }] }],
      },
      "m",
    );
    expect(out.max_tokens).toBe(100);
    expect((out.messages as { content: { input: unknown }[] }[])[0].content[0].input).toEqual({});
  });
  it("berkas PDF format OpenAI → blok document", () => {
    const out = toAnthropic(
      {
        messages: [
          {
            role: "user",
            content: [{ type: "file", file: { filename: "a.pdf", file_data: "data:application/pdf;base64,QUJD" } }],
          },
        ],
      },
      "m",
    );
    expect((out.messages as { content: unknown[] }[])[0].content[0]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "QUJD" },
    });
  });
});

describe("fromAnthropic", () => {
  it("teks, alat, alasan berhenti, usage termasuk cache", () => {
    const out = fromAnthropic(
      {
        id: "msg_1",
        content: [
          { type: "text", text: "Saya cari dulu." },
          { type: "tool_use", id: "t1", name: "cari", input: { q: "x" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
      },
      "akai-model",
      123,
    );
    expect(out).toMatchObject({
      id: "chatcmpl-msg_1",
      model: "akai-model",
      choices: [
        {
          message: {
            content: "Saya cari dulu.",
            tool_calls: [{ id: "t1", type: "function", function: { name: "cari", arguments: '{"q":"x"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 110,
        completion_tokens: 5,
        total_tokens: 115,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    });
  });
  it("jawaban sekaligus sebagai SSE", () => {
    const sse = completionAsSse(
      fromAnthropic({ content: [{ type: "text", text: "Hai" }], stop_reason: "end_turn" }, "m", 1),
    );
    expect(sse).toMatch(/"delta":\{"role":"assistant","content":"Hai"\}/);
    expect(sse.trim().endsWith("data: [DONE]")).toBe(true);
  });
});
