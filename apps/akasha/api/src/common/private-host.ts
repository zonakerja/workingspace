const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain", "host.docker.internal"]);

/** Host jaringan lokal / privat (tidak boleh dituju server produksi atas isian user). */
export function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOSTS.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return true;
  }
  if (PRIVATE_V4.some((re) => re.test(host))) return true;
  // IPv6: loopback, unspecified, link-local, unique local, IPv4-mapped
  if (host.includes(":"))
    return host === "::1" || host === "::" || /^(fe8|fe9|fea|feb|fc|fd)/.test(host) || host.startsWith("::ffff:");
  return false;
}
