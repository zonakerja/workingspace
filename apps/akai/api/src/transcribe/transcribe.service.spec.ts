import { Readable } from "node:stream";
import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranscribeError } from "./gemini-transcribe";
import { TranscribeService } from "./transcribe.service";

const transcribe = vi.fn();
vi.mock("./gemini-transcribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gemini-transcribe")>()),
  transcribeWithGemini: (input: unknown) => transcribe(input),
}));

const caller = { clientId: "akasha", account: { id: "acc1" } } as never;
const model = (id: string, kind = "gemini") => ({ id, modelId: `gemini-${id}`, label: id, source: { kind } });

function setup(list = [model("a"), model("b")]) {
  const logs: { ok: boolean; model: string }[] = [];
  const gateway = {
    candidates: vi.fn(async () => ({ task: "transcribe", list })),
    log: vi.fn(async (_c: unknown, _t: unknown, m: { id: string }, data: { ok: boolean }) => {
      logs.push({ ok: data.ok, model: m.id });
    }),
  };
  const sources = { endpointOf: () => ({ apiKey: "key" }) };
  return { service: new TranscribeService(gateway as never, sources as never), gateway, logs };
}

const audio = () => Readable.from([Buffer.from("isi-audio")]);
const settle = async (service: TranscribeService, key: string) => {
  for (let i = 0; i < 50; i++) {
    const job = service.status(caller, key);
    if (job && job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("tidak selesai");
};

describe("TranscribeService (Akai)", () => {
  beforeEach(() => transcribe.mockReset());

  it("menolak bukan audio & kunci tidak valid", async () => {
    const { service } = setup();
    await expect(service.start(caller, "k1", "image/png", audio(), null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.start(caller, "k/../x", "audio/webm", audio(), null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("selesai dengan model utama; pekerjaan selesai dikembalikan tanpa transkrip ulang", async () => {
    transcribe.mockResolvedValue({ text: "halo", truncated: false, passes: 1, warning: null });
    const { service, logs } = setup();
    expect((await service.start(caller, "up1", "audio/webm", audio(), 9)).status).toBe("running");
    const job = await settle(service, "up1");
    expect(job).toMatchObject({ status: "done", result: { text: "halo", model: "gemini-a" } });
    expect(logs).toEqual([{ ok: true, model: "a" }]);
    expect((await service.start(caller, "up1", "audio/webm", audio(), 9)).status).toBe("done");
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it("kuota habis → cadangan tugas Transkrip; penolakan isi tidak dialihkan", async () => {
    transcribe
      .mockRejectedValueOnce(new TranscribeError("quota", "kuota"))
      .mockResolvedValueOnce({ text: "ok", truncated: false, passes: 1, warning: null });
    const { service, logs } = setup();
    await service.start(caller, "up2", "audio/mpeg", audio(), null);
    expect(await settle(service, "up2")).toMatchObject({ status: "done", result: { model: "gemini-b" } });
    expect(logs.map((l) => l.ok)).toEqual([false, true]);

    transcribe.mockRejectedValueOnce(new TranscribeError("refusal", "ditolak"));
    await service.start(caller, "up3", "audio/mpeg", audio(), null);
    expect(await settle(service, "up3")).toMatchObject({ status: "failed", httpStatus: 422 });
    expect(transcribe).toHaveBeenCalledTimes(3);
  });

  it("isolasi per akun: akun lain tidak melihat pekerjaan", async () => {
    transcribe.mockResolvedValue({ text: "x", truncated: false, passes: 1, warning: null });
    const { service } = setup();
    await service.start(caller, "up4", "audio/webm", audio(), null);
    expect(service.status({ clientId: "akasha", account: { id: "acc2" } } as never, "up4")).toBeNull();
  });
});
