import { ModulePage } from "@/components/layout/module-page";
import { ProfileForm } from "@/features/profile/profile-form";
import { PinSettingsCard } from "@/features/security/pin-settings-card";

/** Profil Saya: dibuka dari menu user di sidebar (bukan bagian Pengaturan). */
export function Component() {
  return (
    <ModulePage module="profile">
      <div className="mx-auto grid w-full max-w-5xl gap-4">
        <ProfileForm />
        <PinSettingsCard />
      </div>
    </ModulePage>
  );
}
