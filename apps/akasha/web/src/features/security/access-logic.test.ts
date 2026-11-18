import { describe, expect, it } from "vitest";
import { accessBannerInfo } from "./access-logic";

const now = new Date("2026-11-18T08:00:00+07:00");

describe("accessBannerInfo", () => {
  it("tanpa batas / masih lama = tanpa pita", () => {
    expect(accessBannerInfo(null, now)).toBeNull();
    expect(accessBannerInfo({ accessExpiresAt: null }, now)).toBeNull();
    expect(accessBannerInfo({ accessExpiresAt: "2027-01-30T00:00:00Z" }, now)).toBeNull();
  });
  it("hampir habis", () => {
    const info = accessBannerInfo({ accessExpiresAt: "2026-11-25T01:00:00Z" }, now);
    expect(info).toMatchObject({ kind: "expiring", daysLeft: 7 });
  });
  it("baca saja + sisa hari sebelum dihapus", () => {
    const info = accessBannerInfo(
      { accessExpiresAt: "2026-11-01T00:00:00Z", accessDeleteAt: "2027-04-30T00:00:00Z" },
      now,
    );
    expect(info?.kind).toBe("read_only");
    expect(info && "deleteLabel" in info && info.deleteLabel).toMatch(/April 2027/);
  });
});
