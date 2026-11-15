import { LogOut, ShieldCheck, UsersRound } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/** Header halaman akun & admin SSO. */
export function AppHeader({ superAdmin }: { superAdmin: boolean }) {
  const navigate = useNavigate();
  const logout = async () => {
    await api.logout().catch(() => undefined);
    navigate("/login", { replace: true });
  };
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <Link to="/account" className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-4" />
          </span>
          <span className="truncate font-bold tracking-wide">Akun Workingspace</span>
        </Link>
        <div className="flex items-center gap-1">
          {superAdmin && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin">
                <UsersRound /> <span className="hidden sm:inline">Kelola akun</span>
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut /> <span className="hidden sm:inline">Keluar</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
