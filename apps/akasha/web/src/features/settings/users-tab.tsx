import { Database, ExternalLink, Home, Phone, Share2, ShieldCheck, Users } from "lucide-react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/config/navigation";
import { useSsoConfig } from "@/data/use-auth";
import { useUsers } from "@/data/use-users";
import { useUserStats } from "@/data/use-sharing";
import { useToday } from "@/hooks/use-today";
import { formatRelative } from "@/lib/dates";
import { useAuthStore } from "@/stores/auth-store";
import type { UserRole, UserStats } from "@/types/api";

const ROLE_BADGE: Record<UserRole, string> = {
  super_admin: "bg-mod-overview/15 text-mod-overview",
  admin: "bg-mod-planner/15 text-mod-planner",
  member: "bg-mod-working-space/15 text-mod-working-space",
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};

export function UsersTab() {
  const currentUser = useAuthStore((s) => s.user);
  const { data: users = [], isLoading } = useUsers();
  const { data: stats = [] } = useUserStats();
  const now = useToday();
  const { data: sso } = useSsoConfig();
  // Akun, role, dan akses Akasha dikelola di admin SSO workingspace.id
  const ssoAdminUrl = sso?.enabled && sso.accountUrl ? sso.accountUrl.replace(/\/account$/, "/admin") : null;

  const isSuperAdmin = currentUser?.role === "super_admin";

  return (
    <SectionCard
      icon={Users}
      title="Manajemen User"
      description="Pengguna Akasha & statistik pemakaian. Data setiap pengguna terisolasi — admin hanya melihat statistik, bukan isi data."
    >
      {
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
          <ShieldCheck className="size-4 shrink-0 text-module" />
          <span className="min-w-0 flex-1 text-muted-foreground">
            Akun, role, akses, dan penghapusan akun dikelola di <b>admin akun Workingspace</b>. Akun baru muncul di sini
            setelah pertama kali masuk Akasha; data akun yang masa aksesnya berakhir dihapus otomatis.
          </span>
          {isSuperAdmin && ssoAdminUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={ssoAdminUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Kelola akun Workingspace
              </a>
            </Button>
          )}
        </div>
      }
      {isLoading ? (
        <PageLoader />
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex flex-col gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40 md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-module-soft font-bold text-module">
                    {u.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{u.name}</span>
                    <Badge className={ROLE_BADGE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                    {u.id === currentUser?.id && <Badge variant="outline">Anda</Badge>}
                    {u.ssoSubject && (
                      <Badge variant="secondary">
                        <ShieldCheck /> Akun Workingspace
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  <UserStatsLine stat={stats.find((st) => st.userId === u.id)} now={now} />
                  {(u.phone || u.address) && (
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {u.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="size-3" /> {u.phone}
                        </span>
                      )}
                      {u.address && (
                        <span className="flex items-center gap-1">
                          <Home className="size-3" /> {u.address}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** Statistik pemakaian (tanpa isi data): jumlah data, berkas & ukurannya, berbagi, aktif terakhir. */
function UserStatsLine({ stat, now }: { stat?: UserStats; now: Date }) {
  if (!stat) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Database className="size-3" /> {stat.records} data · {stat.files} berkas ({formatBytes(stat.storageBytes)})
      </span>
      <span className="flex items-center gap-1">
        <Share2 className="size-3" /> membagikan {stat.sharesOut} · menerima {stat.sharesIn}
      </span>
      <span>Aktif {stat.lastActiveAt ? formatRelative(stat.lastActiveAt, now) : "belum pernah"}</span>
    </div>
  );
}
