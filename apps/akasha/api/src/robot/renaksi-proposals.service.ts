import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuthUser } from "../common/types/auth-user";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RecordType } from "../records/record-schema";
import { RecordsService } from "../records/records.service";
import { isPeriod, periodLabel } from "./ekinerja-agent-logic";
import {
  checkProposals,
  isExcluded,
  normalizeExcluded,
  type ProposalInput,
  renaksiCandidates,
  skpsForPeriod,
} from "./renaksi-candidates";

type Payload = Record<string, unknown>;
const MAX_TEXT = 1_000;

/**
 * Usulan renaksi e-Kinerja oleh agen: konteks satu bulan (kegiatan Productivity + SKP & RHK + entri yang sudah ada) dan
 * penyimpanan usulan sebagai entri `action_plan_entry` bertanda `proposed: true`. Usulan tidak pernah diisikan robot;
 * pemilik mencentangnya di e-Kinerja → Rencana Aksi (atau mengubah / mengabaikannya).
 */
@Injectable()
export class RenaksiProposalsService {
  constructor(
    private readonly records: RecordsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Cakupan yang dikecualikan pemilik (Area / Project / Lepas), disimpan per akun agar agen ikut memakainya. */
  async excluded(userId: string) {
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: { ekinerjaPrefs: true } });
    const prefs = (row?.ekinerjaPrefs ?? {}) as Payload;
    return normalizeExcluded(prefs.renaksiExcluded);
  }

  async setExcluded(userId: string, keys: unknown) {
    const excluded = normalizeExcluded(keys);
    const row = await this.prisma.user.findUnique({ where: { id: userId }, select: { ekinerjaPrefs: true } });
    const prefs = { ...((row?.ekinerjaPrefs ?? {}) as Payload), renaksiExcluded: excluded };
    await this.prisma.user.update({
      where: { id: userId },
      data: { ekinerjaPrefs: prefs as Prisma.InputJsonValue },
    });
    return { excluded };
  }

  private async own(user: AuthUser, type: RecordType) {
    return (await this.records.findMany(type, {}, user)).filter((r) => !r.share).map((r) => r.payload as Payload);
  }

  private async load(user: AuthUser, period: string) {
    if (!isPeriod(period)) throw new BadRequestException("Bulan harus YYYY-MM.");
    const [tasks, schedules, activities, projects, areas, skps, targets, entries, excluded] = await Promise.all([
      this.own(user, "para_task"),
      this.own(user, "schedule"),
      this.own(user, "para_activity"),
      this.own(user, "para_project"),
      this.own(user, "para_area"),
      this.own(user, "skp"),
      this.own(user, "skp_target"),
      this.own(user, "action_plan_entry"),
      this.excluded(user.id),
    ]);
    const all = renaksiCandidates(period, { tasks, schedules, activities, projects, areas });
    // Area / Project / kegiatan lepas yang dikecualikan pemilik tidak pernah ditawarkan ke agen maupun ditampilkan
    const candidates = all.filter((c) => !isExcluded(c, excluded));
    const excludedIds = new Set(all.filter((c) => isExcluded(c, excluded)).map((c) => c.sourceId));
    const monthSkps = skpsForPeriod(skps, period);
    const skpIds = new Set(monthSkps.map((s) => String(s.id)));
    const year = Number(period.slice(0, 4));
    // RHK dari SKP bulan itu; tanpa SKP tersinkron → RHK manual tahun itu
    const monthTargets = targets.filter((t) =>
      skpIds.size ? skpIds.has(String(t.skpId)) : !t.skpId && Number(t.year) === year,
    );
    const monthEntries = entries.filter((e) => e.period === period && !e.deleted);
    return { candidates, excludedIds, monthSkps, monthTargets, monthEntries };
  }

  /** Bahan pemetaan untuk agen. */
  async context(user: AuthUser, period: string) {
    const { candidates, excludedIds, monthSkps, monthTargets, monthEntries } = await this.load(user, period);
    const bySource = (id: string) => monthEntries.filter((e) => e.sourceId === id);
    return {
      bulan: periodLabel(period),
      period,
      kegiatan_dikecualikan_pemilik: excludedIds.size,
      skp: monthSkps.map((s) => ({ id: s.id, mulai: s.startDate, selesai: s.endDate, status: s.status })),
      rhk: monthTargets
        .filter((t) => !t.stale)
        .map((t) => ({
          id: t.id,
          nama: t.name,
          bagian: t.section ?? null,
          rhk_pimpinan: t.leader ?? null,
          indikator: Array.isArray(t.indicators)
            ? (t.indicators as Payload[]).map((i) => ({ indikator: i.indicator, aspek: i.aspect, target: i.target }))
            : [],
        })),
      kegiatan: candidates.map((c) => {
        const existing = bySource(c.sourceId);
        return {
          ...c,
          keputusan_pemilik: existing.some((e) => !e.proposed) ? "sudah dimasukkan" : null,
          usulan_sebelumnya: existing
            .filter((e) => e.proposed)
            .map((e) => ({ rhk: e.targetId, renaksi: e.description, realisasi: e.realization ?? null })),
        };
      }),
      entri_bulan_ini: monthEntries
        .filter((e) => !e.proposed)
        .map((e) => ({ rhk: e.targetId ?? null, renaksi: e.description, realisasi: e.realization ?? null })),
    };
  }

  /**
   * Simpan usulan agen. Usulan lama untuk sumber yang sama di bulan itu diganti (agen bisa memperbaiki), sumber yang
   * sudah diputuskan pemilik tidak disentuh. Satu sumber boleh beberapa butir (beberapa renaksi untuk satu kegiatan).
   */
  async propose(user: AuthUser, period: string, items: ProposalInput[]) {
    const { candidates, excludedIds, monthSkps, monthTargets, monthEntries } = await this.load(user, period);
    const accepted = new Set(monthEntries.filter((e) => !e.proposed && e.sourceId).map((e) => String(e.sourceId)));
    const trimmed = items.map((i) => ({
      ...i,
      description: String(i.description ?? "").slice(0, MAX_TEXT),
      realization: i.realization ? String(i.realization).slice(0, MAX_TEXT) : undefined,
      note: i.note ? String(i.note).slice(0, 300) : undefined,
    }));
    // Kegiatan di cakupan yang dikecualikan pemilik ditolak dengan alasan jelas (bukan "bukan kegiatan bulan ini")
    const blocked = trimmed.filter((i) => excludedIds.has(i.sourceId));
    const { ok, rejected } = checkProposals(
      trimmed.filter((i) => !excludedIds.has(i.sourceId)),
      candidates,
      monthTargets.map((t) => ({
        id: String(t.id),
        indicators: Array.isArray(t.indicators) ? (t.indicators as { indicator: string }[]) : [],
      })),
      accepted,
    );
    // Usulan lama sumber yang diusulkan ulang dibuang dulu (tanpa Sampah: usulan belum pernah menjadi data pemilik)
    const sources = new Set(ok.map((o) => o.sourceId));
    for (const old of monthEntries.filter((e) => e.proposed && sources.has(String(e.sourceId)))) {
      await this.records.remove("action_plan_entry", String(old.id), {}, user, { trash: false });
    }
    const now = new Date().toISOString();
    for (const item of ok) {
      const candidate = candidates.find((c) => c.sourceId === item.sourceId)!;
      const target = monthTargets.find((t) => t.id === item.targetId);
      const id = `ag-renaksi-${randomUUID()}`;
      await this.records.upsert(
        "action_plan_entry",
        id,
        {
          payload: {
            id,
            period,
            skpId: target?.skpId ?? monthSkps[0]?.id,
            targetId: item.targetId,
            description: item.description,
            realization: item.realization,
            indicators: item.indicators,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            sourceTitle: candidate.title,
            status: "draft",
            proposed: true,
            proposedBy: "agent",
            proposalNote: item.note,
            createdAt: now,
          },
        },
        user,
      );
    }
    return {
      saved: ok.length,
      rejected: [
        ...blocked.map((i) => ({
          sourceId: i.sourceId,
          reason: "Area/Project ini dikecualikan pemilik dari e-Kinerja.",
        })),
        ...rejected,
      ],
    };
  }
}
