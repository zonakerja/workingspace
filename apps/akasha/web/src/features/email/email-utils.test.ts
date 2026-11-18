import { describe, expect, it } from "vitest";
import { formatBytes, hintLabel, listTime, senderName } from "./email-utils";

describe("menu Email", () => {
  it("label petunjuk tagihan & jadwal", () => {
    expect(hintLabel({ kind: "bill", amount: 412500, date: "2026-11-20", matched: [] })).toMatch(
      /^Tagihan · Rp 412\.500 · jatuh tempo 20 Nov/,
    );
    expect(hintLabel({ kind: "schedule", date: "2026-11-19", time: "13:00", matched: [] })).toMatch(
      /^Jadwal 19 Nov 13:00/,
    );
    expect(hintLabel({ kind: "none", matched: [] })).toBeNull();
  });

  it("nama pengirim, waktu daftar, ukuran berkas", () => {
    expect(senderName({ fromName: null, fromAddress: "a@b.id" })).toBe("a@b.id");
    const now = new Date(2026, 10, 17, 15, 0);
    expect(listTime(new Date(2026, 10, 17, 9, 5).toISOString(), now)).toMatch(/09[.:]05/);
    expect(listTime(new Date(2026, 10, 2, 9, 5).toISOString(), now)).toMatch(/2 Nov/);
    expect(formatBytes(2_500_000)).toBe("2,4 MB");
  });
});
