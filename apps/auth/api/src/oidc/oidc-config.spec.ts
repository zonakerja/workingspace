import { describe, expect, it } from "vitest";
import { appClaims, canOpenApp, parseClients, parseJwks } from "./oidc-config";

const secret = "s".repeat(32);
const client = {
  client_id: "akasha",
  client_secret: secret,
  redirect_uris: ["http://localhost:5173/api/v1/auth/sso/callback"],
  post_logout_redirect_uris: ["http://localhost:5173/login"],
};

describe("parseClients", () => {
  it("membaca klien yang valid", () => {
    expect(parseClients(JSON.stringify([client]), false)).toEqual([client]);
  });

  it("menolak JSON rusak, id tidak sah, secret pendek, alamat salah, dan id ganda", () => {
    expect(() => parseClients("{", false)).toThrow(/JSON/);
    expect(() => parseClients("[]", false)).toThrow(/minimal satu/);
    expect(() => parseClients(JSON.stringify([{ ...client, client_id: "Akasha!" }]), false)).toThrow(/client_id/);
    expect(() => parseClients(JSON.stringify([{ ...client, client_secret: "x" }]), false)).toThrow(/32/);
    expect(() => parseClients(JSON.stringify([{ ...client, redirect_uris: ["javascript:x"] }]), false)).toThrow(
      /redirect_uris/,
    );
    expect(() => parseClients(JSON.stringify([client, client]), false)).toThrow(/ganda/);
  });

  it("mewajibkan https di production", () => {
    expect(() => parseClients(JSON.stringify([client]), true)).toThrow(/https/);
  });
});

describe("parseJwks", () => {
  it("mewajibkan kunci privat ber-kid", () => {
    expect(() => parseJwks('{"keys":[]}')).toThrow(/minimal satu/);
    expect(() => parseJwks('{"keys":[{"kty":"RSA","n":"x","e":"AQAB"}]}')).toThrow(/kid/);
    expect(() => parseJwks('{"keys":[{"kid":"a","kty":"RSA","n":"x","e":"AQAB"}]}')).toThrow(/privat/);
    expect(parseJwks('{"keys":[{"kid":"a","kty":"EC","d":"x"}]}').keys).toHaveLength(1);
  });
});

describe("akses aplikasi", () => {
  it("klaim role per aplikasi", () => {
    expect(appClaims([{ appKey: "akasha", role: "admin" }])).toEqual({ akasha: "admin" });
  });

  it("super admin selalu boleh, lainnya butuh keanggotaan", () => {
    expect(canOpenApp({ superAdmin: true, memberships: [] }, "akasha")).toBe(true);
    expect(canOpenApp({ superAdmin: false, memberships: [{ appKey: "akai" }] }, "akasha")).toBe(false);
    expect(canOpenApp({ superAdmin: false, memberships: [{ appKey: "akasha" }] }, "akasha")).toBe(true);
  });
});
