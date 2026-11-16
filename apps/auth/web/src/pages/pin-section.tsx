import { Fingerprint, ShieldAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Notice } from "@/components/auth-layout";
import { PasswordField } from "@/components/form-fields";
import { Section, StatusPill } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type Account, type PinStatus, api, errorText } from "@/lib/api";
import { formatDateTime, pinProblem } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Enam titik penanda PIN (terisi = PIN aktif / angka sudah diketik). */
function PinDots({ filled, className }: { filled: number; className?: string }) {
  return (
    <span className={cn("flex gap-1.5", className)} aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-2.5 rounded-full transition-colors",
            i < filled ? "bg-linear-135 from-indigo to-cyan" : "bg-muted ring-1 ring-border",
          )}
        />
      ))}
    </span>
  );
}

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
      <PinDots filled={value.length} />
    </Field>
  );
}

/**
 * PIN keamanan bersama semua aplikasi Workingspace (mis. membuka item terkunci & Kirim Konsep di Akasha).
 * Atur / ganti / atur ulang PIN yang lupa memakai kata sandi akun.
 */
export function PinSection({ account, onChange }: { account: Account; onChange?: (hasPin: boolean) => void }) {
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
      onChange?.(next.hasPin);
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
      icon={<Fingerprint />}
      eyebrow="Keamanan"
      title="PIN keamanan"
      description="Satu PIN 6 angka untuk semua aplikasi: membuka item terkunci dan menyetujui tindakan penting."
    >
      {!status ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-surface/60 p-4">
            <PinDots filled={status.hasPin ? 6 : 0} />
            {status.hasPin ? (
              <StatusPill tone="success">PIN aktif</StatusPill>
            ) : (
              <StatusPill tone="muted">Belum diatur</StatusPill>
            )}
            {status.blockedUntil && (
              <StatusPill tone="danger">
                <ShieldAlert /> Diblokir sampai {formatDateTime(status.blockedUntil)}
              </StatusPill>
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
                  <div className="flex flex-wrap gap-6">
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
