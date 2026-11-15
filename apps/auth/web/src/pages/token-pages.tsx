import { CircleCheck } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AuthLayout, Notice } from "@/components/auth-layout";
import { EmailField, PASSWORD_HINT, PasswordField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { api, errorText } from "@/lib/api";

/** Tautan verifikasi dari email: `/verify?token=` → akun aktif & langsung masuk. */
export function VerifyPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Sekali saja (StrictMode dev menjalankan efek dua kali; token hanya bisa dipakai sekali)
    if (started.current || !token) return;
    started.current = true;
    api
      .verify(token)
      .then(() => navigate("/account?verified=1", { replace: true }))
      .catch((err: unknown) => setError(errorText(err)));
  }, [token, navigate]);
  const shownError = token ? error : "Tautan verifikasi tidak lengkap.";

  return (
    <AuthLayout title="Verifikasi email">
      {shownError ? (
        <div className="flex flex-col gap-4">
          <Notice tone="error">{shownError}</Notice>
          <p className="text-sm text-muted-foreground">
            Masuk dengan email & kata sandi Anda, lalu pilih <b>Kirim ulang email verifikasi</b> untuk tautan baru.
          </p>
          <Button asChild variant="secondary" className="h-11">
            <Link to="/login">Ke halaman masuk</Link>
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
          <Spinner /> Memverifikasi…
        </div>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMessage((await api.forgot(email)).message);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Lupa kata sandi" description="Kami kirim tautan untuk mengatur ulang kata sandi ke email Anda.">
      {message ? (
        <Notice tone="success">{message}</Notice>
      ) : (
        <form onSubmit={submit}>
          <FieldGroup>
            <EmailField id="email" label="Email" value={email} onChange={setEmail} autoFocus />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" size="lg" className="h-11 w-full text-base font-bold" disabled={busy}>
              {busy ? <Spinner /> : "Kirim tautan"}
            </Button>
          </FieldGroup>
        </form>
      )}
      <Link className="mt-6 text-sm font-medium text-primary hover:underline" to="/login">
        Kembali ke halaman masuk
      </Link>
    </AuthLayout>
  );
}

/** Tautan reset dari email: `/reset?token=`. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) return setError("Konfirmasi kata sandi tidak sama.");
    setBusy(true);
    setError(null);
    try {
      await api.reset(token, password);
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <AuthLayout title="Kata sandi diganti">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 p-4 text-sm">
            <CircleCheck className="size-6 shrink-0 text-success" />
            Kata sandi baru sudah aktif. Anda keluar dari semua perangkat; masuk lagi dengan kata sandi baru.
          </div>
          <Button asChild className="h-11 font-bold">
            <Link to="/login">Masuk</Link>
          </Button>
        </div>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Atur ulang kata sandi">
      {!token ? (
        <Notice tone="error">Tautan tidak lengkap. Minta tautan baru dari halaman Lupa kata sandi.</Notice>
      ) : (
        <form onSubmit={submit}>
          <FieldGroup>
            <PasswordField
              id="password"
              label="Kata sandi baru"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              autoFocus
              hint={PASSWORD_HINT}
            />
            <PasswordField
              id="confirm"
              label="Ulangi kata sandi baru"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" size="lg" className="h-11 w-full text-base font-bold" disabled={busy}>
              {busy ? <Spinner /> : "Simpan kata sandi"}
            </Button>
          </FieldGroup>
        </form>
      )}
      <Link className="mt-6 text-sm font-medium text-primary hover:underline" to="/forgot-password">
        Minta tautan baru
      </Link>
    </AuthLayout>
  );
}
