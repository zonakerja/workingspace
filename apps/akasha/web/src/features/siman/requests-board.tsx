import { useQueryClient } from "@tanstack/react-query";
import { CloudDownload, ExternalLink, Inbox, Loader2, Play, UserCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { PaginationControl } from "@/components/common/pagination-control";
import { SearchInput } from "@/components/common/search-input";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSimanRequests } from "@/data/collections";
import { queryKeys } from "@/data/query-keys";
import { useAgentMenus } from "@/data/use-agent";
import { useRobotConnectors } from "@/data/use-robot";
import { usePagination } from "@/hooks/use-pagination";
import { useRetained } from "@/hooks/use-retained";
import { useSearchParam } from "@/hooks/use-search-param";
import { errorMessage } from "@/lib/api/client";
import { robotApi } from "@/lib/api/endpoints";
import { formatDateTime, formatShortDate, parseLocalYMD } from "@/lib/dates";
import { toExternalHref } from "@/lib/urls";
import { cn } from "@/lib/utils";
import type { SimanRequest } from "@/types/entities";
import {
  filterRequests,
  formatRupiah,
  isDone,
  requestCounts,
  type RequestScope,
  type RequestStage,
  statusParts,
} from "./request-logic";
import { TicketDocuments } from "./ticket-documents";

const shortDate = (ymd?: string) => (ymd ? formatShortDate(parseLocalYMD(ymd)) : "-");

function DispositionBadge({ item }: { item: SimanRequest }) {
  if (!item.disposed) return null;
  return (
    <Badge className="bg-module-soft text-module">
      <UserCheck className="size-3" /> Didispo ke Anda
    </Badge>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const { code, label } = statusParts(status);
  if (!label) return <span className="text-muted-foreground">-</span>;
  const done = isDone({ status });
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn("text-xs font-medium", done ? "text-success" : "text-warning")}>{label}</span>
      {code && <span className="text-[11px] text-muted-foreground">{code}</span>}
    </span>
  );
}

/**
 * SIMAN → Permohonan: daftar Permohonan Pengelolaan SIMAN yang dibaca robot (baca saja). Tiket yang juga tampil di
 * Penetapan Pengelolaan akun SIMAN Anda ditandai "Didispo ke Anda"; tampilan bawaan hanya tiket itu, pilihan "Semua"
 * menampilkan seluruh tiket di menu Permohonan SIMAN.
 */
