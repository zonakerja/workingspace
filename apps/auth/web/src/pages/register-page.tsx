import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Briefcase,
  Building2,
  Check,
  ClipboardCheck,
  LayoutGrid,
  MailCheck,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { type ComponentProps, type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import { ProductMark, Wordmark } from "@workingspace/ui/brand";
import { ECOSYSTEM, PRODUCTS, productName } from "@workingspace/ui/ecosystem";
import { ThemeToggle } from "@workingspace/ui/theme-toggle";
import { Notice } from "@/components/auth-layout";
import { EmailField, NameField, PASSWORD_HINT, PasswordField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { PURPOSE_MAX, passwordStrength, purposeHint } from "@/lib/access";
import { type CatalogApp, api, errorText } from "@/lib/api";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "account", title: "Akun", hint: "Email & kata sandi", icon: ShieldCheck },
  { key: "profile", title: "Data diri", hint: "Kontak & pekerjaan", icon: UserRound },
  { key: "apps", title: "Akses aplikasi", hint: "Pilih & jelaskan tujuan", icon: LayoutGrid },
  { key: "review", title: "Periksa", hint: "Konfirmasi & kirim", icon: ClipboardCheck },
] as const;

const taglineOf = (key: string) => PRODUCTS.find((p) => p.key === key)?.tagline;
const STRENGTH_COLOR = ["bg-muted", "bg-destructive", "bg-warning", "bg-info", "bg-success"];

interface Form {
  name: string;
  email: string;
  password: string;
  confirm: string;
  phone: string;
  occupation: string;
  workplace: string;
  address: string;
}

const EMPTY: Form = {
  name: "",
  email: "",
  password: "",
  confirm: "",
  phone: "",
  occupation: "",
  workplace: "",
  address: "",
};

/** Galat langkah (diperiksa sebelum lanjut); server tetap memeriksa ulang semuanya. */
function stepProblem(step: number, form: Form, purposes: Record<string, string>): string | null {
  if (step === 0) {
    if (form.name.trim().length < 2) return "Isi nama lengkap.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Email tidak valid.";
    if (form.password.length < 8) return "Kata sandi minimal 8 karakter.";
    if (form.password !== form.confirm) return "Konfirmasi kata sandi tidak sama.";
  }
  if (step === 1) {
    if (form.phone.replace(/\D/g, "").length < 9) return "Isi nomor HP yang valid.";
    if (!form.occupation.trim()) return "Isi pekerjaan / jabatan.";
    if (!form.workplace.trim()) return "Isi tempat bekerja / instansi.";
  }
  if (step === 2) {
    for (const [key, purpose] of Object.entries(purposes)) {
      const hint = purposeHint(purpose);
      if (hint) return `Tujuan untuk ${productName(key, key)}: ${hint}`;
    }
  }
  return null;
}

