import { createHash, timingSafeEqual } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { parseClients } from "../oidc/oidc-config";
import { parseBasicAuth } from "../pin/pin-logic";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Autentikasi backend aplikasi (HTTP Basic client_id:client_secret klien OIDC) untuk API antar-server. */
@Injectable()
export class ClientAuthService {
  private readonly clients: Map<string, Buffer>;

  constructor(config: ConfigService) {
    const production = config.get<string>("NODE_ENV") === "production";
    this.clients = new Map(
      parseClients(config.getOrThrow<string>("OIDC_CLIENTS"), production).map((c) => [
        c.client_id,
        digest(c.client_secret),
      ]),
    );
  }

  /** client_id aplikasi pemanggil; perbandingan secret waktu-konstan. */
  authenticate(req: Request): string {
    const creds = parseBasicAuth(req.headers.authorization);
    const expected = creds && this.clients.get(creds.id);
    if (!creds || !expected || !timingSafeEqual(expected, digest(creds.secret)))
      throw new UnauthorizedException("Kredensial aplikasi tidak valid.");
    return creds.id;
  }
}
