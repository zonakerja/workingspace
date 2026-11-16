import dns from "node:dns";

/**
 * Development: nama `*.localhost` (mis. SSO dev `auth.workingspace.localhost:5175`) diarahkan ke `localhost`. Chrome & curl
 * melakukannya sendiri (RFC 6761), tetapi resolver Windows tidak, sehingga backend gagal memanggil SSO (discovery OIDC,
 * status akun, PIN). Tidak dipakai di production: uji stack produksi memakai alias jaringan Docker untuk nama *.localhost.
 */
export function mapLocalhostSubdomains() {
  const original = dns.lookup;
  const patched = function (this: unknown, hostname: string, ...rest: unknown[]) {
    const target = typeof hostname === "string" && hostname.endsWith(".localhost") ? "localhost" : hostname;
    return (original as (...args: unknown[]) => unknown).call(this, target, ...rest);
  };
  (dns as { lookup: unknown }).lookup = patched;
}
