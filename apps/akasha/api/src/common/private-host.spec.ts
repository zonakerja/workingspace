import { describe, expect, it } from "vitest";
import { isPrivateHost } from "./private-host";

describe("isPrivateHost", () => {
  it("mengenali alamat lokal & privat", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "192.168.1.2",
      "172.20.0.1",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "api.local",
    ]) {
      expect(isPrivateHost(host)).toBe(true);
    }
    for (const host of ["router.classai.id", "8.8.8.8", "172.32.0.1", "openrouter.ai"]) {
      expect(isPrivateHost(host)).toBe(false);
    }
  });
});
