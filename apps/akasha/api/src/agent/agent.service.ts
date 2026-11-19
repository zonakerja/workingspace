import { isPeriod, RENAKSI_SKILL, renaksiRunInput } from "../robot/ekinerja-agent-logic";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response as ExpressResponse } from "express";
import { type MenuField, menuRunInput, normalizeMenuValues } from "../agent-menus/agent-menu-logic";
import { type AkaiUser, AkaiService } from "../akai/akai.service";
import type { AuthUser } from "../common/types/auth-user";
import { type ApiScope, hashToken, looksLikeToken, normalizeScopes } from "../integrations/api-token-logic";
import type { TokenPrincipal } from "../integrations/api-tokens.service";
import type { AgentRun } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RequestsService } from "../requests/requests.service";
import { TrashService } from "../trash/trash.service";
import { AGENT_TOKEN_NAME, AGENT_TOKEN_PREFIX, DEFAULT_AGENT_SCOPES, modelsResponse } from "./agent-llm";
import {
  type AgentSkill,
  conversationTitle,
  runsToMessages,
  isAgentOwner,
  parseRun,
  parseSkillFile,
  parseSkills,
  sessionIdFor,
  SKILL_NAME,
  skillRunInput,
} from "./agent-logic";
import { AgentPolicyService } from "./agent-policy.service";

/** Pemantau tugas agen: tugas dari aturan dimulai & dipantau server walau tidak ada yang membuka aplikasi. */
const POLL_MS = 10_000;
/** Pengajuan dianggap selesai menerima berkas (jendela berkas susulan WhatsApp) setelah tidak berubah selama ini. */
const SETTLE_MS = 90_000;
/** Tugas antri yang berkasnya tidak kunjung terbaca dimulai juga setelah batas ini. */
const QUEUE_LIMIT_MS = 15 * 60_000;
/** Tugas berjalan yang tidak selesai dalam batas ini dianggap gagal. */
const RUN_LIMIT_MS = 45 * 60_000;

/** Panggilan model agen terakhir (untuk kartu Siapkan agen; di memori, hilang saat backend restart). */
export interface ModelCall {
  at: string;
  ok: boolean;
  provider: string;
  model: string;
  error?: string;
  /** Pemakaian token (saat ini hanya Claude): dasar memeriksa prompt caching & biaya */
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Provider tugas Agen yang gagal sebelum cadangan ini dipakai */
  fallbackFrom?: { provider: string; error: string };
}

/** Error berformat OpenAI untuk Hermes (klien OpenAI membaca `error.message`). */
const llmError = (res: ExpressResponse, status: number, message: string) =>
  res.status(status).json({ error: { message, type: "akasha_agent_error" } });

/**
 * Asisten Agen (docs/AI-AGENT.md §23): backend Akasha ↔ API server Hermes (OpenAI-compatible, `Authorization: Bearer
 * HERMES_API_KEY`). Kunci tidak pernah sampai ke browser. Hermes memakai token MCP milik satu user, sehingga hanya
 * `HERMES_OWNER_EMAIL` yang boleh memakai agen ini. Tugas berjalan sebagai **run** asinkron (`/v1/runs`) yang di-poll.
 */
