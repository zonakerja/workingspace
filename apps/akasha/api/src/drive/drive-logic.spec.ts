import { describe, expect, it } from "vitest";
import { authorizeUrl, hasDriveScope, oauthEndpoints } from "../connections/oauth-logic";
import {
  coldCutoff,
  coldFileName,
  coldMinBytes,
  contentRange,
  fromGoogleFile,
  fromGraphItem,
  normalizeColdSettings,
  pickColdBatch,
  safeFileName,
  sortDriveItems,
  UPLOAD_CHUNK,
} from "./drive-logic";

describe("izin Drive", () => {
  it("scope Drive diminta hanya bila diminta", () => {
    const ep = oauthEndpoints("google", {});
    const base = { clientId: "c", redirectUri: "http://x/cb", state: "s", verifier: "v".repeat(43) };
    expect(new URL(authorizeUrl("google", ep, base)).searchParams.get("scope")).not.toContain("drive.file");
    expect(new URL(authorizeUrl("google", ep, { ...base, drive: true })).searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/drive.file",
    );
  });

  it("mengenali scope tersimpan, termasuk berawalan alamat Graph", () => {
    expect(hasDriveScope("google", "openid https://www.googleapis.com/auth/drive.file")).toBe(true);
    expect(hasDriveScope("google", "openid https://www.googleapis.com/auth/calendar.app.created")).toBe(false);
    expect(
      hasDriveScope(
        "microsoft",
        "https://graph.microsoft.com/Files.Read https://graph.microsoft.com/Files.ReadWrite.AppFolder Mail.Read",
      ),
    ).toBe(true);
    expect(hasDriveScope("microsoft", "Files.Read Mail.Read")).toBe(false);
  });
});

describe("berkas Drive", () => {
  it("dokumen Google diekspor ke format Office, jenis lain ditolak", () => {
    const doc = fromGoogleFile({ id: "a", name: "Laporan", mimeType: "application/vnd.google-apps.document" });
    expect(doc).toMatchObject({
      name: "Laporan.docx",
      exportMime: expect.stringContaining("wordprocessingml"),
      size: null,
    });
    expect(fromGoogleFile({ id: "b", name: "Survei", mimeType: "application/vnd.google-apps.form" })).toBeNull();
    expect(fromGoogleFile({ id: "c", name: "a.pdf", mimeType: "application/pdf", size: "2048" })).toMatchObject({
      size: 2048,
      folder: false,
    });
  });

  it("item OneDrive: berkas & folder, folder di atas", () => {
    const items = [
      fromGraphItem({ id: "1", name: "z.pdf", size: 10, file: { mimeType: "application/pdf" } }),
      fromGraphItem({ id: "2", name: "Arsip", folder: { childCount: 2 } }),
      fromGraphItem({ id: "3", name: "Notebook", package: { type: "oneNote" } }),
    ].filter((x) => x !== null);
    expect(items).toHaveLength(2);
    expect(sortDriveItems(items).map((i) => i.name)).toEqual(["Arsip", "z.pdf"]);
  });

  it("nama berkas aman", () => {
    expect(safeFileName('a/b:c*"d', ".pdf")).toBe("a b c d.pdf");
    expect(safeFileName("  ")).toBe("berkas");
  });
});

describe("arsip dingin", () => {
  it("pengaturan dinormalkan & dibatasi", () => {
    expect(normalizeColdSettings(null)).toMatchObject({ enabled: false, afterDays: 180, minSizeMb: 1 });
    expect(normalizeColdSettings({ enabled: true, afterDays: 3, minSizeMb: -2 })).toMatchObject({
      enabled: true,
      afterDays: 30,
      minSizeMb: 0,
    });
  });

  it("batas waktu & ukuran minimum", () => {
    const now = new Date("2026-11-18T00:00:00Z");
    expect(coldCutoff({ afterDays: 30 }, now).toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(coldMinBytes({ minSizeMb: 0 })).toBe(1);
    expect(coldMinBytes({ minSizeMb: 1 })).toBe(1048576);
  });

  it("satu putaran dibatasi jumlah & ukuran", () => {
    const files = [{ size: 5 }, { size: 8 }, { size: 3 }, { size: 1 }];
    expect(pickColdBatch(files, 10, 10)).toEqual([{ size: 5 }, { size: 3 }, { size: 1 }]);
    expect(pickColdBatch(files, 2, 100)).toHaveLength(2);
    // berkas pertama yang lebih besar dari batas tetap diambil agar berkas besar tidak tertahan selamanya
    expect(pickColdBatch([{ size: 50 }], 10, 10)).toHaveLength(1);
  });

  it("nama berkas di Drive unik per objek", () => {
    expect(coldFileName("u1/2026/01/1700000000-abc.pdf", "SK Panitia.pdf")).toBe("1700000000-abc SK Panitia.pdf");
  });

  it("potongan unggahan memenuhi syarat Google & OneDrive", () => {
    expect(UPLOAD_CHUNK % 327_680).toBe(0);
    expect(UPLOAD_CHUNK % 262_144).toBe(0);
    expect(contentRange(0, 10, 25)).toBe("bytes 0-9/25");
  });
});
