import { describe, expect, it } from "vitest";
import type { TrashItemInfo } from "@/types/api";
import { daysLeft, filterTrash, groupTrash, itemLabel } from "./trash-utils";

const item = (over: Partial<TrashItemInfo>): TrashItemInfo => ({
  id: "i",
  kind: "record",
  recordType: "todo",
  itemId: "x",
  title: "T",
  batchId: "b",
  actorId: "u",
  source: "user",
  deletedAt: "2026-11-10T08:00:00.000Z",
  expiresAt: "2026-12-10T08:00:00.000Z",
  ...over,
});

describe("trash utils", () => {
  it("labels kinds and record types", () => {
    expect(itemLabel({ kind: "record", recordType: "para_project" })).toBe("Project");
    expect(itemLabel({ kind: "asset", recordType: null })).toBe("Berkas");
    expect(itemLabel({ kind: "record", recordType: "baru" })).toBe("baru");
  });

  it("groups by batch, newest first, files last", () => {
    const groups = groupTrash([
      item({ id: "1", batchId: "a", kind: "asset", recordType: null, deletedAt: "2026-11-10T08:00:01.000Z" }),
      item({ id: "2", batchId: "a", deletedAt: "2026-11-10T08:00:00.000Z" }),
      item({ id: "3", batchId: "b", deletedAt: "2026-11-11T08:00:00.000Z" }),
    ]);
    expect(groups.map((g) => g.batchId)).toEqual(["b", "a"]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["2", "1"]);
    expect(groups[1]!.deletedAt).toBe("2026-11-10T08:00:00.000Z");
  });

  it("counts remaining days", () => {
    expect(daysLeft("2026-12-10T08:00:00.000Z", new Date("2026-11-10T08:00:00.000Z"))).toBe(30);
    expect(daysLeft("2026-11-10T09:00:00.000Z", new Date("2026-11-10T08:00:00.000Z"))).toBe(1);
    expect(daysLeft("2026-11-01T00:00:00.000Z", new Date("2026-11-10T08:00:00.000Z"))).toBe(0);
  });

  it("filters by title and label", () => {
    const list = [item({ id: "1", title: "Rapat koordinasi" }), item({ id: "2", title: "Laporan", kind: "asset" })];
    expect(filterTrash(list, "rapat").map((i) => i.id)).toEqual(["1"]);
    expect(filterTrash(list, "berkas").map((i) => i.id)).toEqual(["2"]);
    expect(filterTrash(list, "")).toHaveLength(2);
  });
});
