import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ConfigService } from "@nestjs/config";
import { checkAgentEmail, SEND_EMAIL_KIND, sendEmailTitle } from "../mail/agent-mail-logic";
import { checkSkillChange, lineChangeCount, SKILL_CHANGE_KIND } from "./skill-change";
import { MailService } from "../mail/mail.service";
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
import {
  EKINERJA_FILL_KIND,
  EKINERJA_FILL_RECORD,
  fillRequestTitle,
  fillSnapshot,
  isPeriod,
  periodLabel,
} from "../robot/ekinerja-agent-logic";
import {
  registerRequestMode,
  registerRequestTitle,
  registerSnapshot,
  SRIKANDI_REGISTER_KIND,
  SRIKANDI_REGISTER_RECORD,
} from "../robot/srikandi-agent-logic";
import type { OutgoingEntry } from "../robot/srikandi-register";
import { RobotService } from "../robot/robot.service";
import {
  APPROVAL_KINDS,
  changedKeys,
  createPayload,
  isAgentWritable,
  patchPayload,
  samePayload,
} from "./agent-action-logic";

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
    private readonly robot: RobotService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Folder skill Hermes (sama dengan daftar skill Akasha: `HERMES_SKILLS_DIR`, bawaan folder repo). */
  private skillsDir() {
    return resolve(
      this.config.get<string>("HERMES_SKILLS_DIR") || join(process.cwd(), "..", "..", "akai", "agent", "skills"),
    );
  }

  private skillPath(skill: string) {
    return join(this.skillsDir(), skill, "SKILL.md");
  }

  /**
   * Agen mengusulkan isi SKILL.md (perbaikan skill yang ada atau skill baru). Folder skill baca saja bagi agen, jadi usulan
   * menunggu persetujuan pemilik; usulan lama yang masih menunggu untuk skill yang sama digantikan.
   */
  async requestSkillChange(user: AuthUser, input: { skill: string; content: string; summary: string }) {
    const checked = checkSkillChange(input);
    if ("error" in checked) throw new BadRequestException(checked.error);
    const before = await readFile(this.skillPath(checked.skill), "utf8").catch(() => null);
    if (before !== null && before.replace(/\r\n/g, "\n").trimEnd() === checked.content.trimEnd())
      throw new BadRequestException("Isi usulan sama dengan skill sekarang.");
    await this.prisma.agentAction.updateMany({
      where: { userId: user.id, kind: SKILL_CHANGE_KIND, clientId: checked.skill, status: "pending" },
      data: { status: "rejected", message: "Digantikan usulan yang lebih baru.", decidedAt: new Date() },
    });
    const diff = before === null ? null : lineChangeCount(before.replace(/\r\n/g, "\n"), checked.content);
    const action = await this.prisma.agentAction.create({
      data: {
        userId: user.id,
        kind: SKILL_CHANGE_KIND,
        recordType: "skill",
        clientId: checked.skill,
        title:
          before === null
            ? `Skill baru: ${checked.skill}`
            : `Ubah skill ${checked.skill} (+${diff!.added} / −${diff!.removed} baris)`,
        before: before === null ? Prisma.DbNull : json({ content: before }),
        after: json({ content: checked.content, description: checked.description }),
        reason: checked.summary,
        status: "pending",
      },
    });
    return { actionId: action.id, pending: true, isNew: before === null };
  }

  /** Tulis SKILL.md yang disetujui (atomik). Berkas berubah sejak diusulkan → tetap menunggu (409), tidak menimpa. */
  private async approveSkillChange(action: { id: string; clientId: string; before: unknown; after: unknown }) {
    const content = ((action.after ?? {}) as { content?: string }).content ?? "";
    const expected = ((action.before ?? null) as { content?: string } | null)?.content ?? null;
    const path = this.skillPath(action.clientId);
    const current = await readFile(path, "utf8").catch(() => null);
    if ((current ?? null) !== expected)
      throw new ConflictException(
        "Skill sudah berubah sejak diusulkan. Minta AI agent mengusulkan ulang dari isi terbaru.",
      );
    try {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.tmp-${Date.now()}`;
      await writeFile(temp, content, "utf8");
      await rename(temp, path);
    } catch (error) {
      const message = `Gagal menulis skill: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`;
      await this.decide(action.id, "failed", message);
      return { status: "failed" as const, removed: 0, message };
    }
    const message = `Skill ${action.clientId} ${expected === null ? "dibuat" : "diperbarui"}. AI agent memakainya mulai tugas berikutnya.`;
    await this.decide(action.id, "approved", message);
    return { status: "approved" as const, removed: 0, message };
  }

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

  /**
   * Permintaan agen agar robot mengisi Rencana Aksi satu bulan ke e-Kinerja. Tidak ada yang dikirim ke e-Kinerja sampai
   * pemilik menyetujuinya; isi bulan saat diminta disimpan agar pemilik tahu apa yang akan diisikan.
   */
  async requestEkinerjaFill(user: AuthUser, period: string, reason: string) {
    if (!isPeriod(period)) throw new BadRequestException("Bulan harus YYYY-MM.");
    const existing = await this.prisma.agentAction.findFirst({
      where: { userId: user.id, kind: EKINERJA_FILL_KIND, clientId: period, status: "pending" },
    });
    if (existing) return { actionId: existing.id, pending: true, duplicate: true };
    const entries = (await this.records.findMany("action_plan_entry", {}, user))
      .filter((r) => !r.share)
      .map((r) => r.payload as Payload);
    const snapshot = fillSnapshot(entries, period);
    if (!snapshot.total) {
      throw new BadRequestException(
        `Belum ada entri Rencana Aksi untuk ${periodLabel(period)} — tidak ada yang bisa diisikan.`,
      );
    }
    const action = await this.prisma.agentAction.create({
      data: {
        userId: user.id,
        kind: EKINERJA_FILL_KIND,
        recordType: EKINERJA_FILL_RECORD,
        clientId: period,
        title: fillRequestTitle(period),
        after: json(snapshot),
        reason: reason.trim(),
        status: "pending",
      },
    });
    return { actionId: action.id, pending: true, entries: snapshot.total };
  }

  /**
   * Permintaan agen agar robot mendaftarkan satu entri Register Naskah Keluar ke SRIKANDI (Simpan konsep). Tidak ada yang
   * dikirim ke SRIKANDI sampai pemilik menyetujuinya; isi entri saat diminta disimpan agar pemilik tahu apa yang didaftarkan.
   * Entri harus milik sendiri, lengkap, dan belum terdaftar.
   */
  async requestSrikandiRegister(user: AuthUser, entryId: string, reason: string) {
    const existing = await this.prisma.agentAction.findFirst({
      where: { userId: user.id, kind: SRIKANDI_REGISTER_KIND, clientId: entryId, status: "pending" },
    });
    if (existing) return { actionId: existing.id, pending: true, duplicate: true };
    const record = await this.records.findOne(SRIKANDI_REGISTER_RECORD, entryId, {}, user).catch(() => null);
    if (!record || record.share) throw new NotFoundException("Entri Register Naskah Keluar tidak ditemukan.");
    const entry = { ...(record.payload as Payload), id: entryId } as unknown as OutgoingEntry;
    const checked = registerRequestMode(entry);
    if ("error" in checked) throw new BadRequestException(checked.error);
    const unapproved = await this.robot.approvalBlocker(user.id, entry as unknown as Record<string, unknown>);
    if (unapproved) throw new BadRequestException(unapproved);
    const action = await this.prisma.agentAction.create({
      data: {
        userId: user.id,
        kind: SRIKANDI_REGISTER_KIND,
        recordType: SRIKANDI_REGISTER_RECORD,
        clientId: entryId,
        title: registerRequestTitle(entry, checked.mode),
        after: json(registerSnapshot(entry, checked.mode)),
        reason: reason.trim(),
        status: "pending",
      },
    });
    return { actionId: action.id, pending: true, mode: checked.mode };
  }

  /**
   * Permintaan agen mengirim email atas nama pemilik (tahap 3 docs/AKUN-TERSAMBUNG.md). Tidak ada yang terkirim sampai pemilik
   * menyetujui di Approval; isi email disimpan apa adanya agar pemilik membaca persis yang akan dikirim.
   */
  async requestSendEmail(
    user: AuthUser,
    input: { to: string[]; subject: string; body: string; accountId?: string; reason: string },
  ) {
    const checked = checkAgentEmail(input);
    if ("error" in checked) throw new BadRequestException(checked.error);
    const account = input.accountId
      ? await this.mail.get(user.id, input.accountId)
      : (await this.mail.list(user.id))[0];
    if (!account) throw new BadRequestException("Belum ada akun email tersambung (Pengaturan → Akun Tersambung).");
    const action = await this.prisma.agentAction.create({
      data: {
        userId: user.id,
        kind: SEND_EMAIL_KIND,
        recordType: "mail",
        clientId: account.id,
        title: sendEmailTitle(checked.to, checked.subject),
        after: json({ from: account.address, to: checked.to, subject: checked.subject, body: checked.body }),
        reason: input.reason.trim(),
        status: "pending",
      },
    });
    return { actionId: action.id, pending: true, from: account.address };
  }

  private async approveSendEmail(user: AuthUser, action: { id: string; clientId: string; after: unknown }) {
    const mail = (action.after ?? {}) as { to?: string[]; subject?: string; body?: string; from?: string };
    try {
      await this.mail.send(
        user.id,
        { to: mail.to ?? [], subject: mail.subject ?? "", text: mail.body ?? "" },
        action.clientId,
      );
      const message = `Terkirim dari ${mail.from ?? "akun email"} ke ${(mail.to ?? []).join(", ")}.`;
      await this.decide(action.id, "approved", message);
      return { status: "approved" as const, removed: 0, message };
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await this.decide(action.id, "failed", message);
      return { status: "failed" as const, removed: 0, message };
    }
  }

  list(user: AuthUser, query: { status?: string; take?: number }) {
    return this.prisma.agentAction.findMany({
      where: { userId: user.id, ...(query.status ? { status: query.status } : {}) },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(query.take ?? 100, 1), 300),
    });
  }

  countPending(user: AuthUser) {
    return this.prisma.agentAction.count({
      where: { userId: user.id, kind: { in: [...APPROVAL_KINDS] }, status: "pending" },
    });
  }

  private async own(user: AuthUser, id: string) {
    const action = await this.prisma.agentAction.findFirst({ where: { id, userId: user.id } });
    if (!action) throw new NotFoundException("Aksi agen tidak ditemukan.");
    return action;
  }

  /** Setujui hapus: item + turunannya masuk Sampah (satu kelompok, bertanda agen) dan bisa dipulihkan 30 hari. */
  async approve(user: AuthUser, id: string) {
    const action = await this.own(user, id);
    if (action.kind === EKINERJA_FILL_KIND && action.status === "pending")
      return this.approveEkinerjaFill(user, action);
    if (action.kind === SRIKANDI_REGISTER_KIND && action.status === "pending")
      return this.approveSrikandiRegister(user, action);
    if (action.kind === SEND_EMAIL_KIND && action.status === "pending") return this.approveSendEmail(user, action);
    if (action.kind === SKILL_CHANGE_KIND && action.status === "pending") return this.approveSkillChange(action);
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

  /**
   * Setujui pengisian: robot mengisi bulan itu ke e-Kinerja (sama dengan tombol "Kirim ke e-Kinerja" / "Kirim
   * perubahan", isi terkini saat disetujui). Hanya draf; "Kirim Penilaian Ke Atasan" tidak pernah ditekan robot.
   */
  private async approveEkinerjaFill(user: AuthUser, action: { id: string; clientId: string }) {
    try {
      const result = await this.robot.fillEkinerjaRenaksi(user, action.clientId, false);
      const locked = result.results.filter((r) => r.status === "submitted").length;
      const message =
        `${result.filled} entri terisi, ${result.added} butir ditambahkan` +
        (result.imported ? `, ${result.imported} entri diimpor dari e-Kinerja` : "") +
        (locked ? ` · ${locked} bulan sudah diajukan (tidak diisi)` : "") +
        " — draf, belum dikirim ke atasan.";
      await this.decide(action.id, "approved", message);
      return { status: "approved" as const, removed: 0, filled: result.filled, added: result.added, message };
    } catch (error) {
      // Robot e-Kinerja sedang dipakai tugas lain (409): permintaan tetap menunggu agar pemilik bisa mencoba lagi
      if (error instanceof ConflictException) throw error;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await this.decide(action.id, "failed", message);
      return { status: "failed" as const, removed: 0, message };
    }
  }

  /**
   * Setujui pendaftaran: robot mengisi formulir Registrasi SRIKANDI dari isi entri terkini lalu berhenti di Simpan (draf di
   * Log Naskah Keluar), sama dengan tombol "Daftarkan ke SRIKANDI". Kirim Konsep tetap keputusan pemilik di SRIKANDI.
   */
  private async approveSrikandiRegister(user: AuthUser, action: { id: string; clientId: string; after: unknown }) {
    const mode = (action.after as { mode?: string } | null)?.mode;
    try {
      if (mode === "update") {
        const result = await this.robot.updateSrikandiOutgoing(user, action.clientId, false);
        const message =
          result.status === "unchanged"
            ? "Konsep di SRIKANDI sudah sama — tidak ada yang diubah."
            : `Konsep diperbarui di Log Naskah Keluar (${result.plan.length} perubahan) — belum dikirim; Kirim Konsep tetap di SRIKANDI.`;
        await this.decide(action.id, "approved", message);
        return { status: "approved" as const, removed: 0, message };
      }
      const result = await this.robot.registerSrikandiOutgoing(user, action.clientId, false);
      const message =
        result.status === "exists"
          ? "Draf berhal sama sudah ada di Log Naskah Keluar — tidak dibuat ulang."
          : `Draf disimpan di Log Naskah Keluar${result.draft?.number ? ` (${result.draft.number})` : ""} — belum dikirim; Kirim Konsep tetap di SRIKANDI.`;
      await this.decide(action.id, "approved", message);
      return { status: "approved" as const, removed: 0, message };
    } catch (error) {
      // Robot SRIKANDI sedang dipakai tugas lain (409): permintaan tetap menunggu agar pemilik bisa mencoba lagi
      if (error instanceof ConflictException) throw error;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await this.decide(action.id, "failed", message);
      return { status: "failed" as const, removed: 0, message };
    }
  }

  async reject(user: AuthUser, id: string, note?: string) {
    const action = await this.own(user, id);
    if (!(APPROVAL_KINDS as readonly string[]).includes(action.kind) || action.status !== "pending") {
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
