import { Plug, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ModulePage } from "@/components/layout/module-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useMcpConnections, useMcpPresets } from "@/data/use-mcp-connections";
import { useSearchParam } from "@/hooks/use-search-param";
import { getAppIcon } from "@/lib/icons/icon-registry";
import { cn } from "@/lib/utils";
import type { McpPreset } from "@/types/api";
import { AddConnectionDialog } from "./add-connection-dialog";
import { STATUS_LABEL, STATUS_TONE, toolCounts } from "./mcp-utils";
import { useConnectApp } from "./use-connect-app";

/**
 * Connection & MCP → Aplikasi MCP: katalog aplikasi ber-server MCP + daftar koneksi. Aplikasi yang ditambahkan tampil
 * di sidebar Connection & MCP dan punya halamannya sendiri (`/mcp-app/:slug`).
 */
export function Component() {
  const { data: presets } = useMcpPresets();
  const { data: connections, isLoading } = useMcpConnections();
  const connect = useConnectApp();
  const [adding, setAdding] = useState<{ preset: McpPreset | null } | null>(null);
  const [errorParam, setErrorParam] = useSearchParam("error");

  useEffect(() => {
    if (!errorParam) return;
    toast.error(errorParam);
    setErrorParam(null);
  }, [errorParam, setErrorParam]);

  const connectedKeys = new Set((connections ?? []).map((c) => c.preset).filter(Boolean));

  return (
    <ModulePage
      module="mcp"
      actions={
        <Button variant="secondary" onClick={() => setAdding({ preset: null })}>
          <Plus /> Aplikasi lain
        </Button>
      }
    >
      {() => (
        <div className="grid grid-cols-1 gap-4">
          <Card className="flex items-start gap-3 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-module-soft text-module">
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold">Kredensial tetap di LifeOS</p>
              <p className="mt-1 text-muted-foreground">
                Token dan izin aplikasi disimpan terenkripsi dan tidak pernah dikirim ke browser maupun ke agen. Agen
                hanya bisa memakai aplikasi yang Anda izinkan di halaman aplikasinya; alat yang bisa menghapus data
                tidak pernah dijalankan agen.
              </p>
            </div>
          </Card>

          <section className="grid grid-cols-1 gap-2">
            <h2 className="text-sm font-semibold">Aplikasi tersambung</h2>
            {isLoading ? (
              <Spinner />
            ) : !connections?.length ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Belum ada aplikasi. Pilih dari katalog di bawah.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {connections.map((c) => {
                  const Icon = getAppIcon(c.icon, "plug").icon;
                  const counts = toolCounts(c.tools);
                  return (
                    <Card key={c.id} className="flex min-w-0 items-center gap-3 p-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-module-soft text-module">
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link to={`/mcp-app/${c.slug}`} className="block truncate font-semibold hover:underline">
                          {c.name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge className={cn("shrink-0", STATUS_TONE[c.status])}>{STATUS_LABEL[c.status]}</Badge>
                          {c.tools.length > 0 && (
                            <span>
                              {c.tools.length} alat · {counts.read} baca · {counts.write} ubah
                            </span>
                          )}
                          {c.agentEnabled && <span>· agen diizinkan</span>}
                        </div>
                      </div>
                      {c.status !== "connected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={connect.pending || connect.waitingFor === c.id}
                          onClick={() => connect.start(c)}
                        >
                          {connect.waitingFor === c.id ? <Spinner /> : <Plug />} Sambungkan
                        </Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-2">
            <h2 className="text-sm font-semibold">Katalog</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(presets ?? []).map((p) => {
                const Icon = getAppIcon(p.icon, "plug").icon;
                return (
                  <Card key={p.key} className="flex min-w-0 flex-col gap-2 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-module-soft text-module">
                        <Icon className="size-4" />
                      </span>
                      <span className="font-semibold">{p.name}</span>
                    </div>
                    <p className="flex-1 text-xs text-muted-foreground">{p.description}</p>
                    <Button size="sm" variant="outline" onClick={() => setAdding({ preset: p })}>
                      <Plus /> {connectedKeys.has(p.key) ? "Tambah akun lain" : "Sambungkan"}
                    </Button>
                  </Card>
                );
              })}
              <Card className="flex min-w-0 flex-col gap-2 border-dashed p-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Plug className="size-4" />
                  </span>
                  <span className="font-semibold">Aplikasi lain</span>
                </div>
                <p className="flex-1 text-xs text-muted-foreground">
                  Aplikasi apa pun yang punya server MCP (alamat dari dokumentasinya).
                </p>
                <Button size="sm" variant="outline" onClick={() => setAdding({ preset: null })}>
                  <Plus /> Isi alamat
                </Button>
              </Card>
            </div>
          </section>

          <AddConnectionDialog
            preset={adding?.preset ?? null}
            open={!!adding}
            onOpenChange={(open) => !open && setAdding(null)}
            onCreated={(connection, popup) => {
              setAdding(null);
              connect.start(connection, popup);
            }}
          />
        </div>
      )}
    </ModulePage>
  );
}