@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentService.name);
  private lastModelCall: ModelCall | null = null;
  private poller?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly config: ConfigService,
    private readonly requests: RequestsService,
    private readonly prisma: PrismaService,
    private readonly policies: AgentPolicyService,
    private readonly akai: AkaiService,
    private readonly trash: TrashService,
  ) {
    this.trash.registerHandler("agent_conversation", {
      restore: async (item) => {
        await this.prisma.agentConversation.updateMany({
          where: { id: item.itemId, userId: item.userId },
          data: { deletedAt: null },
        });
      },
      purge: async (item) => {
        await this.prisma.agentConversation.deleteMany({ where: { id: item.itemId, userId: item.userId } });
      },
    });
  }

  /** Akun untuk Akai (sub SSO) — tugas Agen yang diatur di Akai dijawab gateway Akai. */
  private async akaiUser(userId: string): Promise<AkaiUser | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { ssoSubject: true, email: true, name: true },
    });
  }

  onModuleInit() {
    if (!this.configured) return;
    this.poller = setInterval(() => void this.tick(), POLL_MS);
  }

  onModuleDestroy() {
    if (this.poller) clearInterval(this.poller);
  }

  /** Satu putaran pemantau: mulai tugas antri dari aturan, perbarui tugas berjalan, putuskan yang selesai. */
  private async tick() {
    if (this.polling) return;
    this.polling = true;
    try {
      const queued = await this.prisma.agentRun.findMany({
        where: { status: "queued" },
        take: 5,
        orderBy: { createdAt: "asc" },
      });
      for (const run of queued) await this.startQueued(run);
      const running = await this.prisma.agentRun.findMany({ where: { status: "running" }, take: 20 });
      for (const run of running) {
        if (!run.hermesRunId) continue;
        await this.refresh(run).catch((error) =>
          this.logger.warn(
            `Status tugas agen ${run.id} gagal dibaca: ${error instanceof Error ? error.message : error}`,
          ),
        );
      }
    } catch (error) {
      // Dipanggil dari setInterval: galat yang lolos (mis. database sesaat putus) mematikan proses backend
      this.logger.warn(`Pemantau tugas agen gagal: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.polling = false;
    }
  }

  /** Tugas dari aturan dimulai setelah berkas pemohon selesai dibaca server (atau batas tunggu habis). */
  private async startQueued(run: AgentRun) {
    const request = run.requestId ? await this.prisma.request.findUnique({ where: { id: run.requestId } }) : null;
    const account = await this.prisma.user.findUnique({ where: { id: run.userId }, select: { agentAutoPaused: true } });
    if (!request || account?.agentAutoPaused || !["baru", "diproses"].includes(request.status)) {
      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "skipped",
          finishedAt: new Date(),
          error: !request
            ? "Pengajuan sudah dihapus."
            : account?.agentAutoPaused
              ? "Sakelar darurat aktif."
              : "Pengajuan sudah diproses.",
        },
      });
      return;
    }
    const waited = Date.now() - run.createdAt.getTime();
    const settled = Date.now() - request.updatedAt.getTime() > SETTLE_MS;
    const ids = (Array.isArray(request.attachments) ? (request.attachments as { uploadId: string }[]) : []).map(
      (a) => a.uploadId,
    );
    const pending = ids.length
      ? await this.prisma.assetExtraction.count({
          where: { assetId: { in: ids }, status: { in: ["pending", "extracting"] } },
        })
      : 0;
    if ((!settled || pending > 0) && waited < QUEUE_LIMIT_MS) return;
    try {
      const body = await this.call<{ run_id?: string }>("/v1/runs", {
        method: "POST",
        body: { input: run.input, session_id: sessionIdFor(run.userId, `req-${request.id}`) },
      });
      if (!body.run_id) throw new Error("Hermes tidak mengembalikan ID tugas.");
      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: { status: "running", hermesRunId: body.run_id, startedAt: new Date() },
      });
    } catch (error) {
      const failed = await this.prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        },
      });
      await this.policies.finalize(failed);
    }
  }

  /** Baca status run di Hermes; selesai → simpan hasil dan (bila dari aturan) jalankan keputusan server. */
  private async refresh(run: AgentRun) {
    const view = parseRun(
      run.hermesRunId!,
      await this.call<unknown>(`/v1/runs/${encodeURIComponent(run.hermesRunId!)}`),
    );
    const overdue = !view.done && run.startedAt && Date.now() - run.startedAt.getTime() > RUN_LIMIT_MS;
    if (!view.done && !overdue) return run;
    const updated = await this.prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: overdue ? "failed" : view.status,
        output: view.output?.slice(0, 20_000) ?? null,
        error: overdue ? "Tugas agen melewati batas waktu." : view.error,
        finishedAt: new Date(),
      },
    });
    await this.policies.finalize(updated);
    return updated;
  }

  get configured() {
    return !!this.config.get<string>("HERMES_URL") && !!this.config.get<string>("HERMES_API_KEY");
  }

  private isOwner(user: AuthUser) {
    return isAgentOwner(this.config.get<string>("HERMES_OWNER_EMAIL"), user.email);
  }

  private requireOwner(user: AuthUser) {
    if (!this.configured) {
      throw new UnprocessableEntityException("Agen belum diatur (HERMES_URL & HERMES_API_KEY di server).");
    }
    if (!this.isOwner(user)) {
      throw new ForbiddenException("AI Agent hanya untuk pemilik agen (HERMES_OWNER_EMAIL).");
    }
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}, timeoutMs = 20_000) {
    const base = this.config.get<string>("HERMES_URL")!.replace(/\/+$/, "");
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.config.get<string>("HERMES_API_KEY")}`,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new UnprocessableEntityException(
        "Hermes tidak dapat dihubungi. Nyalakan: wsl -e sh /mnt/d/Development/Application/workingspace/infra/hermes/up.sh",
      );
    }
    if (!response.ok) {
      const text = (await response.text().catch(() => "")).slice(0, 300);
      // Error layanan agen → 422/429 (bukan 401/5xx: memicu refresh sesi / pesan "server tidak dapat dihubungi")
      if (response.status === 429) throw new UnprocessableEntityException("Agen sedang penuh. Coba lagi sebentar.");
      if (response.status === 404) throw new NotFoundException("Tugas agen tidak ditemukan di Hermes.");
      throw new UnprocessableEntityException(`Hermes menolak (${response.status}): ${text || response.statusText}`);
    }
    return (await response.json().catch(() => ({}))) as T;
  }

  async status(user: AuthUser) {
    const base = { configured: this.configured, owner: this.isOwner(user) };
    if (!base.configured || !base.owner) return { ...base, reachable: false };
    const setup = await this.setupState(user);
    try {
      const health = await this.call<{ status?: string }>("/health", {}, 4_000);
      const models = await this.call<{ data?: { id?: string }[] }>("/v1/models", {}, 4_000).catch(() => null);
      const skills = await this.skills(user).catch(() => []);
      return {
        ...base,
        setup,
        reachable: true,
        health: typeof health.status === "string" ? health.status : "ok",
        model: models?.data?.[0]?.id ?? null,
        skills: skills.length,
        akashaSkills: skills.filter((s) => s.akasha).length,
      };
    } catch (error) {
      return { ...base, setup, reachable: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ---------------------------------------------------------------- Penyiapan agen (tanpa terminal)

  /** Hash kunci bersama Hermes ↔ Akasha = hash token akses "Agen Hermes" di tabel `api_tokens`. */
  private agentKeyHash() {
    const key = this.config.get<string>("HERMES_API_KEY") ?? "";
    return looksLikeToken(key) ? hashToken(key) : null;
  }

  /** Keadaan penyiapan: izin agen (token), model yang akan dipakai, dan panggilan model terakhir. */
  private async setupState(user: AuthUser) {
    const hash = this.agentKeyHash();
    const token = hash
      ? await this.prisma.apiToken.findFirst({
          where: { tokenHash: hash, userId: user.id },
          select: { id: true, scopes: true, lastUsedAt: true, createdAt: true },
        })
      : null;
    const akaiUser = await this.akaiUser(user.id);
    const akaiModel = akaiUser ? await this.akai.primaryModel(akaiUser, "agent") : null;
    return {
      keyValid: !!hash,
      token: token ? { ...token, scopes: normalizeScopes(token.scopes) } : null,
      model: akaiModel ? { provider: "akai", model: akaiModel } : null,
      lastModelCall: this.lastModelCall,
    };
  }

  /**
   * Tombol "Siapkan agen": buat/perbarui token akses "Agen Hermes" milik pemilik agen dengan hash `HERMES_API_KEY`.
   * Hermes sudah memegang kunci itu (`API_SERVER_KEY`), jadi tidak ada rahasia yang perlu diketik atau disalin.
   * Mencabut token di Pengaturan → Integrasi = memutus akses agen ke data & model.
   */
  async setup(user: AuthUser, scopes?: string[]) {
    this.requireOwner(user);
    const hash = this.agentKeyHash();
    if (!hash) {
      throw new UnprocessableEntityException(
        "HERMES_API_KEY di server harus 24–128 karakter huruf/angka/_/- (buat dengan: openssl rand -hex 32).",
      );
    }
    const chosen: ApiScope[] = scopes ? normalizeScopes(scopes) : DEFAULT_AGENT_SCOPES;
    if (!chosen.length) throw new UnprocessableEntityException("Pilih minimal satu izin untuk agen.");
    // Kunci yang sama pernah disiapkan untuk akun lain (pemilik agen berganti) → dilepas dari akun itu
    await this.prisma.apiToken.deleteMany({ where: { tokenHash: hash, userId: { not: user.id } } });
    await this.prisma.apiToken.upsert({
      where: { tokenHash: hash },
      create: {
        userId: user.id,
        name: AGENT_TOKEN_NAME,
        tokenHash: hash,
        prefix: AGENT_TOKEN_PREFIX,
        scopes: chosen,
        expiresAt: null,
      },
      update: { scopes: chosen, name: AGENT_TOKEN_NAME },
    });
    return this.status(user);
  }

  // ---------------------------------------------------------------- Proxy model (OpenAI-compatible) untuk Hermes

  /** `GET /agent/llm/v1/models`: satu model `akasha-agent` (konteks sesuai provider pilihan user). */
  async models(principal: TokenPrincipal) {
    const akaiUser = await this.akaiUser(principal.user.id);
    const akaiModel = akaiUser ? await this.akai.primaryModel(akaiUser, "agent") : null;
    // Lewat Akai: panjang konteks konservatif (Hermes meringkas riwayat lebih awal, tidak pernah ditolak model)
    return modelsResponse(akaiModel);
  }

  /**
   * `POST /agent/llm/v1/chat/completions`: diteruskan ke gateway Akai (tugas Agen di Akai: model, cadangan, prompt caching &
   * pemikiran Claude dipilih Akai). Hanya token dengan izin `ai:model`. docs/KAJIAN-AI-TERPUSAT.md.
   */
  async proxyChat(principal: TokenPrincipal, body: unknown, res: ExpressResponse) {
    if (!principal.scopes.includes("ai:model")) {
      return llmError(res, 403, "Token agen tidak punya izin Model AI (ai:model). Siapkan ulang agen di Akasha.");
    }
    const akaiUser = await this.akaiUser(principal.user.id);
    if (!akaiUser || !(await this.akai.handles(akaiUser, "agent"))) {
      return llmError(res, 400, "Model agen belum diatur: atur tugas Agen di Akai → Model.");
    }
    const at = new Date().toISOString();
    const result = await this.akai.proxyAgent(akaiUser, body, res);
    this.lastModelCall = {
      at,
      ok: result.ok,
      provider: "akai",
      model: result.model ?? "akai",
      ...(result.error ? { error: result.error } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.fallbackFrom ? { fallbackFrom: { provider: result.fallbackFrom, error: "dialihkan oleh Akai" } } : {}),
    };
    if (result.unreachable) llmError(res, 422, "Akai tidak dapat dihubungi. Coba lagi sebentar.");
  }

  /**
   * Skill Akasha dibaca dari folder repo (`HERMES_SKILLS_DIR`, bawaan `../../akai/agent/skills`) — folder yang sama
   * dipasang ke container Hermes. Skill bawaan Hermes ditambahkan dari `/v1/skills` bila endpoint itu berfungsi.
   */
  async skills(user: AuthUser): Promise<AgentSkill[]> {
    this.requireOwner(user);
    const local = await this.localSkills();
    const remote = await this.call<unknown>("/v1/skills", {}, 5_000)
      .then(parseSkills)
      .catch(() => [] as AgentSkill[]);
    const names = new Set(local.map((s) => s.name));
    return [...local, ...remote.filter((s) => !s.akasha && !names.has(s.name))];
  }

  private async localSkills(): Promise<AgentSkill[]> {
    const dir = resolve(
      this.config.get<string>("HERMES_SKILLS_DIR") || join(process.cwd(), "..", "..", "akai", "agent", "skills"),
    );
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const skills: AgentSkill[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const text = await readFile(join(dir, entry.name, "SKILL.md"), "utf8").catch(() => null);
      const skill = text ? parseSkillFile(text, entry.name) : null;
      if (skill) skills.push(skill);
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Pesan chat → run di sesi Hermes milik user (percakapan berlanjut lewat `session_id`). */
  /**
   * Kirim pesan chat. `conversation` = ID percakapan tersimpan; kosong / tidak dikenal = percakapan baru (judul dari
   * pesan pertama). Konteks percakapan dipegang sesi Hermes `akasha-<userId>-<id>`, riwayat tampilan = `agent_runs`.
   */
  async chat(user: AuthUser, message: string, conversation: string) {
    this.requireOwner(user);
    const existing = conversation
      ? await this.prisma.agentConversation.findFirst({
          where: { id: conversation, userId: user.id, deletedAt: null },
          select: { id: true },
        })
      : null;
    const conv =
      existing ??
      (await this.prisma.agentConversation.create({
        data: { userId: user.id, title: conversationTitle(message) },
        select: { id: true },
      }));
    const started = await this.start(user, {
      kind: "chat",
      input: message,
      sessionId: sessionIdFor(user.id, conv.id),
      conversationId: conv.id,
    });
    await this.prisma.agentConversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    return { ...started, conversationId: conv.id };
  }

  /** Daftar percakapan (disematkan dulu, lalu terakhir dipakai), maks. 200. */
  async conversations(user: AuthUser) {
    this.requireOwner(user);
    const rows = await this.prisma.agentConversation.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 200,
      select: {
        id: true,
        title: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
        runs: { where: { status: { in: ["running", "queued"] } }, select: { id: true }, take: 1 },
        _count: { select: { runs: true } },
      },
    });
    return rows.map(({ runs, _count, ...row }) => ({ ...row, running: runs.length > 0, messages: _count.runs * 2 }));
  }

  /** Isi satu percakapan: pesan user + jawaban agen, urut waktu. */
  async conversation(user: AuthUser, id: string) {
    this.requireOwner(user);
    const conv = await this.ownConversation(user, id);
    const runs = await this.prisma.agentRun.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        hermesRunId: true,
        input: true,
        status: true,
        output: true,
        error: true,
        createdAt: true,
        finishedAt: true,
      },
    });
    return { id: conv.id, title: conv.title, pinned: conv.pinned, messages: runsToMessages(runs) };
  }

  async updateConversation(user: AuthUser, id: string, patch: { title?: string; pinned?: boolean }) {
    this.requireOwner(user);
    const conv = await this.ownConversation(user, id);
    const title = patch.title?.replace(/\s+/g, " ").trim();
    return this.prisma.agentConversation.update({
      where: { id: conv.id },
      data: {
        ...(title ? { title: title.slice(0, 120) } : {}),
        ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
        // Sematkan / ganti judul tidak mengubah urutan "terakhir dipakai"
        updatedAt: conv.updatedAt,
      },
      select: { id: true, title: true, pinned: true, updatedAt: true },
    });
  }

  /** Hapus = ke Sampah (bisa dipulihkan 30 hari). Jawaban yang masih berjalan dihentikan dulu. */
  async removeConversation(user: AuthUser, id: string) {
    this.requireOwner(user);
    const conv = await this.ownConversation(user, id);
    const running = await this.prisma.agentRun.findMany({
      where: { conversationId: conv.id, status: "running", hermesRunId: { not: null } },
      select: { hermesRunId: true },
    });
    for (const run of running)
      await this.call(`/v1/runs/${encodeURIComponent(run.hermesRunId!)}/stop`, { method: "POST" }).catch(
        () => undefined,
      );
    const batchId = await this.prisma.$transaction(async (tx) => {
      await tx.agentConversation.update({
        where: { id: conv.id },
        data: { deletedAt: new Date(), updatedAt: conv.updatedAt },
      });
      return this.trash.add(
        { userId: user.id, kind: "agent_conversation", itemId: conv.id, title: conv.title, actorId: user.id },
        tx,
      );
    });
    return { ok: true, batchId };
  }

  private async ownConversation(user: AuthUser, id: string) {
    const conv = await this.prisma.agentConversation.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!conv) throw new NotFoundException("Percakapan tidak ditemukan.");
    return conv;
  }

  /** Jalankan skill atas satu pengajuan milik user (hasil disimpan agen ke pengajuan lewat MCP → Approval). */
  async runSkill(user: AuthUser, requestId: string, skill: string) {
    this.requireOwner(user);
    if (!SKILL_NAME.test(skill)) throw new UnprocessableEntityException("Nama skill tidak valid.");
    const request = await this.requests.get(user.id, requestId);
    if (!["baru", "diproses", "menunggu_verifikasi"].includes(request.status)) {
      throw new UnprocessableEntityException("Pengajuan sudah diputuskan — agen tidak dijalankan.");
    }
    return this.start(user, {
      kind: "skill",
      input: skillRunInput(skill, request),
      sessionId: sessionIdFor(user.id, `req-${request.id}`),
      requestId: request.id,
      skill,
    });
  }

  /** Jalankan fitur buatan agen; hanya yang sudah disetujui pemilik. */
  async runMenu(
    user: AuthUser,
    menu: {
      id: string;
      slug: string;
      label: string;
      skill: string;
      instructions: string;
      status: string;
      form: unknown;
    },
    note?: string,
    values?: Record<string, unknown>,
  ) {
    this.requireOwner(user);
    if (menu.status !== "active") throw new UnprocessableEntityException("Setujui dulu di Approval → Usulan Agen.");
    const clean = normalizeMenuValues(Array.isArray(menu.form) ? (menu.form as MenuField[]) : [], values);
    if ("error" in clean) throw new UnprocessableEntityException(clean.error);
    return this.start(user, {
      kind: "skill",
      input: menuRunInput(menu, note, clean),
      sessionId: sessionIdFor(user.id, `menu-${menu.id}`),
      skill: menu.skill,
      menuId: menu.id,
    });
  }

  /**
   * e-Kinerja → Rencana Aksi → "Generate usulan": agen memetakan kegiatan satu bulan ke RHK dan menyusun narasi
   * Renaksi/Realisasi sebagai usulan (MCP `ekinerja_propose_renaksi`). Butuh izin token agen `ekinerja:robot`.
   */
  async runRenaksi(user: AuthUser, period: string) {
    this.requireOwner(user);
    if (!isPeriod(period)) throw new UnprocessableEntityException("Bulan harus YYYY-MM.");
    const setup = await this.setupState(user);
    if (!setup.token?.scopes.includes("ekinerja:robot")) {
      throw new UnprocessableEntityException(
        'Agen belum diberi izin "Robot e-Kinerja". Buka AI Agent → Status & Skill → Siapkan agen, centang izin itu, lalu restart Hermes.',
      );
    }
    return this.start(user, {
      kind: "skill",
      input: renaksiRunInput(period),
      sessionId: sessionIdFor(user.id, `renaksi-${period}`),
      skill: RENAKSI_SKILL,
    });
  }

  /** Riwayat tugas satu menu, terbaru dulu. */
  async menuRuns(userId: string, menuId: string) {
    const rows = await this.prisma.agentRun.findMany({
      where: { userId, menuId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rows.map((r) => ({
      runId: r.hermesRunId ?? r.id,
      startedAt: (r.startedAt ?? r.createdAt).toISOString(),
      status: r.status,
      output: r.output,
      error: r.error,
    }));
  }

  assertOwner(user: AuthUser) {
    this.requireOwner(user);
  }

  private async start(
    user: AuthUser,
    run: {
      kind: "chat" | "skill";
      input: string;
      sessionId: string;
      requestId?: string;
      skill?: string;
      menuId?: string;
      conversationId?: string;
    },
  ) {
    const body = await this.call<{ run_id?: string; status?: string }>("/v1/runs", {
      method: "POST",
      body: { input: run.input, session_id: run.sessionId },
    });
    if (!body.run_id) throw new UnprocessableEntityException("Hermes tidak mengembalikan ID tugas.");
    await this.prisma.agentRun.create({
      data: {
        userId: user.id,
        hermesRunId: body.run_id,
        kind: run.kind,
        trigger: run.menuId ? "menu" : run.kind === "chat" ? "chat" : "button",
        skill: run.skill ?? null,
        requestId: run.requestId ?? null,
        menuId: run.menuId ?? null,
        conversationId: run.conversationId ?? null,
        input: run.input,
        status: "running",
        startedAt: new Date(),
      },
    });
    return { runId: body.run_id, status: body.status ?? "started" };
  }

  private async tracked(user: AuthUser, runId: string) {
    const run = await this.prisma.agentRun.findFirst({ where: { hermesRunId: runId, userId: user.id } });
    if (!run) throw new NotFoundException("Tugas agen tidak ditemukan.");
    return run;
  }

  private view(run: AgentRun) {
    const done = run.status !== "queued" && run.status !== "running";
    return {
      runId: run.hermesRunId ?? run.id,
      status: run.status,
      done,
      output: run.output,
      error: run.error,
      requestId: run.requestId,
      skill: run.skill,
    };
  }

  async run(user: AuthUser, runId: string) {
    this.requireOwner(user);
    const run = await this.tracked(user, runId);
    if (run.status !== "running") return this.view(run);
    return this.view(await this.refresh(run));
  }

  async stop(user: AuthUser, runId: string) {
    this.requireOwner(user);
    const run = await this.tracked(user, runId);
    if (run.status !== "running") return { stopping: false };
    await this.call(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST", body: {} });
    return { stopping: true };
  }

  /** Tugas agen terakhir milik user (tersimpan permanen di `agent_runs`). */
  async recent(user: AuthUser) {
    this.requireOwner(user);
    const rows = await this.prisma.agentRun.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rows.map((r) => ({
      runId: r.hermesRunId ?? r.id,
      kind: r.kind,
      trigger: r.trigger,
      skill: r.skill,
      requestId: r.requestId,
      input: r.kind === "chat" ? r.input.slice(0, 200) : null,
      startedAt: (r.startedAt ?? r.createdAt).toISOString(),
      status: r.status,
      error: r.error,
    }));
  }
}
