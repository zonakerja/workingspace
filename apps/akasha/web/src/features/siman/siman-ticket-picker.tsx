import { useState } from "react";
import { Link } from "react-router";
import { SearchableSelect } from "@/components/common/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useSimanRequests } from "@/data/collections";
import { ticketOptions } from "./request-logic";

/**
 * Isian workflow jenis `siman_ticket`: pilih nomor tiket dari daftar Permohonan SIMAN (dropdown dengan pencarian), bukan
 * diketik. Hanya tiket yang didisposisikan ke pemilik (diproses lewat halaman Penetapan Pengelolaan); bawaan yang masih
 * diproses, centang untuk menampilkan yang sudah selesai.
 */
export function SimanTicketPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { items, isLoading } = useSimanRequests();
  const open = ticketOptions(items);
  const [includeDone, setIncludeDone] = useState(() => !!value && !open.some((o) => o.value === value));
  const options = includeDone ? ticketOptions(items, true) : open;
  const done = ticketOptions(items, true).length - open.length;

  if (!isLoading && !items.length) {
    return (
      <p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
        Daftar Permohonan SIMAN masih kosong.{" "}
        <Link className="font-semibold underline" to="/siman/requests">
          Ambil dari SIMAN
        </Link>{" "}
        dulu, lalu pilih tiketnya di sini.
      </p>
    );
  }
  return (
    <div className="grid gap-1.5">
      <SearchableSelect
        id={id}
        value={value || undefined}
        onChange={onChange}
        options={options}
        placeholder={isLoading ? "Memuat daftar tiket…" : "Pilih tiket yang didispo ke Anda"}
        searchPlaceholder="Cari nomor tiket atau satker…"
        emptyText="Tidak ada tiket didispo yang masih diproses."
        wrap
      />
      {done > 0 && (
        <div className="flex items-center gap-2">
          <Checkbox id={`${id}-done`} checked={includeDone} onCheckedChange={(v) => setIncludeDone(v === true)} />
          <Label htmlFor={`${id}-done`} className="text-xs font-normal text-muted-foreground">
            Tampilkan juga tiket yang sudah selesai ({done})
          </Label>
        </div>
      )}
    </div>
  );
}
