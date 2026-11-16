import { describe, expect, it } from "vitest";
import {
  BACKCHANNEL_LOGOUT_EVENT,
  isSilentSsoMiss,
  logoutTokenClaims,
  roleFromClaims,
  safeReturnTo,
  ssoErrorMessage,
} from "./sso-logic";

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

describe("isSilentSsoMiss", () => {
  it("hanya galat 'perlu masuk' dari prompt=none", () => {
    expect(isSilentSsoMiss("login_required")).toBe(true);
    expect(isSilentSsoMiss("interaction_required")).toBe(true);
    expect(isSilentSsoMiss("access_denied")).toBe(false);
  });
});

describe("logoutTokenClaims", () => {
  const ok = { events: { [BACKCHANNEL_LOGOUT_EVENT]: {} }, jti: "j1", sid: "s1", sub: "u1" };
  it("menerima logout token yang sah", () => {
    expect(logoutTokenClaims(ok)).toEqual({ sid: "s1", sub: "u1" });
  });
  it("menolak tanpa event, dengan nonce, tanpa jti / sid", () => {
    expect(logoutTokenClaims({ ...ok, events: {} })).toHaveProperty("error");
    expect(logoutTokenClaims({ ...ok, nonce: "n" })).toHaveProperty("error");
    expect(logoutTokenClaims({ ...ok, jti: undefined })).toHaveProperty("error");
    expect(logoutTokenClaims({ ...ok, sid: "" })).toHaveProperty("error");
  });
});
