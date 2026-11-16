import {
  Activity,
  AppWindow,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Crown,
  KeyRound,
  LogOut,
  MailWarning,
  Search,
  ShieldOff,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { AccountShell } from "@/components/account-shell";
import { Notice } from "@/components/auth-layout";
import { UserAvatar } from "@/components/brand";
import { EmailField, NameField, PasswordField } from "@/components/form-fields";
import { Section, StatusPill } from "@/components/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  type AccountStatus,
  type AdminAccount,
  type AdminApp,
  type AdminStats,
  type AppRole,
  type SecurityEventRow,
  adminApi,
  errorText,
} from "@/lib/api";
import { ROLE_LABELS, deviceLabel, eventLabel, formatDateTime, loginMethod, relativeTime } from "@/lib/format";
import { useMe } from "@/lib/use-me";
import { cn } from "@/lib/utils";

const NONE = "none";
const PAGE_SIZE = 20;

const STATUS_FILTERS: { value: AccountStatus; label: string }[] = [
  { value: "all", label: "Semua" },
  { value: "active", label: "Aktif" },
  { value: "unverified", label: "Belum verifikasi" },
  { value: "disabled", label: "Nonaktif" },
  { value: "super", label: "Super admin" },
];

/** Pengelolaan akun & akses aplikasi (khusus super admin ekosistem; isi data aplikasi tidak pernah terlihat di sini). */
export function AdminPage() {
  const [me] = useMe("/admin", { superAdminOnly: true });
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [tab, setTab] = useState<"accounts" | "apps">("accounts");
  const [status, setStatus] = useState<AccountStatus>("all");
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);

  const loadMeta = useCallback(() => {
    void adminApi
      .apps()
      .then(setApps)
      .catch(() => undefined);
    void adminApi
      .stats()
      .then(setStats)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (me) loadMeta();
  }, [me, loadMeta]);

  const changed = () => {
    loadMeta();
    setVersion((v) => v + 1);
  };

  const pick = (value: AccountStatus) => {
    setTab("accounts");
    setStatus(value);
  };

  return (
    <AccountShell account={me} page="admin">
      {me && (
        <>
          <section className="relative overflow-hidden rounded-[28px] bg-aurora p-6 text-ink-foreground shadow-lift sm:p-8">
            <div className="pointer-events-none absolute inset-0 bg-grid" />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0 max-w-xl">
                <p className="text-xs font-semibold tracking-[0.16em] uppercase opacity-70">Super admin</p>
                <h1 className="text-3xl font-bold sm:text-4xl">Pusat kendali ekosistem</h1>
                <p className="mt-2 text-sm opacity-75">
                  Akun & akses aplikasi workingspace.id. Isi data di setiap aplikasi tetap milik pemiliknya dan tidak
                  terlihat di sini.
                </p>
              </div>
              <Button
                onClick={() => setCreating(true)}
                className="bg-lime text-ink shadow-soft hover:bg-lime/90"
                size="lg"
              >
                <UserPlus /> Tambah akun
              </Button>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard
              label="Total akun"
              value={stats?.total}
              icon={<UsersRound />}
              tone="brand"
              active={tab === "accounts" && status === "all"}
              onClick={() => pick("all")}
            />
            <StatCard label="Aktif 30 hari terakhir" value={stats?.active30d} icon={<Activity />} tone="success" />
            <StatCard
              label="Super admin"
              value={stats?.superAdmins}
              icon={<Crown />}
              tone="info"
              active={tab === "accounts" && status === "super"}
              onClick={() => pick("super")}
            />
            <StatCard
              label="Belum verifikasi"
              value={stats?.unverified}
              icon={<MailWarning />}
              tone="warning"
              active={tab === "accounts" && status === "unverified"}
              onClick={() => pick("unverified")}
            />
            <StatCard
              label="Nonaktif"
              value={stats?.disabled}
              icon={<ShieldOff />}
              tone="danger"
              active={tab === "accounts" && status === "disabled"}
              onClick={() => pick("disabled")}
            />
          </div>

          <div className="flex w-fit gap-1 rounded-2xl border bg-card p-1 shadow-soft" role="tablist">
            <TabButton active={tab === "accounts"} onClick={() => setTab("accounts")} icon={<UsersRound />}>
              Akun
            </TabButton>
            <TabButton active={tab === "apps"} onClick={() => setTab("apps")} icon={<AppWindow />}>
              Aplikasi
              <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{apps.length}</span>
            </TabButton>
          </div>

          {tab === "accounts" ? (
            <AccountsPanel
              refreshKey={version}
              apps={apps}
              selfId={me.id}
              status={status}
              onStatus={setStatus}
              onChanged={loadMeta}
            />
          ) : (
            <AppsPanel apps={apps} onSaved={loadMeta} />
          )}

          <CreateAccountDialog
            key={creating ? "open" : "closed"}
            open={creating}
            apps={apps}
            onClose={() => setCreating(false)}
            onCreated={changed}
          />
        </>
      )}
    </AccountShell>
  );
}

