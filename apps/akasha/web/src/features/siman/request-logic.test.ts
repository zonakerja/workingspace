import { describe, expect, it } from "vitest";
import type { SimanRequest } from "@/types/entities";
import { filterRequests, formatRupiah, requestCounts, statusParts, ticketOptions } from "./request-logic";

const r = (over: Partial<SimanRequest>): SimanRequest =>
  ({ id: over.ticket, ticket: "PPL00000000000000001", active: true, ...over }) as SimanRequest;

const items = [
  r({
    ticket: "PPL26110408030558728",
    date: "2026-11-04",
    disposed: true,
    satkerName: "KANTOR UPBU LETUNG",
    status: "7.4.3 - Proses Penelitian Analis Eselon 1",
  }),
  r({
    ticket: "PPL26091509580231330",
    date: "2026-09-15",
    disposed: true,
    satkerName: "OTBAN VI PADANG",
    status: "11.4.5 - Selesai Proses Penerbitan",
  }),
  r({
    ticket: "PPL26100100000000001",
    date: "2026-10-01",
    disposed: false,
    satkerName: "Bandara Gorontalo",
    status: "7.4.3 - Proses",
  }),
  r({ ticket: "PPL26010100000000009", date: "2026-01-01", disposed: false, active: false }),
];

describe("request-logic", () => {
  it("bawaan hanya tiket yang didisposisikan, terbaru dulu", () => {
    const list = filterRequests(items, { scope: "disposed", stage: "any", search: "", showInactive: false });
    expect(list.map((i) => i.satkerName)).toEqual(["KANTOR UPBU LETUNG", "OTBAN VI PADANG"]);
    expect(filterRequests(items, { scope: "all", stage: "any", search: "", showInactive: false })).toHaveLength(3);
    expect(filterRequests(items, { scope: "all", stage: "done", search: "", showInactive: false })).toHaveLength(1);
    expect(
      filterRequests(items, { scope: "all", stage: "any", search: "gorontalo", showInactive: false }),
    ).toHaveLength(1);
    expect(requestCounts(items, false)).toEqual({ disposed: 2, all: 3, disposedOpen: 1 });
  });

  it("pilihan tiket workflow: disposisi yang masih diproses", () => {
    expect(ticketOptions(items).map((o) => o.value)).toEqual(["PPL26110408030558728"]);
    expect(ticketOptions(items, true)).toHaveLength(2);
    expect(ticketOptions(items)[0].label).toContain("LETUNG");
  });

  it("format", () => {
    expect(formatRupiah(99467100)).toBe("Rp 99.467.100");
    expect(formatRupiah(null)).toBe("-");
    expect(statusParts("7.4.3 - Proses Penelitian")).toEqual({ code: "7.4.3", label: "Proses Penelitian" });
  });
});
