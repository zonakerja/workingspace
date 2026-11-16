import { describe, expect, it } from "vitest";
import { StreamSink } from "./stream-sink";

const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

describe("StreamSink", () => {
  it("mengumpulkan teks, alat bertahap per index, dan usage", () => {
    const deltas: string[] = [];
    const sink = new StreamSink((d) => deltas.push(d));
    sink.setHeader("X-Akai-Model", "Claude");
    sink.write(sse({ choices: [{ delta: { content: "Saya cek " } }] }));
    sink.write(
      sse({
        choices: [
          {
            delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "akasha__cari", arguments: '{"q":' } }] },
          },
        ],
      }),
    );
    sink.write(
      Buffer.from(sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"psp"}' } }] } }] })),
    );
    sink.end(`${sse({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } })}data: [DONE]\n\n`);
    expect(deltas.join("")).toBe("Saya cek ");
    expect(sink.toolCalls).toEqual([{ id: "call_1", name: "akasha__cari", arguments: '{"q":"psp"}' }]);
    expect(sink.usage).toEqual({ input: 10, output: 4 });
    expect(sink.getHeader("x-akai-model")).toBe("Claude");
    expect(sink.writableEnded).toBe(true);
  });

  it("jawaban non-stream & galat di tengah stream", () => {
    const sink = new StreamSink(() => undefined);
    sink.json({
      choices: [
        { message: { content: "halo", tool_calls: [{ id: "t", function: { name: "x__y", arguments: "{}" } }] } },
      ],
    });
    expect(sink.text).toBe("halo");
    expect(sink.toolCalls[0].name).toBe("x__y");
    const err = new StreamSink(() => undefined);
    err.write(sse({ error: { message: "putus" } }));
    expect(err.error).toBe("putus");
  });

  it("abort memanggil penangan close", () => {
    const sink = new StreamSink(() => undefined);
    let closed = false;
    sink.on("close", () => (closed = true));
    sink.abort();
    expect(closed && sink.destroyed).toBe(true);
  });
});
