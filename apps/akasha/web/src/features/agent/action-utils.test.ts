import { describe, expect, it } from "vitest";
import { actionChanges, childrenSummary, recordLabel } from "./action-utils";

describe("agent action utils", () => {
  it("lists changed fields", () => {
    expect(
      actionChanges({ kind: "update", before: { id: "1", a: "x", b: 1 }, after: { id: "1", a: "y", b: 1, c: true } }),
    ).toEqual([
      { key: "a", from: "x", to: "y" },
      { key: "c", from: "—", to: "true" },
    ]);
    expect(actionChanges({ kind: "create", before: null, after: { id: "1", userId: "u", title: "T" } })).toEqual([
      { key: "title", from: null, to: "T" },
    ]);
  });

  it("summarises children by type", () => {
    expect(
      childrenSummary([
        ["para_task", "1"],
        ["para_task", "2"],
        ["schedule", "3"],
      ]),
    ).toBe("2 Action/Task, 1 Agenda");
    expect(childrenSummary(null)).toBe("");
  });

  it("labels record types", () => {
    expect(recordLabel("para_project")).toBe("Project");
  });
});
