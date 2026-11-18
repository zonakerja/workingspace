import { describe, expect, it } from "vitest";
import {
  detectHints,
  findAmounts,
  findDates,
  findTime,
  resolveImap,
  suggestAgenda,
  suggestTodo,
  trimBody,
} from "./inbox-logic";

const opts = { isPrivate: (h: string) => h === "localhost", production: true };
const sent = new Date("2026-11-17T02:00:00Z");

describe("kotak masuk email", () => {
  it("IMAP: preset Gmail, host privat ditolak, port dibatasi", () => {
    expect(resolveImap("gmail", {}, opts)).toEqual({ host: "imap.gmail.com", port: 993, secure: true });
    expect(resolveImap("custom", { imapHost: "localhost" }, opts)).toMatch(/publik/);
    expect(resolveImap("custom", { imapHost: "mail.x.id", imapPort: 110 }, opts)).toMatch(/Port/);
    expect(resolveImap("custom", { imapHost: "mail.x.id", imapPort: 143 }, opts)).toMatchObject({ secure: false });
  });

  it("tanggal & nominal & jam dalam bahasa Indonesia", () => {
    expect(findDates("jatuh tempo 25 November 2026, dibuat 20/11/2026", 2026)).toEqual(["2026-11-25", "2026-11-20"]);
    expect(findDates("Senin, 1 Des", 2026)).toEqual(["2026-12-01"]);
    expect(findDates("31 Februari 2026", 2026)).toEqual([]);
    expect(findAmounts("Total Rp 1.250.000 dan IDR 2,500,000.00 serta Rp1.000,00")).toEqual([1250000, 2500000, 1000]);
    expect(findTime("dimulai pukul 09.30 WIB")).toBe("09:30");
  });

  it("tagihan: kata kunci + nominal, tanggal jatuh tempo setelah tanggal email", () => {
    const h = detectHints(
      "Tagihan Listrik November",
      "Total tagihan Anda Rp 412.500. Jatuh tempo 20 November 2026. Periode 1 Oktober 2026.",
      sent,
    );
    expect(h).toMatchObject({ kind: "bill", amount: 412500, date: "2026-11-20" });
    expect(
      suggestTodo({ subject: "Tagihan Listrik November", fromAddress: "pln@x.id" }, h, "2026-11-17"),
    ).toMatchObject({
      title: "Bayar tagihan Rp 412.500: Tagihan Listrik November",
      date: "2026-11-20",
      priority: "high",
    });
  });

  it("jadwal: undangan + tanggal + jam → usulan agenda", () => {
    const h = detectHints(
      "Undangan Rapat Koordinasi",
      "Dilaksanakan Kamis, 19 November 2026 pukul 13.00 WIB via Zoom",
      sent,
    );
    expect(h).toMatchObject({ kind: "schedule", date: "2026-11-19", time: "13:00" });
    expect(suggestAgenda({ subject: "Undangan Rapat Koordinasi" }, h, "2026-11-17")).toEqual({
      title: "Undangan Rapat Koordinasi",
      startDate: "2026-11-19",
      startTime: "13:00",
    });
    expect(detectHints("Halo", "apa kabar", sent).kind).toBe("none");
  });

  it("isi email: kutipan balasan dibuang", () => {
    const body = "Baik pak.\n\nTerima kasih.\nSalam\nOn Mon, 16 Nov 2026 at 10:00 Budi wrote:\n> isi lama";
    expect(trimBody(body)).toBe("Baik pak.\n\nTerima kasih.\nSalam");
  });
});
