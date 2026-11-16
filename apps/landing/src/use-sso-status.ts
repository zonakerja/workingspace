import { useEffect, useState } from "react";
import { AUTH_URL } from "./config";

export type SsoStatus = { state: "unknown" } | { state: "signedOut" } | { state: "signedIn"; name: string };

/**
 * Status masuk akun workingspace.id dari halaman SSO (GET /api/auth/status dengan cookie sesi SSO). Halaman depan & SSO
 * satu situs (workingspace.id / auth.workingspace.id), jadi cookie ikut terkirim. Galat jaringan = dianggap belum masuk.
 */
export function useSsoStatus(): SsoStatus {
  const [status, setStatus] = useState<SsoStatus>({ state: "unknown" });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${AUTH_URL}/api/auth/status`, { credentials: "include", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { signedIn?: boolean; name?: string } | null) =>
        setStatus(data?.signedIn ? { state: "signedIn", name: data.name ?? "" } : { state: "signedOut" }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setStatus({ state: "signedOut" });
      });
    return () => controller.abort();
  }, []);
  return status;
}
