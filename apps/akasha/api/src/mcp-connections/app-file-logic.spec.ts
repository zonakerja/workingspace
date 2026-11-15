import { describe, expect, it } from "vitest";
import { appFileName, appFileUrlError, baseDomain, fileHostsFor, fileMime } from "./app-file-logic";

describe("app file logic", () => {
  it("baseDomain: dua label, atau tiga untuk akhiran negara", () => {
    expect(baseDomain("export-download.canva.com")).toBe("canva.com");
    expect(baseDomain("design.canva.ai")).toBe("canva.ai");
    expect(baseDomain("siman.kemenkeu.go.id")).toBe("kemenkeu.go.id");
    expect(baseDomain("localhost")).toBe("localhost");
  });

  it("host berkas: katalog + domain dasar server MCP", () => {
    expect(fileHostsFor("https://mcp.canva.com/mcp", ["canva.com", "canva.ai"])).toEqual(["canva.com", "canva.ai"]);
    expect(fileHostsFor("https://mcp.contoh.co.id/mcp")).toEqual(["contoh.co.id"]);
  });

  it("hanya https di domain aplikasi", () => {
    const hosts = ["canva.com", "canva.ai"];
    expect(appFileUrlError("https://export-download.canva.com/a/b.png?X-Amz=1", hosts)).toBeNull();
    expect(appFileUrlError("https://design.canva.ai/abc", hosts)).toBeNull();
    expect(appFileUrlError("http://export-download.canva.com/a.png", hosts)).toMatch(/https/);
    expect(appFileUrlError("https://evilcanva.com/a.png", hosts)).toMatch(/domain/);
    expect(appFileUrlError("https://canva.com.evil.net/a.png", hosts)).toMatch(/domain/);
    expect(appFileUrlError("https://u:p@canva.com/a.png", hosts)).toMatch(/nama/);
    expect(appFileUrlError("bukan alamat", hosts)).toMatch(/tidak valid/);
  });

  it("jenis & nama berkas", () => {
    expect(fileMime("image/png; charset=binary", "x")).toBe("image/png");
    expect(fileMime("application/octet-stream", "slide.pptx")).toMatch(/presentation/);
    expect(appFileName("https://export-download.canva.com/K/D/0001-123.png?sig=1", "image/png")).toBe("0001-123.png");
    expect(appFileName("https://a.canva.com/x", "image/png", "Poster HUT: RI/81")).toBe("Poster HUT RI 81.png");
    expect(appFileName("https://a.canva.com/x", "application/pdf", "Laporan.pdf")).toBe("Laporan.pdf");
  });
});
