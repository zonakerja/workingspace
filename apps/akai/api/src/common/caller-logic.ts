/** Pembacaan kredensial aplikasi pemanggil (logika murni, diuji di caller-logic.spec.ts). */

export interface AkaiClient {
  client_id: string;
  client_secret: string;
}

/** `AKAI_CLIENTS` = JSON array `{ client_id, client_secret }` (secret ≥ 32 karakter, id unik huruf kecil). */
export function parseClients(raw: string): AkaiClient[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AKAI_CLIENTS bukan JSON yang valid.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Error("AKAI_CLIENTS harus array berisi minimal satu aplikasi.");
  const seen = new Set<string>();
  return parsed.map((item, index) => {
    const c = item as Partial<AkaiClient>;
    if (typeof c.client_id !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(c.client_id))
      throw new Error(`AKAI_CLIENTS[${index}].client_id wajib huruf kecil/angka/tanda hubung.`);
    if (c.client_id === "web") throw new Error(`AKAI_CLIENTS[${index}].client_id "web" dipakai Akai web sendiri.`);
    if (seen.has(c.client_id)) throw new Error(`AKAI_CLIENTS[${index}].client_id ganda.`);
    seen.add(c.client_id);
    if (typeof c.client_secret !== "string" || c.client_secret.length < 32)
      throw new Error(`AKAI_CLIENTS[${index}].client_secret minimal 32 karakter.`);
    return { client_id: c.client_id, client_secret: c.client_secret };
  });
}

/** Header `Authorization: Basic base64(id:secret)` → id & secret (URL-decoded), atau null. */
export function parseBasicAuth(header: string | undefined): { id: string; secret: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i <= 0) return null;
  try {
    return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
  } catch {
    return null;
  }
}
