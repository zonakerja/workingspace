import {
  Brain,
  Sparkles,
  Check,
  ExternalLink,
  FolderKanban,
  LogOut,
  Menu,
  MessageSquarePlus,
  Pencil,
  Pin,
  Plug,
  PinOff,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, type Me, api, errorText } from "@/lib/api";
import { type ConversationSummary, chatApi, groupConversations } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@workingspace/ui/brand";
import { ThemeToggle } from "@workingspace/ui/theme-toggle";
import { AkaiWordmark } from "./akai-mark";

/** Data bersama halaman di dalam kerangka (akun + daftar percakapan). */
export interface ShellContext {
  me: Me;
  conversations: ConversationSummary[];
  reloadConversations: () => Promise<void>;
}

export const useShell = () => useOutletContext<ShellContext>();

/**
 * Kerangka Akai web (6b.1): sidebar riwayat percakapan + isi. Belum masuk → /login. Halaman chat memakai tinggi penuh;
 * halaman lain (Pengaturan Model) diberi wadah bergulir.
 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // Laci HP terbuka untuk halaman tertentu: pindah halaman = otomatis tertutup
  const [mobileOpenAt, setMobileOpenAt] = useState<string | null>(null);
  const mobileOpen = mobileOpenAt === location.pathname;
  const setMobileOpen = (open: boolean) => setMobileOpenAt(open ? location.pathname : null);
  const [initialPath] = useState(() => `${location.pathname}${location.search}`);

  const reloadConversations = useCallback(async () => {
    try {
      setConversations(await chatApi.list());
    } catch (error) {
      toast.error(errorText(error));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((value) => {
        if (!alive) return;
        setMe(value);
        void reloadConversations();
      })
      .catch((error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate(`/login?returnTo=${encodeURIComponent(initialPath)}`, { replace: true });
        } else toast.error(errorText(error));
      });
    return () => {
      alive = false;
    };
  }, [initialPath, navigate, reloadConversations]);

  if (!me)
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="size-6" />
      </div>
    );

  const isChat = location.pathname === "/" || location.pathname.startsWith("/chat");
  const sidebar = <Sidebar me={me} conversations={conversations} reload={reloadConversations} />;

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 border-r bg-muted/30 md:flex">{sidebar}</aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[85vw] max-w-80 gap-0 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Riwayat percakapan</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <Button variant="ghost" size="icon-sm" onClick={() => setMobileOpen(true)} aria-label="Buka riwayat">
            <Menu />
          </Button>
          <AkaiWordmark subtitle="Asisten AI" />
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={() => navigate("/chat")}
            aria-label="Percakapan baru"
          >
            <MessageSquarePlus />
          </Button>
        </div>
        <main className={cn("min-h-0 flex-1", isChat ? "flex flex-col" : "overflow-y-auto")}>
          {isChat ? (
            <Outlet context={{ me, conversations, reloadConversations } satisfies ShellContext} />
          ) : (
            <div className="mx-auto max-w-6xl px-4 py-5 md:py-7">
              <Outlet context={{ me, conversations, reloadConversations } satisfies ShellContext} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  me,
  conversations,
  reload,
}: {
  me: Me;
  conversations: ConversationSummary[];
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const { id: activeId } = useParams();
  const [query, setQuery] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupConversations(q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations);
  }, [conversations, query]);

  async function logout() {
    setLeaving(true);
    try {
      const { ssoLogoutUrl } = await api.logout();
      window.location.assign(ssoLogoutUrl ?? "/login?sso_checked=1");
    } catch (error) {
      toast.error(errorText(error));
      setLeaving(false);
    }
  }

  async function saveTitle() {
    if (!renaming) return;
    try {
      await chatApi.update(renaming.id, { title: renaming.title });
      setRenaming(null);
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function togglePin(c: ConversationSummary) {
    try {
      await chatApi.update(c.id, { pinned: !c.pinned });
      await reload();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  const name = me.account.name || me.account.email || "Akun";
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <AkaiWordmark subtitle="Asisten AI" />
        <ThemeToggle />
      </div>
      <div className="flex flex-col gap-2 px-3 pb-2">
        <Button className="justify-start" onClick={() => navigate("/chat")}>
          <MessageSquarePlus data-icon="inline-start" /> Percakapan baru
        </Button>
        <NavLink
          to="/projects"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent",
              isActive && "bg-accent font-medium",
            )
          }
        >
          <FolderKanban className="size-4" /> Proyek
        </NavLink>
        <NavLink
          to="/memory"
          className={({ isActive }) =>
            cn(
              "-mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent",
              isActive && "bg-accent font-medium",
            )
          }
        >
          <Brain className="size-4" /> Memori
        </NavLink>
        <NavLink
          to="/skills"
          className={({ isActive }) =>
            cn(
              "-mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent",
              isActive && "bg-accent font-medium",
            )
          }
        >
          <Sparkles className="size-4" /> Skill
        </NavLink>
        <NavLink
          to="/connectors"
          className={({ isActive }) =>
            cn(
              "-mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent",
              isActive && "bg-accent font-medium",
            )
          }
        >
          <Plug className="size-4" /> Konektor
        </NavLink>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari percakapan"
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {query ? "Tidak ada percakapan yang cocok." : "Belum ada percakapan."}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mt-3 first:mt-1">
            <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </p>
            {group.items.map((c) =>
              renaming?.id === c.id ? (
                <form
                  key={c.id}
                  className="flex items-center gap-1 px-1 py-0.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveTitle();
                  }}
                >
                  <Input
                    autoFocus
                    value={renaming.title}
                    onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
                    onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                    className="h-7 text-sm"
                    maxLength={120}
                  />
                  <Button type="submit" size="icon-xs" variant="ghost" aria-label="Simpan judul">
                    <Check />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Batal"
                    onClick={() => setRenaming(null)}
                  >
                    <X />
                  </Button>
                </form>
              ) : (
                <div
                  key={c.id}
                  className={cn(
                    "group relative flex items-center rounded-lg text-sm hover:bg-accent",
                    activeId === c.id && "bg-accent font-medium",
                  )}
                >
                  <NavLink to={`/chat/${c.id}`} className="min-w-0 flex-1 truncate px-2 py-1.5" title={c.title}>
                    {c.title}
                  </NavLink>
                  <div className="absolute right-1 flex items-center gap-0.5 rounded-md bg-accent pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={c.pinned ? "Lepas sematan" : "Sematkan"}
                      title={c.pinned ? "Lepas sematan" : "Sematkan"}
                      onClick={() => void togglePin(c)}
                    >
                      {c.pinned ? <PinOff /> : <Pin />}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Ganti nama"
                      title="Ganti nama"
                      onClick={() => setRenaming({ id: c.id, title: c.title })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Hapus"
                      title="Hapus"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleting(c)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ),
            )}
          </div>
        ))}
      </nav>
      <div className="flex flex-col gap-1 border-t p-2">
        <NavLink
          to="/models"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent",
              isActive && "bg-accent font-medium",
            )
          }
        >
          <Settings2 className="size-4" /> Model & pengaturan
        </NavLink>
        <div className="flex items-center gap-2 px-2 py-1">
          <UserAvatar name={name} seed={me.account.email ?? name} className="size-7 text-[11px]" />
          <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
          {me.accountUrl && (
            <Button variant="ghost" size="icon-xs" asChild>
              <a href={me.accountUrl} aria-label="Akun Workingspace" title="Akun Workingspace">
                <ExternalLink />
              </a>
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={logout} disabled={leaving} aria-label="Keluar" title="Keluar">
            {leaving ? <Spinner /> : <LogOut />}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Hapus percakapan?"
        description={`"${deleting?.title ?? ""}" beserta pesan dan lampirannya dihapus permanen.`}
        onConfirm={async () => {
          if (!deleting) return false;
          try {
            await chatApi.remove(deleting.id);
            if (activeId === deleting.id) navigate("/chat");
            setDeleting(null);
            await reload();
            return true;
          } catch (error) {
            toast.error(errorText(error));
            return false;
          }
        }}
      />
    </div>
  );
}
