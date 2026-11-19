import { ForbiddenException, Injectable } from "@nestjs/common";
import { AuthUser } from "../common/types/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { domainDelegate } from "../records/record-delegate";
import { rowToPayload } from "../records/record-mapper";
import { RECORD_TABLES, type RecordType } from "../records/record-schema";
import { ShareAccessService } from "../sharing/share-access.service";
import { type ShareRoot, accessKey, collectUploadIds, expandDescendants } from "../sharing/share-graph";
import { LOCKABLE_TYPES, PIN_ACTIVITY_TOUCH_MS, archiveOriginKeys, pinStillUnlocked } from "./lock-logic";

/** Item terkunci milik satu pemilik (dihitung dari item induk bertanda `locked`). */
export interface LockSet {
  /** `type:clientId` — item induk + seluruh turunannya */
  records: Set<string>;
  /** Berkas yang dirujuk item terkunci / milik notebook terkunci */
  uploads: Set<string>;
  notebooks: Set<string>;
  notebookSources: Set<string>;
  /** `type:clientId` item asal (+ turunannya) di arsip PARA terkunci — memulihkannya butuh PIN */
  archivedOrigins: Set<string>;
  /** Jumlah item yang dikunci langsung (tanpa turunan) */
  roots: number;
}

const EMPTY: LockSet = {
  records: new Set(),
  uploads: new Set(),
  notebooks: new Set(),
  notebookSources: new Set(),
  archivedOrigins: new Set(),
  roots: 0,
};
const LOCK_TTL_MS = 30_000;
const UNLOCK_TTL_MS = 5_000;

/** Galat 403 yang dikenali frontend: buka dialog PIN lalu ulangi permintaan. */
export class PinRequiredException extends ForbiddenException {
  constructor(message = "Item ini terkunci. Masukkan PIN untuk membukanya.") {
    super({ statusCode: 403, code: "PIN_REQUIRED", message });
  }
}

/**
 * Kunci PIN: menghitung item terkunci per pemilik & status "PIN terbuka" per sesi login.
 * Agen (token akses / MCP), bot, dan pekerjaan latar belakang tidak punya sesi → selalu terkunci.
 */
@Injectable()
export class LockService {
  private readonly sets = new Map<string, { at: number; value: Promise<LockSet> }>();
  private readonly unlocks = new Map<string, { at: number; value: Promise<boolean> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly shareAccess: ShareAccessService,
  ) {}

  // ------------------------------------------------------------ Sesi

  /**
   * Sesi login user sudah memasukkan PIN (berlaku sampai logout / Kunci sekarang, atau sampai kunci otomatis bila
   * diatur). `touch` = permintaan ini aktivitas atas item terkunci (memperpanjang kunci otomatis); pemeriksaan status
   * berkala memakai `touch: false` agar tidak membuat sesi terbuka selamanya.
   */
  isUnlocked(
    user: Pick<AuthUser, "id" | "sid"> | null | undefined,
    options: { touch?: boolean } = {},
  ): Promise<boolean> {
    const sid = user?.sid;
    if (!sid) return Promise.resolve(false);
    const touch = options.touch ?? true;
    const cached = this.unlocks.get(sid);
    if (cached && Date.now() - cached.at < UNLOCK_TTL_MS) return cached.value;
    const value = this.checkSession(user.id, sid, touch);
    this.unlocks.set(sid, { at: Date.now(), value });
    return value;
  }

