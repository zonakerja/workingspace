import { plainToInstance, Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from "class-validator";

/** String kosong = tidak diisi (compose mengirim `VAR=""` untuk env opsional yang tidak dipakai). */
export const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === "boolean" ? value : String(value).toLowerCase() !== "false";

class EnvironmentVariables {
  @IsIn(["development", "production", "test"])
  NODE_ENV: "development" | "production" | "test" = "development";

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 4400;

  @IsString()
  DATABASE_URL: string;

  /** Kunci enkripsi API key sumber model (64 hex). Mengganti nilainya = key tersimpan tidak terbaca. */
  @Matches(/^[0-9a-fA-F]{64}$/, { message: "AKAI_ENCRYPTION_KEY wajib 64 karakter hex." })
  AKAI_ENCRYPTION_KEY: string;

  /** Aplikasi ekosistem yang boleh memanggil Akai: JSON [{ "client_id": "akasha", "client_secret": "…" }] */
  @IsString()
  AKAI_CLIENTS: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  TRUST_PROXY?: boolean;

  // ---- Masuk Akai web lewat SSO workingspace.id (kosong = halaman web tidak bisa masuk; gateway tetap jalan)
  /** Issuer OIDC SSO, mis. https://auth.workingspace.id/oidc */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUrl({ require_tld: false, protocols: ["http", "https"] })
  SSO_ISSUER?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  SSO_CLIENT_ID?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MinLength(16)
  SSO_CLIENT_SECRET?: string;

  /** <alamat Akai web>/api/auth/sso/callback */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUrl({ require_tld: false, protocols: ["http", "https"] })
  SSO_REDIRECT_URI?: string;

  /** Tujuan setelah keluar dari SSO, mis. <alamat Akai web>/login */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUrl({ require_tld: false, protocols: ["http", "https"] })
  SSO_POST_LOGOUT_URI?: string;

  /** Cookie sesi hanya lewat https (bawaan: true di production). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  COOKIE_SECURE?: boolean;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
  LOG_LEVEL?: string;

  /** MCP server Akasha untuk konektor Akasha (6b.5), mis. dev http://localhost:4000/api/v1/mcp, produksi http://backend:4000/api/v1/mcp. Kosong = konektor Akasha tidak ditawarkan. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUrl({ require_tld: false, protocols: ["http", "https"] })
  AKASHA_MCP_URL?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: false });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0)
    throw new Error(
      `Konfigurasi environment tidak valid:\n${errors.map((e) => `- ${e.property}: ${Object.values(e.constraints ?? {}).join(", ")}`).join("\n")}`,
    );
  return validated;
}
