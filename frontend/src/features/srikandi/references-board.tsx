import { useQueryClient } from "@tanstack/react-query";
import { BookUser, CloudDownload, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PaginationControl } from "@/components/common/pagination-control";
import { SearchInput } from "@/components/common/search-input";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSrikandiReferences } from "@/data/collections";
import { queryKeys } from "@/data/query-keys";
import { usePagination } from "@/hooks/use-pagination";
import { errorMessage } from "@/lib/api/client";
import { robotApi } from "@/lib/api/endpoints";
import { formatDateTime } from "@/lib/dates";
import type { SrikandiReference, SrikandiReferenceCategory } from "@/types/entities";

export const REFERENCE_LABELS: Record<SrikandiReferenceCategory, string> = {
  signer: "Penandatangan",
  recipient: "Tujuan Naskah",
  recipient_group: "Grup Tujuan",
  verifier: "Verifikator",
  cc: "Tembusan",
  cc_group: "Grup Tembusan",
  disposition_group: "Grup Disposisi",
  classification: "Klasifikasi",
  sender_unit: "Instansi Pengirim",
};
const CATEGORIES = Object.keys(REFERENCE_LABELS) as SrikandiReferenceCategory[];
/**
 * Kategori yang diambil terpisah (tombol sendiri): klasifikasi (±1.000 baris) dan Instansi Pengirim (pilihan "Dikirimkan
 * melalui" formulir Registrasi yang digulir sampai habis, ± 1.500 unit). Sisanya = menu Pengguna (Ambil referensi).
 */
const SEPARATE: Partial<
  Record<
    SrikandiReferenceCategory,
    {
      button: string;
      busy: string;
      run: () => Promise<{ counts: Record<string, number>; totals: Record<string, number> }>;
    }
  >
> = {
  classification: {
    button: "Ambil klasifikasi",
    busy: "Mengambil… (± 3–5 menit)",
    run: () => robotApi.syncClassifications(),
  },
  sender_unit: {
    button: "Ambil instansi pengirim",
    busy: "Mengambil… (± 2–3 menit)",
    run: () => robotApi.syncSenderUnits(),
  },
};
const USER_CATEGORIES = CATEGORIES.filter((c) => !SEPARATE[c]);
/** Kolom yang sudah tampil di label klasifikasi ("KODE - Nama") tidak diulang. */
const HIDDEN_FIELDS = new Set(["Dibuat Pada", "Kode", "Nama Klasifikasi"]);

/** Urutan kolom saat ditampilkan (jsonb tidak menjaga urutan). */
const FIELD_ORDER = [
  "Jabatan",
  "Unit Kerja / Instansi",
  "Instansi / Unit Kerja",
  "Pangkat",
  "Jenis Tujuan",
  "Jenis Tembusan",
  "Deskripsi",
  "Jumlah Tujuan",
  "Status",
];
const fieldRank = (key: string) => {
  const i = FIELD_ORDER.indexOf(key);
  return i < 0 ? FIELD_ORDER.length : i;
};

const matches = (ref: SrikandiReference, query: string) =>
  !query || [ref.label, ...Object.values(ref.fields ?? {})].some((v) => v.toLowerCase().includes(query));

/**
 * SRIKANDI → Referensi: penandatangan, tujuan, verifikator, tembusan, dan grup dari menu Pengguna SRIKANDI (diambil
 * robot, hanya membaca) — bahan pilihan formulir Register Naskah Keluar.
 */
export function ReferencesBoard() {
  const client = useQueryClient();
  const { items } = useSrikandiReferences();
  const [category, setCategory] = useState<SrikandiReferenceCategory>("signer");
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const list = items
    .filter((r) => r.category === category && matches(r, search.trim().toLowerCase()))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const { pageItems, setPage, controlProps } = usePagination(list, 20);
  const count = (c: SrikandiReferenceCategory) => items.filter((r) => r.category === c).length;
  const lastSync = items
    .map((r) => r.syncedAt ?? "")
    .sort()
    .at(-1);

  const separate = SEPARATE[category];
  const sync = async () => {
    setSyncing(true);
    try {
      if (separate) {
        const r = await separate.run();
        await client.invalidateQueries({ queryKey: queryKeys.records("srikandi_reference") });
        const n = r.counts[category] ?? 0;
        const total = r.totals[category];
        toast.success(
          `${n} ${REFERENCE_LABELS[category].toLowerCase()} diambil dari SRIKANDI${total !== undefined ? ` (total ${total})` : ""}.`,
        );
        return;
      }
      const r = await robotApi.syncReferences();
      await client.invalidateQueries({ queryKey: queryKeys.records("srikandi_reference") });
      const short = USER_CATEGORIES.filter((c) => (r.totals[c] ?? 0) > (r.counts[c] ?? 0));
      toast.success("Referensi SRIKANDI diperbarui.", {
        description: USER_CATEGORIES.map(
          (c) => `${REFERENCE_LABELS[c]} ${r.counts[c] ?? 0}${r.totals[c] !== undefined ? `/${r.totals[c]}` : ""}`,
        ).join(" · "),
      });
      if (short.length) {
        toast.info("Sebagian kecil baris tergabung karena sama persis di SRIKANDI (entri ganda).");
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <SectionCard
      icon={BookUser}
      title="Referensi SRIKANDI"
      description={
        lastSync
          ? `Diambil dari SRIKANDI ${formatDateTime(lastSync)}. Dipakai sebagai pilihan di Register Naskah Keluar.`
          : "Penandatangan, tujuan, verifikator, tembusan, dan grup dari menu Pengguna SRIKANDI — pilihan Register Naskah Keluar."
      }
      action={
        <Button size="sm" onClick={() => void sync()} disabled={syncing}>
          {syncing ? <Loader2 className="animate-spin" /> : <CloudDownload />}{" "}
          {syncing ? (separate?.busy ?? "Mengambil… (± 1–2 menit)") : (separate?.button ?? "Ambil referensi")}
        </Button>
      }
      contentClassName="flex flex-col gap-3"
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={category}
        onValueChange={(v) => {
          if (!v) return;
          setCategory(v as SrikandiReferenceCategory);
          setPage(1);
        }}
        className="flex-wrap justify-start"
      >
        {CATEGORIES.map((c) => (
          <ToggleGroupItem key={c} value={c} className="gap-1.5">
            {REFERENCE_LABELS[c]}
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {count(c)}
            </Badge>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder={`Cari ${REFERENCE_LABELS[category].toLowerCase()}…`}
      />
      {list.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookUser />
            </EmptyMedia>
            <EmptyTitle>{count(category) ? "Tidak ada data" : "Belum ada referensi"}</EmptyTitle>
            <EmptyDescription>
              {count(category)
                ? `Belum ada ${REFERENCE_LABELS[category].toLowerCase()} yang cocok.`
                : `Klik ${separate?.button ?? "Ambil referensi"}. Pastikan sesi SRIKANDI aktif di tab Connector.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid grid-cols-1 gap-1.5">
          {pageItems.map((r) => (
            <li key={r.id} className="rounded-md bg-muted/40 px-3 py-2">
              <p className="text-sm font-medium">{r.label}</p>
              {!!r.fields && Object.keys(r.fields).length > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {Object.entries(r.fields)
                    .filter(([key]) => !HIDDEN_FIELDS.has(key))
                    .sort(([a], [b]) => fieldRank(a) - fieldRank(b))
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <PaginationControl {...controlProps} />
    </SectionCard>
  );
}
