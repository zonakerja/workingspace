import { AkashaMark } from "@workingspace/ui/brand";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { appLogoUrl, useAppSettings } from "@/data/use-app-settings";
import { useSsoConfig } from "@/data/use-auth";
import { rememberSsoLogin } from "@/features/security/pin-prompt";
import { API_BASE_URL } from "@/lib/api/client";
import { useAuthStore } from "@/stores/auth-store";
import { markSilentSso, silentSsoAllowed } from "./silent-sso";

/** Halaman masuk Akasha: hanya lewat akun Workingspace (SSO). Tidak ada kata sandi lokal. */
function LoginPage() {
  const { settings } = useAppSettings();
  const logoUrl = appLogoUrl(settings);
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const location = useLocation();
  const { data: sso, isLoading } = useSsoConfig();
  const [params] = useSearchParams();
  const ssoError = params.get("sso_error");
  const [silentAllowed] = useState(() => silentSsoAllowed());

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  // Sudah masuk di akun Workingspace (SSO) → Akasha ikut masuk tanpa klik. Tidak dilakukan setelah pemeriksaan gagal
  // (`sso_checked`), saat ada galat SSO, atau bila baru saja dicoba di tab ini.
  const silentCheck = !isAuthenticated && !!sso?.enabled && silentAllowed && !params.get("sso_checked") && !ssoError;
  useEffect(() => {
    if (!silentCheck) return;
    markSilentSso();
    window.location.replace(`${API_BASE_URL}/auth/sso/start?silent=1&returnTo=${encodeURIComponent(from)}`);
  }, [silentCheck, from]);

  if (isAuthenticated) return <Navigate to={from} replace />;
  if (silentCheck)
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
        <Spinner />
        Memeriksa akun Workingspace…
      </div>
    );

  // Masuk lewat SSO = navigasi penuh (bukan fetch): SSO mengarahkan kembali ke /api/v1/auth/sso/callback
  const startSso = () => {
    rememberSsoLogin();
    window.location.assign(`${API_BASE_URL}/auth/sso/start?returnTo=${encodeURIComponent(from)}`);
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4 sm:p-8">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border bg-card shadow-2xl shadow-primary/10 md:grid-cols-[1fr_1.1fr]">
        {/* Panel branding */}
        <section
          data-module="overview"
          className="relative flex flex-col justify-between gap-10 overflow-hidden bg-module-gradient p-8 text-white md:p-10"
        >
          <div className="pointer-events-none absolute inset-0 bg-dots opacity-70" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-white/15 blur-3xl" />
          <div className="pointer-events-none absolute -top-20 -right-20 size-64 rounded-full bg-mod-planner/40 blur-3xl" />

          <div className="relative flex items-center gap-4">
            {logoUrl ? (
              <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-lg">
                <img src={logoUrl} alt="" className="size-full object-cover" />
              </span>
            ) : (
              <AkashaMark className="size-16 shadow-lg" />
            )}
            <div className="min-w-0">
              <p className="truncate text-3xl font-extrabold tracking-wider">{settings.name}</p>
              <p className="mt-1 text-sm font-bold tracking-widest text-white/80 uppercase">{settings.loginSub}</p>
            </div>
          </div>

          <h2 className="relative text-2xl leading-snug font-bold md:text-3xl">{settings.motto}</h2>

          <div className="relative flex flex-wrap gap-2">
            {(["planner", "notes", "working-space", "files"] as const).map((key) => (
              <span key={key} data-module={key} className="h-1.5 w-10 rounded-full bg-module ring-1 ring-white/40" />
            ))}
          </div>
          <p className="relative text-xs font-medium text-white/75">{settings.footerText}</p>
        </section>

        <section className="flex flex-col justify-center p-8 md:p-12">
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight">{settings.welcomeTitle}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{settings.welcomeSub}</p>
          </div>

          {ssoError && (
            <p
              role="alert"
              className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              {ssoError}
            </p>
          )}
          {isLoading ? (
            <Spinner className="mx-auto" />
          ) : sso?.enabled ? (
            <>
              <Button type="button" size="lg" className="h-11 w-full text-base font-bold" onClick={startSso}>
                <ShieldCheck /> Masuk dengan akun Workingspace
              </Button>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Satu akun untuk Akasha, Akasha AI, dan aplikasi workingspace.id lainnya.
              </p>
            </>
          ) : (
            <p
              role="alert"
              className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground"
            >
              Masuk lewat akun Workingspace belum diatur di server (SSO_ISSUER / SSO_CLIENT_ID / SSO_CLIENT_SECRET /
              SSO_REDIRECT_URI). Akasha hanya bisa dimasuki lewat SSO.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Dipakai `lazy` router. */
export const Component = LoginPage;
