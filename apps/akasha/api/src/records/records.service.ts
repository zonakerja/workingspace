import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { AuditAction, Prisma } from "../generated/prisma/client";
import { AiIndexQueueService } from "../ai/index/ai-index-queue.service";
import { INDEXED_TYPES, isIndexedType } from "../ai/index/index-text";
import { NO_TRASH_RECORD_TYPES, recordTitle, type TrashSource } from "../trash/trash-logic";
import { TrashService } from "../trash/trash.service";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { LockService, PinRequiredException } from "../security/lock.service";
import { PinService } from "../security/pin.service";
import {
  ARCHIVE_ORIGIN_TYPES,
  archiveRelatedKeys,
  isFileControlResource,
  isLockableType,
  redactPayload,
} from "../security/lock-logic";
import { ShareAccessService } from "../sharing/share-access.service";
import { type SharePermission, accessKey, atLeast, collectUploadIds, parentRefsOf } from "../sharing/share-graph";
import { ListRecordsQueryDto } from "./dto/list-records-query.dto";
import { RecordOwnerQueryDto } from "./dto/record-owner-query.dto";
import { UpsertRecordDto } from "./dto/upsert-record.dto";
import { domainDelegate } from "./record-delegate";
import { preserveFields, toLightPayload } from "./record-light";
import { MERGE_ARRAY_KEYS, mergePayload } from "./record-merge";
import { type Payload, payloadToRow, rowToPayload, toApiRecord } from "./record-mapper";
import { RECORD_TABLES, type RecordType, type TableSpec, fieldName } from "./record-schema";

/** Penanda item milik user lain yang dibagikan (dikirim bersama record). */
type SharedMeta = { ownerId: string; ownerName: string; permission: SharePermission; root: boolean };
/** Record di respons daftar: `partial` = key payload yang tidak utuh (daftar ringan). */
type ApiRecord = ReturnType<typeof toApiRecord> & { share?: SharedMeta; partial?: string[]; locked?: boolean };

/** Metadata akses yang ditempelkan ke respons (bukan bagian data) — dibuang bila ikut terkirim saat menulis. */
const META_KEYS = ["share"];

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical((value as Payload)[k])]),
        )
      : value;
const sameValue = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Perubahan per field: { field: { from, to } }. */
function diffPayload(before: Payload, after: Payload) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === "userId") continue;
    if (!sameValue(before[key], after[key])) changes[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }
  return changes;
}

/** Resource/snapshot PARA hanya diaudit bila menyangkut arsip (File Control). */
function isArchivalData(type: RecordType, payload?: Payload) {
  if (!payload) return false;
  if (type === "para_resource") return !!payload.archivalStatus;
  if (type === "para_archive") return (payload.data as Payload | undefined)?.type === "file";
  return true;
}

/**
 * Data domain terisolasi per user: setiap user (termasuk admin) hanya membaca & menulis datanya sendiri, ditambah
 * item milik user lain yang dibagikan kepadanya (`shares`, lihat `src/sharing/`).
 */
