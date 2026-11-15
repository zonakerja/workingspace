/** Pembacaan konfigurasi OIDC dari env (logika murni, diuji di oidc-config.spec.ts). */

export interface OidcClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
}

const isUrl = (value: unknown) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/** `OIDC_CLIENTS` = JSON array. Setiap klien = satu aplikasi (client_id = kunci aplikasi di tabel apps). */
export function parseClients(raw: string, production: boolean): OidcClientConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OIDC_CLIENTS bukan JSON yang valid.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Error("OIDC_CLIENTS harus array berisi minimal satu klien.");
  const seen = new Set<string>();
  return parsed.map((item, index) => {
    const c = item as Partial<OidcClientConfig>;
    const where = `OIDC_CLIENTS[${index}]`;
    if (typeof c.client_id !== "string" || !/^[a-z][a-z0-9-]{1,40}$/.test(c.client_id))
      throw new Error(`${where}.client_id wajib huruf kecil/angka/tanda hubung.`);
    if (seen.has(c.client_id)) throw new Error(`${where}.client_id ganda: ${c.client_id}`);
    seen.add(c.client_id);
    if (typeof c.client_secret !== "string" || c.client_secret.length < 32)
      throw new Error(`${where}.client_secret minimal 32 karakter.`);
    const redirects = c.redirect_uris ?? [];
    const logouts = c.post_logout_redirect_uris ?? [];
    if (!Array.isArray(redirects) || redirects.length === 0 || !redirects.every(isUrl))
      throw new Error(`${where}.redirect_uris wajib berisi alamat http(s).`);
    if (!Array.isArray(logouts) || !logouts.every(isUrl))
      throw new Error(`${where}.post_logout_redirect_uris tidak valid.`);
    if (production && [...redirects, ...logouts].some((u) => new URL(u).protocol !== "https:"))
      throw new Error(`${where}: alamat wajib https di production.`);
    return {
      client_id: c.client_id,
      client_secret: c.client_secret,
      redirect_uris: redirects,
      post_logout_redirect_uris: logouts,
    };
  });
}

/** `OIDC_JWKS` = JSON `{ keys: [...] }` berisi kunci privat (RSA/EC) dengan `kid`. */
export function parseJwks(raw: string): { keys: Record<string, unknown>[] } {
  let parsed: { keys?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OIDC_JWKS bukan JSON yang valid.");
  }
  const keys = parsed.keys;
  if (!Array.isArray(keys) || keys.length === 0) throw new Error("OIDC_JWKS harus berisi minimal satu kunci.");
  for (const key of keys as Record<string, unknown>[]) {
    if (typeof key.kid !== "string" || !key.kid) throw new Error("Setiap kunci OIDC_JWKS wajib punya kid.");
    if (key.kty !== "RSA" && key.kty !== "EC") throw new Error("Kunci OIDC_JWKS harus RSA atau EC.");
    if (typeof key.d !== "string") throw new Error("Kunci OIDC_JWKS harus kunci privat (punya d).");
  }
  return { keys: keys as Record<string, unknown>[] };
}

/** Klaim aplikasi di token: `{ akasha: "admin" }`; super admin ekosistem = admin di semua aplikasi. */
export function appClaims(memberships: { appKey: string; role: string }[]) {
  return Object.fromEntries(memberships.map((m) => [m.appKey, m.role]));
}

/** Boleh membuka aplikasi? Super admin selalu boleh; lainnya wajib punya keanggotaan aplikasi itu. */
export function canOpenApp(account: { superAdmin: boolean; memberships: { appKey: string }[] }, appKey: string) {
  return account.superAdmin || account.memberships.some((m) => m.appKey === appKey);
}
