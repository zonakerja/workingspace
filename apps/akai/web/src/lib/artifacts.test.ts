import { describe, expect, it } from "vitest";
import { collectVersions, downloadInfo, parseArtifacts } from "./artifacts";

describe("artifacts", () => {
  it("memisahkan teks & artifact, atribut dibaca", () => {
    const segs = parseArtifacts(
      'Berikut kerangkanya.\n<akai_artifact identifier="kerangka-laporan" type="markdown" title="Kerangka Laporan">\n# Bab 1\nIsi\n</akai_artifact>\nSemoga membantu.',
    );
    expect(segs.map((s) => s.kind)).toEqual(["text", "artifact", "text"]);
    const art = segs[1].kind === "artifact" ? segs[1].artifact : null;
    expect(art).toMatchObject({
      identifier: "kerangka-laporan",
      type: "markdown",
      title: "Kerangka Laporan",
      content: "# Bab 1\nIsi",
      complete: true,
    });
  });

  it("artifact belum selesai saat stream & tag pembuka setengah jadi", () => {
    const open = parseArtifacts('Ok <akai_artifact identifier="a" type="html" title="Hal">\n<html>');
    expect(open[1]).toMatchObject({ kind: "artifact", artifact: { complete: false, content: "<html>" } });
    expect(parseArtifacts("Sebentar <akai_arti")).toEqual([{ kind: "text", text: "Sebentar " }]);
  });

  it("pembungkus ``` dilepas, tipe tak dikenal = code, identifier dirapikan", () => {
    const [seg] = parseArtifacts(
      '<akai_artifact identifier="Skrip Data!" type="python" title="x">\n```python\nprint(1)\n```\n</akai_artifact>',
    );
    expect(seg).toMatchObject({
      kind: "artifact",
      artifact: { identifier: "skrip-data", type: "code", content: "print(1)" },
    });
  });

  it("versi per identifier lintas pesan", () => {
    const tag = (body: string) =>
      `<akai_artifact identifier="surat" type="markdown" title="Surat">${body}</akai_artifact>`;
    const versions = collectVersions([
      { id: "1", role: "user", content: tag("bukan") },
      { id: "2", role: "assistant", content: tag("v1") },
      { id: "3", role: "assistant", content: `Diperbarui ${tag("v2")}` },
    ]);
    expect(versions.get("surat")?.map((v) => [v.version, v.artifact.content, v.messageId])).toEqual([
      [1, "v1", "2"],
      [2, "v2", "3"],
    ]);
  });

  it("nama unduhan", () => {
    const base = { identifier: "x", title: "X", content: "", complete: true };
    expect(downloadInfo({ ...base, type: "code", language: "python" }).filename).toBe("x.py");
    expect(downloadInfo({ ...base, type: "html", language: "" })).toEqual({ filename: "x.html", mime: "text/html" });
    expect(downloadInfo({ ...base, type: "code", language: "cobol" }).filename).toBe("x.txt");
  });
});
