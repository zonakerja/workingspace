import { CheckCircle2, ExternalLink, LockKeyhole, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useSsoConfig, useUpdateProfile } from "@/data/use-auth";
import { errorMessage } from "@/lib/api/client";
import { useAuthStore } from "@/stores/auth-store";
import type { PublicUser } from "@/types/api";

export function ProfileForm() {
  const user = useAuthStore((s) => s.user);
  // Form diisi sekali dari profil saat dibuka; key = akun agar ganti akun selalu mulai dari data baru
  return user ? <ProfileFormInner key={user.id} user={user} /> : null;
}

/** Profil Akasha: nama, email, dan kata sandi mengikuti akun Workingspace (SSO); di sini hanya No. HP & alamat. */
function ProfileFormInner({ user }: { user: PublicUser }) {
  const updateProfile = useUpdateProfile();
  const { data: ssoConfig } = useSsoConfig();
  const [phone, setPhone] = useState(user.phone ?? "");
  const [address, setAddress] = useState(user.address ?? "");

  const save = async () => {
    try {
      await updateProfile.mutateAsync({ phone, address });
      toast.success("Profil Anda berhasil diperbarui.");
    } catch (error) {
      toast.error("Gagal menyimpan profil", { description: errorMessage(error) });
    }
  };

  return (
    <SectionCard icon={UserRound} title="Profil" description="Data akun Anda di Akasha.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <FieldGroup>
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-name">Nama Lengkap</FieldLabel>
              <Input id="profile-name" readOnly value={user.name} />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input id="profile-email" type="email" readOnly value={user.email} />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-phone">No. HP</FieldLabel>
              <Input id="profile-phone" placeholder="08..." value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-address">Alamat</FieldLabel>
              <Input
                id="profile-address"
                placeholder="Jalan..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
            <LockKeyhole className="size-4 shrink-0 text-module" />
            <span className="min-w-0 flex-1 text-muted-foreground">
              Nama, email, dan kata sandi mengikuti <b>akun Workingspace</b> Anda (berlaku untuk semua aplikasi).
            </span>
            {ssoConfig?.accountUrl && (
              <Button asChild size="sm" variant="outline">
                <a href={ssoConfig.accountUrl} target="_blank" rel="noreferrer">
                  <ExternalLink /> Buka akun Workingspace
                </a>
              </Button>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={updateProfile.isPending}>
              {updateProfile.isPending ? <Spinner /> : <CheckCircle2 />} Simpan Profil
            </Button>
          </div>
        </FieldGroup>
      </form>
    </SectionCard>
  );
}
