import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { type Express, json } from "express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { PrismaExceptionFilter } from "./common/filters/prisma-exception.filter";
import { OidcService } from "./oidc/oidc.service";

async function bootstrap() {
  // Parser body Nest dimatikan: oidc-provider membaca body sendiri di /oidc (body yang sudah dibaca tidak dianjurkan)
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  const express = app.getHttpAdapter().getInstance() as Express;
  // Di belakang proxy (Caddy / Vite dev) → IP klien dari X-Forwarded-For
  if (config.get<boolean>("TRUST_PROXY") ?? true) express.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(["/api", "/interaction"], json({ limit: "100kb" }));
  app.use("/oidc", app.get(OidcService).provider.callback());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>("PORT"));
}

void bootstrap();
