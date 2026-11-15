import { AppWindow, KeyRound, LaptopMinimal, UserRound } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AppHeader } from "@/components/app-header";
import { Notice } from "@/components/auth-layout";
import { NameField, PASSWORD_HINT, PasswordField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { type Account, ApiError, type SessionRow, api, errorText } from "@/lib/api";
import { deviceLabel, formatDateTime } from "@/lib/format";
import { PinSection } from "./pin-section";

export function Section({
  id,
  icon,
  title,
  description,
  children,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-4">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Halaman akun: aplikasi yang boleh dibuka, profil, kata sandi, sesi masuk. */
export function AccountPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((value) => alive && setAccount(value))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) navigate("/login?next=/account", { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  if (!account)
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    );

  return (
    <div className="min-h-svh bg-background">
      <AppHeader superAdmin={account.superAdmin} />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        {params.get("verified") && <Notice tone="success">Email terverifikasi. Akun Anda sudah aktif.</Notice>}
        <div>
          <h1 className="text-xl font-bold">Halo, {account.name}</h1>
          <p className="text-sm text-muted-foreground">
            {account.email}
            {account.superAdmin && (
              <Badge variant="secondary" className="ml-2">
                Super admin
              </Badge>
            )}
          </p>
        </div>
        <AppsSection account={account} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ProfileSection account={account} onSaved={setAccount} />
          <PasswordSection account={account} />
        </div>
        <PinSection account={account} />
        <SessionsSection />
      </main>
    </div>
  );
}

function AppsSection({ account }: { account: Account }) {
  return (
    <Section icon={<AppWindow />} title="Aplikasi" description="Aplikasi yang bisa Anda buka dengan akun ini.">
      {account.apps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada aplikasi. Minta admin memberi akses ke aplikasi yang Anda butuhkan.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {account.apps.map((app) => (
            <a
              key={app.key}
              href={app.url}
              className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-accent"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{app.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {app.url.replace(/^https?:\/\//, "")}
                </span>
              </span>
              <Badge variant={app.role === "admin" ? "default" : "secondary"}>
                {app.role === "admin" ? "Admin" : "Anggota"}
              </Badge>
            </a>
          ))}
        </div>
      )}
    </Section>
  );
}

function ProfileSection({ account, onSaved }: { account: Account; onSaved: (a: Account) => void }) {
  const [name, setName] = useState(account.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      onSaved(await api.updateProfile(name));
      setMessage({ tone: "success", text: "Nama disimpan." });
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section icon={<UserRound />} title="Profil" description="Nama ini dipakai di semua aplikasi.">
      <form onSubmit={submit}>
        <FieldGroup>
          <NameField id="profile-name" label="Nama lengkap" value={name} onChange={setName} />
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <Button type="submit" disabled={busy || name.trim() === account.name}>
            {busy ? <Spinner /> : "Simpan"}
          </Button>
        </FieldGroup>
      </form>
    </Section>
  );
}

function PasswordSection({ account }: { account: Account }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.changePassword(account.hasPassword ? current : undefined, next);
      setCurrent("");
      setNext("");
      setMessage({ tone: "success", text: "Kata sandi diganti. Sesi di perangkat lain dikeluarkan." });
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<KeyRound />}
      title={account.hasPassword ? "Ganti kata sandi" : "Buat kata sandi"}
      description={
        account.hasPassword
          ? undefined
          : "Akun ini masuk lewat Google; kata sandi membuat Anda bisa masuk dengan email juga."
      }
    >
      <form onSubmit={submit}>
        <FieldGroup>
          {account.hasPassword && (
            <PasswordField id="pw-current" label="Kata sandi saat ini" value={current} onChange={setCurrent} />
          )}
          <PasswordField
            id="pw-next"
            label="Kata sandi baru"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            hint={PASSWORD_HINT}
          />
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <Button type="submit" disabled={busy || !next}>
            {busy ? <Spinner /> : "Simpan kata sandi"}
          </Button>
        </FieldGroup>
      </form>
    </Section>
  );
}

function SessionsSection() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .sessions()
      .then(setRows)
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  const revoke = async (id: string) => {
    try {
      await api.revokeSession(id);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Section
      icon={<LaptopMinimal />}
      title="Perangkat yang masuk"
      description="Sesi halaman akun ini di setiap perangkat."
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!rows ? (
        <Spinner />
      ) : (
        <ul className="flex flex-col divide-y">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {deviceLabel(row.userAgent)}
                  {row.current && (
                    <Badge variant="secondary" className="ml-2">
                      Perangkat ini
                    </Badge>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  Aktif {formatDateTime(row.lastSeenAt)}
                  {row.ip ? ` · ${row.ip}` : ""}
                </span>
              </span>
              {!row.current && (
                <Button variant="ghost" size="sm" onClick={() => revoke(row.id)}>
                  Keluarkan
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
