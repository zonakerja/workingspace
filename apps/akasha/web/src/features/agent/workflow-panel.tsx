import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Play, Square } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/common/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useAgentMenuRuns, useAgentReady, useAgentRunWatcher } from "@/data/use-agent";
import { queryKeys } from "@/data/query-keys";
import { useOpenSession } from "@/hooks/use-retained";
import { errorMessage } from "@/lib/api/client";
import { type AgentMenu, type AgentMenuField, agentApi } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/dates";
import { getAppIcon } from "@/lib/icons/icon-registry";

/**
 * Satu fitur buatan agen: tombol Jalankan membuka modal yang isiannya ditentukan data fitur (bukan kode di aplikasi),
 * lalu agen mengerjakannya dan hasil yang perlu keputusan masuk ke Approval. Dipakai tab Workflow & menu koneksi.
 */
export function WorkflowPanel({ menu }: { menu: AgentMenu }) {
  const client = useQueryClient();
  const ready = useAgentReady();
  const [open, setOpen] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const { data: runs } = useAgentMenuRuns(menu.id, showRuns);
  const [runId, setRunId] = useState<string | null>(null);
  const { run, error } = useAgentRunWatcher(runId, (r) => {
    void client.invalidateQueries({ queryKey: queryKeys.agentMenuRuns(menu.id) });
    if (r.status === "completed") toast.success(`${menu.label}: agen selesai.`);
    else toast.error(r.error ?? `Tugas agen berakhir (${r.status}).`);
    setRunId(null);
  });
  const Icon = getAppIcon(menu.icon, "bot").icon;

  return (
    <Card className="grid min-w-0 grid-cols-1 gap-2 p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-module-soft text-module">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{menu.label}</p>
          <p className="text-xs text-muted-foreground">{menu.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {runId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void agentApi.stop(runId).catch((e) => toast.error(errorMessage(e)))}
            >
              <Square /> Hentikan
            </Button>
          )}
          <Button size="sm" onClick={() => setOpen(true)} disabled={!!runId || !ready}>
            {runId ? <Loader2 className="animate-spin" /> : <Play />} Jalankan
          </Button>
        </div>
      </div>
      {runId && <p className="text-xs text-muted-foreground">Agen bekerja… {run?.status ?? ""}</p>}
      {!ready && <p className="text-xs text-warning">Agen Hermes belum siap.</p>}
      {error && <p className="text-xs text-warning">{error}</p>}

      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setShowRuns((v) => !v)}
        aria-expanded={showRuns}
      >
        <ChevronDown className={`size-3.5 transition-transform ${showRuns ? "rotate-180" : ""}`} /> Riwayat
      </button>
      {showRuns &&
        (!runs?.length ? (
          <p className="text-sm text-muted-foreground">Belum pernah dijalankan.</p>
        ) : (
          runs.map((r) => (
            <div key={r.runId} className="min-w-0 rounded-lg border p-2.5">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatDateTime(r.startedAt)}</span>
                <Badge variant="secondary">{r.status}</Badge>
              </div>
              {r.error ? (
                <p className="text-sm text-destructive">{r.error}</p>
              ) : r.output ? (
                <Markdown content={r.output} />
              ) : (
                <p className="text-sm text-muted-foreground">Belum ada hasil.</p>
              )}
            </div>
          ))
        ))}

      <RunDialog menu={menu} open={open} onClose={() => setOpen(false)} onStarted={setRunId} />
    </Card>
  );
}

function RunDialog({
  menu,
  open,
  onClose,
  onStarted,
}: {
  menu: AgentMenu;
  open: boolean;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const session = useOpenSession(open);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94svh] grid-cols-1 overflow-y-auto sm:max-w-lg">
        {open && <RunForm key={session} menu={menu} onClose={onClose} onStarted={onStarted} />}
      </DialogContent>
    </Dialog>
  );
}

function RunForm({
  menu,
  onClose,
  onStarted,
}: {
  menu: AgentMenu;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [starting, setStarting] = useState(false);
  const set = (name: string, value: string) => setValues((prev) => ({ ...prev, [name]: value }));
  const complete = menu.form.every((f) => !f.required || values[f.name]?.trim());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStarting(true);
    try {
      const started = await agentApi.runMenu(menu.id, { values, note: note.trim() || undefined });
      onStarted(started.runId);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-3">
      <DialogHeader>
        <DialogTitle>{menu.label}</DialogTitle>
        <DialogDescription>{menu.description}</DialogDescription>
      </DialogHeader>
      {menu.form.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          value={values[field.name] ?? ""}
          onChange={(v) => set(field.name, v)}
        />
      ))}
      <div className="grid gap-1.5">
        <Label htmlFor="workflow-note">Catatan untuk kali ini (opsional)</Label>
        <Textarea id="workflow-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </div>
      <p className="text-xs text-muted-foreground">Hasil yang perlu keputusan masuk ke Approval untuk Anda periksa.</p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={!complete || starting}>
          {starting ? <Loader2 className="animate-spin" /> : <Play />} Jalankan
        </Button>
      </DialogFooter>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: AgentMenuField;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `workflow-${field.name}`;
  const label = `${field.label}${field.required ? " *" : ""}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {field.type === "textarea" ? (
        <Textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "select" ? (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Pilih" />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input id={id} type={field.type} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
    </div>
  );
}
