import { describe, expect, it } from "vitest";
import { accountChangeProblem, accountSearch, accountStatusFilter } from "./admin-logic";

describe("accountChangeProblem", () => {
  const base = { self: false, targetSuperAdmin: false, activeSuperAdmins: 2 };

  it("melarang menonaktifkan / mencabut super admin diri sendiri", () => {
    expect(accountChangeProblem({ disabled: true }, { ...base, self: true })).toMatch(/sendiri/);
    expect(accountChangeProblem({ superAdmin: false }, { ...base, self: true, targetSuperAdmin: true })).toMatch(
      /sendiri/,
    );
  });

  it("mempertahankan minimal satu super admin aktif", () => {
    const last = { ...base, targetSuperAdmin: true, activeSuperAdmins: 1 };
    expect(accountChangeProblem({ superAdmin: false }, last)).toMatch(/minimal satu/);
    expect(accountChangeProblem({ disabled: true }, last)).toMatch(/minimal satu/);
    expect(accountChangeProblem({ superAdmin: false }, { ...last, activeSuperAdmins: 2 })).toBeNull();
  });

  it("perubahan biasa diizinkan", () => {
    expect(accountChangeProblem({ disabled: true }, base)).toBeNull();
    expect(accountChangeProblem({ superAdmin: true }, base)).toBeNull();
  });
});

describe("accountSearch", () => {
  it("kosong = semua", () => {
    expect(accountSearch("  ")).toEqual({});
  });
  it("nama atau email", () => {
    expect(JSON.stringify(accountSearch(" budi "))).toContain('"contains":"budi"');
  });
});

describe("accountStatusFilter", () => {
  it("memetakan status ke filter Prisma", () => {
    expect(accountStatusFilter(undefined)).toEqual({});
    expect(accountStatusFilter("all")).toEqual({});
    expect(accountStatusFilter("super")).toEqual({ superAdmin: true });
    expect(accountStatusFilter("unverified")).toEqual({ disabled: false, emailVerifiedAt: null });
    expect(accountStatusFilter("disabled")).toEqual({ disabled: true });
    expect(accountStatusFilter("active")).toEqual({ disabled: false, emailVerifiedAt: { not: null } });
  });
});
