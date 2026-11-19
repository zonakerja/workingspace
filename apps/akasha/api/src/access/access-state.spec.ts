import { describe, expect, it } from "vitest";
import { accessState, allowedWhileReadOnly } from "./access-state";

const d = (s: string) => new Date(s);

describe("accessState", () => {
  it("tanpa batas / belum habis = aktif", () => {
    expect(accessState(null, null)).toBe("active");
    expect(accessState(d("2026-12-01"), d("2027-05-30"), d("2026-11-30"))).toBe("active");
  });
  it("habis → baca saja → berakhir", () => {
    expect(accessState(d("2026-12-01"), d("2027-05-30"), d("2026-12-01"))).toBe("read_only");
    expect(accessState(d("2026-12-01"), d("2027-05-30"), d("2027-05-30"))).toBe("ended");
  });
});

describe("allowedWhileReadOnly", () => {
  it("baca selalu boleh", () => {
    expect(allowedWhileReadOnly("GET", "/api/v1/records/todo")).toBe(true);
  });
  it("tulis ditolak kecuali jalur yang diizinkan", () => {
    expect(allowedWhileReadOnly("PUT", "/api/v1/records/todo/x")).toBe(false);
    expect(allowedWhileReadOnly("DELETE", "/api/v1/uploads/x")).toBe(false);
    expect(allowedWhileReadOnly("POST", "/api/v1/ai/chat")).toBe(false);
    expect(allowedWhileReadOnly("POST", "/api/v1/auth/logout")).toBe(true);
    expect(allowedWhileReadOnly("POST", "/api/v1/auth/sso/backchannel-logout")).toBe(true);
    expect(allowedWhileReadOnly("PATCH", "/api/v1/auth/me")).toBe(false);
    expect(allowedWhileReadOnly("POST", "/api/v1/security/pin/unlock")).toBe(true);
    expect(allowedWhileReadOnly("PUT", "/api/v1/security/pin")).toBe(false);
    expect(allowedWhileReadOnly("POST", "/api/v1/uploads/abc/link?x=1")).toBe(true);
    expect(allowedWhileReadOnly("POST", "/api/v1/drive/backup/run")).toBe(true);
    expect(allowedWhileReadOnly("PUT", "/api/v1/drive/backup")).toBe(true);
    expect(allowedWhileReadOnly("PUT", "/api/v1/drive/cold")).toBe(false);
    expect(allowedWhileReadOnly("POST", "/api/v1/office/config")).toBe(true);
  });
});
