import { describe, expect, it } from "vitest";
import {
  changedKeys,
  compactPayload,
  createPayload,
  describeRecordType,
  isAgentWritable,
  patchPayload,
  samePayload,
} from "./agent-action-logic";

describe("agent action logic", () => {
  it("allows work data and blocks logs and robot-synced types", () => {
    expect(isAgentWritable("schedule")).toBe(true);
    expect(isAgentWritable("para_task")).toBe(true);
    expect(isAgentWritable("para_archive_log")).toBe(false);
    expect(isAgentWritable("srikandi_letter")).toBe(false);
    expect(isAgentWritable("unknown")).toBe(false);
  });

  it("patches only given keys, null removes, system keys ignored", () => {
    const before = { id: "1", title: "A", priority: "low", date: "x" };
    expect(patchPayload(before, { title: "B", date: null, id: "evil", userId: "other" })).toEqual({
      id: "1",
      title: "B",
      priority: "low",
    });
  });

  it("builds a create payload without system keys", () => {
    expect(createPayload("new", { id: "x", userId: "u", share: {}, title: "T" })).toEqual({ id: "new", title: "T" });
  });

  it("compares payloads ignoring key order and share", () => {
    expect(samePayload({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1, share: { x: 1 } })).toBe(true);
    expect(samePayload({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("lists changed keys", () => {
    expect(changedKeys({ id: "1", a: 1, b: 2 }, { id: "1", a: 1, b: 3, c: 4 })).toEqual(["b", "c"]);
    expect(changedKeys(null, { id: "1", a: 1 })).toEqual(["a"]);
  });

  it("describes a record type", () => {
    const todo = describeRecordType("todo");
    expect(todo.titleKey).toBe("title");
    expect(todo.fields.find((f) => f.key === "date")?.kind).toContain("toDateString");
  });

  it("compacts long text and drops editor blobs", () => {
    const out = compactPayload({ title: "x".repeat(500), doc: { big: true } }, 10);
    expect(out).toEqual({ title: "xxxxxxxxxx…" });
  });
});
