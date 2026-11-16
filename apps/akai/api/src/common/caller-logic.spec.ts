import { describe, expect, it } from "vitest";
import { parseBasicAuth, parseClients } from "./caller-logic";

const secret = "s".repeat(32);

describe("parseClients", () => {
  it("membaca daftar aplikasi", () => {
    expect(parseClients(JSON.stringify([{ client_id: "akasha", client_secret: secret }]))).toEqual([
      { client_id: "akasha", client_secret: secret },
    ]);
  });
  it("menolak JSON rusak, kosong, id salah, ganda, secret pendek", () => {
    expect(() => parseClients("x")).toThrow(/JSON/);
    expect(() => parseClients("[]")).toThrow(/minimal/);
    expect(() => parseClients(JSON.stringify([{ client_id: "Akasha", client_secret: secret }]))).toThrow(/client_id/);
    const dup = { client_id: "akasha", client_secret: secret };
    expect(() => parseClients(JSON.stringify([dup, dup]))).toThrow(/ganda/);
    expect(() => parseClients(JSON.stringify([{ client_id: "akasha", client_secret: "pendek" }]))).toThrow(/32/);
  });
});

describe("parseBasicAuth", () => {
  it("membaca id & secret", () => {
    const header = `Basic ${Buffer.from("akasha:rahasia:dengan:titik-dua").toString("base64")}`;
    expect(parseBasicAuth(header)).toEqual({ id: "akasha", secret: "rahasia:dengan:titik-dua" });
  });
  it("null untuk header lain / tanpa id", () => {
    expect(parseBasicAuth("Bearer x")).toBeNull();
    expect(parseBasicAuth(undefined)).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from(":x").toString("base64")}`)).toBeNull();
  });
});
