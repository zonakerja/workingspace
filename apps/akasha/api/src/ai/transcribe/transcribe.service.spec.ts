import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { AkaiError } from "../../akai/akai.service";
import type { AuthUser } from "../../common/types/auth-user";
import { TranscribeService } from "./transcribe.service";

const user = { id: "u1" } as AuthUser;
const other = { id: "u2" } as AuthUser;
const result = { text: "Halo.", truncated: false, passes: 1, warning: null, provider: "gemini", model: "m" };
const done = (r = result) => ({ status: "done" as const, startedAt: 1, finishedAt: 2, result: r });

function setup(start: () => Promise<unknown>, mimeType = "audio/webm;codecs=opus", status = vi.fn()) {
  const transcribeStart = vi.fn(start);
  const service = new TranscribeService(
    { transcribeStart, transcribeStatus: status } as never,
    { findWithPermission: () => Promise.resolve({ asset: { id: "a1", objectKey: "k", mimeType, size: 1 } }) } as never,
    { getObject: () => Promise.resolve(Readable.from([Buffer.from("x")])) } as never,
    { user: { findUniqueOrThrow: () => Promise.resolve({ ssoSubject: "s", email: null, name: null }) } } as never,
  );
  return { service, transcribeStart };
}

const settled = async (service: TranscribeService, userId = "u1") => {
  await vi.waitFor(() => expect(service.status(userId, "a1")?.status).not.toBe("running"));
  return service.status(userId, "a1")!;
};

describe("TranscribeService (lewat Akai)", () => {
  it("langsung menjawab running, hasil Akai tersedia lewat status", async () => {
    const { service } = setup(() => Promise.resolve(done()));
    expect((await service.start(user, "a1")).status).toBe("running");
    expect(await settled(service)).toMatchObject({ status: "done", result });
  });

  it("berkas yang sama tidak ditranskrip dua kali", async () => {
    const { service, transcribeStart } = setup(() => Promise.resolve(done()));
    await service.start(user, "a1");
    await service.start(user, "a1");
    await settled(service);
    expect((await service.start(user, "a1")).status).toBe("done");
    expect(transcribeStart).toHaveBeenCalledTimes(1);
  });

  it("galat Akai membawa status & pesan, dan boleh dicoba lagi", async () => {
    const { service, transcribeStart } = setup(() => Promise.reject(new AkaiError(429, "kuota habis")));
    await service.start(user, "a1");
    expect(await settled(service)).toMatchObject({ status: "failed", httpStatus: 429, message: "kuota habis" });
    await service.start(user, "a1");
    await settled(service);
    expect(transcribeStart).toHaveBeenCalledTimes(2);
  });

  it("pekerjaan gagal di Akai diteruskan; hasil terpotong boleh diulang", async () => {
    const failed = { status: "failed", startedAt: 1, finishedAt: 2, httpStatus: 422, message: "ditolak" };
    const a = setup(() => Promise.resolve(failed));
    await a.service.start(user, "a1");
    expect(await settled(a.service)).toMatchObject({ status: "failed", message: "ditolak" });

    const b = setup(() => Promise.resolve(done({ ...result, truncated: true })));
    await b.service.start(user, "a1");
    await settled(b.service);
    await b.service.start(user, "a1");
    await settled(b.service);
    expect(b.transcribeStart).toHaveBeenCalledTimes(2);
  });

  it("pekerjaan user lain tidak terlihat; bukan audio ditolak", async () => {
    const { service } = setup(() => Promise.resolve(done()));
    await service.start(user, "a1");
    expect(service.status(other.id, "a1")).toBeNull();
    const pdf = setup(() => Promise.resolve(done()), "application/pdf");
    await expect(pdf.service.start(user, "a1")).rejects.toThrow("bukan audio");
    expect(pdf.transcribeStart).not.toHaveBeenCalled();
  });
});
