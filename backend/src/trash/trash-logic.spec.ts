import { describe, expect, it } from "vitest";
import { chooseBatch, recordTitle, TRASH_BATCH_WINDOW_MS, trashExpiry } from "./trash-logic";

describe("trash logic", () => {
  const now = new Date("2026-11-10T08:00:00Z");
  const newId = () => "new";

  it("groups deletions by the same actor within the window", () => {
    const recent = { batchId: "b1", deletedAt: new Date(now.getTime() - 5_000), actorId: "u1", source: "user" };
    expect(chooseBatch(recent, "u1", "user", now, newId)).toBe("b1");
    expect(chooseBatch(recent, "u2", "user", now, newId)).toBe("new");
    expect(chooseBatch(recent, "u1", "agent", now, newId)).toBe("new");
    const old = { ...recent, deletedAt: new Date(now.getTime() - TRASH_BATCH_WINDOW_MS - 1) };
    expect(chooseBatch(old, "u1", "user", now, newId)).toBe("new");
    expect(chooseBatch(null, "u1", "user", now, newId)).toBe("new");
  });

  it("expires after 30 days", () => {
    expect(trashExpiry(now).toISOString()).toBe("2026-12-10T08:00:00.000Z");
  });

  it("picks a readable title", () => {
    expect(recordTitle({ title: "  Rapat   koordinasi " }, "Agenda")).toBe("Rapat koordinasi");
    expect(recordTitle({ name: "Area A" }, "Area")).toBe("Area A");
    expect(recordTitle({ content: "x".repeat(200) }, "Catatan")).toHaveLength(118);
    expect(recordTitle({}, "Catatan")).toBe("Catatan");
    expect(recordTitle(undefined, "To-do")).toBe("To-do");
  });
});
