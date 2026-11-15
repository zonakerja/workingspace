import { UserRole } from "../generated/prisma/client";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  role: UserRole;
  /** Sesi login, tetap sama saat token dirotasi */
  sid?: string;
};

export type RefreshTokenPayload = {
  sub: string;
  jti: string;
  sid?: string;
};
