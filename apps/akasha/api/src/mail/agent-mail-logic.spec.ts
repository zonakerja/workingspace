import { describe, expect, it } from "vitest";
import { checkAgentEmail, freeSlots, sendEmailTitle } from "./agent-mail-logic";

describe("alat agen email & kalender", () => {
  it("waktu luang di antara agenda berjam", () => {
    const r = freeSlots(
      [
        { title: "Rapat", startTime: "09:00", endTime: "10:30" },
        { title: "Makan siang", startTime: "12:00" },
        { title: "Cuti", allDay: true },
        { title: "Tumpang", startTime: "09:30", endTime: "11:00" },
      ],
      { duration: 60 },
    );
    expect(r.slots).toEqual([
      { start: "08:00", end: "09:00", minutes: 60 },
      { start: "11:00", end: "12:00", minutes: 60 },
      { start: "13:00", end: "17:00", minutes: 240 },
    ]);
    expect(r.allDay).toEqual(["Cuti"]);
    expect(freeSlots([], { duration: 30, from: "07:00", to: "08:00" }).slots).toEqual([
      { start: "07:00", end: "08:00", minutes: 60 },
    ]);
  });

  it("permintaan kirim email: penerima dirapikan & divalidasi", () => {
    expect(checkAgentEmail({ to: ["A@x.id", "a@x.id"], subject: " Halo ", body: "isi" })).toEqual({
      to: ["a@x.id"],
      subject: "Halo",
      body: "isi",
    });
    expect(checkAgentEmail({ to: ["bukan"], subject: "x", body: "y" })).toMatchObject({
      error: expect.stringMatching(/tidak valid/),
    });
    expect(checkAgentEmail({ to: ["a@x.id"], subject: "", body: "y" })).toMatchObject({
      error: expect.stringMatching(/Subjek/),
    });
    expect(sendEmailTitle(["a@x.id", "b@x.id"], "Undangan")).toBe("Kirim email ke a@x.id (+1): Undangan");
  });
});