export function RequestsBoard() {
  const client = useQueryClient();
  const { items, isLoading } = useSimanRequests();
  const { data: connectors } = useRobotConnectors();
  const [scope, setScope] = useState<RequestScope>("disposed");
  const [stage, setStage] = useState<RequestStage>("any");
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [openTicket, setOpenTicket] = useSearchParam("request");
  const counts = requestCounts(items, false);
  const list = filterRequests(items, { scope, stage, search, showInactive: false });
  const { pageItems, setPage, controlProps } = usePagination(list, 25);
  const lastSync = items
    .map((i) => i.syncedAt ?? "")
    .sort()
    .at(-1);
  const base = (connectors?.find((c) => c.system === "siman")?.baseUrl ?? "https://siman.kemenkeu.go.id").replace(
    /\/login\/?$|\/+$/g,
    "",
  );
  const accountHint =
    items.find((i) => i.accountHint)?.accountHint ?? connectors?.find((c) => c.system === "siman")?.credentialHint;
  const selected = items.find((i) => i.ticket === openTicket) ?? null;

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await robotApi.syncSimanRequests();
      await client.invalidateQueries({ queryKey: queryKeys.records("siman_request") });
      toast.success(`${r.total} permohonan terbaca dari SIMAN.`, { description: r.summary });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <SectionCard
      icon={Inbox}
      title="Permohonan SIMAN"
      description={
        lastSync
          ? `Akun SIMAN ${accountHint ?? "-"} · diambil ${formatDateTime(lastSync)}. Data mengikuti akun SIMAN yang tersambung di Connector; tiket yang ada di Penetapan Pengelolaan akun itu ditandai "Didispo ke Anda".`
          : "Ambil daftar Permohonan Pengelolaan dari SIMAN. Robot hanya membaca daftar Permohonan dan Penetapan Pengelolaan; tiket tidak diubah."
      }
      action={
        <Button size="sm" onClick={() => void sync()} disabled={syncing}>
          {syncing ? <Loader2 className="animate-spin" /> : <CloudDownload />} Ambil dari SIMAN
        </Button>
      }
      contentClassName="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={scope}
          onValueChange={(v) => {
            if (!v) return;
            setScope(v as RequestScope);
            setPage(1);
          }}
          className="flex flex-wrap justify-start"
        >
          <ToggleGroupItem value="disposed" className="h-8 px-2.5 text-xs">
            Didispo ke saya <span className="ml-1 text-muted-foreground">{counts.disposed}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className="h-8 px-2.5 text-xs">
            Semua permohonan <span className="ml-1 text-muted-foreground">{counts.all}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <Select
          value={stage}
          onValueChange={(v) => {
            setStage(v as RequestStage);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="w-full lg:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Semua status</SelectItem>
            <SelectItem value="process">Dalam proses</SelectItem>
            <SelectItem value="done">Selesai</SelectItem>
          </SelectContent>
        </Select>
        <SearchInput
          className="lg:flex-1"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Cari nomor tiket, satker, tipe, nomor surat…"
        />
      </div>

      {list.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>
              {isLoading
                ? "Memuat…"
                : items.length
                  ? scope === "disposed" && !search && stage === "any"
                    ? "Belum ada tiket yang didisposisikan ke Anda"
                    : "Tidak ada yang cocok"
                  : "Belum ada data permohonan"}
            </EmptyTitle>
            <EmptyDescription>
              {items.length
                ? 'Pilih "Semua permohonan" untuk melihat seluruh tiket, atau ubah pencarian.'
                : "Klik Ambil dari SIMAN. Pastikan sesi SIMAN aktif di tab Connector; pengambilan berkala bisa dinyalakan di Connector → Otomasi terjadwal."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor Tiket</TableHead>
                <TableHead>Asal Permohonan</TableHead>
                <TableHead>Tipe Pengelolaan</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className="text-right">Nilai Permohonan</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((item) => (
                <TableRow
                  key={item.id}
                  className={cn("cursor-pointer", item.disposed && "bg-module-soft/40")}
                  onClick={() => setOpenTicket(item.ticket)}
                >
                  <TableCell className="align-top">
                    <div className="flex flex-col items-start gap-1">
                      <span className="font-mono text-xs font-semibold">{item.ticket}</span>
                      <DispositionBadge item={item} />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-64 align-top">
                    <p className="text-sm break-words whitespace-normal">{item.satkerName || "-"}</p>
                    <p className="text-[11px] text-muted-foreground">{item.satkerCode}</p>
                  </TableCell>
                  <TableCell className="max-w-56 align-top text-xs break-words whitespace-normal">
                    {item.tipe || "-"}
                    {item.jenisBmn && <p className="text-muted-foreground">{item.jenisBmn}</p>}
                  </TableCell>
                  <TableCell className="align-top text-xs whitespace-nowrap">{shortDate(item.date)}</TableCell>
                  <TableCell className="align-top text-right text-xs whitespace-nowrap">
                    {formatRupiah(item.value)}
                  </TableCell>
                  <TableCell className="max-w-56 align-top whitespace-normal">
                    <StatusBadge status={item.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {list.length > 0 && <PaginationControl {...controlProps} />}

      <RequestDialog item={selected} base={base} onClose={() => setOpenTicket(null)} />
    </SectionCard>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm break-words">{value || "-"}</p>
    </div>
  );
}

function RequestDialog({
  item: itemProp,
  base,
  onClose,
}: {
  item: SimanRequest | null;
  base: string;
  onClose: () => void;
}) {
  const item = useRetained(itemProp);
  const navigate = useNavigate();
  const { data: menus } = useAgentMenus();
  // Workflow memproses tiket lewat halaman Penetapan → hanya untuk tiket yang didisposisikan ke pemilik
  const workflows = (menus ?? []).filter(
    (m) =>
      itemProp?.disposed === true &&
      m.status === "active" &&
      m.placement === "siman" &&
      m.form.some((f) => f.type === "siman_ticket"),
  );
  const extra = item ? Object.entries(item.fields ?? {}).filter(([k]) => !/^(no|aksi)$/i.test(k)) : [];
  return (
    <Dialog open={!!itemProp} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94svh] grid-cols-1 overflow-y-auto sm:max-w-2xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="font-mono">{item.ticket}</DialogTitle>
              <DialogDescription>{item.satkerName || item.satkerCode}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-1.5">
              <DispositionBadge item={item} />
              {!item.disposed && <Badge variant="secondary">Tidak didisposisikan ke Anda</Badge>}
              {item.active === false && <Badge variant="outline">Tidak lagi tampil di SIMAN</Badge>}
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-xl border p-3 sm:grid-cols-2">
              <Field label="Tipe Pengelolaan" value={item.tipe} />
              <Field label="Status" value={item.status} />
              <Field label="Tanggal Tiket" value={shortDate(item.date)} />
              <Field label="Nilai Permohonan" value={formatRupiah(item.value)} />
              <Field label="Asal Permohonan" value={[item.satkerCode, item.satkerName].filter(Boolean).join(" · ")} />
              {item.permohonanLetter ? (
                <Field
                  label="Surat Permohonan"
                  value={`${item.permohonanLetter.number} · ${item.permohonanLetter.date}`}
                />
              ) : (
                <Field label="Nomor surat di kepala tiket SIMAN" value={item.letterNumber} />
              )}
              {item.permohonanLetter && item.letterNumber && item.letterNumber !== item.permohonanLetter.number && (
                <Field
                  label="Nomor surat di kepala tiket SIMAN"
                  value={`${item.letterNumber} — bukan surat permohonan (mis. surat koreksi)`}
                />
              )}
              <Field label="Jenis BMN" value={item.jenisBmn} />
              <Field label="Korwil" value={item.korwil} />
              <Field label="Pemohon → Termohon" value={[item.pemohon, item.termohon].filter(Boolean).join(" → ")} />
              {item.disposed && <Field label="Status di Penetapan" value={item.dispositionStatus} />}
            </div>
            {item.disposed && <TicketDocuments item={item} />}
            {extra.length > 0 && (
              <details className="rounded-xl border p-3 text-sm">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                  Semua kolom daftar SIMAN ({extra.length})
                </summary>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {extra.map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="text-[11px] text-muted-foreground">{k}</dt>
                      <dd className="text-xs break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={
                    toExternalHref(`${base}/pengelolaan/${item.disposed ? "penetapan-permohonan" : "permohonan"}`) ??
                    "#"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink /> Buka SIMAN
                </a>
              </Button>
              {workflows.map((menu) => (
                <Button
                  key={menu.id}
                  size="sm"
                  onClick={() =>
                    void navigate(
                      `/siman/workflow?run=${encodeURIComponent(menu.id)}&ticket=${encodeURIComponent(item.ticket)}`,
                    )
                  }
                >
                  <Play /> {menu.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Data dari halaman daftar SIMAN. Isi lengkap tiket (aset, kelengkapan, berkas) dibaca saat workflow
              dijalankan.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
