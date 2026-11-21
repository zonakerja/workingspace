import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mergeChecklist } from "../requests/request-checklist";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import mammoth from "mammoth";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { RecordsService } from "../records/records.service";
import { ObjectStorageService } from "../storage/object-storage.service";
import { Prisma } from "../generated/prisma/client";
import { type RequestStatus, withHistory } from "../requests/request-logic";
import { UploadsService } from "../uploads/uploads.service";
import { SimanAgentService } from "./siman-agent.service";
import { simanTicketNumber } from "./siman-agent-logic";
import { simanDate } from "./siman-requests";
import { AgentPolicyService } from "../agent/agent-policy.service";
import { isLandOrBuilding, kelengkapanFacts, type SimanFacts } from "../agent/siman-policy";
import {
  analysisDocument,
  decreeDocument,
  documentFileName,
  normalizeDocumentData,
  packDocument,
  type SimanDocumentAsset,
  textChanges,
  withLetterhead,
} from "./siman-documents";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GARUDA = join(__dirname, "..", "..", "templates", "siman", "garuda.png");
const ORIGINAL_CHARS = 60_000;
/** Dokumen hasil milik pengajuan Approval (ikut terhapus bersama pengajuannya), sama dengan dokumen templat pengajuan. */
const REQUEST_DOCUMENT_CONTEXT = "request-document";
/** Pengajuan yang masih bisa ditambah dokumen (belum diputuskan pemilik). */
const OPEN_STATUSES = ["baru", "diproses", "menunggu_verifikasi"];
/** Berkas milik pengajuan (dibuat untuknya, ikut terhapus bersama pengajuan): daftar aset usulan. */
const REQUEST_CONTEXT = "request";

/** Hasil baca tiket yang dipakai di sini (lihat RobotService.readSimanTicket). */
interface TicketRead {
  aset?: SimanDocumentAsset[];
  info?: Record<string, string>;
  ringkasanAset?: { jumlah?: number; nilaiPermohonan?: number; cocokDenganKepala?: boolean | null } | null;
  berkas?: { nama: string; jenis: string; nomor: string; uploadId: string | null }[];
}

export type SimanDocumentKind = "analysis" | "decree";

/** Satu dokumen hasil yang tertaut ke record `siman_request.documents`. */
export interface SimanTicketDocument {
  kind: SimanDocumentKind;
  uploadId: string;
  name: string;
  createdAt: string;
  createdBy: "agent";
  /** Teks dokumen saat dibuat agen — pembanding suntingan pemilik di ONLYOFFICE */
  originalText: string;
  /** Versi ONLYOFFICE yang suntingannya sudah dipelajari agen */
  learnedVersion?: number;
  /** Cara penandatanganan Dokumen Analisis: konvensional (cetak & tanda tangan basah) / digital (lewat SRIKANDI) */
  method?: "konvensional" | "digital";
  /** Entri Register Naskah Keluar SRIKANDI (`srikandi_outgoing.id`) bila sudah dinaikkan */
  registerId?: string;
}

/**
 * Dokumen hasil workflow Penetapan SIMAN: dibuat server dari data analisis agen + daftar aset tiket yang terakhir dibaca,
 * disimpan sebagai dokumen ONLYOFFICE (Tools → ONLYOFFICE → Dokumen) dan ditautkan ke record `siman_request` tiketnya,
 * sehingga pemilik bisa memeriksa & mengubahnya. Agen membaca suntingan pemilik (teks buatan agen vs isi sekarang) untuk
 * dipelajari dan disimpan di memorinya. Tidak ada yang diunggah ke SIMAN; SRIKANDI hanya lewat Register oleh pemilik.
 */
@Injectable()
export class SimanDocumentsService {
  private readonly logger = new Logger(SimanDocumentsService.name);