const TONES = {
  brand: "from-indigo/20 to-cyan/10 text-primary",
  success: "from-success/20 to-success/5 text-success",
  info: "from-info/20 to-info/5 text-info",
  warning: "from-warning/25 to-warning/5 text-warning-foreground dark:text-warning",
  danger: "from-destructive/20 to-destructive/5 text-destructive",
} as const;

function StatCard({
  label,
  value,
  icon,
  tone,
  active = false,
  onClick,
}: {
  label: string;
  value: number | undefined;
  icon: ReactNode;
  tone: keyof typeof TONES;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-xl bg-linear-135 [&_svg]:size-[18px]",
          TONES[tone],
        )}
      >
        {icon}
      </span>
      <span className="font-display mt-3 block text-3xl leading-none font-bold">{value ?? "–"}</span>
      <span className="mt-1.5 block truncate text-xs font-medium text-muted-foreground">{label}</span>
    </>
  );
  const base = "rounded-2xl border bg-card p-4 text-left shadow-soft";
  if (!onClick)
    return (
      <div className={base} title={label}>
        {body}
      </div>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`Saring: ${label}`}
      className={cn(
        base,
        "transition-all hover:-translate-y-0.5 hover:shadow-lift",
        active && "border-primary/40 ring-2 ring-primary/20",
      )}
    >
      {body}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors [&_svg]:size-4",
        active ? "bg-ink text-ink-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function AccountStatusPills({ account }: { account: AdminAccount }) {
  return (
    <>
      {account.superAdmin && (
        <StatusPill tone="info">
          <Crown /> Super admin
        </StatusPill>
      )}
      {account.disabled ? (
        <StatusPill tone="danger">Nonaktif</StatusPill>
      ) : account.emailVerified ? (
        <StatusPill tone="success">Aktif</StatusPill>
      ) : (
        <StatusPill tone="warning">Belum verifikasi</StatusPill>
      )}
      {account.google && <StatusPill tone="muted">Google</StatusPill>}
    </>
  );
}

