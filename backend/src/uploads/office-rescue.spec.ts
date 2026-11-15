import { describe, expect, it } from "vitest";
import { shouldRescueOnDiscard } from "./office-rescue";

describe("shouldRescueOnDiscard", () => {
  const base = { userId: "u1", version: 3, context: "resource" };

  it("keeps edited documents of the owner", () => {
    expect(shouldRescueOnDiscard(base, "u1")).toBe(true);
    expect(shouldRescueOnDiscard({ ...base, context: null }, "u1")).toBe(true);
  });

  it("discards untouched documents, other owners, and managed contexts", () => {
    expect(shouldRescueOnDiscard({ ...base, version: 1 }, "u1")).toBe(false);
    expect(shouldRescueOnDiscard(base, "u2")).toBe(false);
    expect(shouldRescueOnDiscard({ ...base, context: "office-workspace" }, "u1")).toBe(false);
    expect(shouldRescueOnDiscard({ ...base, context: "office-template" }, "u1")).toBe(false);
  });
});
