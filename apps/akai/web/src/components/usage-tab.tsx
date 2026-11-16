import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCost, formatTokens } from "@/lib/akai-logic";
import { type Usage, type UsageGroup, api, errorText } from "@/lib/api";

const TASK_NAMES: Record<string, string> = {
  chat: "Chat & asisten",
  general: "Umum",
  agent: "Agen",
  document: "Rapikan dokumen",
  ocr: "OCR",
  embedding: "Embedding",
  transcribe: "Transkrip",
  "-": "—",
};
const APP_NAMES: Record<string, string> = { web: "Akai web", akasha: "Akasha" };

/** Tab Pemakaian: jumlah panggilan, token, dan perkiraan biaya per model / tugas / aplikasi + 50 panggilan terakhir. */
export function UsageTab() {
  const [days, setDays] = useState(30);
  const [loaded, setLoaded] = useState<Usage | null>(null);
  // Data rentang lama tidak ditampilkan saat rentang diganti (memuat lagi)
  const usage = loaded?.days === days ? loaded : null;

  useEffect(() => {
    let alive = true;
    api
      .usage(days)
      .then((value) => alive && setLoaded(value))
      .catch((error: unknown) => alive && toast.error(errorText(error)));
    return () => {
      alive = false;
    };
  }, [days]);

  const modelName = (id: string) => usage?.labels[id] ?? (id === "-" ? "—" : "Model dihapus");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Biaya = perkiraan dari harga model di Akai (model paket / tanpa harga tidak dihitung). Tagihan resmi ada di
          dasbor router/provider.
        </p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">24 jam</SelectItem>
            <SelectItem value="7">7 hari</SelectItem>
            <SelectItem value="30">30 hari</SelectItem>
            <SelectItem value="90">90 hari</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!usage ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Panggilan" value={usage.total.calls.toLocaleString("id-ID")} />
            <Stat label="Gagal" value={usage.total.failed.toLocaleString("id-ID")} />
            <Stat
              label="Token masuk / keluar"
              value={`${formatTokens(usage.total.inputTokens)} / ${formatTokens(usage.total.outputTokens)}`}
            />
            <Stat label="Perkiraan biaya" value={formatCost(usage.total.cost)} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <GroupTable title="Per model" rows={usage.byModel} name={modelName} />
            <GroupTable title="Per tugas" rows={usage.byTask} name={(k) => TASK_NAMES[k] ?? k} />
            <GroupTable title="Per aplikasi" rows={usage.byApp} name={(k) => APP_NAMES[k] ?? k} />
          </div>
          <section className="min-w-0 rounded-2xl border bg-card">
            <h3 className="border-b px-4 py-3 font-semibold">Panggilan terakhir</h3>
            {usage.recent.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Belum ada panggilan pada rentang ini.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Waktu</TableHead>
                      <TableHead>Aplikasi</TableHead>
                      <TableHead>Tugas</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Token</TableHead>
                      <TableHead>Hasil</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usage.recent.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {new Date(row.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                        </TableCell>
                        <TableCell className="text-xs">{APP_NAMES[row.clientId] ?? row.clientId}</TableCell>
                        <TableCell className="text-xs">{TASK_NAMES[row.task ?? "-"] ?? row.task}</TableCell>
                        <TableCell className="max-w-48 truncate text-xs" title={row.modelId ?? ""}>
                          {modelName(row.modelId ?? "-")}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {row.inputTokens ?? "—"} / {row.outputTokens ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-64 text-xs">
                          {row.ok ? (
                            <Badge variant="secondary">
                              {row.fallbackFrom ? `Cadangan (dari ${row.fallbackFrom})` : "Berhasil"}
                            </Badge>
                          ) : (
                            <span className="line-clamp-2 text-destructive" title={row.error ?? ""}>
                              {row.error ?? "Gagal"}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-4 shadow-soft">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display mt-1 truncate text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function GroupTable({ title, rows, name }: { title: string; rows: UsageGroup[]; name: (key: string) => string }) {
  return (
    <section className="min-w-0 rounded-2xl border bg-card">
      <h3 className="border-b px-4 py-3 font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="divide-y">
          {rows.slice(0, 10).map((row) => (
            <li key={row.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{name(row.key)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {row.calls}× · {formatTokens(row.inputTokens + row.outputTokens)}
              </span>
              <span className="w-20 truncate text-right text-xs tabular-nums">{formatCost(row.cost)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
