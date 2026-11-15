import { plainToInstance, Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
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
  PORT = 4300;

  @IsString()
  DATABASE_URL: string;

  /** Alamat publik halaman SSO (dev http://auth.localhost:5175, produksi https://auth.workingspace.id) */
  @IsString()
  PUBLIC_URL = "http://auth.localhost:5175";

  /** JWKS privat penanda tangan token (JSON `{ "keys": [...] }`); kunci pertama dipakai menandatangani */
  @IsString()
  OIDC_JWKS: string;

  /** Kunci tanda tangan cookie oidc-provider, dipisah koma (kunci pertama dipakai, lainnya untuk rotasi) */
  @IsString()
  @MinLength(32)
  OIDC_COOKIE_KEYS: string;

  /** Klien OIDC (JSON array: client_id, client_secret, redirect_uris, post_logout_redirect_uris) */
  @IsString()
  OIDC_CLIENTS: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  COOKIE_SECURE?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  TRUST_PROXY?: boolean;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
  LOG_LEVEL?: string;

  // Email (Titan SMTP). Kosong = email ditulis ke MAIL_DIR (development)
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  SMTP_HOST?: string;

  @Transform(({ value }) => Number(value || 465))
  @IsInt()
  SMTP_PORT = 465;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  SMTP_PASSWORD?: string;

  @IsString()
  MAIL_FROM = "Workingspace <noreply@workingspace.id>";

  @IsString()
  MAIL_DIR = ".mail";

  // Masuk dengan Google (kosong = tombol disembunyikan)
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  GOOGLE_CLIENT_ID?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  GOOGLE_CLIENT_SECRET?: string;

  // Seed produksi (super admin pertama)
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail()
  SEED_ADMIN_EMAIL?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  SEED_ADMIN_PASSWORD?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: false });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(
      `Konfigurasi environment tidak valid:\n${errors.map((e) => `- ${e.property}: ${Object.values(e.constraints ?? {}).join(", ")}`).join("\n")}`,
    );
  }
  if (validated.NODE_ENV === "production" && !validated.SMTP_HOST) {
    throw new Error(
      "Konfigurasi environment tidak valid:\n- SMTP_HOST wajib diisi di production (email verifikasi & reset)",
    );
  }
  return validated;
}
