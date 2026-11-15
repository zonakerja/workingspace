import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight, Download, Eye, FileText, FolderLock, Loader2, ScrollText, ShieldAlert } from "lucide-react";
import { useParams } from "react-router";
import { ThemeMenu } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { appLogoUrl, useAppSettings } from "@/data/use-app-settings";
import { errorMessage } from "@/lib/api/client";
import { publicVaultApi } from "@/lib/api/endpoints";
import type { PublicVaultView } from "@/types/api";
import { formatDateTime } from "@/lib/dates";
import { VaultFileViewer } from "./vault-file-viewer";
import { formatVaultSize } from "./vault-utils";

/**
 * Halaman publik brankas digital (tanpa login): bukti data dukung satu poin renaksi e-Kinerja yang dibuka atasan / pejabat
 * pembina kepegawaian. Server mencatat setiap pembukaan & unduhan (waktu, IP, perkiraan lokasi, peramban); pengunjung
 * diberi tahu pencatatan itu dan kewajiban pelindungan data pribadi. Fokus halaman = daftar berkas; kedua pemberitahuan tampil
 * sebagai baris kecil di bawahnya yang bisa dibuka untuk teks lengkap (keputusan pemilik 2026-11-15).
 */
function PublicVaultPage() {
  const { token = "" } = useParams();
  const { settings } = useAppSettings();
  const logoUrl = appLogoUrl(settings);
  // Satu kali per kunjungan (setiap pemanggilan = satu catatan akses)
  const vault = useQuery({
    queryKey: ["public-vault", token],
    // Situs tempat tautan diklik (mis. e-Kinerja) ikut dicatat; kosong bila tautan ditempel langsung
    queryFn: () => publicVaultApi.open(token, document.referrer),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [viewing, setViewing] = useState<PublicVaultView["files"][number] | null>(null);

  return (
    <div data-module="kinerja" className="min-h-svh bg-background px-4 py-6 sm:py-10">
      <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4">
        <header className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-module text-module-foreground">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="size-full object-cover" />
            ) : (
              <FolderLock className="size-6" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Brankas Digital</p>
            <p className="truncate text-sm font-medium">{settings.name} · Bukti data dukung kinerja</p>
          </div>
          {/* Tema dipilih pelihat sendiri (tersimpan di perangkatnya), bukan mengikuti pemilik brankas */}
          <div className="ml-auto">
            <ThemeMenu />
          </div>
        </header>

        {vault.isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border bg-card p-10 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" /> Membuka brankas…
          </div>
        ) : vault.isError || !vault.data ? (
          <div className="rounded-2xl border bg-card p-8 text-center">
            <FolderLock className="mx-auto size-10 text-muted-foreground" />
            <p className="mt-3 font-semibold">Brankas tidak dapat dibuka</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {errorMessage(vault.error, "Tautan tidak dikenal, sudah diganti, atau sudah dicabut pemiliknya.")}
            </p>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border bg-card p-4 sm:p-5">
              <h1 className="text-lg leading-snug font-bold sm:text-xl">{vault.data.title}</h1>
              {vault.data.description && (
                <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{vault.data.description}</p>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                Pemilik: {vault.data.owner} · Diperbarui {formatDateTime(vault.data.updatedAt)}
              </p>
              <p className="mt-4 mb-2 text-sm font-semibold">{vault.data.files.length} berkas bukti</p>
              <ul className="grid grid-cols-1 gap-2">
                {vault.data.files.map((file) => (
                  <li
                    key={file.id}
                    className="group flex min-w-0 items-center gap-3 rounded-xl border bg-background p-3 transition-colors hover:border-module/50 hover:bg-module-soft"
                  >
                    {/* Seluruh baris = Lihat berkas; Unduh tetap tombol sendiri */}
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => setViewing(file)}
                    >
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-module-soft text-module">
                        <FileText className="size-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium break-words sm:text-base">{file.name}</span>
                        <span className="block text-xs text-muted-foreground">{formatVaultSize(file.size)}</span>
                      </span>
                    </button>
                    <Button size="sm" title="Lihat" onClick={() => setViewing(file)}>
                      <Eye /> <span className="hidden sm:inline">Lihat</span>
                    </Button>
                    <Button asChild variant="outline" size="sm" title="Unduh">
                      <a href={publicVaultApi.fileUrl(token, file.id, true)} rel="noopener noreferrer">
                        <Download /> <span className="hidden sm:inline">Unduh</span>
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>

            {/* Pemberitahuan tetap ada tetapi ringkas: satu baris, teks lengkap saat dibuka */}
            <div className="grid grid-cols-1 gap-1.5 text-xs text-muted-foreground">
              <details className="group/pdp rounded-lg px-3 py-2 hover:bg-muted/50 open:bg-muted/50">
                <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
                  <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning" />
                  <span className="flex-1">
                    Dokumen kedinasan, dapat memuat data pribadi — hanya untuk pejabat penilai yang berwenang (UU
                    27/2022).
                  </span>
                  <ChevronRight className="mt-px size-3.5 shrink-0 transition-transform group-open/pdp:rotate-90" />
                </summary>
                <ul className="mt-2 grid list-disc grid-cols-1 gap-1 pl-9">
                  <li>
                    Akses hanya diperuntukkan bagi atasan, pejabat penilai kinerja, dan pejabat pembina kepegawaian yang
                    berwenang dalam rangka penilaian kinerja.
                  </li>
                  <li>
                    Dilarang menyebarluaskan tautan, menyalin, mengunggah ulang, atau memakai dokumen di luar keperluan
                    tersebut. Bila tautan ini Anda terima tanpa kewenangan, mohon tutup halaman ini dan beri tahu
                    pemiliknya.
                  </li>
                  <li>
                    Memperoleh, mengungkapkan, atau menggunakan data pribadi yang bukan miliknya secara melawan hukum
                    diancam pidana penjara dan/atau denda sebagaimana diatur dalam Undang-Undang Nomor 27 Tahun 2022
                    tentang Pelindungan Data Pribadi (Pasal 65 jo. Pasal 67), serta dapat dikenai sanksi disiplin bagi
                    Aparatur Sipil Negara.
                  </li>
                </ul>
              </details>
              <details className="group/log rounded-lg px-3 py-2 hover:bg-muted/50 open:bg-muted/50">
                <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
                  <ScrollText className="mt-px size-3.5 shrink-0" />
                  <span className="flex-1">
                    Akses Anda tercatat: {formatDateTime(vault.data.visitor.at)} · IP{" "}
                    {vault.data.visitor.ip ?? "tidak terbaca"}
                  </span>
                  <ChevronRight className="mt-px size-3.5 shrink-0 transition-transform group-open/log:rotate-90" />
                </summary>
                <p className="mt-2 pl-5.5">
                  Untuk keamanan, setiap pembukaan brankas dan setiap berkas yang dilihat atau diunduh dicatat dan dapat
                  dilihat pemilik brankas: waktu, alamat IP, perkiraan lokasi (dari alamat IP), serta jenis peramban dan
                  perangkat.
                </p>
                <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 pl-5.5 sm:grid-cols-[auto_1fr]">
                  <dt>Perkiraan lokasi</dt>
                  <dd className="text-foreground">{vault.data.visitor.location}</dd>
                  <dt>Peramban</dt>
                  <dd className="text-foreground">{vault.data.visitor.browser ?? "Tidak terbaca"}</dd>
                </dl>
              </details>
            </div>
          </>
        )}
      </div>
      <VaultFileViewer token={token} file={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

export { PublicVaultPage as Component };
