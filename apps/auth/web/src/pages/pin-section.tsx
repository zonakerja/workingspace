import { LockKeyhole } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Notice } from "@/components/auth-layout";
import { PasswordField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type Account, type PinStatus, api, errorText } from "@/lib/api";
import { formatDateTime, pinProblem } from "@/lib/format";
import { Section } from "./account-page";

function PinInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        className="h-11 max-w-40 text-center font-mono tracking-[0.5em]"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </Field>
  );
}

/**
 * PIN keamanan bersama semua aplikasi Workingspace (mis. membuka item terkunci & Kirim Konsep di Akasha).
 * Atur / ganti / atur ulang PIN yang lupa memakai kata sandi akun.
 */
export function PinSection({ account }: { account: Account }) {
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [mode, setMode] = useState<"view" | "set" | "remove">("view");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .pinStatus()
      .then((value) => alive && setStatus(value))
      .catch((err: unknown) => alive && setMessage({ tone: "error", text: errorText(err) }));
    return () => {
      alive = false;
    };
  }, []);

  const reset = (next: "view" | "set" | "remove") => {
    setMode(next);
    setPin("");
    setConfirm("");
    setPassword("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "set") {
      const problem = pinProblem(pin, confirm);
      if (problem) return setMessage({ tone: "error", text: problem });
    }
    setBusy(true);
    setMessage(null);
    try {
      const pass = account.hasPassword ? password : undefined;
      const next = mode === "set" ? await api.setPin(pin, pass) : await api.removePin(pass);
      setStatus(next);
      setMessage({ tone: "success", text: mode === "set" ? "PIN disimpan." : "PIN dihapus." });
      reset("view");
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id="pin"
      icon={<LockKeyhole />}
      title="PIN keamanan"
      description="Satu PIN 6 angka untuk semua aplikasi: membuka item terkunci dan menyetujui tindakan penting."
    >
      {!status ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {status.hasPin ? <Badge>PIN aktif</Badge> : <Badge variant="secondary">Belum diatur</Badge>}
            {status.blockedUntil && (
              <Badge variant="destructive">Diblokir sampai {formatDateTime(status.blockedUntil)}</Badge>
            )}
          </div>
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          {mode === "view" ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => reset("set")}>{status.hasPin ? "Ganti / atur ulang PIN" : "Atur PIN"}</Button>
              {status.hasPin && (
                <Button variant="ghost" onClick={() => reset("remove")}>
                  Hapus PIN
                </Button>
              )}
            </div>
          ) : (
            <form onSubmit={submit}>
              <FieldGroup>
                {mode === "set" ? (
                  <div className="flex flex-wrap gap-4">
                    <PinInput id="pin-new" label="PIN baru" value={pin} onChange={setPin} />
                    <PinInput id="pin-confirm" label="Ulangi PIN" value={confirm} onChange={setConfirm} />
                  </div>
                ) : (
                  <Notice tone="error">
                    Tanpa PIN, item yang sudah dikunci di aplikasi tidak bisa dibuka sampai PIN dibuat lagi.
                  </Notice>
                )}
                {account.hasPassword ? (
                  <PasswordField id="pin-password" label="Kata sandi akun" value={password} onChange={setPassword} />
                ) : (
                  <FieldDescription>
                    Akun tanpa kata sandi: berlaku bila Anda masuk kurang dari 15 menit yang lalu.
                  </FieldDescription>
                )}
                {mode === "set" && status.hasPin && (
                  <FieldDescription>
                    Lupa PIN? Cukup buat PIN baru dengan kata sandi akun; blokir ikut dibuka.
                  </FieldDescription>
                )}
                <div className="flex gap-2">
                  <Button type="submit" variant={mode === "remove" ? "destructive" : "default"} disabled={busy}>
                    {busy ? <Spinner /> : mode === "set" ? "Simpan PIN" : "Hapus PIN"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => reset("view")}>
                    Batal
                  </Button>
                </div>
              </FieldGroup>
            </form>
          )}
        </div>
      )}
    </Section>
  );
}
