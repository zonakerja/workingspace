import {
  ArrowUpRight,
  AtSign,
  BadgeCheck,
  Briefcase,
  Building2,
  Check,
  Crown,
  KeyRound,
  LaptopMinimal,
  LayoutGrid,
  MapPin,
  Phone,
  Smartphone,
  Sparkles,
  UserRound,
} from "lucide-react";
import { type ComponentProps, type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AccountShell } from "@/components/account-shell";
import { Notice } from "@/components/auth-layout";
import { ProductMark, UserAvatar } from "@workingspace/ui/brand";
import { PRODUCTS, productName } from "@workingspace/ui/ecosystem";
import { NameField, PASSWORD_HINT, PasswordField } from "@/components/form-fields";
import { Section, StatusPill } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { type Account, type SessionRow, api, errorText } from "@/lib/api";
import { ROLE_LABELS, deviceLabel, isMobileAgent, relativeTime, securityChecks } from "@/lib/format";
import { useMe } from "@/lib/use-me";
import { cn } from "@/lib/utils";
import { PinSection } from "./pin-section";

/** Aplikasi ekosistem yang sedang dibangun (ditampilkan bila akun belum punya aksesnya). */
const UPCOMING_APPS = PRODUCTS.filter((p) => !p.available);
const taglineOf = (key: string) => PRODUCTS.find((p) => p.key === key)?.tagline;

/** Halaman akun: ringkasan, aplikasi, profil, kata sandi, PIN, perangkat. */
export function AccountPage() {
  const [account, setAccount] = useMe("/account");
  const [params] = useSearchParams();

  return (
    <AccountShell account={account} page="account">
      {account && (
        <>
          {params.get("verified") && <Notice tone="success">Email terverifikasi. Akun Anda sudah aktif.</Notice>}
          <Hero account={account} />
          <AppsSection account={account} />
          <ProfileSection account={account} onSaved={setAccount} />
          <div id="keamanan" className="grid scroll-mt-24 grid-cols-1 gap-5 xl:grid-cols-2">
            <PasswordSection account={account} onChanged={() => setAccount({ ...account, hasPassword: true })} />
            <PinSection account={account} onChange={(hasPin) => setAccount({ ...account, hasPin })} />
          </div>
          <SessionsSection />
        </>
      )}
    </AccountShell>
  );
}

function ScoreRing({ score }: { score: number }) {
  const radius = 34;
  const length = 2 * Math.PI * radius;
  return (
    <div className="relative size-24 shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="7" className="stroke-white/12" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - score / 100)}
          className="stroke-lime transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl leading-none font-bold">{score}</span>
        <span className="text-[10px] font-medium tracking-wide opacity-70">dari 100</span>
      </span>
    </div>
  );
}