function AccountsPanel({
  refreshKey,
  apps,
  selfId,
  status,
  onStatus,
  onChanged,
}: {
  refreshKey: number;
  apps: AdminApp[];
  selfId: string;
  status: AccountStatus;
  onStatus: (value: AccountStatus) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: AdminAccount[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<AdminAccount | null>(null);

  const load = useCallback(() => {
    adminApi
      .accounts(search, page, PAGE_SIZE, status)
      .then((value) => {
        setData(value);
        setError(null);
        // Data di laci Kelola ikut diperbarui
        setManaging((current) => (current ? (value.items.find((a) => a.id === current.id) ?? current) : null));
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [search, page, status]);
  useEffect(load, [load, refreshKey]);

  const reload = () => {
    load();
    onChanged();
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const appName = (key: string) => apps.find((a) => a.key === key)?.name ?? key;

  return (
    <section className="rounded-3xl border bg-card shadow-soft">
      <div className="flex flex-col gap-3 border-b p-4 sm:p-5">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(query);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-11 rounded-2xl pl-10"
            placeholder="Cari nama atau email, lalu Enter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => {
                setPage(1);
                onStatus(filter.value);
              }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold ring-1 transition-colors",
                status === filter.value
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "text-muted-foreground ring-border hover:bg-accent hover:text-foreground",
              )}
            >
              {filter.label}
            </button>
          ))}
          {data && <span className="ml-auto text-xs text-muted-foreground">{data.total} akun</span>}
        </div>
      </div>

      {error && (
        <div className="p-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {!data ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : data.items.length === 0 ? (
        <p className="p-10 text-center text-sm text-muted-foreground">Tidak ada akun yang cocok.</p>
      ) : (
        <ul className="divide-y">
          {data.items.map((account) => {
            const roles = Object.entries(account.apps);
            return (
              <li key={account.id}>
                <button
                  type="button"
                  onClick={() => setManaging(account)}
                  className={cn(
                    "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60 sm:px-5",
                    account.disabled && "opacity-60",
                  )}
                >
                  <UserAvatar name={account.name} seed={account.id} />
                  <span className="grid min-w-0 flex-1 grid-cols-1 gap-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center md:gap-4">
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold">{account.name}</span>
                        {account.id === selfId && <StatusPill tone="brand">Anda</StatusPill>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{account.email}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <AccountStatusPills account={account} />
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-wrap gap-1">
                      {roles.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Tanpa akses aplikasi</span>
                      ) : (
                        roles.map(([key, role]) => (
                          <span
                            key={key}
                            className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 text-[11px] font-medium"
                          >
                            <span className="size-1.5 rounded-full bg-linear-135 from-indigo to-cyan" />
                            {appName(key)} · {ROLE_LABELS[role]}
                          </span>
                        ))
                      )}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted-foreground md:text-right">
                      {account.lastLoginAt ? `Masuk ${relativeTime(account.lastLoginAt)}` : "Belum pernah masuk"}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t p-3 text-sm">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft /> Sebelumnya
          </Button>
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Berikutnya <ChevronRight />
          </Button>
        </div>
      )}
      <Sheet open={!!managing} onOpenChange={(open) => !open && setManaging(null)}>
        <SheetContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-full gap-0 overflow-y-auto data-[side=right]:w-full [&>*]:shrink-0 data-[side=right]:sm:max-w-lg"
        >
          {managing && (
            <ManageAccount
              key={managing.id}
              account={managing}
              apps={apps}
              self={managing.id === selfId}
              onChanged={reload}
            />
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function RoleSelect({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={cn("w-32", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Tanpa akses</SelectItem>
        <SelectItem value="member">{ROLE_LABELS.member}</SelectItem>
        <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
      </SelectContent>
    </Select>
  );
}

function DrawerBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t px-5 py-5">
      <h3 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</h3>
      {children}
    </div>
  );
}

function ManageAccount({
  account,
  apps,
  self,
  onChanged,
}: {
  account: AdminAccount;
  apps: AdminApp[];
  self: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [disabled, setDisabled] = useState(account.disabled);
  const [superAdmin, setSuperAdmin] = useState(account.superAdmin);
  const [events, setEvents] = useState<SecurityEventRow[] | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    adminApi
      .events(account.id)
      .then((rows) => alive && setEvents(rows))
      .catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
  }, [account.id]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "success", text: await action() });
      onChanged();
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const dirty = name.trim() !== account.name || disabled !== account.disabled || superAdmin !== account.superAdmin;

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await adminApi.update(account.id, {
        name: name.trim() !== account.name ? name : undefined,
        disabled: disabled !== account.disabled ? disabled : undefined,
        superAdmin: superAdmin !== account.superAdmin ? superAdmin : undefined,
      });
      return disabled && !account.disabled
        ? "Disimpan. Akun dinonaktifkan dan dikeluarkan dari semua perangkat."
        : "Disimpan.";
    });
  };

  const setRole = (app: AdminApp, value: string) =>
    run(async () => {
      await adminApi.setRole(account.id, app.key, value === NONE ? null : (value as AppRole));
      return value === NONE ? `Akses ${app.name} dicabut.` : `Akses ${app.name}: ${ROLE_LABELS[value as AppRole]}.`;
    });

  return (
    <>
      <SheetHeader className="relative overflow-hidden bg-aurora p-5 pt-6 text-ink-foreground">
        <div className="pointer-events-none absolute inset-0 bg-grid" />
        <div className="relative flex items-center gap-4 pr-8">
          <UserAvatar name={account.name} seed={account.id} className="size-14 text-lg ring-4 ring-white/15" />
          <div className="min-w-0">
            <SheetTitle className="font-display truncate text-xl font-bold text-ink-foreground">
              {account.name}
            </SheetTitle>
            <SheetDescription className="truncate text-ink-foreground/75">{account.email}</SheetDescription>
          </div>
        </div>
        <div className="relative mt-3 flex flex-wrap gap-1.5 text-xs opacity-80">
          <span>Dibuat {formatDateTime(account.createdAt)}</span>
          <span>·</span>
          <span>{account.lastLoginAt ? `Masuk ${relativeTime(account.lastLoginAt)}` : "Belum pernah masuk"}</span>
        </div>
      </SheetHeader>

      {message && (
        <div className="px-5 pt-4">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <DrawerBlock title="Profil & status">
        <form onSubmit={save}>
          <FieldGroup>
            <NameField id="manage-name" label="Nama lengkap" value={name} onChange={setName} />
            <div className="flex flex-col divide-y rounded-2xl border">
              <label htmlFor="manage-active" className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block text-sm font-medium">Akun aktif</span>
                  <span className="block text-xs text-muted-foreground">Nonaktif = keluar dari semua perangkat</span>
                </span>
                <Switch
                  id="manage-active"
                  checked={!disabled}
                  disabled={self}
                  onCheckedChange={(v) => setDisabled(!v)}
                />
              </label>
              <label htmlFor="manage-super" className="flex items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block text-sm font-medium">Super admin ekosistem</span>
                  <span className="block text-xs text-muted-foreground">Mengelola akun & aplikasi</span>
                </span>
                <Switch id="manage-super" checked={superAdmin} disabled={self} onCheckedChange={setSuperAdmin} />
              </label>
            </div>
            {self && <FieldDescription>Status akun Anda sendiri tidak bisa diubah dari sini.</FieldDescription>}
            <Button type="submit" className="self-start" disabled={busy || !dirty}>
              {busy ? <Spinner /> : "Simpan perubahan"}
            </Button>
          </FieldGroup>
        </form>
      </DrawerBlock>

      <DrawerBlock title="Akses aplikasi">
        <div className="flex flex-col gap-2">
          {apps.map((app) => (
            <div key={app.key} className="flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-3">
                <span className="font-display flex size-9 shrink-0 items-center justify-center rounded-xl bg-aurora text-sm font-bold text-ink-foreground">
                  {app.name.slice(0, 1)}
                </span>
                <span className="truncate text-sm font-medium">{app.name}</span>
              </span>
              <RoleSelect
                value={account.apps[app.key] ?? NONE}
                onChange={(v) => setRole(app, v)}
                label={`Akses ${app.name}`}
              />
            </div>
          ))}
        </div>
      </DrawerBlock>

      <DrawerBlock title="Tindakan">
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            disabled={busy || account.disabled}
            onClick={() => run(async () => (await adminApi.passwordLink(account.id)).message)}
          >
            <KeyRound /> Kirim tautan kata sandi
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await adminApi.signOut(account.id);
                return "Akun dikeluarkan dari semua perangkat.";
              })
            }
          >
            <LogOut /> Keluarkan dari semua perangkat
          </Button>
        </div>
      </DrawerBlock>

      <DrawerBlock title="Log keamanan (50 terakhir)">
        {!events ? (
          <Spinner />
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada catatan.</p>
        ) : (
          <ol className="relative flex flex-col gap-4 border-l pl-5">
            {events.map((event) => (
              <li key={event.id} className="relative">
                <span
                  className={cn(
                    "absolute top-1 -left-[25px] size-2.5 rounded-full ring-4 ring-popover",
                    event.event === "login_failed" ? "bg-destructive" : "bg-linear-135 from-indigo to-cyan",
                  )}
                />
                <p className="text-sm font-medium">
                  {eventLabel(event.event)}
                  {loginMethod(event.detail) && (
                    <span className="font-normal text-muted-foreground"> · {loginMethod(event.detail)}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(event.createdAt)} · {deviceLabel(event.userAgent)}
                  {event.ip ? ` · ${event.ip}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </DrawerBlock>
    </>
  );
}

function CreateAccountDialog({
  open,
  apps,
  onClose,
  onCreated,
}: {
  open: boolean;
  apps: AdminApp[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [superAdmin, setSuperAdmin] = useState(false);
  const [roles, setRoles] = useState<Record<string, AppRole>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await adminApi.create({ name, email, password: password || undefined, superAdmin, apps: roles });
      setResult(
        created.invited
          ? `Akun dibuat. Undangan untuk membuat kata sandi dikirim ke ${email}.`
          : "Akun dibuat dan bisa langsung masuk dengan kata sandi yang Anda isi.",
      );
      onCreated();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92svh] grid-cols-1 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Tambah akun</DialogTitle>
          <DialogDescription>
            Kosongkan kata sandi untuk mengirim undangan; pemilik akun membuat kata sandinya sendiri.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <>
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
                <BadgeCheck className="size-7" />
              </span>
              <p className="text-sm">{result}</p>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Selesai</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <FieldGroup>
              <NameField id="new-name" label="Nama lengkap" value={name} onChange={setName} autoFocus />
              <EmailField id="new-email" label="Email" value={email} onChange={setEmail} autoComplete="off" />
              <PasswordField
                id="new-password"
                label="Kata sandi (opsional)"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                required={false}
                hint="Kosong = kirim email undangan (berlaku 3 hari)."
              />
              <Field>
                <FieldLabel>Akses aplikasi</FieldLabel>
                <div className="flex flex-col gap-2">
                  {apps.map((app) => (
                    <div key={app.key} className="flex items-center justify-between gap-3 rounded-2xl border px-3 py-2">
                      <span className="text-sm font-medium">{app.name}</span>
                      <RoleSelect
                        value={roles[app.key] ?? NONE}
                        label={`Akses ${app.name}`}
                        onChange={(v) =>
                          setRoles((prev) => {
                            const next = { ...prev };
                            if (v === NONE) delete next[app.key];
                            else next[app.key] = v as AppRole;
                            return next;
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </Field>
              <Field orientation="horizontal">
                <Switch id="new-super" checked={superAdmin} onCheckedChange={setSuperAdmin} />
                <FieldLabel htmlFor="new-super">Super admin ekosistem</FieldLabel>
              </Field>
              {error && <Notice tone="error">{error}</Notice>}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={onClose}>
                  Batal
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? <Spinner /> : "Buat akun"}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AppsPanel({ apps, onSaved }: { apps: AdminApp[]; onSaved: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {apps.map((app) => (
        <AppCard key={`${app.key}-${app.url}-${app.selfSignup}`} app={app} onSaved={onSaved} />
      ))}
    </div>
  );
}

function AppCard({ app, onSaved }: { app: AdminApp; onSaved: () => void }) {
  const [url, setUrl] = useState(app.url);
  const [selfSignup, setSelfSignup] = useState<string>(app.selfSignup ?? NONE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const changed = url !== app.url || selfSignup !== (app.selfSignup ?? NONE);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await adminApi.updateApp(app.key, {
        url: url !== app.url ? url : undefined,
        selfSignup: selfSignup === NONE ? null : (selfSignup as AppRole),
      });
      setMessage({ tone: "success", text: "Disimpan." });
      onSaved();
    } catch (err) {
      setMessage({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<span className="font-display text-base font-bold">{app.name.slice(0, 1)}</span>}
      eyebrow={`Kunci ${app.key}`}
      title={app.name}
      description={app.description ?? undefined}
      action={
        <StatusPill tone="brand">
          <UsersRound /> {app.members} akun
        </StatusPill>
      }
    >
      <form onSubmit={save}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`url-${app.key}`}>Alamat aplikasi</FieldLabel>
            <Input id={`url-${app.key}`} value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Akun yang mendaftar sendiri</FieldLabel>
            <Select value={selfSignup} onValueChange={setSelfSignup}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Tidak otomatis (admin memberi akses)</SelectItem>
                <SelectItem value="member">Otomatis sebagai Anggota</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              Berlaku untuk pendaftaran berikutnya; akun yang sudah ada tidak berubah.
            </FieldDescription>
          </Field>
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <Button type="submit" className="self-start" disabled={busy || !changed}>
            {busy ? <Spinner /> : "Simpan"}
          </Button>
        </FieldGroup>
      </form>
    </Section>
  );
}
