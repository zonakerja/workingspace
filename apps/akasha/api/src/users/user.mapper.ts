import { accessState } from "../access/access-state";
import { User } from "../generated/prisma/client";

/** Hilangkan field sensitif dari user (hash & penghitung PIN); `hasPin` = PIN sudah diatur. */
export function toPublicUser(user: User): Omit<User, "pinHash" | "pinFailed" | "pinBlockedUntil" | "ssoPin"> & {
  hasPin: boolean;
  accessState: ReturnType<typeof accessState>;
} {
  const { pinHash, pinFailed, pinBlockedUntil, ssoPin, ...rest } = user;
  void pinFailed;
  void pinBlockedUntil;
  // Akun SSO: PIN diatur di akun Workingspace (cermin ssoPin); akun tanpa SSO (uji/dev): hash PIN Akasha
  return {
    ...rest,
    hasPin: rest.ssoSubject ? ssoPin : !!pinHash,
    accessState: accessState(rest.accessExpiresAt, rest.accessDeleteAt),
  };
}
