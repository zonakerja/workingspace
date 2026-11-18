import { describe, expect, it } from "vitest";
import {
  agendaFields,
  fieldsKey,
  fromGoogleEvent,
  fromGraphEvent,
  inWindow,
  mergeIntoSchedule,
  shouldApplyRemote,
  toGoogleEvent,
  toGraphEvent,
  toLocal,
} from "./calendar-sync-logic";
import { authorizeUrl, oauthEndpoints, parseTokenResponse, profileIdentity, tokenExpired } from "./oauth-logic";

describe("OAuth akun tersambung", () => {
  it("URL izin Google: offline + consent + PKCE, scope kalender buatan aplikasi saja", () => {
    const url = new URL(
      authorizeUrl("google", oauthEndpoints("google", {}), {
        clientId: "cid",
        redirectUri: "http://localhost:5173/api/v1/connections/oauth/callback",
        state: "st",
        verifier: "v".repeat(43),
      }),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("calendar.app.created");
    expect(url.searchParams.get("scope")).not.toContain("gmail");
  });

  it("Microsoft: tenant consumers bawaan, server tiruan untuk uji", () => {
    expect(oauthEndpoints("microsoft", {}).token).toContain("/consumers/oauth2/v2.0/token");
    expect(oauthEndpoints("microsoft", { testBase: "http://localhost:4510/" }).api).toBe(
      "http://localhost:4510/ms/v1.0",
    );
  });

  it("token: refresh token lama dipertahankan, galat penyedia dibaca", () => {
    const t = parseTokenResponse({ access_token: "a", expires_in: 3600 }, 1000, {
      access_token: "x",
      refresh_token: "r",
      expires_at: 0,
    });
    expect(t).toEqual({ access_token: "a", refresh_token: "r", expires_at: 1000 + 3_600_000 });
    expect(tokenExpired(t, 1000 + 3_500_000)).toBe(true);
    expect(() =>
      parseTokenResponse({ error: "invalid_grant", error_description: "Token has been expired" }, 0),
    ).toThrow(/expired/);
    expect(profileIdentity("microsoft", { userPrincipalName: "A@Outlook.com", displayName: "A" })).toEqual({
      email: "a@outlook.com",
      displayName: "A",
    });
  });
});

describe("kalender dua arah", () => {
  const tz = "Asia/Jakarta" as const;

  it("agenda berjam ↔ Google (zona WIB) bolak-balik sama", () => {
    const f = agendaFields({
      title: "Rapat",
      startDate: "2026-11-20",
      startTime: "09:00",
      endTime: "10:30",
      location: "Aula",
    })!;
    const g = toGoogleEvent(f, tz);
    expect(g.start).toEqual({ dateTime: "2026-11-20T09:00:00+07:00", timeZone: tz });
    expect(
      fromGoogleEvent(
        { id: "x", ...g, start: { dateTime: "2026-11-20T02:00:00Z" }, end: { dateTime: "2026-11-20T03:30:00Z" } },
        tz,
      ),
    ).toEqual(f);
  });

  it("sepanjang hari multi-hari: tanggal akhir eksklusif di kalender luar", () => {
    const f = agendaFields({ title: "Dinas", startDate: "2026-11-20", endDate: "2026-11-22", isAllDay: true })!;
    expect(toGoogleEvent(f, tz).end).toEqual({ date: "2026-11-23" });
    expect(
      fromGoogleEvent({ id: "x", summary: "Dinas", start: { date: "2026-11-20" }, end: { date: "2026-11-23" } }, tz),
    ).toMatchObject({
      startDate: "2026-11-20",
      endDate: "2026-11-22",
      startTime: "",
    });
    const g = toGraphEvent(f, tz);
    expect(g).toMatchObject({ isAllDay: true, end: { dateTime: "2026-11-23T00:00:00" } });
    expect(fromGraphEvent({ id: "m", subject: "Dinas", isAllDay: true, start: g.start, end: g.end }, tz)).toMatchObject(
      {
        startDate: "2026-11-20",
        endDate: "2026-11-22",
      },
    );
  });

  it("Outlook dalam UTC → jam lokal; tanpa jam selesai = 1 jam", () => {
    expect(toLocal("2026-11-20T02:00:00.0000000", tz)).toEqual({ date: "2026-11-20", time: "09:00" });
    const f = agendaFields({ title: "X", startDate: "2026-11-20", startTime: "23:30" })!;
    expect(toGraphEvent(f, tz).end).toEqual({ dateTime: "2026-11-21T00:30:00", timeZone: tz });
    expect(
      fromGraphEvent(
        {
          id: "m",
          subject: "X",
          start: { dateTime: "2026-11-20T16:30:00.0000000", timeZone: "UTC" },
          end: { dateTime: "2026-11-20T17:30:00.0000000", timeZone: "UTC" },
        },
        tz,
      ),
    ).toMatchObject({ startDate: "2026-11-20", startTime: "23:30", endDate: "2026-11-21", endTime: "00:30" });
  });

  it("gabung ke agenda lama mempertahankan key lain; sidik jari berubah bila isi berubah", () => {
    const f = agendaFields({ title: "A", startDate: "2026-11-20" })!;
    const merged = mergeIntoSchedule({ id: "s1", type: "Rapat", results: [1] }, { ...f, title: "B" }, "s1");
    expect(merged).toMatchObject({ type: "Rapat", results: [1], title: "B", isAllDay: true });
    expect(fieldsKey(f)).not.toBe(fieldsKey({ ...f, title: "B" }));
  });

  it("bentrok: agenda Akasha yang lebih baru menang", () => {
    expect(shouldApplyRemote({ localChanged: false })).toBe(true);
    expect(
      shouldApplyRemote({
        localChanged: true,
        localUpdatedAt: new Date("2026-11-18T10:00:00Z"),
        remoteUpdatedAt: "2026-11-18T09:00:00Z",
      }),
    ).toBe(false);
    expect(
      shouldApplyRemote({
        localChanged: true,
        localUpdatedAt: new Date("2026-11-18T10:00:00Z"),
        remoteUpdatedAt: "2026-11-18T11:00:00Z",
      }),
    ).toBe(true);
    expect(inWindow("2026-10-01", "2026-11-18")).toBe(false);
    expect(inWindow("2027-01-01", "2026-11-18")).toBe(true);
  });
});