function Hero({ account }: { account: Account }) {
  const { checks, score } = securityChecks(account);
  const firstName = account.name.trim().split(/\s+/)[0] ?? account.name;
  return (
    <section
      id="ringkasan"
      className="relative scroll-mt-24 overflow-hidden rounded-[28px] bg-aurora p-6 text-ink-foreground shadow-lift sm:p-8"
    >
      <div className="pointer-events-none absolute inset-0 bg-grid" />
      <div className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-cyan/25 blur-3xl" />
      <div className="relative grid grid-cols-1 gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div className="min-w-0">
          <div className="flex items-center gap-4">
            <UserAvatar
              name={account.name}
              seed={account.id}
              className="size-16 text-xl ring-4 ring-white/15 sm:size-20 sm:text-2xl"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.16em] uppercase opacity-70">Akun Workingspace</p>
              <h1 className="truncate text-3xl font-bold sm:text-4xl">Halo, {firstName}</h1>
              <p className="truncate text-sm opacity-75">{account.email}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {account.superAdmin && (
              <HeroChip>
                <Crown /> Super admin
              </HeroChip>
            )}
            <HeroChip>
              <LayoutGrid /> {account.apps.length} aplikasi
            </HeroChip>
            {account.emailVerified && (
              <HeroChip>
                <BadgeCheck /> Email terverifikasi
              </HeroChip>
            )}
            {account.google && <HeroChip>Google tertaut</HeroChip>}
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/15 backdrop-blur-md">
          <ScoreRing score={score} />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Keamanan akun</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {checks.map((check) => (
                <li key={check.key} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full",
                      check.done ? "bg-lime text-ink" : "ring-1 ring-white/40",
                    )}
                  >
                    {check.done && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  {check.done ? (
                    <span className="opacity-90">{check.label}</span>
                  ) : (
                    <Link to={`/account#${check.hash}`} className="font-medium underline-offset-2 hover:underline">
                      {check.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/15 [&_svg]:size-3.5">
      {children}
    </span>
  );
}

const hostOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

function AppsSection({ account }: { account: Account }) {
  const upcoming = UPCOMING_APPS.filter((app) => !account.apps.some((a) => a.key === app.key));
  return (
    <Section
      id="aplikasi"
      icon={<LayoutGrid />}
      eyebrow="Akses"
      title="Aplikasi Anda"
      description="Masuk sekali, buka aplikasi mana pun tanpa login ulang."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {account.apps.map((app) => (
          <a
            key={app.key}
            href={app.url}
            className="group ring-aurora relative flex flex-col gap-4 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:shadow-lift"
          >
            <div className="flex items-start justify-between gap-3">
              <ProductMark appKey={app.key} name={app.name} className="size-12 shadow-soft" />
              <ArrowUpRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-display truncate text-lg font-bold">{productName(app.key, app.name)}</p>
              {taglineOf(app.key) && (
                <p className="truncate text-xs font-medium text-primary italic">{taglineOf(app.key)}</p>
              )}
              <p className="truncate text-xs text-muted-foreground">{hostOf(app.url)}</p>
            </div>
            <StatusPill tone={app.role === "admin" ? "brand" : "muted"} className="self-start">
              {ROLE_LABELS[app.role]}
            </StatusPill>
          </a>
        ))}
        {upcoming.map((app) => (
          <div
            key={app.key}
            className="flex flex-col gap-4 rounded-2xl border border-dashed bg-surface/60 p-4 text-muted-foreground"
          >
            <ProductMark appKey={app.key} name={app.name} className="size-12 opacity-60 grayscale-[35%]" />
            <div className="min-w-0">
              <p className="font-display truncate text-lg font-bold text-foreground/70">{app.name}</p>
              <p className="truncate text-xs font-medium italic">{app.tagline}</p>
              <p className="mt-1 line-clamp-2 text-xs">{app.lead}</p>
            </div>
            <StatusPill tone="info" className="self-start">
              <Sparkles /> Segera hadir
            </StatusPill>
          </div>
        ))}
      </div>
      {account.apps.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Belum ada aplikasi yang bisa dibuka. Minta admin memberi akses ke aplikasi yang Anda butuhkan.
        </p>
      )}
    </Section>
  );
}

type ProfileForm = { name: string; phone: string; occupation: string; workplace: string; address: string };

const profileForm = (a: Account): ProfileForm => ({
  name: a.name,
  phone: a.phone ?? "",
  occupation: a.occupation ?? "",
  workplace: a.workplace ?? "",
  address: a.address ?? "",
});

/** Nomor baku "+6281234567890" ditampilkan seperti diketik orang Indonesia: "0812-3456-7890". */
const phoneDisplay = (phone: string | null) =>
  phone?.startsWith("+62") ? `0${phone.slice(3)}`.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3") : (phone ?? "");

function IconInput({
  id,
  label,
  icon,
  value,
  onChange,
  ...props
}: {
  id: string;
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
} & Omit<ComponentProps<"input">, "value" | "onChange" | "id">) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup className="h-11">
        <InputGroupAddon>{icon}</InputGroupAddon>
        <InputGroupInput id={id} value={value} onChange={(e) => onChange(e.target.value)} {...props} />
      </InputGroup>
    </Field>
  );
}

function ProfileSection({ account, onSaved }: { account: Account; onSaved: (a: Account) => void }) {
  const [form, setForm] = useState<ProfileForm>(() => ({
    ...profileForm(account),
    phone: phoneDisplay(account.phone),
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const set = (key: keyof ProfileForm) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const saved = { ...profileForm(account), phone: phoneDisplay(account.phone) };
  const dirty = (Object.keys(form) as (keyof ProfileForm)[]).some((k) => form[k].trim() !== saved[k].trim());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const next = await api.updateProfile(form);
      onSaved(next);
      setForm({ ...profileForm(next), phone: phoneDisplay(next.phone) });
      setMessage({ tone: "success", text: "Profil disimpan." });
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const methods = [account.hasPassword && "Email & kata sandi", account.google && "Google"].filter(Boolean);

  return (
    <Section
      id="profil"
      icon={<UserRound />}
      eyebrow="Identitas"
      title="Profil"
      description="Data ini dipakai bersama oleh semua aplikasi workingspace.id."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <form onSubmit={submit}>
          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NameField id="profile-name" label="Nama lengkap" value={form.name} onChange={set("name")} />
              <IconInput
                id="profile-phone"
                label="Nomor HP"
                icon={<Phone />}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0812-3456-7890"
                maxLength={30}
                value={form.phone}
                onChange={set("phone")}
              />
              <IconInput
                id="profile-occupation"
                label="Pekerjaan / jabatan"
                icon={<Briefcase />}
                autoComplete="organization-title"
                placeholder="Mis. Analis Pengelolaan BMN"
                maxLength={100}
                value={form.occupation}
                onChange={set("occupation")}
              />
              <IconInput
                id="profile-workplace"
                label="Tempat bekerja"
                icon={<Building2 />}
                autoComplete="organization"
                placeholder="Nama instansi / perusahaan"
                maxLength={150}
                value={form.workplace}
                onChange={set("workplace")}
              />
            </div>
            <Field>
              <FieldLabel htmlFor="profile-address">Alamat</FieldLabel>
              <Textarea
                id="profile-address"
                rows={3}
                autoComplete="street-address"
                placeholder="Jalan, nomor, kelurahan, kecamatan, kota, kode pos"
                maxLength={300}
                value={form.address}
                onChange={(e) => set("address")(e.target.value)}
              />
            </Field>
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            <Button type="submit" className="self-start" disabled={busy || !dirty || form.name.trim().length < 2}>
              {busy ? <Spinner /> : "Simpan profil"}
            </Button>
          </FieldGroup>
        </form>
        <dl className="flex flex-col divide-y self-start rounded-2xl border bg-surface/60 px-4">
          <InfoRow icon={<AtSign />} label="Email">
            <span className="truncate">{account.email}</span>
            {account.emailVerified ? (
              <StatusPill tone="success">
                <BadgeCheck /> Terverifikasi
              </StatusPill>
            ) : (
              <StatusPill tone="warning">Belum verifikasi</StatusPill>
            )}
          </InfoRow>
          <InfoRow icon={<KeyRound />} label="Cara masuk">
            {methods.length ? methods.join(" · ") : "—"}
          </InfoRow>
          <InfoRow icon={<Crown />} label="Peran ekosistem">
            {account.superAdmin ? "Super admin" : "Pengguna"}
          </InfoRow>
          <InfoRow icon={<MapPin />} label="Dibagikan ke aplikasi">
            <span className="font-normal text-muted-foreground">
              Nama, email, HP, alamat, pekerjaan & tempat bekerja dikirim ke aplikasi workingspace.id yang Anda buka.
            </span>
          </InfoRow>
        </dl>
      </div>
    </Section>
  );
}

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
      {icon}
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">{children}</dd>
      </div>
    </div>
  );
}

function PasswordSection({ account, onChanged }: { account: Account; onChanged: () => void }) {
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
      setMessage({ tone: "success", text: "Kata sandi disimpan. Sesi di perangkat lain dikeluarkan." });
      onChanged();
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<KeyRound />}
      eyebrow="Keamanan"
      title={account.hasPassword ? "Ganti kata sandi" : "Buat kata sandi"}
      description={
        account.hasPassword
          ? "Mengganti kata sandi mengeluarkan sesi di perangkat lain."
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
          <Button type="submit" className="self-start" disabled={busy || !next}>
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
      id="perangkat"
      icon={<LaptopMinimal />}
      eyebrow="Sesi"
      title="Perangkat yang masuk"
      description="Keluarkan perangkat yang tidak Anda kenali."
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!rows ? (
        <Spinner />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((row) => {
            const Icon = isMobileAgent(row.userAgent) ? Smartphone : LaptopMinimal;
            return (
              <li
                key={row.id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border p-3",
                  row.current ? "border-primary/30 bg-primary/5" : "bg-surface/60",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl",
                    row.current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{deviceLabel(row.userAgent)}</span>
                    {row.current && <StatusPill tone="brand">Perangkat ini</StatusPill>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Aktif {relativeTime(row.lastSeenAt)}
                    {row.ip ? ` · ${row.ip}` : ""}
                  </span>
                </span>
                {!row.current && (
                  <Button variant="ghost" size="sm" onClick={() => revoke(row.id)}>
                    Keluarkan
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
