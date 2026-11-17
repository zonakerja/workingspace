import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { type Express, json, urlencoded } from "express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { PrismaExceptionFilter } from "./common/filters/prisma-exception.filter";
import { mapLocalhostSubdomains } from "./common/localhost-dns";

// Dev: SSO dev di *.localhost tidak dikenal resolver Windows (lihat localhost-dns.ts)
if (process.env.NODE_ENV !== "production") mapLocalhostSubdomains();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  // Di belakang proxy (Caddy / Vite dev) → IP klien dari X-Forwarded-For
  if (config.get<boolean>("TRUST_PROXY") ?? true) (app.getHttpAdapter().getInstance() as Express).set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  // Gateway: riwayat percakapan + gambar base64 bisa besar; API pengaturan cukup kecil
  app.use("/gateway", json({ limit: "30mb" }));
  // Skill: instruksi 30 rb + 10 berkas × 50 rb karakter (huruf non-ASCII bisa 3 byte) → di atas 1 MB
  app.use("/api/skills", json({ limit: "2mb" }));
  app.use(json({ limit: "1mb" }));
  // Logout token OIDC Back-Channel Logout dikirim SSO sebagai form-urlencoded
  app.use("/api/auth/sso/backchannel-logout", urlencoded({ extended: false, limit: "64kb" }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>("PORT"));
}

void bootstrap();
