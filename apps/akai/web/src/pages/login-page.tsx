import { ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api } from "@/lib/api";
import { ThemeToggle } from "@workingspace/ui/theme-toggle";
import { AkaiWordmark } from "@/components/akai-mark";

const POINTS = [
  "Satu tempat untuk router & API key model AI",
  "Pembagian tugas + cadangan otomatis",
  "Dipakai Akasha dan aplikasi workingspace.id lain",
];

/**
 * Masuk Akai lewat akun Workingspace (SSO). Sudah masuk SSO → otomatis masuk (pemeriksaan diam-diam `silent=1`, sekali;
 * hasilnya `?sso_checked=1`). Sudah punya sesi Akai → langsung ke tujuan.
 */
export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = params.get("returnTo") ?? "/chat";
  const error = params.get("sso_error");
  const checked = params.get("sso_checked") === "1" || !!error;
  const [state, setState] = useState<"checking" | "ready" | "disabled">("checking");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await api.me();
        if (alive) navigate(returnTo, { replace: true });
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) {
          if (alive) setState("ready");
          return;
        }
      }
      const config = await api.config().catch(() => ({ sso: false }));
      if (!alive) return;
      if (!config.sso) return setState("disabled");
      if (!checked) {
        window.location.replace(`/api/auth/sso/start?silent=1&returnTo=${encodeURIComponent(returnTo)}`);
        return;
      }
      setState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [checked, navigate, returnTo]);

  const start = `/api/auth/sso/start?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div className="flex min-h-svh items-center justify-center bg-background bg-aurora-soft p-4 sm:p-8">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[28px] border bg-card shadow-lift md:grid-cols-[1fr_1.1fr]">
        <section className="relative flex flex-col justify-between gap-10 overflow-hidden bg-aurora p-8 text-ink-foreground md:p-10">
          <div className="pointer-events-none absolute inset-0 bg-grid" />
          <div className="pointer-events-none absolute -right-16 -bottom-24 size-72 rounded-full bg-lime/20 blur-3xl" />
          <div className="relative flex items-center justify-between gap-3">
            <AkaiWordmark subtitle="Asisten AI workingspace.id" />
            <ThemeToggle onDark />
          </div>
          <div className="relative">
            <p className="font-display text-2xl leading-tight font-bold md:text-3xl">
              Otak AI untuk <span className="text-gradient">semua ruang kerja</span> Anda.
            </p>
            <ul className="mt-6 hidden flex-col gap-2.5 md:flex">
              {POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2.5 text-sm opacity-85">
                  <span className="flex size-5 items-center justify-center rounded-full bg-white/12 ring-1 ring-white/20">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs font-medium opacity-60">© 2026 workingspace.id</p>
        </section>
        <section className="flex min-w-0 flex-col justify-center gap-6 p-6 sm:p-8 md:p-12">
          <div>
            <h1 className="text-3xl font-bold">Masuk ke Akai</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Gunakan akun Workingspace yang sama dengan Akasha.</p>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {state === "checking" ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Memeriksa akun Workingspace…
            </div>
          ) : state === "disabled" ? (
            <p className="text-sm text-muted-foreground">
              Masuk lewat akun Workingspace belum diatur di server Akai ini.
            </p>
          ) : (
            <Button size="lg" asChild className="w-full">
              <a href={start}>
                Masuk dengan akun Workingspace
                <ArrowRight data-icon="inline-end" />
              </a>
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
