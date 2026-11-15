import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, type Transporter } from "nodemailer";
import { type MailContent } from "./mail-templates";

/**
 * Pengirim email (Titan SMTP, `noreply@workingspace.id`). Tanpa SMTP_HOST (development) email tidak dikirim, melainkan
 * ditulis ke MAIL_DIR sebagai berkas .eml + .txt agar alur verifikasi & reset bisa diuji tanpa mengirim email sungguhan.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;
  private readonly dir: string;

  constructor(config: ConfigService) {
    this.from = config.getOrThrow<string>("MAIL_FROM");
    this.dir = resolve(config.getOrThrow<string>("MAIL_DIR"));
    const host = config.get<string>("SMTP_HOST");
    const port = config.getOrThrow<number>("SMTP_PORT");
    this.transport = host
      ? createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user: config.get<string>("SMTP_USER"), pass: config.get<string>("SMTP_PASSWORD") },
        })
      : null;
  }

  get delivering() {
    return this.transport !== null;
  }

  async send(to: string, mail: MailContent) {
    if (this.transport) {
      await this.transport.sendMail({ from: this.from, to, subject: mail.subject, text: mail.text, html: mail.html });
      this.logger.log(`Email "${mail.subject}" terkirim`);
      return;
    }
    await mkdir(this.dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${to.replace(/[^a-z0-9@.]/gi, "_")}`;
    await writeFile(join(this.dir, `${name}.txt`), `Kepada: ${to}\nSubjek: ${mail.subject}\n\n${mail.text}\n`);
    this.logger.log(
      `Email "${mail.subject}" untuk ${to} ditulis ke ${join(this.dir, `${name}.txt`)} (SMTP belum diatur)`,
    );
  }
}
