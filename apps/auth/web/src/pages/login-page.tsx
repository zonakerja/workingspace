import { ArrowRight, UserRoundCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AuthLayout, Notice } from "@/components/auth-layout";
import { EmailField, PasswordField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, type InteractionInfo, api, errorText } from "@/lib/api";
import { safeNext } from "@/lib/format";

/**
 * Masuk. Dengan `?uid=` = dibuka dari aplikasi (alur OIDC): setelah berhasil browser kembali ke aplikasi itu.
 * Tanpa uid = masuk ke halaman akun (atau `?next=` di situs ini).
 */
export function LoginPage() {
  const [params] = useSearchParams();
  const uid = params.get("uid");
  const navigate = useNavigate();
  const [info, setInfo] = useState<InteractionInfo | null>(null);
  const [expired, setExpired] = useState(false);
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState<string | null>(null);
  const [useOther, setUseOther] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    api
      .interaction(uid)
      .then((value) => alive && setInfo(value))
      .catch(() => alive && setExpired(true));
    return () => {
      alive = false;
    };
  }, [uid]);

  const leave = (redirectTo: string) => window.location.assign(redirectTo);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      if (uid) leave((await api.interactionLogin(uid, email, password)).redirectTo);
      else {
        await api.login(email, password);
        navigate(safeNext(params.get("next")), { replace: true });
      }
    } catch (err) {
      setError(errorText(err));
      setUnverified(err instanceof ApiError && err.code === "EMAIL_UNVERIFIED");
      setBusy(false);
    }
  };

  const continueAs = async () => {
    if (!uid) return;
    setBusy(true);
    setError(null);
    try {
      leave((await api.interactionContinue(uid)).redirectTo);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const abort = async () => {
    if (!uid) return;
    try {
      leave((await api.interactionAbort(uid)).redirectTo);
    } catch {
      setExpired(true);
    }
  };

  const resend = async () => {
    try {
      setResent((await api.resendVerification(email)).message);
    } catch (err) {
      setError(errorText(err));
    }
  };

  if (expired)
    return (
      <AuthLayout title="Sesi masuk berakhir" description="Halaman masuk ini sudah kedaluwarsa atau sudah dipakai.">
        <Notice tone="info">Buka lagi aplikasinya, lalu pilih Masuk.</Notice>
        <Button asChild variant="secondary" className="mt-4 h-11">
          <Link to="/login">Masuk ke akun Workingspace</Link>
        </Button>
      </AuthLayout>
    );

  const appName = info?.app.name;
  const signedIn = info?.account && !useOther;

  return (
    <AuthLayout
      title={appName ? `Masuk ke ${appName}` : "Masuk"}
      description={appName ? "Gunakan akun Workingspace Anda." : "Masuk ke akun Workingspace Anda."}
    >
      {uid && !info ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : signedIn ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 p-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserRoundCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{info.account!.name}</p>
              <p className="truncate text-xs text-muted-foreground">{info.account!.email}</p>
            </div>
          </div>
          {(info.accessError || error) && <Notice tone="error">{info.accessError ?? error}</Notice>}
          {!info.accessError && (
            <Button className="h-11 text-base font-bold" disabled={busy} onClick={continueAs}>
              {busy ? <Spinner /> : <>Lanjut sebagai {info.account!.name.split(" ")[0]}</>}
              {!busy && <ArrowRight />}
            </Button>
          )}
          <Button variant="secondary" className="h-11" onClick={() => setUseOther(true)}>
            Gunakan akun lain
          </Button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <FieldGroup>
            <EmailField id="email" label="Email" value={email} onChange={setEmail} autoFocus={!email} />
            <PasswordField
              id="password"
              label="Kata sandi"
              value={password}
              onChange={setPassword}
              autoFocus={!!email}
            />
            {error && <Notice tone="error">{error}</Notice>}
            {unverified && !resent && (
              <Button type="button" variant="secondary" onClick={resend}>
                Kirim ulang email verifikasi
              </Button>
            )}
            {resent && <Notice tone="success">{resent}</Notice>}
            <Button type="submit" size="lg" className="h-11 w-full text-base font-bold" disabled={busy}>
              {busy ? <Spinner /> : "Masuk"}
            </Button>
          </FieldGroup>
        </form>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm">
        <Link className="font-medium text-primary hover:underline" to="/forgot-password">
          Lupa kata sandi?
        </Link>
        <span className="text-muted-foreground">
          Belum punya akun?{" "}
          <Link className="font-medium text-primary hover:underline" to="/register">
            Daftar
          </Link>
        </span>
      </div>
      {uid && (
        <button type="button" className="mt-4 self-start text-xs text-muted-foreground hover:underline" onClick={abort}>
          Batal dan kembali ke {appName ?? "aplikasi"}
        </button>
      )}
    </AuthLayout>
  );
}
