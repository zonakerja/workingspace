import { describe, expect, it } from "vitest";
import {
  categoryKey,
  classificationText,
  classifyRequest,
  DEFAULT_CATEGORIES,
  normalizeKeywords,
  type CategoryRule,
} from "./request-categories";

const rules: CategoryRule[] = DEFAULT_CATEGORIES.map((c, position) => ({
  key: c.key,
  label: c.label,
  keywords: c.keywords,
  archived: false,
  isDefault: !!c.isDefault,
  position,
}));

describe("request categories", () => {
  it("classifies by whole-word keywords and falls back to the default category", () => {
    expect(classifyRequest(rules, "Permohonan PSP laptop").key).toBe("psp");
    expect(classifyRequest(rules, "Usul penghapusan kendaraan dinas").key).toBe("penghapusan");
    expect(classifyRequest(rules, "Sewa tanah dermaga").key).toBe("pemanfaatan");
    expect(classifyRequest(rules, "Persewaan kios").key).toBe("lainnya");
    expect(classifyRequest(rules, "mohon arahan").key).toBe("surat");
    expect(classifyRequest(rules, "Undangan rapat").matched).toBeNull();
  });

  it("prefers the longer (more specific) keyword and skips archived categories", () => {
    const custom: CategoryRule[] = [
      ...rules,
      {
        key: "panitia",
        label: "SK Panitia",
        keywords: ["sk panitia penghapusan"],
        archived: false,
        isDefault: false,
        position: 9,
      },
    ];
    expect(classifyRequest(custom, "Mohon SK panitia penghapusan BMN").key).toBe("panitia");
    const archived = custom.map((c) => (c.key === "panitia" ? { ...c, archived: true } : c));
    expect(classifyRequest(archived, "Mohon SK panitia penghapusan BMN").key).toBe("penghapusan");
    const ownDefault = rules.map((c) => ({ ...c, isDefault: c.key === "surat" }));
    expect(classifyRequest(ownDefault, "Undangan rapat").key).toBe("surat");
  });

  it("builds unique keys and clean keyword lists", () => {
    expect(categoryKey("Disposisi Pimpinan", [])).toBe("disposisi-pimpinan");
    expect(categoryKey("Disposisi Pimpinan", ["disposisi-pimpinan"])).toBe("disposisi-pimpinan-2");
    expect(categoryKey("!!!", [])).toBe("kategori");
    expect(normalizeKeywords("Sewa, sewa ,  , KSP\nBGS")).toEqual(["sewa", "ksp", "bgs"]);
    expect(classificationText({ title: "A", fileNames: ["b.pdf"] })).toContain("b.pdf");
  });
});
