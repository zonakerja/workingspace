import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BadRequestException } from "@nestjs/common";
import { isPrivateHost } from "../common/private-host";

/** Kunci enkripsi sandi akun email (turunan AI_ENCRYPTION_KEY, dipakai SMTP & IMAP). */
export const mailCryptoKey = (aiKeyHex: string) =>
  createHmac("sha256", Buffer.from(aiKeyHex, "hex")).update("akasha:mail-account:v1").digest("hex");

/** Server email yang ternyata mengarah ke IP privat ditolak di production (dicek setelah DNS, bukan hanya nama host). */
export async function assertPublicMailHost(host: string, production: boolean, label: "SMTP" | "IMAP") {
  if (!production) return;
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new BadRequestException(`Server ${label} tidak ditemukan.`);
  if (addresses.some((a) => isPrivateHost(a.address)))
    throw new BadRequestException(`Server ${label} harus alamat publik.`);
}
