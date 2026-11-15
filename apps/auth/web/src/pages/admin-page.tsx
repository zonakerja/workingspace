import { AppWindow, ChevronLeft, ChevronRight, Search, UserPlus, UsersRound } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { AppHeader } from "@/components/app-header";
import { Notice } from "@/components/auth-layout";
import { EmailField, NameField, PasswordField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type Account,
  type AdminAccount,
  type AdminApp,
  ApiError,
  type AppRole,
  type SecurityEventRow,
  adminApi,
  api,
  errorText,
} from "@/lib/api";
import { ROLE_LABELS, deviceLabel, eventLabel, formatDateTime, loginMethod } from "@/lib/format";
import { Section } from "./account-page";

const NONE = "none";
const PAGE_SIZE = 20;

/** Pengelolaan akun & akses aplikasi (khusus super admin ekosistem; isi data aplikasi tidak pernah terlihat di sini). */
export function AdminPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<Account | null>(null);
  const [apps, setApps] = useState<AdminApp[]>([]);

  const loadApps = useCallback(() => adminApi.apps().then(setApps), []);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((account) => {
        if (!alive) return;
        if (!account.superAdmin) navigate("/account", { replace: true });
        else {
          setMe(account);
          void loadApps();
        }
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) navigate("/login?next=/admin", { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [navigate, loadApps]);

  if (!me)
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    );

  return (
    <div className="min-h-svh bg-background">
      <AppHeader superAdmin />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
        <div>
          <h1 className="text-xl font-bold">Kelola akun</h1>
          <p className="text-sm text-muted-foreground">
            Akun ekosistem & akses aplikasi. Isi data di setiap aplikasi tetap milik pemiliknya dan tidak terlihat di
            sini.
          </p>
        </div>
        <Tabs defaultValue="accounts">
          <TabsList>
            <TabsTrigger value="accounts">
              <UsersRound /> Akun
            </TabsTrigger>
            <TabsTrigger value="apps">
              <AppWindow /> Aplikasi
            </TabsTrigger>
          </TabsList>
          <TabsContent value="accounts" className="mt-3">
            <AccountsTab apps={apps} selfId={me.id} onAppsChanged={loadApps} />
          </TabsContent>
          <TabsContent value="apps" className="mt-3">
            <AppsTab apps={apps} onSaved={loadApps} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function AccountsTab({ apps, selfId, onAppsChanged }: { apps: AdminApp[]; selfId: string; onAppsChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; items: AdminAccount[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<AdminAccount | null>(null);

  const load = useCallback(() => {
    adminApi
      .accounts(search, page, PAGE_SIZE)
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [search, page]);
  useEffect(load, [load]);

  const reload = () => {
    load();
    onAppsChanged();
  };

  const setRole = async (account: AdminAccount, app: string, value: string) => {
    try {
      await adminApi.setRole(account.id, app, value === NONE ? null : (value as AppRole));
      reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <Section
      icon={<UsersRound />}
      title={data ? `${data.total} akun` : "Akun"}
      description="Atur akses aplikasi langsung di tabel; Kelola untuk status, super admin, dan log keamanan."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(query);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Cari nama atau email lalu Enter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <Button onClick={() => setCreating(true)}>
          <UserPlus /> Tambah akun
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada akun yang cocok.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Akun</TableHead>
                {apps.map((app) => (
                  <TableHead key={app.key}>{app.name}</TableHead>
                ))}
                <TableHead>Terakhir masuk</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((account) => (
                <TableRow key={account.id} className={account.disabled ? "opacity-60" : undefined}>
                  <TableCell className="max-w-64">
                    <p className="truncate font-medium">{account.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{account.email}</p>
                    <AccountBadges account={account} />
                  </TableCell>
                  {apps.map((app) => (
                    <TableCell key={app.key}>
                      <Select value={account.apps[app.key] ?? NONE} onValueChange={(v) => setRole(account, app.key, v)}>
                        <SelectTrigger size="sm" className="w-28" aria-label={`Akses ${app.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Tanpa akses</SelectItem>
                          <SelectItem value="member">{ROLE_LABELS.member}</SelectItem>
                          <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  ))}
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {account.lastLoginAt ? formatDateTime(account.lastLoginAt) : "Belum pernah"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setManaging(account)}>
                      Kelola
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
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
      <CreateAccountDialog
        key={creating ? "open" : "closed"}
        open={creating}
        apps={apps}
        onClose={() => setCreating(false)}
        onCreated={reload}
      />
      {managing && (
        <ManageAccountDialog
          key={managing.id}
          account={managing}
          self={managing.id === selfId}
          onClose={() => setManaging(null)}
          onChanged={reload}
        />
      )}
    </Section>
  );
}

function AccountBadges({ account }: { account: AdminAccount }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {account.superAdmin && <Badge>Super admin</Badge>}
      {account.disabled && <Badge variant="destructive">Nonaktif</Badge>}
      {!account.emailVerified && <Badge variant="secondary">Belum verifikasi</Badge>}
      {account.google && <Badge variant="secondary">Google</Badge>}
    </div>
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
      <DialogContent className="grid-cols-1 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tambah akun</DialogTitle>
          <DialogDescription>
            Kosongkan kata sandi untuk mengirim undangan; pemilik akun membuat kata sandinya sendiri.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <>
            <Notice tone="success">{result}</Notice>
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
                    <div key={app.key} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2">
                      <span className="text-sm font-medium">{app.name}</span>
                      <Select
                        value={roles[app.key] ?? NONE}
                        onValueChange={(v) =>
                          setRoles((prev) => {
                            const next = { ...prev };
                            if (v === NONE) delete next[app.key];
                            else next[app.key] = v as AppRole;
                            return next;
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="w-32" aria-label={`Akses ${app.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Tanpa akses</SelectItem>
                          <SelectItem value="member">{ROLE_LABELS.member}</SelectItem>
                          <SelectItem value="admin">{ROLE_LABELS.admin}</SelectItem>
                        </SelectContent>
                      </Select>
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

function ManageAccountDialog({
  account,
  self,
  onClose,
  onChanged,
}: {
  account: AdminAccount;
  self: boolean;
  onClose: () => void;
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

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90svh] grid-cols-1 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Kelola akun</DialogTitle>
          <DialogDescription>{account.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save}>
          <FieldGroup>
            <NameField id="manage-name" label="Nama lengkap" value={name} onChange={setName} />
            <Field orientation="horizontal">
              <Switch id="manage-active" checked={!disabled} disabled={self} onCheckedChange={(v) => setDisabled(!v)} />
              <FieldLabel htmlFor="manage-active">Akun aktif</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch id="manage-super" checked={superAdmin} disabled={self} onCheckedChange={setSuperAdmin} />
              <FieldLabel htmlFor="manage-super">Super admin ekosistem</FieldLabel>
            </Field>
            {self && <FieldDescription>Status akun Anda sendiri tidak bisa diubah dari sini.</FieldDescription>}
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? <Spinner /> : "Simpan"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || account.disabled}
                onClick={() => run(async () => (await adminApi.passwordLink(account.id)).message)}
              >
                Kirim tautan kata sandi
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await adminApi.signOut(account.id);
                    return "Akun dikeluarkan dari semua perangkat.";
                  })
                }
              >
                Keluarkan dari semua perangkat
              </Button>
            </div>
          </FieldGroup>
        </form>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Log keamanan (50 terakhir)</h3>
          {!events ? (
            <Spinner />
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada catatan.</p>
          ) : (
            <ul className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-xl border px-3">
              {events.map((event) => (
                <li key={event.id} className="py-2">
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
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AppsTab({ apps, onSaved }: { apps: AdminApp[]; onSaved: () => void }) {
  return (
    <div className="flex flex-col gap-3">
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
    <Section icon={<AppWindow />} title={app.name} description={`${app.members} akun punya akses · kunci ${app.key}`}>
      <form onSubmit={save}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`url-${app.key}`}>Alamat aplikasi</FieldLabel>
            <Input id={`url-${app.key}`} value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Akun yang mendaftar sendiri</FieldLabel>
            <Select value={selfSignup} onValueChange={setSelfSignup}>
              <SelectTrigger className="w-full sm:w-72">
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
