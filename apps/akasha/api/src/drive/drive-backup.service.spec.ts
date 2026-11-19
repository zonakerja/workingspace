import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { DriveBackupService } from "./drive-backup.service";

/**
 * Orkestrasi backup dengan tiruan database, storage, dan Drive: berkas diunggah sekali lalu dipakai ulang, berkas arsip dingin tidak
 * disalin, backup lama & berkas yang tidak dipakai lagi dipangkas, galat tercatat sebagai backup gagal.
 */

type Row = Record<string, unknown> & { id: string };

function fakeWorld(options: { failUploads?: boolean } = {}) {
  let seq = 0;
  const id = () => `id${++seq}`;
  const backups: Row[] = [];
  const copies: Row[] = [];
  const uploaded: { name: string; target: unknown }[] = [];
  const deleted: string[] = [];
  const folders: string[] = [];
  let userSettings: unknown = { accountId: "acc1", keep: 2 };
  const assets = [
    {
      id: "a1",
      objectKey: "u1/a1",
      originalName: "surat.pdf",
      mimeType: "application/pdf",
      size: 3,
      checksum: "aaaa1111bbbb2222",
      context: null,
    },
    {
      id: "a2",
      objectKey: "u1/a2",
      originalName: "foto.png",
      mimeType: "image/png",
      size: 2,
      checksum: "cccc3333dddd4444",
      context: null,
    },
  ];
  const cold = [{ objectKey: "u1/a2", provider: "google", fileId: "cold-a2" }];
  const empty = { findMany: async () => [] };

  const table = (rows: Row[]) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      // Waktu mulai backup selalu sebelum berkas ditandai dipakai (sama seperti default now() database)
      const row = { id: id(), startedAt: new Date(Date.now() - 1_000_000 + seq * 10), ...data } as Row;
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      rows.splice(
        rows.findIndex((r) => r.id === where.id),
        1,
      );
    },
  });

  const prisma = new Proxy(
    {
      user: {
        findUnique: async () => ({ driveBackup: userSettings, email: "a@b.c", name: "A", accessExpiresAt: null }),
        update: async ({ data }: { data: { driveBackup: unknown } }) => {
          userSettings = data.driveBackup;
        },
      },
      driveBackup: {
        ...table(backups),
        findMany: async () => [...backups].sort((a, b) => +(b.startedAt as Date) - +(a.startedAt as Date)),
      },
      driveBackupFile: {
        ...table(copies),
        findUnique: async ({ where }: { where: { oauthAccountId_checksum: { checksum: string } } }) =>
          copies.find((c) => c.checksum === where.oauthAccountId_checksum.checksum) ?? null,
        upsert: async ({ create }: { create: Record<string, unknown> }) => {
          const row = { id: id(), ...create } as Row;
          copies.push(row);
          return row;
        },
        deleteMany: async () => ({ count: 0 }),
        findMany: async ({ where }: { where: { lastSeenAt: { lt: Date } } }) =>
          copies.filter((c) => (c.lastSeenAt as Date) < where.lastSeenAt.lt),
        aggregate: async () => ({ _count: copies.length, _sum: { size: 0 } }),
      },
      asset: { findMany: async () => assets },
      coldObject: { findMany: async () => cold },
    } as Record<string, unknown>,
    { get: (target, key: string) => target[key] ?? empty },
  );

  const uploader = {
    exists: async () => true,
    createGoogleFolder: async (_a: unknown, name: string) => {
      folders.push(name);
      return `folder-${name}`;
    },
    createSession: async (_a: unknown, target: unknown, file: { name: string }) => {
      if (options.failUploads) throw new Error("kuota habis");
      uploaded.push({ name: file.name, target });
      return `session-${file.name}`;
    },
    upload: async (_p: string, url: string, stream: Readable) => {
      for await (const _ of stream) void _;
      return `file-${url}`;
    },
    uploadBuffer: async (_a: unknown, target: unknown, name: string) => {
      if (options.failUploads) throw new Error("kuota habis");
      uploaded.push({ name, target });
      return `file-${name}`;
    },
    deleteRemote: async (_a: unknown, fileId: string) => void deleted.push(fileId),
    oneDriveItemId: async () => null,
  };
  const drive = { account: async () => ({ id: "acc1", provider: "google" }), accounts: async () => ({ accounts: [] }) };
  const storage = { getObjectRaw: async () => Readable.from([Buffer.from("xyz")]) };
  const service = new DriveBackupService(prisma as any, storage as any, drive as any, uploader as any);
  return { service, backups, copies, uploaded, deleted, folders };
}

const runOnce = (service: DriveBackupService) =>
  (service as any).run("u1", { accountId: "acc1", keep: 2, includeFiles: true }, "button");

describe("DriveBackupService", () => {
  it("backup pertama: berkas diunggah, arsip dingin dirujuk, manifest + README di folder backup", async () => {
    const w = fakeWorld();
    await runOnce(w.service);
    expect(w.backups[0].status).toBe("done");
    expect(w.backups[0].stats).toMatchObject({ files: 2, uploaded: 1, cold: 1, reused: 0 });
    expect(w.uploaded.map((u) => u.name)).toEqual(["aaaa1111bbbb-surat.pdf", "akasha-backup.json", "README.txt"]);
    expect(w.folders).toEqual(expect.arrayContaining(["Akasha Backup", "berkas"]));
    expect(w.copies).toHaveLength(1);
  });

  it("backup berikutnya memakai ulang berkas; backup lebih lama dari batas dipangkas", async () => {
    const w = fakeWorld();
    await runOnce(w.service);
    await runOnce(w.service);
    await runOnce(w.service);
    expect(w.backups.at(-1)!.stats).toMatchObject({ uploaded: 0, reused: 1 });
    expect(w.backups.filter((b) => b.status === "done")).toHaveLength(2);
    expect(w.deleted.length).toBe(1); // folder backup pertama
  });

  it("berkas gagal dicatat & dilewati; manifest gagal → backup gagal dengan pesan", async () => {
    const w = fakeWorld({ failUploads: true });
    await runOnce(w.service);
    expect(w.backups[0].status).toBe("failed");
    expect(w.backups[0].stats).toMatchObject({ skipped: 1, cold: 1 });
    expect(String(w.backups[0].error)).toContain("kuota habis");
  });
});
