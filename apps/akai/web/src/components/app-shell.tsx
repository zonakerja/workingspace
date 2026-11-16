import { ExternalLink, LogOut, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, type Me, api, errorText } from "@/lib/api";
import { UserAvatar } from "@workingspace/ui/brand";
import { ThemeToggle } from "@workingspace/ui/theme-toggle";
import { AkaiWordmark } from "./akai-mark";

/** Kerangka halaman yang butuh masuk: header (logo, tema, akun, keluar) + isi. Belum masuk → /login. */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Sesi diperiksa sekali saat halaman dibuka (pindah tab tidak perlu memeriksa ulang)
  const [initialPath] = useState(() => `${location.pathname}${location.search}`);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((value) => alive && setMe(value))
      .catch((error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate(`/login?returnTo=${encodeURIComponent(initialPath)}`, { replace: true });
        } else toast.error(errorText(error));
      });
    return () => {
      alive = false;
    };
  }, [initialPath, navigate]);

  async function logout() {
    setLeaving(true);
    try {
      const { ssoLogoutUrl } = await api.logout();
      // Keluar dari SSO juga (= keluar dari semua aplikasi ekosistem), lalu kembali ke /login
      window.location.assign(ssoLogoutUrl ?? "/login?sso_checked=1");
    } catch (error) {
      toast.error(errorText(error));
      setLeaving(false);
    }
  }

  if (!me)
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="size-6" />
      </div>
    );

  const name = me.account.name || me.account.email || "Akun";
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <AkaiWordmark />
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            {me.accountUrl && (
              <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                <a href={me.accountUrl}>
                  <UserRound data-icon="inline-start" />
                  Akun
                  <ExternalLink className="size-3 opacity-60" />
                </a>
              </Button>
            )}
            <span className="hidden max-w-48 truncate px-1 text-sm text-muted-foreground md:block">{name}</span>
            <UserAvatar name={name} seed={me.account.email ?? name} className="size-8 text-xs" />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={logout}
              disabled={leaving}
              aria-label="Keluar"
              title="Keluar"
            >
              {leaving ? <Spinner /> : <LogOut />}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 md:py-7">
        <Outlet />
      </main>
    </div>
  );
}
