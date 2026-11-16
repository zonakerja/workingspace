import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { type Account, ApiError, api } from "./api";

/**
 * Akun yang sedang masuk untuk halaman akun & admin. Belum masuk → halaman masuk (kembali ke `returnTo`);
 * `superAdminOnly` → akun biasa dialihkan ke /account.
 */
export function useMe(returnTo: string, options: { superAdminOnly?: boolean } = {}) {
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const { superAdminOnly = false } = options;

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((value) => {
        if (!alive) return;
        if (superAdminOnly && !value.superAdmin) navigate("/account", { replace: true });
        else setAccount(value);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401)
          navigate(`/login?next=${encodeURIComponent(returnTo)}`, { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [navigate, returnTo, superAdminOnly]);

  return [account, setAccount] as const;
}
