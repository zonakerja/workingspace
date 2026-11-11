import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMcpConnectionMutations } from "@/data/use-mcp-connections";
import { errorMessage } from "@/lib/api/client";
import type { McpAuthType, McpConnectionInfo, McpPreset } from "@/types/api";
import { AUTH_LABEL } from "./mcp-utils";

/**
 * Tambah koneksi: dari katalog (nama/alamat/cara masuk terisi, tetap bisa diubah) atau alamat sendiri. Setelah dibuat,
 * langsung disambungkan: OAuth membuka jendela izin aplikasi, token diuji.
 */
export function AddConnectionDialog({
  preset,
  open,
  onOpenChange,
  onCreated,
}: {
  preset: McpPreset | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (connection: McpConnectionInfo, popup: Window | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-1 sm:max-w-lg">
        {open && <AddConnectionForm key={preset?.key ?? "custom"} preset={preset} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function AddConnectionForm({
  preset,
  onCreated,
}: {
  preset: McpPreset | null;
  onCreated: (c: McpConnectionInfo, popup: Window | null) => void;
}) {
  const m = useMcpConnectionMutations();
  const [name, setName] = useState(preset?.name ?? "");
  const [url, setUrl] = useState(preset?.url ?? "");
  const [authType, setAuthType] = useState<McpAuthType>(preset?.authType ?? "oauth");
  const [token, setToken] = useState("");

  const submit = () => {
    // Jendela izin OAuth dibuka saat tombol diklik (setelah permintaan selesai browser akan memblokirnya)
    const popup = authType === "oauth" ? window.open("about:blank", "_blank") : null;
    m.create.mutate(
      { name, url, authType, preset: preset?.key, ...(authType === "token" ? { token } : {}) },
      {
        onSuccess: (connection) => onCreated(connection, popup),
        onError: (e) => {
          popup?.close();
          toast.error(errorMessage(e));
        },
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{preset ? `Sambungkan ${preset.name}` : "Sambungkan aplikasi lain"}</DialogTitle>
        <DialogDescription>
          {preset?.hint ??
            "Isi alamat server MCP aplikasi (lihat dokumentasi aplikasinya, biasanya berakhiran /mcp atau /sse)."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="mcp-name">Nama</Label>
          <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="mcp-url">Alamat server MCP</Label>
          <Input
            id="mcp-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.contoh.com/mcp"
          />
          {preset && (
            <p className="text-xs text-muted-foreground">Alamat resmi saat ini; ubah bila penyedia menggantinya.</p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label>Cara masuk</Label>
          <Select value={authType} onValueChange={(v) => setAuthType(v as McpAuthType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AUTH_LABEL) as McpAuthType[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {AUTH_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {authType === "token" && (
          <div className="grid gap-1.5">
            <Label htmlFor="mcp-token">Token akses</Label>
            <Input
              id="mcp-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Tempel token dari aplikasi"
            />
            <p className="text-xs text-muted-foreground">
              Disimpan terenkripsi di LifeOS dan tidak pernah ditampilkan lagi atau dikirim ke agen.
            </p>
          </div>
        )}
        {authType === "oauth" && (
          <p className="rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
            Setelah disimpan, jendela izin aplikasi terbuka. Masuk dan setujui akses, lalu kembali ke tab ini.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={m.create.isPending || !name.trim() || !url.trim()}>
          {m.create.isPending && <Loader2 className="animate-spin" />} Simpan & sambungkan
        </Button>
      </DialogFooter>
    </>
  );
}
