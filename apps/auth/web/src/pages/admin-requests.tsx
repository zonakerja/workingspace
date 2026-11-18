import { Briefcase, Building2, Check, Clock, Inbox, MailWarning, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ProductMark, UserAvatar } from "@workingspace/ui/brand";
import { productName } from "@workingspace/ui/ecosystem";
import { Notice } from "@/components/auth-layout";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { DURATION_CHOICES, accessLabel, durationLabel } from "@/lib/access";
import { type AdminAccessRequest, type AppRole, adminApi, errorText } from "@/lib/api";
import { ROLE_LABELS, formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Admin → Pengajuan: pengajuan akses / perpanjangan beserta tujuannya; setujui (role + lama akses) atau tolak (catatan). */
export function RequestsPanel({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const [rows, setRows] = useState<AdminAccessRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ row: AdminAccessRequest; action: "approve" | "reject" } | null>(null);

  const load = useCallback(() => {
    adminApi
      .requests(status)
      .then(setRows)
      .catch((err) => setError(errorText(err)));
  }, [status]);
  useEffect(load, [load]);

  return (
    <Section
      id="pengajuan"
      icon={<Inbox />}
      eyebrow="Pengajuan akses"
      title={status === "pending" ? "Menunggu keputusan" : "Semua pengajuan"}
      description="Tinjau tujuan pengaju, lalu setujui dengan lama akses yang sesuai. Setelah masa akses habis, data hanya bisa dibaca 180 hari lalu dihapus aplikasi."
      action={
        <div className="flex gap-1 rounded-xl border p-1">
          {(["pending", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold",
                status === value ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "pending" ? "Menunggu" : "Semua"}
            </button>
          ))}
        </div>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {notice && (
        <div className="mb-3">
          <Notice tone="success">{notice}</Notice>
        </div>
      )}
      {!rows && !error && <Spinner className="mx-auto my-6" />}
      {rows?.length === 0 && (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {status === "pending" ? "Tidak ada pengajuan yang menunggu." : "Belum ada pengajuan."}
        </p>
      )}
      <div className="flex flex-col gap-3">
        {rows?.map((row) => (
          <RequestRow key={row.id} row={row} onDecide={(action) => setDeciding({ row, action })} />
        ))}
      </div>
      <DecisionDialog
        key={deciding ? `${deciding.row.id}-${deciding.action}` : "none"}
        target={deciding}
        onClose={() => setDeciding(null)}
        onDone={(message) => {
          setDeciding(null);
          setNotice(message);
          load();
          onChanged();
        }}
      />
    </Section>
  );
}

function RequestRow({ row, onDecide }: { row: AdminAccessRequest; onDecide: (a: "approve" | "reject") => void }) {
  const current = row.current ? accessLabel(row.current.access) : null;
  return (
    <article className="rounded-2xl border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <UserAvatar name={row.account.name} seed={row.account.id} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{row.account.name}</p>
          <p className="truncate text-xs text-muted-foreground">{row.account.email}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground [&_svg]:size-3.5">
            {row.account.occupation && (
              <span className="flex items-center gap-1">
                <Briefcase /> {row.account.occupation}
              </span>
            )}
            {row.account.workplace && (
              <span className="flex items-center gap-1">
                <Building2 /> {row.account.workplace}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ProductMark appKey={row.appKey} name={row.appName} className="size-8 rounded-lg" />
          <div className="text-right">
            <p className="text-sm font-semibold">{productName(row.appKey, row.appName)}</p>
            <p className="text-xs text-muted-foreground">{row.current ? "Perpanjangan" : "Akses baru"}</p>
          </div>
        </div>
      </div>
      <blockquote className="mt-3 rounded-xl border-l-4 border-primary/40 bg-muted/40 px-3 py-2 text-sm whitespace-pre-line">
        {row.purpose}
      </blockquote>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3.5" /> {relativeTime(row.createdAt)}
        </span>
        {!row.account.emailVerified && (
          <StatusPill tone="warning">
            <MailWarning /> Email belum diverifikasi
          </StatusPill>
        )}
        {row.current && current && <StatusPill tone={current.tone}>Saat ini: {current.text}</StatusPill>}
        {row.status !== "pending" && (
          <StatusPill tone={row.status === "approved" ? "success" : "danger"}>
            {row.status === "approved"
              ? `Disetujui · ${row.role ? ROLE_LABELS[row.role] : ""} · ${durationLabel(row.durationDays)}`
              : "Ditolak"}
            {row.decidedAt ? ` · ${formatDateTime(row.decidedAt)}` : ""}
          </StatusPill>
        )}
        {row.note && <span className="text-xs text-muted-foreground">Catatan: {row.note}</span>}
        {row.status === "pending" && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onDecide("reject")}>
              <X /> Tolak
            </Button>
            <Button size="sm" disabled={!row.account.emailVerified} onClick={() => onDecide("approve")}>
              <Check /> Setujui
            </Button>
          </span>
        )}
      </div>
    </article>
  );
}

function DecisionDialog({
  target,
  onClose,
  onDone,
}: {
  target: { row: AdminAccessRequest; action: "approve" | "reject" } | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [role, setRole] = useState<AppRole>(target?.row.current?.role ?? "member");
  const [days, setDays] = useState<number | null>(90);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = target?.row;
  const app = row ? productName(row.appKey, row.appName) : "";

  const submit = async () => {
    if (!target || !row) return;
    setBusy(true);
    setError(null);
    try {
      if (target.action === "approve") {
        await adminApi.approve(row.id, { role, days });
        onDone(`Akses ${app} untuk ${row.account.name} disetujui (${durationLabel(days)}).`);
      } else {
        await adminApi.reject(row.id, note.trim() || undefined);
        onDone(`Pengajuan ${row.account.name} ditolak.`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{target?.action === "approve" ? `Setujui akses ${app}` : "Tolak pengajuan"}</DialogTitle>
          <DialogDescription>{row?.account.name}</DialogDescription>
        </DialogHeader>
        {target?.action === "approve" ? (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>Role</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                {(["member", "admin"] as const).map((value) => (
                  <ChoiceButton key={value} active={role === value} onClick={() => setRole(value)}>
                    {ROLE_LABELS[value]}
                  </ChoiceButton>
                ))}
              </div>
            </Field>
            <Field>
              <FieldLabel>Lama akses</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {DURATION_CHOICES.map((c) => (
                  <ChoiceButton key={String(c.days)} active={days === c.days} onClick={() => setDays(c.days)}>
                    {c.label}
                  </ChoiceButton>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {row?.current?.access.state === "active" && row.current.access.expiresAt
                  ? "Perpanjangan dihitung dari akhir masa akses sekarang."
                  : "Dihitung mulai hari ini."}
              </p>
            </Field>
          </div>
        ) : (
          <Field>
            <FieldLabel htmlFor="reject-note">Catatan untuk pengaju (opsional)</FieldLabel>
            <Textarea
              id="reject-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contoh: tujuan belum jelas, lengkapi unit kerja dan kebutuhan."
            />
          </Field>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant={target?.action === "reject" ? "destructive" : "default"}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : target?.action === "approve" ? <Check /> : <X />}
            {target?.action === "approve" ? "Setujui" : "Tolak"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
        active ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}
