import { User } from "../generated/prisma/client";

/**
 * Hilangkan field sensitif dari user (hash password & PIN, penghitung salah PIN); `hasPin` = PIN sudah diatur,
 * `hasPassword` = punya kata sandi lokal Akasha (akun SSO saja = false).
 */
export function toPublicUser(user: User): Omit<
  User,
  "passwordHash" | "pinHash" | "pinFailed" | "pinBlockedUntil" | "ssoPin"
> & {
  hasPin: boolean;
  hasPassword: boolean;
} {
  const { passwordHash, pinHash, pinFailed, pinBlockedUntil, ssoPin, ...rest } = user;
  void pinFailed;
  void pinBlockedUntil;
  // Akun SSO: PIN diatur di akun Workingspace (cermin ssoPin); akun lokal: hash PIN Akasha
  return { ...rest, hasPin: rest.ssoSubject ? ssoPin : !!pinHash, hasPassword: !!passwordHash };
}
