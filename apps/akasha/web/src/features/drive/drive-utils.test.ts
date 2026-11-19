import { describe, expect, it } from "vitest";
import { backupSummary, dayLabel, formatSize, isPickerMessage, PICKER_MESSAGE } from "./drive-utils";

describe("drive-utils", () => {
  it("pesan Picker hanya diterima untuk permintaan yang sama", () => {
    const msg = { type: PICKER_MESSAGE, request: "r1", fileId: "abc" };
    expect(isPickerMessage(msg, "r1")).toBe(true);
    expect(isPickerMessage(msg, "r2")).toBe(false);
    expect(isPickerMessage({ ...msg, fileId: null }, "r1")).toBe(true);
    expect(isPickerMessage({ type: "lain", request: "r1", fileId: "abc" }, "r1")).toBe(false);
    expect(isPickerMessage(null, "r1")).toBe(false);
  });

  it("ukuran & label hari", () => {
    expect(formatSize(null)).toBe("");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1,5 KB");
    expect(formatSize(250 * 1024 * 1024)).toBe("250 MB");
    expect(dayLabel(180)).toBe("6 bulan");
    expect(dayLabel(45)).toBe("45 hari");
  });
});

describe("backupSummary", () => {
  it("meringkas data & berkas", () => {
    expect(backupSummary(null)).toBe("");
    expect(
      backupSummary({
        records: 120,
        notebooks: 2,
        requests: 6,
        files: 34,
        uploaded: 12,
        reused: 20,
        cold: 2,
        skipped: 0,
        bytes: 2048,
      }),
    ).toBe("128 data · 34 berkas (12 baru, 20 sudah ada, 2 arsip dingin) · 2,0 KB diunggah");
    expect(
      backupSummary({
        records: 5,
        notebooks: 0,
        requests: 0,
        files: 0,
        uploaded: 0,
        reused: 0,
        cold: 0,
        skipped: 0,
        bytes: 0,
      }),
    ).toBe("5 data");
  });
});