  constructor(
    private readonly siman: SimanAgentService,
    private readonly uploads: UploadsService,
    private readonly records: RecordsService,
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private async requestRecord(user: AuthUser, ticket: string) {
    const record = (await this.records.findMany("siman_request", {}, user)).find(
      (r) => !r.share && r.clientId === ticket,
    );
    if (!record) {
      throw new BadRequestException(
        `Tiket ${ticket} tidak ada di daftar Permohonan SIMAN akun ini. Perbarui daftar (siman_sync_requests / SIMAN → Permohonan) dulu.`,
      );
    }
    return record.payload as Record<string, unknown>;
  }

  /** Kop Dokumen Analisis = templat dokumen ONLYOFFICE milik pemilik bernama "Surat Dinas". */
  private async letterhead(user: AuthUser): Promise<Buffer | null> {
    const template = await this.prisma.asset.findFirst({
      where: {
        userId: user.id,
        context: "office-template",
        originalName: { contains: "Surat Dinas", mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!template) return null;
    return this.storage.getObjectBuffer(template.objectKey);
  }

  async create(user: AuthUser, rawTicket: string, rawData: unknown, include: SimanDocumentKind[]) {
    const ticket = simanTicketNumber(rawTicket);
    if (!ticket) throw new BadRequestException("Nomor tiket tidak valid (PPL…).");
    const data = normalizeDocumentData({ ...(rawData as object), ticket });
    if ("error" in data) throw new BadRequestException(data.error);
    const record = await this.requestRecord(user, ticket);
    if (record.disposed !== true) {
      throw new BadRequestException(
        `Tiket ${ticket} tidak didisposisikan ke pemilik (tidak ada di Penetapan Pengelolaan).`,
      );
    }
    const result = this.siman.ticketResult(user, ticket) as TicketRead;
    const assets = Array.isArray(result?.aset) ? result.aset : [];
    if (!assets.length)
      throw new BadRequestException("Daftar aset tiket kosong. Baca ulang tiket dengan siman_read_ticket.");
    const kinds = [...new Set(include.length ? include : (["analysis", "decree"] as SimanDocumentKind[]))];
    if (kinds.includes("decree") && data.status !== "LENGKAP") {
      throw new BadRequestException("Konsep KM PSP hanya dibuat bila status kelengkapan LENGKAP.");
    }

    const notes: string[] = [];
    const created: SimanTicketDocument[] = [];
    for (const kind of kinds) {
      let buffer: Buffer;
      if (kind === "analysis") {
        buffer = await packDocument(analysisDocument(data, assets));
        const kop = await this.letterhead(user).catch(() => null);
        if (kop) {
          try {
            buffer = withLetterhead(buffer, kop);
          } catch (error) {
            notes.push(`Kop tidak dipasang: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else
          notes.push('Kop tidak dipasang: templat dokumen "Surat Dinas" belum ada di Tools → ONLYOFFICE → Templat.');
      } else {
        const garuda = await readFile(GARUDA).catch(() => null);
        buffer = await packDocument(decreeDocument(data, assets, garuda));
      }
      const name = documentFileName(kind, data);
      const asset = await this.uploads.createFromBuffer(buffer, name, DOCX, user, REQUEST_DOCUMENT_CONTEXT);
      const originalText = (await mammoth.extractRawText({ buffer }).catch(() => ({ value: "" }))).value.slice(
        0,
        ORIGINAL_CHARS,
      );
      created.push({
        kind,
        uploadId: asset.id,
        name,
        createdAt: new Date().toISOString(),
        createdBy: "agent",
        originalText,
      });
    }
    const requestId = await this.toApproval(user, ticket, record, data, created, result);
    // Panel tiket menampilkan hasil run terakhir saja (dokumen lama, mis. konsep KM PSP yang kini tidak berlaku, tidak tertinggal)
    const documents = created;
    // Nomor di kepala tiket SIMAN ("Nomor Surat Pemohon") bisa surat koreksi / surat lain, bukan surat permohonan:
    // nomor & tanggal surat permohonan sebenarnya (dibaca AI agent dari isi berkas) disimpan terpisah
    const permohonanLetter = { number: data.nomorSurat, date: data.tanggalSurat };
    await this.records.upsert(
      "siman_request",
      ticket,
      { payload: { ...record, documents, requestId, permohonanLetter } },
      user,
    );
    return {
      approval: { requestId, status: "menunggu_verifikasi" },
      tiket: ticket,
      dokumen: created.map((d) => ({
        jenis: d.kind === "analysis" ? "Dokumen Analisis" : "Konsep KM PSP",
        uploadId: d.uploadId,
        nama: d.name,
      })),
      catatan: notes,
      petunjuk:
        "Dokumen masuk antrian Approval (Menunggu verifikasi) dan tampil di SIMAN → Permohonan → tiket ini. Minta pemilik memeriksa & mengubahnya di ONLYOFFICE lalu memutuskan di Approval; jangan mendaftarkan ke SRIKANDI sebelum pemilik menyetujui.",
    };
  }

  /**
   * Hasil kerja masuk antrian **Approval**: satu pengajuan per tiket (jenis PSP, sumber AI agent) berstatus Menunggu verifikasi
   * yang berisi dokumen hasil. Pengajuan tiket yang masih terbuka dipakai lagi (dokumen baru ditambahkan); yang sudah diputuskan
   * pemilik → pengajuan baru. Dibuat langsung (tanpa pemicu Kebijakan Otomatis): keputusan tetap di tangan pemilik.
   */
  private async toApproval(
    user: AuthUser,
    ticket: string,
    record: Record<string, unknown>,
    data: ReturnType<typeof normalizeDocumentData> & object,
    created: SimanTicketDocument[],
    read: TicketRead,
  ): Promise<string> {
    if ("error" in data) throw new BadRequestException(data.error);
    const docs = created.map((d) => ({
      uploadId: d.uploadId,
      name: d.name,
      templateName: d.kind === "analysis" ? "Dokumen Analisis (AI agent)" : "Konsep KM PSP (AI agent)",
      createdAt: d.createdAt,
    }));
    const note = `Tiket SIMAN ${ticket} · kelengkapan ${data.status}`;
    const existing =
      typeof record.requestId === "string"
        ? await this.prisma.request.findFirst({ where: { id: record.requestId, userId: user.id } })
        : null;
    const reuse = existing && OPEN_STATUSES.includes(existing.status) ? existing : null;
    const attachments = await this.ticketAttachments(user, ticket, read, reuse?.attachments);
    const fresh = this.analysisOf(ticket, data, read);
    // Tanda cek manual pemilik pada checklist lama tetap menempel saat analisis dibuat ulang
    const analysis = {
      ...fresh,
      checklist: mergeChecklist((reuse?.analysis as { checklist?: unknown } | null)?.checklist, fresh.checklist),
    };
    let requestId: string;
    if (reuse) {
      // Dokumen AI agent dari run sebelumnya diganti hasil terbaru (konsep KM PSP lama tidak tertinggal bila status kini tidak LENGKAP);
      // dokumen lain di pengajuan tetap
      const agentNames = new Set(["Dokumen Analisis (AI agent)", "Konsep KM PSP (AI agent)"]);
      const before = (Array.isArray(reuse.documents) ? (reuse.documents as { templateName?: string }[]) : []).filter(
        (d) => !agentNames.has(d?.templateName ?? ""),
      );
      await this.prisma.request.update({
        where: { id: reuse.id },
        data: {
          documents: [...before, ...docs] as unknown as Prisma.InputJsonValue,
          attachments: attachments as unknown as Prisma.InputJsonValue,
          analysis: analysis as unknown as Prisma.InputJsonValue,
          status: "menunggu_verifikasi",
          history: withHistory(
            reuse.history,
            "menunggu_verifikasi",
            "agen",
            reuse.review || reuse.draftReply
              ? `Dokumen diperbarui AI agent · ${note} · telaah & konsep jawaban sebelumnya dibuat dari dokumen lama — telaah ulang sebelum memutuskan`
              : `Dokumen diperbarui AI agent · ${note}`,
          ) as unknown as Prisma.InputJsonValue,
        },
      });
      requestId = reuse.id;
    } else {
      const opened = withHistory([], "baru" as RequestStatus, "agen", `Dari workflow Penetapan SIMAN · ${note}`);
      const request = await this.prisma.request.create({
        data: {
          userId: user.id,
          kind: "psp",
          title: `PSP ${data.satker} – ${ticket}`.slice(0, 300),
          applicant: data.satker,
          letterNumber: data.nomorSurat,
          letterDate: simanDate(data.tanggalSurat) || null,
          subject: data.perihal,
          source: "mcp",
          notes: `${note}. Berkas pemohon = berkas Kelengkapan Dokumen SIMAN + daftar aset usulan (CSV). Dokumen Analisis dan konsep KM PSP disusun AI agent dari data tiket SIMAN (SIMAN → Permohonan → ${ticket}). Periksa & ubah di ONLYOFFICE; setelah disetujui, naikkan ke SRIKANDI (Dokumen Analisis boleh konvensional).`,
          attachments: attachments as unknown as Prisma.InputJsonValue,
          analysis: analysis as unknown as Prisma.InputJsonValue,
          documents: docs as unknown as Prisma.InputJsonValue,
          status: "menunggu_verifikasi",
          history: withHistory(opened, "menunggu_verifikasi", "agen") as unknown as Prisma.InputJsonValue,
        },
      });
      requestId = request.id;
    }
    await this.applyPolicy(user, requestId, ticket, data, read, record, created);
    return requestId;
  }

  /**
   * Berkas pemohon pengajuan: berkas Kelengkapan Dokumen SIMAN yang terunduh (dirujuk, konteks `siman` — tidak ikut terhapus
   * bersama pengajuan) + daftar aset usulan sebagai CSV (milik pengajuan). Agar telaah pengajuan & pemilik melihat datanya.
   */
  private async ticketAttachments(user: AuthUser, ticket: string, read: TicketRead, previous: unknown) {
    const list: { uploadId: string; name: string; mimeType: string }[] = Array.isArray(previous)
      ? (previous as { uploadId: string; name: string; mimeType: string }[]).filter(
          (a) => !a.name.startsWith(`Daftar Aset ${ticket}`),
        )
      : [];
    const ids = (read.berkas ?? []).map((b) => b.uploadId).filter((id): id is string => !!id);
    const files = await this.prisma.asset.findMany({
      where: { id: { in: ids }, userId: user.id },
      select: { id: true, originalName: true, mimeType: true },
    });
    for (const file of files) {
      if (!list.some((a) => a.uploadId === file.id))
        list.push({ uploadId: file.id, name: file.originalName, mimeType: file.mimeType });
    }
    const assets = read.aset ?? [];
    if (assets.length) {
      const csv = assetCsv(assets);
      const name = `Daftar Aset ${ticket}.csv`;
      const asset = await this.uploads.createFromBuffer(
        Buffer.from(csv, "utf8"),
        name,
        "text/csv",
        user,
        REQUEST_CONTEXT,
      );
      list.push({ uploadId: asset.id, name, mimeType: "text/csv" });
    }
    return list;
  }

  /** Analisis & kelengkapan pengajuan dari data tiket (bagian "Analisis & kelengkapan" di Approval). */
  private analysisOf(
    ticket: string,
    data: Exclude<ReturnType<typeof normalizeDocumentData>, { error: string }>,
    read: TicketRead,
  ) {
    const summary = read.ringkasanAset;
    const status = (cek: string) =>
      /^ada$/i.test(cek.trim()) ? "ada" : /^tidak/i.test(cek.trim()) ? "tidak_ada" : "perlu_dicek";
    const checklist = data.kelengkapan
      .filter((k) => k.cek && k.cek !== "-" && k.cek.trim())
      .map((k) => ({ dokumen: k.dok, status: status(k.cek), catatan: k.cek }));
    return {
      summary: `Tiket SIMAN ${ticket} — ${data.satker}: ${summary?.jumlah ?? read.aset?.length ?? 0} aset, nilai permohonan Rp${(summary?.nilaiPermohonan ?? 0).toLocaleString("id-ID")}${summary?.cocokDenganKepala === true ? " (sama dengan kepala tiket)" : summary?.cocokDenganKepala === false ? " (BERBEDA dengan kepala tiket)" : ""}. Status kelengkapan menurut AI agent: ${data.status}.`,
      fields: {
        tiket: ticket,
        kodeSatker: data.kodeSatker,
        satker: data.satker,
        nomorSurat: data.nomorSurat,
        tanggalSurat: data.tanggalSurat,
        jenisAset: read.info?.["Jenis Aset"] ?? "",
        jumlahAset: summary?.jumlah ?? read.aset?.length ?? 0,
      },
      checklist,
      missing: checklist.filter((c) => c.status === "tidak_ada").map((c) => c.dokumen),
      suggestion:
        "Persyaratan wajib PSP selain tanah/bangunan: surat permohonan + daftar barang yang sama dengan daftar aset usulan SIMAN, dan SPTJM. Dokumen kepemilikan hanya untuk tanah/bangunan; listing tidak wajib.",
      sources: [],
      analyzedAt: new Date().toISOString(),
    };
  }

  /** Kebijakan Otomatis sumber Workflow SIMAN (bila ada aturan aktif) memutuskan dari fakta server. */
  private async applyPolicy(
    user: AuthUser,
    requestId: string,
    ticket: string,
    data: Exclude<ReturnType<typeof normalizeDocumentData>, { error: string }>,
    read: TicketRead,
    record: Record<string, unknown>,
    created: SimanTicketDocument[],
  ) {
    // Hanya dokumen run ini: konsep dari run lama tidak boleh membuat kebijakan menganggap dokumen lengkap
    const kinds = new Set(created.map((d) => d.kind));
    const facts: SimanFacts = {
      ticket,
      ...kelengkapanFacts((read.berkas ?? []).map((b) => ({ jenis: b.jenis, nama: b.nama, uploadId: b.uploadId }))),
      landOrBuilding: isLandOrBuilding(read.info?.["Jenis Aset"] ?? "", read.info?.["Tipe Pengelolaan"] ?? ""),
      assetsMatch: read.ringkasanAset?.cocokDenganKepala ?? null,
      assetCount: read.aset?.length ?? 0,
      analysisStatus: data.status,
      documents: { analysis: kinds.has("analysis"), decree: kinds.has("decree") },
      disposed: record.disposed === true,
      stage:
        typeof record.dispositionStatus === "string"
          ? record.dispositionStatus
          : typeof record.status === "string"
            ? record.status
            : null,
    };
    try {
      const policies = this.moduleRef.get(AgentPolicyService, { strict: false });
      await policies.decideSiman(user.id, requestId, facts);
    } catch (error) {
      this.logger.warn(
        `Kebijakan SIMAN tiket ${ticket} tidak dijalankan: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Dokumen hasil satu tiket (atau semua tiket yang punya dokumen, terbaru dulu) + suntingan pemilik: versi ONLYOFFICE,
   * baris yang dihapus/ditambah dibanding buatan agen. `markLearned` = tandai versi sekarang sudah dipelajari agen.
   */
  async list(
    user: AuthUser,
    rawTicket: string | undefined,
    options: { unlearnedOnly?: boolean; markLearned?: boolean },
  ) {
    const ticket = rawTicket ? simanTicketNumber(rawTicket) : null;
    if (rawTicket && !ticket) throw new BadRequestException("Nomor tiket tidak valid (PPL…).");
    const records = (await this.records.findMany("siman_request", {}, user)).filter(
      (r) =>
        !r.share &&
        (!ticket || r.clientId === ticket) &&
        Array.isArray((r.payload as Record<string, unknown>).documents),
    );
    const out: unknown[] = [];
    for (const r of records.slice(0, 30)) {
      const payload = r.payload as Record<string, unknown>;
      const docs = (payload.documents as SimanTicketDocument[]).filter((d) => d?.uploadId);
      const assets = await this.prisma.asset.findMany({
        where: { id: { in: docs.map((d) => d.uploadId) }, userId: user.id },
        include: { extraction: true },
      });
      const byId = new Map(assets.map((a) => [a.id, a]));
      let marked = false;
      const items = docs.map((d) => {
        const asset = byId.get(d.uploadId);
        if (!asset) return { jenis: d.kind, uploadId: d.uploadId, nama: d.name, ada: false };
        const edited = asset.version > 1;
        const learned = (d.learnedVersion ?? 1) >= asset.version;
        const ext = asset.extraction;
        const reading = edited && ext?.status !== "completed";
        const changes = edited && !reading ? textChanges(d.originalText ?? "", ext?.extractedText ?? "") : null;
        if (options.markLearned && edited && !reading && !learned) {
          d.learnedVersion = asset.version;
          marked = true;
        }
        return {
          jenis: d.kind,
          uploadId: d.uploadId,
          nama: asset.originalName,
          ada: true,
          versi: asset.version,
          disuntingPemilik: edited,
          sudahDipelajari: learned,
          ...(reading ? { catatan: "Isi terbaru masih dibaca server, coba lagi sebentar." } : {}),
          ...(changes ? { perubahan: changes } : {}),
          metode: d.method ?? null,
          registerSrikandi: d.registerId ?? null,
        };
      });
      if (marked) {
        await this.records.upsert("siman_request", r.clientId, { payload: { ...payload, documents: docs } }, user);
      }
      const visible = options.unlearnedOnly
        ? items.filter((i) => "disuntingPemilik" in i && i.disuntingPemilik && !i.sudahDipelajari)
        : items;
      if (visible.length) out.push({ tiket: r.clientId, satker: payload.satkerName ?? null, dokumen: visible });
    }
    if (ticket && !out.length && !options.unlearnedOnly) {
      throw new BadRequestException(`Tiket ${ticket} belum punya dokumen hasil. Buat dengan create_siman_documents.`);
    }
    this.logger.debug(`Dokumen SIMAN dibaca: ${out.length} tiket`);
    return { tiket: out };
  }
}

/** Daftar aset usulan → CSV (pemisah titik koma, BOM agar terbaca Excel). */
function assetCsv(assets: SimanDocumentAsset[]): string {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = [
    "No",
    "Kode Register",
    "Kode Barang",
    "Nama Barang",
    "NUP",
    "Merk",
    "Tipe",
    "Tanggal Perolehan",
    "Nilai Perolehan",
    "Kondisi",
  ];
  const rows = assets.map((a, i) =>
    [
      i + 1,
      a.kodeRegister,
      a.kodeBarang,
      a.namaBarang,
      a.nup,
      a.merk,
      a.tipe,
      a.tanggalPerolehan,
      a.nilaiPerolehan,
      a.kondisi,
    ]
      .map(cell)
      .join(";"),
  );
  return "\uFEFF" + [head.map(cell).join(";"), ...rows].join("\r\n");
}
