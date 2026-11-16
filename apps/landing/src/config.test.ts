import { describe, expect, it } from "vitest";
import { ssoLinks } from "./config";

describe("ssoLinks", () => {
  it("menyusun tautan masuk, daftar, akun tanpa garis miring ganda", () => {
    expect(ssoLinks("https://auth.workingspace.id/")).toEqual({
      login: "https://auth.workingspace.id/login?next=/account",
      register: "https://auth.workingspace.id/register",
      account: "https://auth.workingspace.id/account",
    });
  });
});
