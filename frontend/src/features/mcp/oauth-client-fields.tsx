import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface OAuthClientValue {
  clientId: string;
  clientSecret: string;
  scope: string;
}

/** Alamat callback OAuth LifeOS (sama dengan backend: alamat aplikasi + path callback). */
export const oauthRedirectUrl = (fromServer?: string | null) =>
  fromServer || `${window.location.origin}/api/v1/mcp-connections/oauth/callback`;

/**
 * Isian OAuth client yang didaftarkan pemilik sendiri — untuk aplikasi yang tidak mendukung pendaftaran klien dinamis
 * (Google Workspace, GitHub OAuth App). Secret tidak pernah ditampilkan lagi setelah disimpan.
 */
export function OAuthClientFields({
  value,
  onChange,
  redirectUrl,
  required,
  hasSecret,
  sharedNote,
}: {
  value: OAuthClientValue;
  onChange: (next: OAuthClientValue) => void;
  redirectUrl: string;
  required?: boolean;
  /** Secret sudah tersimpan: kosong = tetap memakai yang lama */
  hasSecret?: boolean;
  /** Keterangan bila client diambil dari koneksi sekelompok */
  sharedNote?: string | null;
}) {
  const copy = () =>
    void navigator.clipboard.writeText(redirectUrl).then(
      () => toast.success("Alamat callback disalin."),
      () => toast.error("Gagal menyalin."),
    );
  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border p-3">
      <div className="grid gap-1.5">
        <Label>Alamat callback (daftarkan di OAuth client)</Label>
        <div className="flex min-w-0 gap-2">
          <Input readOnly value={redirectUrl} className="min-w-0 font-mono text-xs" />
          <Button type="button" size="icon" variant="outline" onClick={copy} aria-label="Salin alamat callback">
            <Copy />
          </Button>
        </div>
      </div>
      {sharedNote && <p className="rounded-lg bg-info/10 p-2 text-xs text-info">{sharedNote}</p>}
      <div className="grid gap-1.5">
        <Label htmlFor="mcp-client-id">Client ID{required && !sharedNote ? "" : " (opsional)"}</Label>
        <Input
          id="mcp-client-id"
          autoComplete="off"
          value={value.clientId}
          onChange={(e) => onChange({ ...value, clientId: e.target.value })}
          placeholder={sharedNote ? "Kosong = pakai client yang sama" : "Mis. 1234-abc.apps.googleusercontent.com"}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="mcp-client-secret">Client Secret</Label>
        <Input
          id="mcp-client-secret"
          type="password"
          autoComplete="off"
          value={value.clientSecret}
          onChange={(e) => onChange({ ...value, clientSecret: e.target.value })}
          placeholder={hasSecret ? "Tersimpan — kosongkan bila tidak diganti" : "Tempel client secret"}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="mcp-scope">Scope</Label>
        <Textarea
          id="mcp-scope"
          rows={2}
          value={value.scope}
          onChange={(e) => onChange({ ...value, scope: e.target.value })}
          placeholder="Kosong = semua scope yang diumumkan server"
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Hak akses yang diminta ke aplikasi. Bawaan sengaja terbatas (baca + buat, tanpa hapus); tambah bila perlu.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Client ID, secret, dan izin disimpan terenkripsi di LifeOS dan tidak pernah dikirim ke agen.
      </p>
    </div>
  );
}