@Injectable()
export class RecordsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    // Perubahan data diindeks ulang untuk RAG di latar belakang (tidak menahan respons)
    private readonly indexQueue: AiIndexQueueService,
    private readonly shareAccess: ShareAccessService,
    private readonly trash: TrashService,
    // Kunci PIN: isi item terkunci disembunyikan & ditolak ditulis selama sesi belum memasukkan PIN
    private readonly locks: LockService,
    private readonly pins: PinService,
  ) {}

  /** Record yang dihapus tetap di tabelnya (`deleted_at`); Sampah memulihkan atau menghapus barisnya permanen. */
  onModuleInit() {
    this.trash.registerHandler("record", {
      restore: (item) => this.restoreDeleted(this.parseType(item.recordType ?? ""), item.itemId, item.userId),
      purge: async (item) => {
        const type = this.parseType(item.recordType ?? "");
        await domainDelegate(this.prisma, type).deleteMany({
          where: { userId: item.userId, clientId: item.itemId, deletedAt: { not: null } },
        });
      },
    });
  }

  private async restoreDeleted(type: RecordType, clientId: string, ownerId: string) {
    const spec: TableSpec = RECORD_TABLES[type];
    const row = await this.prisma.$transaction(async (tx) => {
      const table = domainDelegate(tx, type);
      const found = await table.findUnique({ where: { userId_clientId: { userId: ownerId, clientId } } });
      if (!found) throw new NotFoundException("Data sudah dihapus permanen.");
      if (!found.deletedAt) return found;
      const saved = await table.update({ where: { id: found.id }, data: { deletedAt: null } });
      const actor = { id: ownerId } as AuthUser;
      if (spec.audit) await this.audit(tx, type, actor, ownerId, clientId, undefined, rowToPayload(spec, saved));
      return saved;
    });
    this.shareAccess.invalidate();
    this.locks.invalidate(ownerId);
    if (isIndexedType(type)) void this.indexQueue.enqueueSource(row.userId, type, clientId);
  }

  parseType(type: string): RecordType {
    if (!Object.hasOwn(RECORD_TABLES, type)) {
      throw new NotFoundException(`Record type '${type}' tidak dikenal.`);
    }
    return type as RecordType;
  }

  /** Data milik user + item yang dibagikan kepadanya (bertanda `share`). */
  async findMany(type: RecordType, query: ListRecordsQueryDto, user: AuthUser) {
    const spec: TableSpec = RECORD_TABLES[type];
    const where: Record<string, unknown> = { deletedAt: null };
    const dateField = spec.fields.find((f) => f.key === spec.dateKey);
    if (dateField && (query.from || query.to)) {
      where[fieldName(dateField)] = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    const table = domainDelegate(this.prisma, type);
    const orderBy = [{ createdAt: "asc" }, { id: "asc" }];

    const own = await table.findMany({ where: { ...where, userId: user.id }, orderBy });
    const result: ApiRecord[] = own.map((row) => toApiRecord(type, spec, row));

    for (const access of (await this.shareAccess.forUser(user.id)).values()) {
      const entries = [...access.records.values()].filter((e) => e.type === type);
      if (entries.length === 0) continue;
      const rows = await table.findMany({
        where: { ...where, userId: access.ownerId, clientId: { in: entries.map((e) => e.id) } },
        orderBy,
      });
      for (const row of rows) {
        const entry = access.records.get(accessKey(type, row.clientId))!;
        result.push({
          ...toApiRecord(type, spec, row),
          share: {
            ownerId: access.ownerId,
            ownerName: access.ownerName,
            permission: entry.permission,
            root: entry.root,
          },
        });
      }
    }
    const listed = query.light ? result.map((record) => this.lighten(type, record)) : result;
    return this.sealLocked(type, listed, user);
  }

  /**
   * Item terkunci (milik sendiri atau pemilik item bersama) di sesi yang belum memasukkan PIN: hanya kerangka (judul, waktu,
   * status, relasi) yang dikirim, ditandai `locked`; key lain masuk `partial` sehingga tulisan tidak menghapusnya.
   */
  private async sealLocked(type: RecordType, records: ApiRecord[], user: AuthUser): Promise<ApiRecord[]> {
    if (records.length === 0 || (await this.locks.isUnlocked(user))) return records;
    const sets = new Map<string, Set<string>>();
    const lockedOf = async (ownerId: string) => {
      if (!sets.has(ownerId)) sets.set(ownerId, (await this.locks.lockSet(ownerId)).records);
      return sets.get(ownerId)!;
    };
    const out: ApiRecord[] = [];
    for (const record of records) {
      const owner = record.share?.ownerId ?? record.userId;
      if (!(await lockedOf(owner)).has(accessKey(type, record.clientId))) {
        out.push(record);
        continue;
      }
      const { payload, hidden } = redactPayload(record.payload);
      out.push({ ...record, payload, partial: [...new Set([...(record.partial ?? []), ...hidden])], locked: true });
    }
    return out;
  }

  /** Versi daftar: field berat dipotong, ditandai `partial`. */
  private lighten(type: RecordType, record: ApiRecord): ApiRecord {
    const { payload, partial } = toLightPayload(type, record.payload);
    return partial.length ? { ...record, payload, partial } : record;
  }

  /** Satu record utuh (milik sendiri atau dibagikan kepada user) — dipakai editor setelah daftar ringan. */
  async findOne(type: RecordType, clientId: string, query: RecordOwnerQueryDto, user: AuthUser) {
    const spec: TableSpec = RECORD_TABLES[type];
    const ownerId = query.userId ?? user.id;
    let share: SharedMeta | undefined;
    if (ownerId !== user.id) {
      const access = await this.shareAccess.forOwner(user.id, ownerId);
      const entry = access?.records.get(accessKey(type, clientId));
      if (!access || !entry) throw new NotFoundException("Record tidak ditemukan.");
      share = { ownerId, ownerName: access.ownerName, permission: entry.permission, root: entry.root };
    }
    const row = await domainDelegate(this.prisma, type).findUnique({
      where: { userId_clientId: { userId: ownerId, clientId } },
    });
    if (!row || row.deletedAt) throw new NotFoundException("Record tidak ditemukan.");
    const [record] = await this.sealLocked(
      type,
      [{ ...toApiRecord(type, spec, row), ...(share ? { share } : {}) }],
      user,
    );
    return record;
  }

  async upsert(type: RecordType, clientId: string, dto: UpsertRecordDto, user: AuthUser) {
    const spec: TableSpec = RECORD_TABLES[type];
    const payload: Payload = { ...dto.payload, id: dto.payload.id ?? clientId };
    for (const key of META_KEYS) delete payload[key];
    const userId = await this.resolveWriteOwner(type, clientId, dto.userId ?? payload.userId, payload, user);
    const mergeKeys = dto.base ? MERGE_ARRAY_KEYS[type] : undefined;
    const preserve = dto.preserve?.length ? dto.preserve : undefined;
    const lockedRecord = await this.checkLockOnWrite(type, clientId, userId, payload, user);

    const row = await this.prisma.$transaction(async (tx) => {
      const table = domainDelegate(tx, type);
      const key = { userId_clientId: { userId, clientId } };
      const before = spec.audit || mergeKeys || preserve ? await table.findUnique({ where: key }) : null;
      const current = before && !before.deletedAt ? rowToPayload(spec, before) : undefined;
      let next = payload;
      // Perubahan client diterapkan di atas isi terkini (perubahan orang lain tidak tertimpa)
      if (mergeKeys && dto.base) {
        const base = { ...dto.base };
        for (const meta of META_KEYS) delete base[meta];
        next = { ...mergePayload(current, base, next, mergeKeys), id: next.id };
      }
      if (preserve) next = preserveFields(type, next, current, preserve, lockedRecord);
      const data = { ...payloadToRow(spec, next, clientId), deletedAt: null };
      const saved = await table.upsert({
        where: key,
        create: { userId, clientId, ...data },
        update: data,
      });
      if (spec.audit) await this.audit(tx, type, user, saved.userId, clientId, current, rowToPayload(spec, saved));
      return saved;
    });
    if (userId !== user.id) this.shareAccess.invalidate();
    this.locks.invalidate(userId);
    if (isIndexedType(type)) void this.indexQueue.enqueueSource(row.userId, type, clientId);
    // Record yang ditulis ulang (dibuat lagi dengan ID sama) tidak lagi berada di Sampah
    await this.trash.forget(row.userId, "record", clientId, type);
    return toApiRecord(type, spec, row);
  }

  /**
   * Item terkunci / item baru di dalam item terkunci hanya boleh ditulis setelah PIN dibuka. Mengunci & melepas kunci hanya
   * oleh pemilik; mengunci butuh PIN yang sudah diatur.
   */
  private async checkLockOnWrite(
    type: RecordType,
    clientId: string,
    ownerId: string,
    payload: Payload,
    user: AuthUser,
  ) {
    const lockSet = await this.locks.lockSet(ownerId);
    const lockedRecord = lockSet.records.has(accessKey(type, clientId));
    // Mengarsipkan item terkunci (atau turunannya): snapshot ikut terkunci agar isinya tidak terbuka di Archives
    const originType = type === "para_archive" ? ARCHIVE_ORIGIN_TYPES[String(payload.originalType)] : undefined;
    const archivesLocked =
      !!originType &&
      (lockSet.records.has(accessKey(originType, String(payload.originalId ?? ""))) ||
        archiveRelatedKeys(payload).some((key) => lockSet.records.has(key)));
    if (archivesLocked) {
      // Snapshot dari kerangka (PIN belum dibuka) = kosong. Ditolak tanpa PIN_REQUIRED agar tidak diulang otomatis.
      if (!(await this.locks.isUnlocked(user))) {
        throw new ForbiddenException("Ada item terkunci di dalamnya. Masukkan PIN, lalu arsipkan ulang.");
      }
      if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
        payload.data = { ...(payload.data as Payload), locked: true };
      }
    }
    const touchesLocked =
      lockedRecord ||
      parentRefsOf(type, payload).some(([refType, refId]) => lockSet.records.has(accessKey(refType, refId)));
    if (touchesLocked && !(await this.locks.isUnlocked(user))) throw new PinRequiredException();
    // Pemulihan dari arsip terkunci saat PIN belum dibuka: isi yang dikirim berasal dari kerangka (kosong). Ditolak tanpa
    // kode PIN_REQUIRED agar client tidak mengulang permintaan yang sama setelah PIN dibuka — pulihkan ulang dari Archives.
    if (lockSet.archivedOrigins.has(accessKey(type, clientId)) && !(await this.locks.isUnlocked(user))) {
      throw new ForbiddenException("Arsip ini terkunci PIN. Masukkan PIN lalu ulangi pemulihan dari Archives.");
    }
    if (type === "para_resource" && payload.locked === true && isFileControlResource(payload)) {
      throw new BadRequestException(
        "Arsip yang masuk File Control tidak bisa dikunci PIN. Keluarkan dari File Control atau lepas kuncinya dulu.",
      );
    }
    if (!isLockableType(type)) return lockedRecord;
    const current = await domainDelegate(this.prisma, type).findUnique({
      where: { userId_clientId: { userId: ownerId, clientId } },
      select: { extra: true, deletedAt: true },
    });
    const was = !current?.deletedAt && (current?.extra as Payload | null)?.locked === true;
    const will = payload.locked === true;
    if (was === will) return lockedRecord;
    if (ownerId !== user.id) throw new ForbiddenException("Hanya pemilik yang dapat mengunci atau melepas kunci item.");
    if (will) await this.pins.assertHasPin(user.id);
    return lockedRecord;
  }

  /** Hapus = pindah ke Sampah (bisa dipulihkan selama masa simpan). `source: "agent"` = dihapus atas persetujuan untuk agen. */
  async remove(
    type: RecordType,
    clientId: string,
    query: RecordOwnerQueryDto,
    user: AuthUser,
    options: { source?: TrashSource; trash?: boolean } = {},
  ) {
    // Sinkron robot menghapus data yang sudah tidak ada di sistem asal → tidak masuk Sampah (diisi lagi oleh sinkron)
    const toTrash = options.trash !== false && !NO_TRASH_RECORD_TYPES.has(type);
    const spec: TableSpec = RECORD_TABLES[type];
    const ownerId = query.userId ?? user.id;
    if (ownerId !== user.id) {
      const entry = (await this.shareAccess.forOwner(user.id, ownerId))?.records.get(accessKey(type, clientId));
      if (!entry) throw new NotFoundException("Record tidak ditemukan.");
      if (!atLeast(entry.permission, "edit")) throw new ForbiddenException("Anda hanya memiliki akses lihat.");
      if (entry.root) throw new ForbiddenException("Hanya pemilik yang dapat menghapus item yang dibagikan.");
    }

    await this.locks.assertRecordOpen(user, ownerId, type, clientId);

    const batchId = await this.prisma.$transaction(async (tx) => {
      const table = domainDelegate(tx, type);
      const row = await table.findUnique({ where: { userId_clientId: { userId: ownerId, clientId } } });
      if (!row || row.deletedAt) throw new NotFoundException("Record tidak ditemukan.");
      await table.update({
        where: { id: row.id },
        data: { deletedAt: new Date() },
      });
      const payload = rowToPayload(spec, row);
      if (spec.audit) await this.audit(tx, type, user, row.userId, clientId, payload, undefined);
      if (!toTrash) return null;
      return this.trash.add(
        {
          userId: row.userId,
          kind: "record",
          recordType: type,
          itemId: clientId,
          title: recordTitle(payload, INDEXED_TYPES[type] ?? type),
          actorId: user.id,
          source: options.source,
        },
        tx,
      );
    });
    if (ownerId !== user.id) this.shareAccess.invalidate();
    this.locks.invalidate(ownerId);
    if (isIndexedType(type)) void this.indexQueue.enqueueSource(ownerId, type, clientId);
    return { success: true, batchId };
  }

  /**
   * Semua ID berkas yang dirujuk record hidup milik user (lampiran, Resource Global, snapshot arsip, audio, …) — berkas
   * di sini masih dipakai sehingga tidak ikut dibuang saat item lain dihapus.
   */
  async liveUploadIds(userId: string) {
    const ids = new Set<string>();
    for (const type of Object.keys(RECORD_TABLES) as RecordType[]) {
      const rows = await domainDelegate(this.prisma, type).findMany({ where: { userId, deletedAt: null } });
      for (const row of rows) collectUploadIds(rowToPayload(RECORD_TABLES[type], row), ids);
    }
    return ids;
  }

  /** Riwayat audit kearsipan atas data milik user sendiri. */
  /** Jejak audit. Sesi yang belum memasukkan PIN: isi perubahan item terkunci (diff / snapshot) disembunyikan. */
  async auditLog(user: AuthUser, query: { entityType?: string; entityId?: string; take?: number }) {
    const rows = await this.prisma.archiveAuditLog.findMany({
      where: {
        userId: user.id,
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(query.take ?? 100, 500),
    });
    if (!rows.length || (await this.locks.isUnlocked(user))) return rows;
    const locked = (await this.locks.lockSet(user.id)).records;
    return rows.map((row) =>
      locked.has(accessKey(row.entityType, row.entityId)) ? { ...row, changes: {}, locked: true } : row,
    );
  }

  /**
   * Pemilik record yang ditulis:
   * - `userId` user lain → harus punya izin edit atas item itu (atau atas induknya bila item baru);
   * - tanpa `userId` → milik sendiri, kecuali item BARU yang induknya (project/kegiatan/area) adalah item bersama
   *   yang boleh diubah → ikut pemilik induk (mis. kolaborator menambah action ke project yang dibagikan).
   */
  private async resolveWriteOwner(
    type: RecordType,
    clientId: string,
    requested: unknown,
    payload: Payload,
    user: AuthUser,
  ): Promise<string> {
    if (typeof requested === "string" && requested && requested !== user.id) {
      await this.assertCanWrite(user, requested, type, clientId, payload);
      return requested;
    }
    const exists = (t: RecordType, id: string, ownerId: string) =>
      domainDelegate(this.prisma, t)
        .findUnique({ where: { userId_clientId: { userId: ownerId, clientId: id } } })
        .then((row) => !!row);
    if (await exists(type, clientId, user.id)) return user.id;

    const parents = parentRefsOf(type, payload) as [RecordType, string][];
    for (const [parentType, parentId] of parents) {
      // Induk virtual (seri agenda) tidak punya tabel — kepemilikan ditentukan dari berbagi di bawah
      if (!Object.hasOwn(RECORD_TABLES, parentType)) continue;
      if (await exists(parentType, parentId, user.id)) return user.id;
    }
    if (parents.length === 0) return user.id;
    const owners = await this.prisma.share.findMany({
      where: { recipientId: user.id, permission: "edit" },
      select: { ownerId: true },
      distinct: ["ownerId"],
    });
    for (const { ownerId } of owners) {
      const access = await this.shareAccess.forOwner(user.id, ownerId);
      const editable = parents.some(([t, id]) => atLeast(access?.records.get(accessKey(t, id))?.permission, "edit"));
      if (editable) return ownerId;
    }
    return user.id;
  }

  private async assertCanWrite(user: AuthUser, ownerId: string, type: RecordType, clientId: string, payload: Payload) {
    const access = await this.shareAccess.forOwner(user.id, ownerId);
    const entry = access?.records.get(accessKey(type, clientId));
    if (entry) {
      if (atLeast(entry.permission, "edit")) return;
      throw new ForbiddenException("Anda hanya memiliki akses lihat atas item ini.");
    }
    // Item baru di dalam item bersama: induknya harus boleh diubah dan ID belum dipakai pemilik
    const existing = await domainDelegate(this.prisma, type).findUnique({
      where: { userId_clientId: { userId: ownerId, clientId } },
    });
    const parentEditable = parentRefsOf(type, payload).some(([t, id]) =>
      atLeast(access?.records.get(accessKey(t, id))?.permission, "edit"),
    );
    if ((!existing || existing.deletedAt) && parentEditable) return;
    throw new ForbiddenException("Anda tidak memiliki akses ke data user lain.");
  }

  private async audit(
    tx: Prisma.TransactionClient,
    type: RecordType,
    actor: AuthUser,
    ownerId: string,
    clientId: string,
    before: Payload | undefined,
    after: Payload | undefined,
  ) {
    if (!isArchivalData(type, before) && !isArchivalData(type, after)) return;
    let action: AuditAction;
    let changes: Prisma.InputJsonValue;
    if (!before && after) {
      action = AuditAction.created;
      changes = after as Prisma.InputJsonObject;
    } else if (before && !after) {
      action = AuditAction.deleted;
      changes = before as Prisma.InputJsonObject;
    } else if (before && after) {
      const diff = diffPayload(before, after);
      if (Object.keys(diff).length === 0) return;
      action = AuditAction.updated;
      changes = diff as Prisma.InputJsonObject;
    } else {
      return;
    }
    await tx.archiveAuditLog.create({
      data: {
        userId: ownerId,
        actorId: actor.id,
        entityType: type,
        entityId: clientId,
        action,
        changes,
      },
    });
  }
}
