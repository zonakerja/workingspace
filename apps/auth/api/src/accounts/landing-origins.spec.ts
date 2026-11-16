import { describe, expect, it } from "vitest";
import { landingOrigins } from "./landing-origins";

describe("landingOrigins", () => {
  it("membaca daftar origin dan membuang yang tidak sah", () => {
    expect(
      landingOrigins("https://workingspace.id/, http://workingspace.localhost:5176/x , ftp://a, bukan-url"),
    ).toEqual(["https://workingspace.id", "http://workingspace.localhost:5176"]);
    expect(landingOrigins(undefined)).toEqual([]);
  });
});
