import { type ReactNode, useEffect } from "react";
import { Navigate, NavLink, useParams } from "react-router";
import { getModule, type ModuleKey, visibleTabs } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

interface ModulePageProps {
  module: ModuleKey;
  /** Konten kanan pada hero (tombol aksi utama modul). */
  actions?: ReactNode;
  /** Ringkasan kecil di samping judul (mis. statistik). */
  meta?: ReactNode;
  children: ReactNode | ((tab: string | undefined) => ReactNode);
  /** Override judul & deskripsi hero (default dari config navigasi). */
  title?: ReactNode;
  description?: ReactNode;
  /** Sembunyikan hero (mis. halaman dengan header kustom). */
  hideHero?: boolean;
  /** Banner paling rendah (dipakai Knowledge yang butuh area kerja setinggi mungkin). */
  compactHero?: boolean;
}

/**
 * Kerangka standar setiap halaman modul: banner ringkas berwarna sesuai modul,
 * tab berbasis URL (`/modul/:tab`), lalu konten. Semua halaman wajib memakai
 * komponen ini agar layout seragam. Banner sengaja satu baris (± 80 px; `compactHero` ± 65 px)
 * di layar lebar agar ruang kerja di bawahnya lega — jangan menambah blok tinggi di sini.
 */
export function ModulePage({
  module: key,
  actions,
  meta,
  children,
  hideHero,
  compactHero,
  title,
  description,
}: ModulePageProps) {
  const module = getModule(key);

  // Warna modul juga dipasang di <html> agar konten portal (Dialog, Popover, Sheet) ikut berwarna modul
  useEffect(() => {
    document.documentElement.dataset.module = key;
  }, [key]);
  const role = useAuthStore((s) => s.user?.role);
  const { tab } = useParams();
  const tabs = visibleTabs(module, role);

  // Tab tidak valid / kosong → arahkan ke tab pertama yang boleh diakses
  if (tabs.length > 0 && !tabs.some((t) => t.id === tab)) {
    return <Navigate to={`${module.path}/${tabs[0].id}`} replace />;
  }

  const Icon = module.icon;

  return (
    <div data-module={module.key} className="mx-auto flex w-full max-w-7xl flex-col gap-3">
      {!hideHero && (
        <section
          className={cn(
            "relative overflow-hidden rounded-2xl bg-module-gradient text-white shadow-md shadow-module/15",
            compactHero ? "px-3.5 py-2.5 md:px-4 md:py-3" : "rounded-3xl px-4 py-3.5 md:px-5 md:py-4",
          )}
        >
          <div className="pointer-events-none absolute inset-0 bg-dots opacity-50" />
          <div className="pointer-events-none absolute -top-12 -right-8 size-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-4">
            <div className="flex min-w-0 items-center gap-3 lg:min-w-72 lg:flex-1">
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center bg-white/20 ring-1 ring-white/30 backdrop-blur",
                  compactHero ? "size-9 rounded-xl" : "size-11 rounded-2xl",
                )}
              >
                <Icon className={compactHero ? "size-[18px]" : "size-[22px]"} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1
                    className={cn(
                      "leading-tight font-extrabold tracking-tight",
                      compactHero ? "text-lg md:text-xl" : "text-xl md:text-2xl",
                    )}
                  >
                    {title ?? module.label}
                  </h1>
                  {meta && <div className="flex flex-wrap gap-1.5">{meta}</div>}
                </div>
                <div
                  className={cn(
                    "line-clamp-1 max-w-3xl text-white/80",
                    compactHero ? "mt-0.5 text-xs" : "mt-1 text-[13px]",
                  )}
                >
                  {description ?? module.description}
                </div>
              </div>
            </div>
            {actions && (
              // HP: satu baris yang bisa digeser agar banner tidak meninggi; layar lebar: boleh membungkus
              <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 lg:mx-0 lg:flex-wrap lg:justify-end lg:overflow-visible lg:px-0 [&>*]:shrink-0">
                {actions}
              </div>
            )}
          </div>
        </section>
      )}

      {tabs.length > 0 && (
        <nav className="-mx-1 overflow-x-auto px-1">
          <div className="inline-flex min-w-max gap-1 rounded-2xl border bg-card p-1 shadow-xs">
            {tabs.map((t) => {
              const TabIcon = t.icon;
              return (
                <NavLink
                  key={t.id}
                  to={`${module.path}/${t.id}`}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
                      isActive
                        ? "bg-module text-module-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-module-soft hover:text-module",
                    )
                  }
                >
                  <TabIcon className="size-3.5" />
                  {t.label}
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}

      <div className="min-w-0">{typeof children === "function" ? children(tab) : children}</div>
    </div>
  );
}

/** Pemberi tanda pada hero, mis. jumlah item. */
export function HeroStat({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/18 px-2 py-0.5 text-[11px] font-semibold ring-1 ring-white/25 backdrop-blur [&_svg]:size-3">
      {children}
    </span>
  );
}
