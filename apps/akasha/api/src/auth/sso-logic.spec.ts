import { describe, expect, it } from "vitest";
import { roleFromClaims, safeReturnTo, ssoErrorMessage } from "./sso-logic";

describe("roleFromClaims", () => {
  it("super admin, admin, member, tanpa akses", () => {
    expect(roleFromClaims({ super_admin: true, apps: {} }, "akasha")).toBe("super_admin");
    expect(roleFromClaims({ apps: { akasha: "admin" } }, "akasha")).toBe("admin");
    expect(roleFromClaims({ apps: { akasha: "member" } }, "akasha")).toBe("member");
    expect(roleFromClaims({ apps: { akai: "admin" } }, "akasha")).toBeNull();
    expect(roleFromClaims({}, "akasha")).toBeNull();
  });
});

describe("safeReturnTo", () => {
  it("hanya path aplikasi", () => {
    expect(safeReturnTo("/planner/daily?date=2026-11-16")).toBe("/planner/daily?date=2026-11-16");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo("/login")).toBe("/");
    expect(safeReturnTo("/api/v1/auth/sso/start")).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
  });
});

describe("ssoErrorMessage", () => {
  it("pesan ramah", () => {
    expect(ssoErrorMessage("access_denied", "Masuk dibatalkan.")).toBe("Masuk dibatalkan.");
    expect(ssoErrorMessage("login_required")).toBe("Silakan masuk lagi.");
    expect(ssoErrorMessage("server_error")).toMatch(/gagal/);
  });
});
