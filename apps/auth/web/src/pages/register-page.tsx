import { MailCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { AuthLayout, Notice } from "@/components/auth-layout";
import { EmailField, NameField, PASSWORD_HINT, PasswordField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { api, errorText } from "@/lib/api";

export function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) return setError("Konfirmasi kata sandi tidak sama.");
    setBusy(true);
    setError(null);
    try {
      await api.register(name, email, password);
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <AuthLayout
        title="Cek email Anda"
        description={
          <>
            Tautan verifikasi dikirim ke <b>{email}</b>.
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-2xl border bg-muted/40 p-4 text-sm">
            <MailCheck className="size-6 shrink-0 text-primary" />
            Klik tautan di email untuk mengaktifkan akun. Tautan berlaku 24 jam. Tidak ada di kotak masuk? Periksa
            folder spam.
          </div>
          <Button asChild variant="secondary" className="h-11">
            <Link to={`/login?email=${encodeURIComponent(email)}`}>Ke halaman masuk</Link>
          </Button>
        </div>
      </AuthLayout>
    );

  return (
    <AuthLayout title="Daftar akun" description="Satu akun untuk semua aplikasi workingspace.id.">
      <form onSubmit={submit}>
        <FieldGroup>
          <NameField id="name" label="Nama lengkap" value={name} onChange={setName} autoFocus />
          <EmailField id="email" label="Email" value={email} onChange={setEmail} />
          <PasswordField
            id="password"
            label="Kata sandi"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={PASSWORD_HINT}
          />
          <PasswordField
            id="confirm"
            label="Ulangi kata sandi"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" className="h-11 w-full text-base font-bold" disabled={busy}>
            {busy ? <Spinner /> : "Daftar"}
          </Button>
        </FieldGroup>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Sudah punya akun?{" "}
        <Link className="font-medium text-primary hover:underline" to="/login">
          Masuk
        </Link>
      </p>
    </AuthLayout>
  );
}
