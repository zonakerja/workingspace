import { describe, expect, it } from "vitest";
import type { Resource } from "@/types/entities";
import { countResourceTypes, fileExtension, linkHost, resourceKind, resourceTypeGroup } from "./resource-view";

const res = (values: Partial<Resource>): Resource => ({ id: "r", title: "", type: "file", ...values });

describe("resource-view", () => {
  it("mengenali jenis berkas dari ekstensi lalu MIME", () => {
    expect(resourceKind(res({ title: "SK Panitia.PDF" }))).toBe("pdf");
    expect(resourceKind(res({ title: "Rekap.xlsx" }))).toBe("sheet");
    expect(resourceKind(res({ title: "Paparan.pptx" }))).toBe("slide");
    expect(resourceKind(res({ title: "Foto kegiatan", mimeType: "image/jpeg" }))).toBe("image");
    expect(resourceKind(res({ title: "Tanpa ekstensi" }))).toBe("file");
  });

  it("membedakan link dan catatan", () => {
    expect(resourceKind(res({ type: "link", url: "https://jdih.go.id" }))).toBe("link");
    expect(resourceKind(res({ type: "note", noteId: "free-1" }))).toBe("note");
    expect(resourceKind(res({ type: "file", noteId: "ai-9" }))).toBe("note");
    expect(resourceTypeGroup(res({ title: "a.docx" }))).toBe("file");
  });

  it("menghitung per tipe data", () => {
    expect(
      countResourceTypes([res({ title: "a.pdf" }), res({ type: "link" }), res({ type: "note", noteId: "list-1" })]),
    ).toEqual({ all: 3, file: 1, link: 1, note: 1 });
  });

  it("membaca ekstensi dan host", () => {
    expect(fileExtension("laporan.final.docx")).toBe("docx");
    expect(fileExtension("tanpa")).toBe("");
    expect(linkHost("www.jdih.go.id/peraturan")).toBe("jdih.go.id");
    expect(linkHost("bukan url ::")).toBe("");
  });
});