  private async checkSession(userId: string, sid: string, touch: boolean) {
    const token = await this.prisma.refreshToken.findFirst({
      where: { sessionId: sid, userId, pinUnlocked: true, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { pinActiveAt: true, user: { select: { pinAutoLockMinutes: true } } },
    });
    if (!token) return false;
    const now = Date.now();
    const minutes = token.user.pinAutoLockMinutes;
    if (!pinStillUnlocked(token.pinActiveAt, minutes, now)) {
      // Kunci otomatis: tidak ada aktivitas atas item terkunci selama `minutes`
      await this.prisma.refreshToken.updateMany({ where: { sessionId: sid, userId }, data: { pinUnlocked: false } });
      return false;
    }
    if (touch && minutes && (!token.pinActiveAt || now - token.pinActiveAt.getTime() > PIN_ACTIVITY_TOUCH_MS)) {
      await this.prisma.refreshToken.updateMany({
        where: { sessionId: sid, userId },
        data: { pinActiveAt: new Date(now) },
      });
    }
    return true;
  }

  async setSessionUnlocked(user: AuthUser, unlocked: boolean) {
    if (!user.sid) return;
    await this.prisma.refreshToken.updateMany({
      where: { sessionId: user.sid, userId: user.id },
      data: { pinUnlocked: unlocked, pinActiveAt: unlocked ? new Date() : null },
    });
    this.unlocks.delete(user.sid);
  }

  /** Kunci semua sesi user (PIN diganti / dihapus). */
  async lockAllSessions(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId }, data: { pinUnlocked: false } });
    this.unlocks.clear();
  }

  // ------------------------------------------------------------ Item terkunci

  invalidate(ownerId: string) {
    this.sets.delete(ownerId);
  }

  lockSet(ownerId: string): Promise<LockSet> {
    const cached = this.sets.get(ownerId);
    if (cached && Date.now() - cached.at < LOCK_TTL_MS) return cached.value;
    const value = this.compute(ownerId).catch((error: unknown) => {
      this.sets.delete(ownerId);
      throw error;
    });
    this.sets.set(ownerId, { at: Date.now(), value });
    return value;
  }

  async isRecordLocked(ownerId: string, type: string, id: string) {
    return (await this.lockSet(ownerId)).records.has(accessKey(type, id));
  }

  /** Tolak dengan PIN_REQUIRED bila item terkunci dan sesi belum memasukkan PIN. */
  async assertRecordOpen(user: AuthUser, ownerId: string, type: string, id: string) {
    if (!(await this.isRecordLocked(ownerId, type, id))) return;
    if (!(await this.isUnlocked(user))) throw new PinRequiredException();
  }

  async assertAssetOpen(user: AuthUser, ownerId: string, assetId: string) {
    if (!(await this.lockSet(ownerId)).uploads.has(assetId)) return;
    if (!(await this.isUnlocked(user))) throw new PinRequiredException("Berkas ini milik item terkunci. Masukkan PIN.");
  }

  async assertNotebookOpen(user: AuthUser, notebookId: string) {
    if (!(await this.lockSet(user.id)).notebooks.has(notebookId)) return;
    if (!(await this.isUnlocked(user))) throw new PinRequiredException("Notebook ini terkunci. Masukkan PIN.");
  }

  /** Sumber indeks RAG milik item terkunci (dibuang dari pencarian selama PIN belum dibuka). */
  async lockedSources(ownerId: string): Promise<{ sourceType: string; sourceId: string }[]> {
    const set = await this.lockSet(ownerId);
    return [
      ...[...set.records].map((key) => {
        const at = key.indexOf(":");
        return { sourceType: key.slice(0, at), sourceId: key.slice(at + 1) };
      }),
      ...[...set.uploads].map((id) => ({ sourceType: "asset", sourceId: id })),
      ...[...set.notebookSources].map((id) => ({ sourceType: "notebook_source", sourceId: id })),
    ];
  }

  private async compute(ownerId: string): Promise<LockSet> {
    const where = { userId: ownerId, deletedAt: null, extra: { path: ["locked"], equals: true } };
    const rootRows = await Promise.all(
      LOCKABLE_TYPES.map(async (type) => {
        const rows = await domainDelegate(this.prisma, type).findMany({ where, select: { clientId: true } });
        return rows.map((row): ShareRoot => ({ type, id: row.clientId, permission: "edit" }));
      }),
    );
    const roots = rootRows.flat();
    const notebooks = await this.prisma.notebook.findMany({
      where: { userId: ownerId, locked: true },
      select: { id: true, sources: { select: { id: true, assetId: true, kind: true } } },
    });
    // Arsip PARA dari item terkunci (snapshot ditandai `data.locked` saat diarsipkan)
    const archives = await this.prisma.paraArchive.findMany({
      where: { userId: ownerId, deletedAt: null, data: { path: ["locked"], equals: true } },
    });
    if (roots.length === 0 && notebooks.length === 0 && archives.length === 0) return EMPTY;

    const records = new Set<string>();
    const uploads = new Set<string>();
    const archivedOrigins = new Set<string>();
    for (const row of archives) {
      records.add(accessKey("para_archive", row.clientId));
      const payload = rowToPayload(RECORD_TABLES.para_archive, row);
      collectUploadIds(payload, uploads);
      for (const key of archiveOriginKeys(payload)) archivedOrigins.add(key);
    }
    if (roots.length) {
      const access = expandDescendants(roots, await this.shareAccess.loadStructure(ownerId, roots));
      const byType = new Map<RecordType, string[]>();
      for (const entry of access.values()) {
        if (!Object.hasOwn(RECORD_TABLES, entry.type)) continue;
        records.add(accessKey(entry.type, entry.id));
        const type = entry.type as RecordType;
        byType.set(type, [...(byType.get(type) ?? []), entry.id]);
      }
      // Berkas yang dirujuk item terkunci ikut terkunci
      for (const [type, ids] of byType) {
        const rows = await domainDelegate(this.prisma, type).findMany({
          where: { userId: ownerId, clientId: { in: ids }, deletedAt: null },
        });
        for (const row of rows) collectUploadIds(rowToPayload(RECORD_TABLES[type], row), uploads);
      }
    }

    const notebookIds = new Set(notebooks.map((n) => n.id));
    const notebookSources = new Set<string>();
    for (const notebook of notebooks) {
      for (const source of notebook.sources) {
        notebookSources.add(source.id);
        // Berkas yang diunggah ke notebook (bukan rujukan berkas Akasha lain) ikut terkunci
        if (source.assetId) {
          const asset = await this.prisma.asset.findFirst({
            where: { id: source.assetId, userId: ownerId, context: "notebook" },
            select: { id: true },
          });
          if (asset) uploads.add(asset.id);
        }
      }
    }
    if (notebookIds.size) {
      const messages = await this.prisma.notebookMessage.findMany({
        where: { notebookId: { in: [...notebookIds] } },
        select: { attachments: true },
      });
      for (const message of messages) collectUploadIds(message.attachments, uploads);
    }
    return {
      records,
      uploads,
      notebooks: notebookIds,
      notebookSources,
      archivedOrigins,
      roots: roots.length + archives.length,
    };
  }
}
