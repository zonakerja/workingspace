import { describe, expect, it } from "vitest";
import { sampleInput, toolKind } from "./plugins";
import { emptySchedule, shortWhen } from "./schedules";

describe("plugins & schedules (web)", () => {
  it("contoh masukan dari skema & jenis alat", () => {
    expect(
      JSON.parse(
        sampleInput({
          type: "object",
          properties: { a: { type: "string" }, n: { type: "integer" }, b: { type: "boolean" } },
        }),
      ),
    ).toEqual({ a: "", n: 0, b: false });
    expect(sampleInput({ type: "object" })).toBe("{}");
    expect(toolKind({ readOnly: true, destructive: false })).toBe("Baca");
    expect(toolKind({ readOnly: false, destructive: false })).toBe("Ubah");
    expect(toolKind({ readOnly: false, destructive: true })).toBe("Hapus");
  });

  it("jadwal bawaan & tanggal kosong", () => {
    expect(emptySchedule().schedule).toMatchObject({ kind: "daily", time: "07:00" });
    expect(shortWhen(null)).toBe("—");
  });
});
