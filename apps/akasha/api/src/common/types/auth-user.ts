import { UserRole } from "../../generated/prisma/client";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  /** Sesi login (token akses dari login/refresh). Token agen / MCP tidak punya sesi → item terkunci PIN tetap tertutup. */
  sid?: string;
};
