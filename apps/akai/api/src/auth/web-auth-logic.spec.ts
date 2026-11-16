import { describe, expect, it } from "vitest";
import { hasAppAccess, logoutTokenClaims, needsWebHeader, readCookie, safeReturnTo } from "./web-auth-logic";

describe("web-auth-logic", () => {
  it("akses Akai dari klaim SSO", () => {
    expect(hasAppAccess({ super_admin: true }, "akai")).toBe(true);
    expect(hasAppAccess({ apps: { akai: "member" } }, "akai")).toBe(true);
    expect(hasAppAccess({ apps: { akasha: "admin" } }, "akai")).toBe(false);
    expect(hasAppAccess({}, "akai")).toBe(false);
  });

  it("tujuan setelah masuk hanya path lokal", () => {
    expect(safeReturnTo("/models?tab=tugas")).toBe("/models?tab=tugas");
    expect(safeReturnTo("//evil.test")).toBe("/");
    expect(safeReturnTo("https://evil.test")).toBe("/");
    expect(safeReturnTo("/\\evil")).toBe("/");
    expect(safeReturnTo("/login")).toBe("/");
    expect(safeReturnTo("/api/auth/logout")).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
  });

  it("logout token", () => {
    const events = { "http://schemas.openid.net/event/backchannel-logout": {} };
    expect(logoutTokenClaims({ events, jti: "j", sid: "s1", sub: "u" })).toEqual({ sid: "s1", sub: "u" });
    expect(logoutTokenClaims({ events, jti: "j" })).toHaveProperty("error");
    expect(logoutTokenClaims({ events, jti: "j", sid: "s", nonce: "n" })).toHaveProperty("error");
    expect(logoutTokenClaims({ jti: "j", sid: "s" })).toHaveProperty("error");
  });

  it("membaca cookie & header web", () => {
    expect(readCookie("a=1; akai_sid=abc%3D; b=2", "akai_sid")).toBe("abc=");
    expect(readCookie("akai_sidx=1", "akai_sid")).toBeUndefined();
    expect(readCookie(undefined, "akai_sid")).toBeUndefined();
    expect(needsWebHeader("GET")).toBe(false);
    expect(needsWebHeader("post")).toBe(true);
  });
});
