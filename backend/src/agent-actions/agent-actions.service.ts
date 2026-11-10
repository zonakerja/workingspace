import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { RECORD_TABLES, type RecordType } from "../records/record-schema";
import { RecordsService } from "../records/records.service";
import { ShareAccessService } from "../sharing/share-access.service";
import { collectUploadIds } from "../sharing/share-graph";
import { UploadsService } from "../uploads/uploads.service";
import { recordTitle } from "../trash/trash-logic";
import { INDEXED_TYPES } from "../ai/index/index-text";
import { changedKeys, createPayload, isAgentWritable, patchPayload, samePayload } from "./agent-action-logic";

type Payload = Record<string, unknown>;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * Aksi agen atas data kerja pemilik lewat service aplikasi yang sama (isolasi, berbagi, audit, indeks tetap berlaku):
 * buat & ubah langsung dijalankan dan bisa dibatalkan; hapus hanya permintaan yang menunggu persetujuan pemilik, lalu
 * masuk Sampah bersama turunannya.
 */
@Injectable()
export class AgentActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordsService,
    private readonly shareAccess: ShareAccessService,
    private readonly uploads: UploadsService,
  ) {}

  private writableType(type: string): RecordType {
    if (!Object.hasOwn(RECORD_TABLES, type)) throw new BadRequestException(`Jenis data '${type}' tidak dikenal.`);
    if (!isAgentWritable(type)) throw new BadRequestException(`Jenis data '${type}' hanya bisa dibaca agen.`);
    return type;
  }

  private label(type: RecordType) {
    return INDEXED_TYPES[type] ?? type;
  }

  async create(user: AuthUser, type: string, input: Payload) {
    const recordType = this.writableType(type);
    const clientId = `ag-${randomUUID()}`;
    const saved = await this.records.upsert(recordType, clientId, { payload: createPayload(clientId, input) }, user);
    const action = await this.prisma.agentAction.create({
      data: {
        userId: user.id,
        kind: "create",
        recordType,
        clientId,
        title: recordTitle(saved.payload, this.label(recordType)),
        after: json(saved.payload),
        status: "applied",
      },
    });
    return { actionId: action.id, id: clientId, payload: saved.payload };
  }

  async update(user: AuthUser, type: string, clientId: string, patch: Payload) {
    const recordType = this.writableType(type);
    const current = await this.records.findOne(recordType, clientId, {}, user);
    if (current.share) throw new BadRequestException("Agen hanya mengubah data milik pemilik sendiri.");
    const before = current.payload as Payload;
    const next = patchPayload(before, patch);
    if (samePayload(before, next)) return { actionId: null, id: clientId, changed: [] as string[] };
    const saved = await this.records.upsert(recordType, clientId, { payload: next }, user);
    const action = await this.prisma.agentAction.create({
      data: {
        userId: user.id,
        kind: "update",
        recordType,
        clientId,
        title: recordTitle(saved.payload, this.label(recordType)),
        before: json(before),
        after: json(saved.payload),
        status: "applied",
      },
    });
    return { actionId: action.id, id: clientId, changed: changedKeys(before, saved.payload) };
  }

  /** Permintaan hapus: tidak menghapus apa pun sampai pemilik menyetujuinya di Approval. */
  async requestDelete(user: AuthUser, type: string, clientId: string, reason: string) {
    const recordType = this.writableType(type);
    const current = await this.records.findOne(recordType, clientId, {}, user);
    if (current.share) throw new BadRequestException("Agen hanya bisa meminta hapus data milik pemilik sendiri.");
    const existing = await this.prisma.agentAction.findFirst({
      where: { userId: user.id, kind: "delete", recordType, clientId, status: "pending" },
    });
    if (existing) return { actionId: existing.id, pending: true, duplicate: true };
    const children = await this.shareAccess.descendantsOf(user.id, recordType, clientId);
    const action = await this.prisma.agentAction.create({
      data: {
        userId: user.id,
        kind: "delete",
        recordType,
        clientId,
        title: recordTitle(current.payload as Payload, this.label(recordType)),
        before: json(current.payload),
        reason: reason.trim(),
        children: json(children),
        status: "pending",
      },
    });
    return { actionId: action.id, pending: true, children: children.length };
  }

  list(user: AuthUser, query: { status?: string; take?: number }) {
    return this.prisma.agentAction.findMany({
      where: { userId: user.id, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(query.take ?? 100, 1), 300),
    });
  }

  countPending(user: AuthUser) {
    return this.prisma.agentAction.count({ where: { userId: user.id, kind: "delete", status: "pending" } });
  }

  private async own(user: AuthUser, id: string) {
    const action = await this.prisma.agentAction.findFirst({ where: { id, userId: user.id } });
    if (!action) throw new NotFoundException("Aksi agen tidak ditemukan.");
    return action;
  }

  /** Setujui hapus: item + turunannya masuk Sampah (satu kelompok, bertanda agen) dan bisa dipulihkan 30 hari. */
  async approve(user: AuthUser, id: string) {
    const action = await this.own(user, id);
    if (action.kind !== "delete" || action.status !== "pending") {
      throw new ConflictException("Permintaan ini sudah diputuskan.");
    }
    const type = action.recordType as RecordType;
    const children = (Array.isArray(action.children) ? action.children : []) as [string, string][];
    // Berkas milik item yang dihapus (dicatat sebelum hapus); setelahnya yang masih dirujuk data lain dilewati
    const files = new Set<string>();
    for (const [t, cid] of [[type, action.clientId] as [string, string], ...children]) {
      if (!Object.hasOwn(RECORD_TABLES, t)) continue;
      const record = await this.records.findOne(t as RecordType, cid, {}, user).catch(() => null);
      if (record) collectUploadIds(record.payload, files);
    }
    let removed = 0;
    // Turunan dulu, induk terakhir: gagal di tengah tidak meninggalkan induk terhapus dengan turunan yatim
    for (const [childType, childId] of [...children].reverse()) {
      if (!Object.hasOwn(RECORD_TABLES, childType)) continue;
      try {
        await this.records.remove(childType as RecordType, childId, {}, user, { source: "agent" });
        removed += 1;
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    try {
      await this.records.remove(type, action.clientId, {}, user, { source: "agent" });
      removed += 1;
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      await this.decide(id, "failed", "Data sudah tidak ada saat disetujui.");
      return { status: "failed", removed };
    }
    const filesTrashed = await this.trashOwnedFiles(user, files);
    await this.decide(
      id,
      "approved",
      `${removed} item${filesTrashed ? ` dan ${filesTrashed} berkas` : ""} dipindah ke Sampah.`,
    );
    return { status: "approved", removed, files: filesTrashed };
  }

  /**
   * Berkas milik item yang baru dihapus ikut ke Sampah (kelompok yang sama), kecuali masih dirujuk data lain yang hidup
   * (Resource Global, lampiran item lain, snapshot arsip). Berkas sumber Notebook / bukti brankas ditolak UploadsService.
   */
  private async trashOwnedFiles(user: AuthUser, files: Set<string>) {
    if (!files.size) return 0;
    const used = await this.records.liveUploadIds(user.id);
    let trashed = 0;
    for (const fileId of files) {
      if (used.has(fileId)) continue;
      const asset = await this.prisma.asset.findUnique({ where: { id: fileId }, select: { userId: true } });
      if (asset?.userId !== user.id) continue;
      try {
        await this.uploads.remove(fileId, user, { trash: true, source: "agent" });
        trashed += 1;
      } catch {
        // dipakai Notebook / brankas, atau sudah tidak ada → dibiarkan
      }
    }
    return trashed;
  }

  async reject(user: AuthUser, id: string, note?: string) {
    const action = await this.own(user, id);
    if (action.kind !== "delete" || action.status !== "pending") {
      throw new ConflictException("Permintaan ini sudah diputuskan.");
    }
    await this.decide(id, "rejected", note?.trim() || null);
    return { status: "rejected" };
  }

  /**
   * Batalkan buat/ubah agen. Ditolak bila record sudah diubah lagi setelah aksi (kecuali `force`), agar perubahan
   * pemilik sesudahnya tidak tertimpa diam-diam. Batalkan "buat" = record dipindah ke Sampah.
   */
  async undo(user: AuthUser, id: string, force = false) {
    const action = await this.own(user, id);
    if (action.status !== "applied" || (action.kind !== "create" && action.kind !== "update")) {
      throw new ConflictException("Aksi ini tidak bisa dibatalkan.");
    }
    const type = action.recordType as RecordType;
    let current: Payload | null = null;
    try {
      current = (await this.records.findOne(type, action.clientId, {}, user)).payload as Payload;
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    if (!force && current && !samePayload(current, action.after)) {
      throw new ConflictException(
        "Data sudah diubah lagi setelah aksi agen. Batalkan tetap akan menimpa perubahan itu.",
      );
    }
    if (action.kind === "create") {
      if (current) await this.records.remove(type, action.clientId, {}, user);
    } else {
      // Data yang sudah dihapus tidak dihidupkan lagi diam-diam lewat Batalkan: pulihkan dari Sampah dulu
      if (!current)
        throw new GoneException(
          "Data ini sudah dihapus. Pulihkan dari Tools → Sampah dulu bila ingin membatalkan perubahan agen.",
        );
      await this.records.upsert(type, action.clientId, { payload: action.before as Payload }, user);
    }
    await this.decide(id, "undone", null);
    return { status: "undone" };
  }

  private decide(id: string, status: string, message: string | null) {
    return this.prisma.agentAction.update({ where: { id }, data: { status, message, decidedAt: new Date() } });
  }
}
