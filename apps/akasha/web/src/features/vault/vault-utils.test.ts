import { describe, expect, it } from "vitest";
import type { VaultAccess } from "@/types/api";
import { distinctVisitors, formatVaultSize, referrerSummary, vaultUrl } from "./vault-utils";

describe("brankas digital", () => {
  it("ukuran berkas ringkas", () => {
    expect(formatVaultSize(512)).toBe("512 B");
    expect(formatVaultSize(1536)).toBe("1,5 KB");
    expect(formatVaultSize(4.7 * 1024 * 1024)).toBe("4,7 MB");
    expect(formatVaultSize(-1)).toBe("-");
  });

  it("jumlah IP berbeda & tautan lengkap", () => {
    const row = (ip: string | null) => ({ ip }) as VaultAccess;
    expect(distinctVisitors([row("1.1.1.1"), row("1.1.1.1"), row("2.2.2.2"), row(null)])).toBe(3);
    expect(vaultUrl("/brankas/bv_abc", "https://lifeos.go.id")).toBe("https://lifeos.go.id/brankas/bv_abc");
  });
});

describe("asal pembuka brankas", () => {
  it("menghitung pembukaan per asal, baris lihat/unduh tanpa asal dilewati", () => {
    const row = (kind: "ekinerja" | "none" | "other" | null) =>
      ({ referrer: kind ? { kind, label: kind } : null }) as VaultAccess;
    expect(referrerSummary([row("ekinerja"), row("ekinerja"), row("none"), row(null), row("other")])).toEqual({
      ekinerja: 2,
      app: 0,
      other: 1,
      none: 1,
    });
  });
});
