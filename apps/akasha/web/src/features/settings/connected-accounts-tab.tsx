import {
  CalendarSync,
  Check,
  Copy,
  Mail,
  MailCheck,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SectionCard } from "@/components/common/section-card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useCalendarFeed,
  useCalendarFeedMutations,
  useMailAccountMutations,
  useMailAccounts,
  useMailPresets,
} from "@/data/use-connected-accounts";
import { useInboxMutations } from "@/data/use-mail-inbox";
import { ColdStorageCard } from "@/features/drive/cold-storage-card";
import { OAuthAccountsCard } from "./oauth-accounts-card";
import { useOpenSession } from "@/hooks/use-retained";
import { errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type {
  CalendarFeedInclude,
  FeedTimezone,
  MailAccount,
  MailAccountInput,
  MailInboxSettingsInput,
  MailProvider,
} from "@/types/api";

const TIMEZONES: { value: FeedTimezone; label: string }[] = [
  { value: "Asia/Jakarta", label: "WIB (Asia/Jakarta)" },
  { value: "Asia/Makassar", label: "WITA (Asia/Makassar)" },
  { value: "Asia/Jayapura", label: "WIT (Asia/Jayapura)" },
];

const INCLUDE_LABELS: { key: keyof CalendarFeedInclude; label: string; hint: string }[] = [
  { key: "agenda", label: "Agenda", hint: "Agenda Planner & agenda Project/Area" },
  { key: "tasks", label: "Action / Task", hint: "Pada tanggal tenggatnya (sepanjang hari)" },
  { key: "todos", label: "To-do", hint: "Pada tanggalnya (sepanjang hari)" },
];

/**
 * Pengaturan → Akun Tersambung (docs/AKUN-TERSAMBUNG.md tahap 0): langganan kalender ICS untuk Google Calendar / Outlook /
 * kalender HP, dan akun email untuk mengirim (ringkasan harian, fitur berikutnya). Email masuk & kalender dua arah menyusul.
 */
export function ConnectedAccountsTab() {
  return (
    <div className="flex flex-col gap-4">
      <OAuthAccountsCard />
      <ColdStorageCard />
      <CalendarFeedCard />
      <MailAccountsCard />
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Tersalin" : "Salin"}
    </Button>
  );
}

function CalendarFeedCard() {
  const { data, isLoading } = useCalendarFeed();
  const { update, rotate, remove } = useCalendarFeedMutations();
  const [confirm, setConfirm] = useState<"rotate" | "remove" | null>(null);
  const fail = (error: unknown) => toast.error(errorMessage(error));

  return (
    <SectionCard
      icon={CalendarSync}
      title="Langganan kalender"
      description="Tampilkan agenda, task, dan to-do Akasha di Google Calendar, Outlook, atau kalender HP (baca saja)."
    >
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : !data?.enabled ? (
        <div className="flex flex-col items-start gap-3 text-sm">
          <p className="text-muted-foreground">
            Akasha membuat satu alamat rahasia. Tempelkan alamat itu di aplikasi kalender; perubahan di Akasha ikut
            tampil saat aplikasi kalender memperbarui langganan.
          </p>
          <Button onClick={() => update.mutate({}, { onError: fail })} disabled={update.isPending}>
            <Plus /> Buat alamat langganan
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-2">
            <Label htmlFor="feed-url">Alamat langganan (rahasia)</Label>
            <div className="flex gap-2">
              <Input
                id="feed-url"
                readOnly
                value={data.url}
                className="font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <CopyButton value={data.url} />
            </div>
            <p className="text-xs text-muted-foreground">
              Siapa pun yang memegang alamat ini bisa melihat isinya. Tersebar? Klik <b>Ganti alamat</b>.{" "}
              {data.lastAccessAt
                ? `Terakhir dibaca aplikasi kalender: ${formatDateTime(data.lastAccessAt)}.`
                : "Belum pernah dibaca."}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {INCLUDE_LABELS.map((item) => (
              <label key={item.key} className="flex items-start gap-2.5 rounded-xl border p-3">
                <Switch
                  checked={data.include[item.key]}
                  disabled={update.isPending}
                  onCheckedChange={(checked) => update.mutate({ include: { [item.key]: checked } }, { onError: fail })}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label>Zona waktu agenda</Label>
              <Select
                value={data.timezone}
                onValueChange={(v) => update.mutate({ timezone: v as FeedTimezone }, { onError: fail })}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirm("rotate")}>
                <RefreshCw /> Ganti alamat
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirm("remove")}>
                <Trash2 /> Matikan
              </Button>
            </div>
          </div>

          <details className="rounded-xl border p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Cara memasang di aplikasi kalender</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>
                <b>Google Calendar</b> (web): Kalender lain → <b>+</b> → <i>Dari URL</i> → tempel alamat. Google
                memperbarui langganan sendiri, biasanya beberapa jam sekali.
              </li>
              <li>
                <b>Outlook</b> (web): Tambahkan kalender → <i>Berlangganan dari web</i> → tempel alamat.
              </li>
              <li>
                <b>iPhone</b>: Pengaturan → Kalender → Akun → Tambah Akun → Lainnya →{" "}
                <i>Tambah Kalender Berlangganan</i>.
              </li>
              <li>Item yang dikunci PIN hanya tampil judulnya (tanpa lokasi & keterangan).</li>
              <li>Mengubah agenda dari Google/Outlook belum didukung (kalender dua arah = tahap berikutnya).</li>
            </ul>
          </details>
        </div>
      )}
      <ConfirmDialog
        open={confirm === "rotate"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Ganti alamat langganan?"
        description="Alamat lama langsung tidak berlaku. Tempelkan alamat baru di setiap aplikasi kalender yang berlangganan."
        confirmLabel="Ganti alamat"
        onConfirm={() =>
          rotate.mutate(undefined, { onSuccess: () => toast.success("Alamat langganan diganti."), onError: fail })
        }
      />
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Matikan langganan kalender?"
        description="Alamat langganan dihapus; aplikasi kalender tidak lagi menerima pembaruan dari Akasha."
        confirmLabel="Matikan"
        destructive
        onConfirm={() => remove.mutate(undefined, { onError: fail })}
      />
    </SectionCard>
  );
}

const STATUS_BADGE: Record<MailAccount["status"], { label: string; variant: "secondary" | "outline" | "destructive" }> =
  {
    new: { label: "Belum diuji", variant: "outline" },
    ok: { label: "Tersambung", variant: "secondary" },
    error: { label: "Gagal", variant: "destructive" },
  };

function MailAccountsCard() {
  const { data: accounts, isLoading } = useMailAccounts();
  const mutations = useMailAccountMutations();
  const [editing, setEditing] = useState<MailAccount | "new" | null>(null);
  const [removing, setRemoving] = useState<MailAccount | null>(null);
  const session = useOpenSession(editing !== null);
  const fail = (error: unknown) => toast.error(errorMessage(error));

  return (
    <SectionCard
      icon={Mail}
      title="Akun email"
      description="Kirim & terima email lewat akun Anda sendiri (bisa lebih dari satu). Email masuk dibaca di menu Email."
      action={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> Tambah akun
        </Button>
      }
    >
      {isLoading ? (
        <Skeleton className="h-20" />
      ) : !accounts?.length ? (
        <p className="text-sm text-muted-foreground">
          Belum ada akun email. Tambahkan Gmail (dengan Sandi Aplikasi) atau email lain lewat SMTP.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <MailAccountRow
              key={account.id}
              account={account}
              onEdit={() => setEditing(account)}
              onRemove={() => setRemoving(account)}
              mutations={mutations}
              fail={fail}
            />
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="grid-cols-1 sm:max-w-lg">
          {editing !== null && (
            <MailAccountForm
              key={session}
              account={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Lepas akun email?"
        itemName={removing?.address}
        description="Kata sandi yang tersimpan ikut dihapus. Email yang sudah terkirim tidak terpengaruh."
        confirmLabel="Lepas"
        destructive
        onConfirm={() => removing && mutations.remove.mutate(removing.id, { onError: fail })}
      />
    </SectionCard>
  );
}

function MailAccountRow({
  account,
  onEdit,
  onRemove,
  mutations,
  fail,
}: {
  account: MailAccount;
  onEdit: () => void;
  onRemove: () => void;
  mutations: ReturnType<typeof useMailAccountMutations>;
  fail: (error: unknown) => void;
}) {
  const badge = STATUS_BADGE[account.status];
  const busy = mutations.test.isPending || mutations.digest.isPending;
  const setDigest = (input: MailAccountInput) => mutations.update.mutate({ id: account.id, input }, { onError: fail });
  return (
    <li className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MailCheck className="size-4 shrink-0 text-module" />
        <span className="min-w-0 truncate font-medium">{account.address}</span>
        <span className="text-xs text-muted-foreground">{account.label}</span>
        {account.isDefault && (
          <Badge variant="outline" className="gap-1">
            <Star className="size-3" /> Utama
          </Badge>
        )}
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              mutations.test.mutate(
                { id: account.id },
                { onSuccess: () => toast.success(`Email uji dikirim ke ${account.address}.`), onError: fail },
              )
            }
          >
            <Send /> Uji
          </Button>
          {!account.isDefault && (
            <Button variant="ghost" size="sm" onClick={() => setDigest({ isDefault: true })}>
              <Star /> Jadikan utama
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Ubah" onClick={onEdit}>
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Lepas" onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>
      {account.status === "error" && account.statusMessage && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {account.statusMessage}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
        <label className="flex items-center gap-2">
          <Switch
            checked={account.digestEnabled}
            onCheckedChange={(checked) => setDigest({ digestEnabled: checked })}
          />
          Ringkasan harian ke alamat ini
        </label>
        <Input
          type="time"
          className="w-28"
          value={account.digestTime}
          disabled={!account.digestEnabled}
          onChange={(e) => e.target.value && setDigest({ digestTime: e.target.value })}
          aria-label="Jam ringkasan"
        />
        <Select
          value={account.digestTimezone}
          disabled={!account.digestEnabled}
          onValueChange={(v) => setDigest({ digestTimezone: v as FeedTimezone })}
        >
          <SelectTrigger className="w-28" aria-label="Zona waktu ringkasan">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label.split(" ")[0]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            mutations.digest.mutate(account.id, {
              onSuccess: () => toast.success("Ringkasan hari ini dikirim."),
              onError: fail,
            })
          }
        >
          Kirim contoh sekarang
        </Button>
        {account.digestLastSent && (
          <span className="text-xs text-muted-foreground">Terakhir terjadwal: {account.digestLastSent}</span>
        )}
      </div>
      {account.provider !== "outlook" && <InboxSettings account={account} fail={fail} />}
    </li>
  );
}

const INBOX_DAY_OPTIONS = [3, 7, 14, 30, 60];

/** Kotak masuk (IMAP) per akun: sinkron baca saja ke menu Email, opsional ke indeks AI. */
function InboxSettings({ account, fail }: { account: MailAccount; fail: (error: unknown) => void }) {
  const { settings, sync } = useInboxMutations();
  const custom = account.provider === "custom";
  const [imapHost, setImapHost] = useState(account.imapHost ?? account.smtpHost?.replace(/^smtp\./, "imap.") ?? "");
  const [imapPort, setImapPort] = useState(String(account.imapPort ?? 993));
  const save = (input: MailInboxSettingsInput) =>
    settings.mutate(
      { id: account.id, input: custom ? { imapHost, imapPort: Number(imapPort), ...input } : input },
      { onError: fail },
    );
  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <Switch
            checked={account.inboxEnabled}
            disabled={settings.isPending}
            onCheckedChange={(checked) => save({ enabled: checked })}
          />
          Kotak masuk (menu Email)
        </label>
        <Select
          value={String(account.inboxDays)}
          onValueChange={(v) => save({ days: Number(v) })}
          disabled={!account.inboxEnabled}
        >
          <SelectTrigger className="w-40" aria-label="Rentang awal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INBOX_DAY_OPTIONS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d} hari terakhir
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2">
          <Switch
            checked={account.inboxIndex}
            disabled={!account.inboxEnabled || settings.isPending}
            onCheckedChange={(checked) => save({ index: checked })}
          />
          Bisa ditanya AI
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={!account.inboxEnabled || sync.isPending}
          onClick={() =>
            sync.mutate(account.id, {
              onSuccess: (r) =>
                toast.success(
                  r.added
                    ? `${r.added} email baru${r.pending ? `, ${r.pending} menyusul` : ""}.`
                    : "Tidak ada email baru.",
                ),
              onError: fail,
            })
          }
        >
          <RefreshCw className={cn(sync.isPending && "animate-spin")} /> Sinkron sekarang
        </Button>
      </div>
      {custom && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <Label htmlFor={`imap-host-${account.id}`} className="text-xs">
              Server IMAP
            </Label>
            <Input id={`imap-host-${account.id}`} value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
          </div>
          <Select value={imapPort} onValueChange={setImapPort}>
            <SelectTrigger className="w-24" aria-label="Port IMAP">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="993">993</SelectItem>
              <SelectItem value="143">143</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => save({})} disabled={settings.isPending}>
            Simpan server
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Akasha hanya membaca salinan email (tidak menandai dibaca, tidak menghapus). Gmail: pastikan IMAP aktif (Setelan
        → Lihat semua setelan → Penerusan dan POP/IMAP). "Bisa ditanya AI" = isi email dikirim ke model embedding agar
        bisa dicari chatbot & Pencarian Pintar.
        {account.inboxSyncedAt && !account.inboxError && ` Sinkron terakhir ${formatDateTime(account.inboxSyncedAt)}.`}
      </p>
      {account.inboxError && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {account.inboxError}
        </p>
      )}
    </div>
  );
}

function MailAccountForm({ account, onDone }: { account: MailAccount | null; onDone: () => void }) {
  const { data: presets } = useMailPresets();
  const { create, update } = useMailAccountMutations();
  const [provider, setProvider] = useState<MailProvider>(account?.provider ?? "gmail");
  const [address, setAddress] = useState(account?.address ?? "");
  const [label, setLabel] = useState(account?.label ?? "");
  const [displayName, setDisplayName] = useState(account?.displayName ?? "");
  const [password, setPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState(account?.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(String(account?.smtpPort ?? 587));
  const [smtpUser, setSmtpUser] = useState(account?.smtpUser ?? "");
  const preset = presets?.find((p) => p.key === provider);
  const custom = provider === "custom";
  const pending = create.isPending || update.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const port = Number(smtpPort);
    const smtp = custom ? { smtpHost, smtpPort: port, smtpSecure: port === 465, smtpUser: smtpUser || null } : {};
    const done = {
      onSuccess: () => {
        toast.success(account ? "Akun email diperbarui." : "Akun email ditambahkan. Klik Uji untuk memastikan.");
        onDone();
      },
      onError: (error: unknown) => toast.error(errorMessage(error)),
    };
    if (account) {
      update.mutate(
        {
          id: account.id,
          input: {
            label,
            displayName: displayName || null,
            ...(password ? { password } : {}),
            ...(custom ? smtp : {}),
          },
        },
        done,
      );
    } else {
      create.mutate({ provider, address, label, displayName: displayName || null, password, ...smtp }, done);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{account ? "Ubah akun email" : "Tambah akun email"}</DialogTitle>
        <DialogDescription>
          Kata sandi disimpan terenkripsi di server dan tidak pernah ditampilkan lagi.
        </DialogDescription>
      </DialogHeader>
      {!account && (
        <div className="grid grid-cols-3 gap-2">
          {(presets ?? []).map((p) => (
            <Button
              key={p.key}
              type="button"
              variant={provider === p.key ? "default" : "outline"}
              size="sm"
              onClick={() => setProvider(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      )}
      {preset && (
        <p
          className={
            preset.oauthOnly ? "rounded-xl bg-warning/10 p-3 text-xs text-warning" : "text-xs text-muted-foreground"
          }
        >
          {preset.oauthOnly ?? preset.hint}
        </p>
      )}
      {!preset?.oauthOnly && (
        <div className="grid grid-cols-1 gap-3">
          {!account && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="mail-address">Alamat email</Label>
              <Input
                id="mail-address"
                type="email"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="nama@gmail.com"
              />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="mail-label">Label</Label>
              <Input id="mail-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Pribadi" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mail-name">Nama pengirim</Label>
              <Input id="mail-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          </div>
          {custom && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem]">
              <div className="flex flex-col gap-2">
                <Label htmlFor="mail-host">Server SMTP</Label>
                <Input
                  id="mail-host"
                  required
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.domain.id"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="mail-port">Port</Label>
                <Select value={smtpPort} onValueChange={setSmtpPort}>
                  <SelectTrigger id="mail-port">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["465", "587", "25", "2525"].map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="mail-user">Nama pengguna SMTP (kosong = alamat email)</Label>
                <Input id="mail-user" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="mail-password">
              {provider === "gmail" ? "Sandi Aplikasi Google" : "Kata sandi SMTP"}
              {account?.hasPassword && " (kosongkan bila tidak diganti)"}
            </Label>
            <Input
              id="mail-password"
              type="password"
              autoComplete="new-password"
              required={!account}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={pending || !!preset?.oauthOnly}>
          {account ? "Simpan" : "Tambahkan"}
        </Button>
      </DialogFooter>
    </form>
  );
}
