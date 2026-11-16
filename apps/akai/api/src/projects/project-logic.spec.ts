import { describe, expect, it } from "vitest";
import {
  FULL_KNOWLEDGE_CHARS,
  chunkText,
  normalizeExtracted,
  projectContext,
  projectFileKind,
  selectKnowledge,
} from "./project-logic";

describe("project-logic", () => {
  it("jenis berkas pengetahuan", () => {
    expect(projectFileKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(projectFileKind("application/octet-stream", "surat.docx")).toBe("docx");
    expect(projectFileKind("text/markdown", "a.md")).toBe("text");
    expect(projectFileKind("image/png", "a.png")).toBeNull();
  });

  it("merapikan teks ekstraksi", () => {
    expect(normalizeExtracted("a  \r\n\r\n\r\n\r\nb").text).toBe("a\n\nb");
  });

  it("memotong per paragraf", () => {
    const chunks = chunkText(["a".repeat(1500), "b".repeat(1500), "c".repeat(100)].join("\n\n"), 2000);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toContain("c");
    expect(chunkText("x".repeat(4500), 2000)).toHaveLength(3);
  });

  it("memilih potongan relevan dan menjaga urutan", () => {
    const files = [
      {
        name: "a.md",
        text: ["Kebijakan cuti pegawai tahunan.", "x ".repeat(1000), "Prosedur pengadaan barang."].join("\n\n"),
      },
      { name: "b.md", text: "Jadwal rapat koordinasi anggaran." },
    ];
    const picked = selectKnowledge(files, "bagaimana prosedur pengadaan barang?", 1500);
    expect(picked.map((c) => c.text).join(" ")).toContain("pengadaan");
    expect(picked.every((c) => !c.text.startsWith("x "))).toBe(true);
  });

  it("konteks proyek: instruksi + dokumen utuh bila muat, potongan bila besar", () => {
    const small = projectContext({ name: "BMN", instructions: "Jawab formal." }, [{ name: "a.md", text: "isi" }], "q");
    expect(small).toContain('proyek "BMN"');
    expect(small).toContain("<instruksi_proyek>\nJawab formal.");
    expect(small).toContain('<dokumen nama="a.md">\nisi');
    const big = projectContext(
      { name: "P", instructions: "" },
      [{ name: "besar.txt", text: `${"lorem ipsum ".repeat(FULL_KNOWLEDGE_CHARS / 10)}\n\nkata kunci khusus zeta` }],
      "zeta",
    );
    expect(big).toContain("potongan=");
    expect(big).toContain("zeta");
    expect(big).not.toContain("<instruksi_proyek>");
    expect(big.length).toBeLessThan(FULL_KNOWLEDGE_CHARS);
  });
});