/** Daftar akun workingspace.id: wizard 4 langkah (akun, data diri, pengajuan akses aplikasi, periksa). */
export function RegisterPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  // Aplikasi yang diajukan → tujuan / kepentingannya
  const [purposes, setPurposes] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<CatalogApp[]>([]);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void api
      .accessCatalog()
      .then(setCatalog)
      .catch(() => undefined);
  }, []);

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const next = (event?: FormEvent) => {
    event?.preventDefault();
    const problem = stepProblem(step, form, purposes);
    if (problem) return setError(problem);
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    if (!agree) return setError("Centang pernyataan persetujuan dulu.");
    setBusy(true);
    setError(null);
    try {
      await api.register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone,
        occupation: form.occupation,
        workplace: form.workplace,
        address: form.address || undefined,
        requests: Object.entries(purposes).map(([appKey, purpose]) => ({ appKey, purpose })),
      });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleApp = (key: string) =>
    setPurposes((prev) => {
      const copy = { ...prev };
      if (key in copy) delete copy[key];
      else copy[key] = "";
      return copy;
    });

  if (sent) return <SentScreen email={form.email} requested={Object.keys(purposes).length} />;

  return (
    <div className="flex min-h-svh items-center justify-center bg-background bg-aurora-soft p-3 sm:p-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border bg-card shadow-lift md:grid-cols-[17rem_1fr]">
        {/* Penunjuk langkah */}
        <aside className="relative flex flex-col gap-6 overflow-hidden bg-ink p-6 text-ink-foreground md:p-7">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
          <div className="pointer-events-none absolute -top-20 -left-16 size-56 rounded-full bg-indigo/40 blur-3xl" />
          <div className="pointer-events-none absolute -right-20 -bottom-16 size-56 rounded-full bg-cyan/25 blur-3xl" />
          <div className="relative">
            <Wordmark subtitle="Daftar akun" />
          </div>
          <ol className="relative flex gap-2 md:flex-col md:gap-0">
            {STEPS.map((s, i) => {
              const done = i < step;
              const current = i === step;
              return (
                <li key={s.key} className="flex flex-1 items-start gap-3 md:relative md:pb-6 md:last:pb-0">
                  {i < STEPS.length - 1 && (
                    <span
                      className={cn(
                        "absolute top-9 left-[17px] hidden h-[calc(100%-2.25rem)] w-px md:block",
                        done ? "bg-lime" : "bg-white/15",
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "relative flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ring-1 transition-colors",
                      done && "bg-lime text-ink ring-lime",
                      current && "bg-white text-ink ring-white shadow-[0_0_0_4px_rgb(255_255_255/0.12)]",
                      !done && !current && "bg-white/5 text-white/60 ring-white/15",
                    )}
                  >
                    {done ? <Check className="size-4" strokeWidth={3} /> : <s.icon className="size-4" />}
                  </span>
                  <span className={cn("hidden min-w-0 md:block", !current && !done && "opacity-60")}>
                    <span className="block text-sm font-semibold">{s.title}</span>
                    <span className="block text-xs opacity-70">{s.hint}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="relative mt-auto hidden md:block">
            <div className="flex -space-x-2">
              {PRODUCTS.map((p) => (
                <ProductMark key={p.key} appKey={p.key} className="size-8 rounded-lg ring-2 ring-ink" />
              ))}
            </div>
            <p className="mt-3 text-sm font-semibold">{ECOSYSTEM.tagline}</p>
            <p className="mt-1 text-xs opacity-60">{ECOSYSTEM.motto}</p>
            <div className="mt-4">
              <ThemeToggle onDark />
            </div>
          </div>
        </aside>

        {/* Isi langkah */}
        <section className="flex min-w-0 flex-col p-5 sm:p-8 md:p-10">
          <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-linear-90 from-indigo via-cyan to-lime transition-all duration-500"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
          <p className="mt-3 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Langkah {step + 1} dari {STEPS.length}
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{STEP_TITLES[step]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{STEP_LEADS[step]}</p>

          <form
            className="mt-6 flex flex-1 flex-col"
            onSubmit={step === STEPS.length - 1 ? (e) => e.preventDefault() : next}
          >
            <div className="flex-1">
              {step === 0 && <AccountStep form={form} set={set} />}
              {step === 1 && <ProfileStep form={form} set={set} />}
              {step === 2 && (
                <AppsStep
                  catalog={catalog}
                  purposes={purposes}
                  onToggle={toggleApp}
                  onPurpose={(key, value) => setPurposes((p) => ({ ...p, [key]: value }))}
                />
              )}
              {step === 3 && (
                <ReviewStep
                  form={form}
                  purposes={purposes}
                  catalog={catalog}
                  agree={agree}
                  onAgree={setAgree}
                  onEdit={setStep}
                />
              )}
            </div>

            {error && (
              <div className="mt-5">
                <Notice tone="error">{error}</Notice>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setError(null);
                    setStep((s) => s - 1);
                  }}
                >
                  <ArrowLeft /> Kembali
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sudah punya akun?{" "}
                  <Link className="font-medium text-primary hover:underline" to="/login">
                    Masuk
                  </Link>
                </p>
              )}
              {step < STEPS.length - 1 ? (
                <Button type="submit" size="lg" className="h-11 px-6 font-bold">
                  {step === 2 && Object.keys(purposes).length === 0 ? "Lewati, ajukan nanti" : "Lanjut"} <ArrowRight />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  className="h-11 px-6 font-bold"
                  disabled={busy || !agree}
                  onClick={() => void submit()}
                >
                  {busy ? <Spinner /> : <Sparkles />} Buat akun
                </Button>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

const STEP_TITLES = ["Buat akun Anda", "Kenalkan diri Anda", "Aplikasi yang Anda butuhkan", "Periksa sebelum mengirim"];
const STEP_LEADS = [
  "Satu akun untuk semua aplikasi workingspace.id.",
  "Dipakai admin untuk memverifikasi pengajuan akses dan menghubungi Anda bila perlu.",
  "Akses aplikasi diberikan terbatas. Pilih aplikasi dan jelaskan tujuan atau kepentingannya — admin meninjau setiap pengajuan.",
  "Pastikan data benar. Setelah dikirim, kami mengirim tautan verifikasi ke email Anda.",
];

function AccountStep({ form, set }: { form: Form; set: (k: keyof Form) => (v: string) => void }) {
  const strength = passwordStrength(form.password);
  return (
    <FieldGroup>
      <NameField id="name" label="Nama lengkap" value={form.name} onChange={set("name")} autoFocus />
      <EmailField id="email" label="Email" value={form.email} onChange={set("email")} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PasswordField
          id="password"
          label="Kata sandi"
          value={form.password}
          onChange={set("password")}
          autoComplete="new-password"
        />
        <PasswordField
          id="confirm"
          label="Ulangi kata sandi"
          value={form.confirm}
          onChange={set("confirm")}
          autoComplete="new-password"
        />
      </div>
      <div>
        <div className="flex gap-1.5" aria-hidden>
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                strength.score >= n ? STRENGTH_COLOR[strength.score] : "bg-muted",
              )}
            />
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {strength.label ? <b className="text-foreground">{strength.label}. </b> : null}
          {PASSWORD_HINT}
        </p>
      </div>
    </FieldGroup>
  );
}

function IconInput({
  id,
  label,
  icon,
  value,
  onChange,
  hint,
  ...props
}: {
  id: string;
  label: string;
  icon: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
} & Omit<ComponentProps<"input">, "value" | "onChange" | "id">) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup className="h-11">
        <InputGroupAddon>{icon}</InputGroupAddon>
        <InputGroupInput id={id} value={value} onChange={(e) => onChange(e.target.value)} {...props} />
      </InputGroup>
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}

function ProfileStep({ form, set }: { form: Form; set: (k: keyof Form) => (v: string) => void }) {
  return (
    <FieldGroup>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <IconInput
          id="phone"
          label="No. HP / WhatsApp"
          icon={<Phone />}
          value={form.phone}
          onChange={set("phone")}
          inputMode="tel"
          autoComplete="tel"
          placeholder="0812 3456 7890"
          autoFocus
        />
        <IconInput
          id="occupation"
          label="Pekerjaan / jabatan"
          icon={<Briefcase />}
          value={form.occupation}
          onChange={set("occupation")}
          autoComplete="organization-title"
          placeholder="Analis Pengelolaan Aset"
          maxLength={100}
        />
      </div>
      <IconInput
        id="workplace"
        label="Tempat bekerja / instansi"
        icon={<Building2 />}
        value={form.workplace}
        onChange={set("workplace")}
        autoComplete="organization"
        placeholder="Nama instansi, unit kerja"
        maxLength={150}
      />
      <Field>
        <FieldLabel htmlFor="address">
          Alamat <span className="font-normal text-muted-foreground">(opsional)</span>
        </FieldLabel>
        <div className="relative">
          <MapPin className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
          <Textarea
            id="address"
            rows={2}
            maxLength={300}
            className="pl-9"
            placeholder="Jalan, kota"
            value={form.address}
            onChange={(e) => set("address")(e.target.value)}
          />
        </div>
      </Field>
    </FieldGroup>
  );
}

function AppsStep({
  catalog,
  purposes,
  onToggle,
  onPurpose,
}: {
  catalog: CatalogApp[];
  purposes: Record<string, string>;
  onToggle: (key: string) => void;
  onPurpose: (key: string, value: string) => void;
}) {
  if (!catalog.length) return <Spinner className="mx-auto my-8" />;
  return (
    <div className="flex flex-col gap-3">
      {catalog.map((app) => {
        const selected = app.key in purposes;
        const purpose = purposes[app.key] ?? "";
        const hint = selected ? purposeHint(purpose) : null;
        return (
          <div
            key={app.key}
            className={cn(
              "rounded-2xl border p-4 transition-all",
              selected ? "border-primary/40 bg-primary/5 shadow-soft" : "hover:border-primary/30",
              app.autoAccess && "bg-success/5",
            )}
          >
            <button
              type="button"
              disabled={app.autoAccess}
              onClick={() => onToggle(app.key)}
              className="flex w-full items-center gap-3 text-left disabled:cursor-default"
              aria-pressed={selected}
            >
              <ProductMark appKey={app.key} name={app.name} className="size-11 shrink-0 shadow-soft" />
              <span className="min-w-0 flex-1">
                <span className="font-display block truncate text-base font-bold">
                  {productName(app.key, app.name)}
                </span>
                <span className="block truncate text-xs text-muted-foreground italic">
                  {taglineOf(app.key) ?? app.description}
                </span>
              </span>
              {app.autoAccess ? (
                <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                  Langsung aktif
                </span>
              ) : (
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors",
                    selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30",
                  )}
                >
                  {selected && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              )}
            </button>
            {selected && (
              <Field className="mt-3">
                <FieldLabel htmlFor={`purpose-${app.key}`}>Tujuan / kepentingan menggunakan aplikasi ini</FieldLabel>
                <Textarea
                  id={`purpose-${app.key}`}
                  rows={3}
                  maxLength={PURPOSE_MAX}
                  autoFocus
                  placeholder="Contoh: mengelola agenda, arsip, dan laporan kinerja bulanan di unit kerja saya."
                  value={purpose}
                  onChange={(e) => onPurpose(app.key, e.target.value)}
                />
                <FieldDescription className={cn(hint && purpose && "text-warning-foreground dark:text-warning")}>
                  {hint ?? "Cukup jelas."} · {purpose.length}/{PURPOSE_MAX}
                </FieldDescription>
              </Field>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Bisa juga diajukan nanti dari halaman akun. Admin menentukan lama akses; setelah masa akses habis data hanya
        bisa dibaca selama 180 hari sebelum dihapus.
      </p>
    </div>
  );
}

function ReviewStep({
  form,
  purposes,
  catalog,
  agree,
  onAgree,
  onEdit,
}: {
  form: Form;
  purposes: Record<string, string>;
  catalog: CatalogApp[];
  agree: boolean;
  onAgree: (v: boolean) => void;
  onEdit: (step: number) => void;
}) {
  const requested = Object.entries(purposes);
  const auto = catalog.filter((a) => a.autoAccess);
  return (
    <div className="flex flex-col gap-3">
      <ReviewCard title="Akun" onEdit={() => onEdit(0)}>
        <ReviewRow icon={<UserRound />} value={form.name} />
        <ReviewRow icon={<AtSign />} value={form.email} />
      </ReviewCard>
      <ReviewCard title="Data diri" onEdit={() => onEdit(1)}>
        <ReviewRow icon={<Phone />} value={form.phone} />
        <ReviewRow icon={<Briefcase />} value={form.occupation} />
        <ReviewRow icon={<Building2 />} value={form.workplace} />
        {form.address && <ReviewRow icon={<MapPin />} value={form.address} />}
      </ReviewCard>
      <ReviewCard title="Akses aplikasi" onEdit={() => onEdit(2)}>
        {requested.length === 0 && auto.length === 0 && (
          <p className="text-sm text-muted-foreground">Tidak ada — bisa diajukan nanti dari halaman akun.</p>
        )}
        {auto.map((app) => (
          <p key={app.key} className="flex items-center gap-2 text-sm">
            <ProductMark appKey={app.key} name={app.name} className="size-6 rounded-md" />
            {productName(app.key, app.name)} <span className="text-xs text-success">· langsung aktif</span>
          </p>
        ))}
        {requested.map(([key, purpose]) => (
          <div key={key} className="flex items-start gap-2 text-sm">
            <ProductMark appKey={key} className="mt-0.5 size-6 shrink-0 rounded-md" />
            <span className="min-w-0">
              <b>{productName(key, catalog.find((a) => a.key === key)?.name ?? key)}</b>{" "}
              <span className="text-xs text-info">· diajukan</span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{purpose}</span>
            </span>
          </div>
        ))}
      </ReviewCard>
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-muted/30 p-4 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={agree}
          onChange={(e) => onAgree(e.target.checked)}
        />
        <span>
          Data yang saya isi benar. Saya setuju data ini dipakai untuk mengelola akun dan meninjau pengajuan akses
          aplikasi workingspace.id.
        </span>
      </label>
    </div>
  );
}

function ReviewCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="rounded-2xl border p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</p>
        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={onEdit}>
          Ubah
        </button>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function ReviewRow({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <p className="flex items-center gap-2 text-sm [&_svg]:size-4 [&_svg]:text-muted-foreground">
      {icon}
      <span className="min-w-0 truncate">{value}</span>
    </p>
  );
}

function SentScreen({ email, requested }: { email: string; requested: number }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background bg-aurora-soft p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-[28px] border bg-card text-center shadow-lift">
        <div className="relative overflow-hidden bg-aurora px-8 py-10 text-ink-foreground">
          <div className="pointer-events-none absolute inset-0 bg-grid" />
          <span className="relative mx-auto flex size-16 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <MailCheck className="size-8" />
          </span>
          <h1 className="relative mt-4 text-2xl font-bold">Cek email Anda</h1>
          <p className="relative mt-1 text-sm opacity-80">
            Tautan verifikasi dikirim ke <b>{email}</b>
          </p>
        </div>
        <div className="flex flex-col gap-4 p-6 text-left text-sm">
          <Step n={1} text="Buka email dan klik tautan verifikasi (berlaku 24 jam; periksa folder spam)." />
          <Step
            n={2}
            text={
              requested
                ? `${requested} pengajuan akses dikirim ke admin setelah email terverifikasi. Hasilnya dikabarkan lewat email.`
                : "Ajukan akses aplikasi dari halaman akun setelah masuk."
            }
          />
          <Step n={3} text="Masuk dan buka aplikasi dari halaman akun Workingspace." />
          <Button asChild className="mt-2 h-11">
            <Link to={`/login?email=${encodeURIComponent(email)}`}>Ke halaman masuk</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <p className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {n}
      </span>
      {text}
    </p>
  );
}
