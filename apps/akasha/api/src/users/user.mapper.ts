import { User } from "../generated/prisma/client";

/** Hilangkan field sensitif dari user (hash password & PIN, penghitung salah PIN); `hasPin` = PIN sudah diatur. */
export function toPublicUser(
  user: User,
): Omit<User, "passwordHash" | "pinHash" | "pinFailed" | "pinBlockedUntil"> & { hasPin: boolean } {
  const { passwordHash, pinHash, pinFailed, pinBlockedUntil, ...rest } = user;
  void passwordHash;
  void pinFailed;
  void pinBlockedUntil;
  return { ...rest, hasPin: !!pinHash };
}
