import { describe, expect, it } from "vitest";
import { applyManualCheck, mergeChecklist, normalizeChecklist, openManualChecks } from "./request-checklist";

describe("request checklist", () => {
  it("normalizes items and assigns unique ids", () => {
    const items = normalizeChecklist([
      { dokumen: "SPTJM", status: "perlu_dicek", catatan: "meterai?" },
      { dokumen: "Surat permohonan", status: "ada" },
      { dokumen: "", status: "ada" },
      { dokumen: "Foto", status: "aneh" },
    ]);
    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
    expect(items[2].status).toBe("perlu_dicek");
  });

  it("keeps the owner's manual check when the agent rewrites the checklist", () => {
    const first = normalizeChecklist([{ id: "a1", dokumen: "SPTJM bermeterai", status: "perlu_dicek", manual: true }]);
    const checked = applyManualCheck(first, "a1", "lolos", "meterai asli dicek", "2026-11-21T00:00:00Z")!;
    expect(checked.item.check?.result).toBe("lolos");
    expect(openManualChecks(checked.items)).toHaveLength(0);
    // agen menulis ulang dengan id yang sama dan teks berbeda
    const byId = mergeChecklist(checked.items, [{ id: "a1", dokumen: "SPTJM (meterai tempel)", status: "ada" }]);
    expect(byId[0].check?.result).toBe("lolos");
    // agen menulis ulang tanpa id, teks sama
    const byText = mergeChecklist(checked.items, [{ dokumen: "sptjm  bermeterai", status: "perlu_dicek" }]);
    expect(byText[0].check?.note).toBe("meterai asli dicek");
    // agen tidak bisa memalsukan tanda cek
    const forged = mergeChecklist([], [{ dokumen: "X", status: "ada", check: { result: "lolos", at: "x" } }]);
    expect(forged[0].check).toBeUndefined();
  });

  it("clears a check and reports open manual checks", () => {
    const items = normalizeChecklist([{ id: "b", dokumen: "Foto BMN", status: "perlu_dicek" }]);
    const marked = applyManualCheck(items, "b", "bermasalah", "foto buram", "t")!;
    expect(openManualChecks(marked.items)).toHaveLength(1);
    const cleared = applyManualCheck(marked.items, "b", null, null, "t")!;
    expect(cleared.item.check).toBeUndefined();
    expect(applyManualCheck(items, "zz", "lolos", null, "t")).toBeNull();
  });
});
