import {
  AppWindow,
  KeyRound,
  LayoutDashboard,
  LaptopMinimal,
  LogOut,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Spinner } from "@/components/ui/spinner";
import { type Account, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { UserAvatar, Wordmark } from "@workingspace/ui/brand";
import { ThemeToggle } from "@workingspace/ui/theme-toggle";

interface NavItem {
  to: string;
  hash?: string;
  label: string;
  icon: ReactNode;
}

/** Bagian halaman akun (anchor; `#pin` dipakai tautan "Kelola PIN" dari aplikasi). */
export const ACCOUNT_SECTIONS: NavItem[] = [
  { to: "/account", hash: "ringkasan", label: "Ringkasan", icon: <LayoutDashboard /> },
  { to: "/account", hash: "akses", label: "Akses", icon: <AppWindow /> },
  { to: "/account", hash: "profil", label: "Profil", icon: <UserRound /> },
  { to: "/account", hash: "keamanan", label: "Kata sandi & PIN", icon: <KeyRound /> },
  { to: "/account", hash: "perangkat", label: "Perangkat", icon: <LaptopMinimal /> },
];

const ADMIN_ITEMS: NavItem[] = [{ to: "/admin", label: "Kelola ekosistem", icon: <UsersRound /> }];

/** Bagian yang sedang terlihat di layar (untuk menandai menu). */
function useActiveSection(enabled: boolean) {
  const [active, setActive] = useState("ringkasan");
  useEffect(() => {
    if (!enabled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    for (const item of ACCOUNT_SECTIONS) {
      const el = item.hash && document.getElementById(item.hash);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [enabled]);
  return active;
}

function NavLink({ item, active, compact = false }: { item: NavItem; active: boolean; compact?: boolean }) {
  return (
    <Link
      to={item.hash ? `${item.to}#${item.hash}` : item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl text-sm font-medium transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0",
        compact ? "shrink-0 px-3 py-1.5 whitespace-nowrap" : "px-3 py-2",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {item.icon}
      <span className={compact ? undefined : "truncate"}>{item.label}</span>
    </Link>
  );
}

/**
 * Kerangka halaman akun & admin: sidebar (desktop) / bilah atas + menu geser (HP), kartu pengguna, Keluar.
 * Hash di alamat (`/account#pin`) digulir otomatis setelah isi dimuat.
 */
export function AccountShell({
  account,
  page,
  children,
}: {
  account: Account | null;
  page: "account" | "admin";
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const activeSection = useActiveSection(page === "account" && !!account);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!account || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [account, location.hash, location.key]);

  const logout = async () => {
    setLeaving(true);
    await api.logout().catch(() => undefined);
    navigate("/login", { replace: true });
  };

  const items = [...ACCOUNT_SECTIONS, ...(account?.superAdmin ? ADMIN_ITEMS : [])];
  const isActive = (item: NavItem) =>
    item.hash ? page === "account" && activeSection === item.hash : location.pathname === item.to;

  return (
    <div className="min-h-svh bg-background bg-aurora-soft">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-card/70 backdrop-blur-xl lg:flex">
        <Link to="/account" className="px-5 pt-5 pb-6">
          <Wordmark subtitle="Single sign on" />
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/80 uppercase">
            Akun saya
          </p>
          {ACCOUNT_SECTIONS.map((item) => (
            <NavLink key={item.label} item={item} active={isActive(item)} />
          ))}
          {account?.superAdmin && (
            <>
              <p className="px-3 pt-5 pb-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/80 uppercase">
                Super admin
              </p>
              {ADMIN_ITEMS.map((item) => (
                <NavLink key={item.label} item={item} active={isActive(item)} />
              ))}
            </>
          )}
        </nav>
        <div className="flex items-center justify-between gap-2 px-6 pt-3">
          <span className="text-xs font-medium text-muted-foreground">Tema</span>
          <ThemeToggle />
        </div>
        {account && (
          <div className="m-3 flex items-center gap-3 rounded-2xl border bg-background/60 p-3">
            <UserAvatar name={account.name} seed={account.id} className="size-9 text-xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{account.name}</p>
              <p className="truncate text-xs text-muted-foreground">{account.email}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              disabled={leaving}
              aria-label="Keluar"
              title="Keluar"
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              {leaving ? <Spinner /> : <LogOut className="size-4" />}
            </button>
          </div>
        )}
      </aside>

      {/* Bilah atas HP & tablet */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-xl lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Link to="/account" className="min-w-0">
            <Wordmark />
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              onClick={logout}
              disabled={leaving}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {leaving ? <Spinner /> : <LogOut className="size-4" />}
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 [scrollbar-width:none]">
          {items.map((item) => (
            <NavLink key={item.label} item={item} active={isActive(item)} compact />
          ))}
        </nav>
      </header>

      <main className="lg:pl-64">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 lg:py-8">
          {account ? (
            children
          ) : (
            <div className="flex min-h-[60svh] items-center justify-center">
              <Spinner />
            </div>
          )}
        </div>
        <footer className="mx-auto flex max-w-5xl items-center gap-2 px-6 pb-8 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Satu akun untuk semua aplikasi workingspace.id
        </footer>
      </main>
    </div>
  );
}
