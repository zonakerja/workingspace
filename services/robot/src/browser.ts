import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type Browser, type BrowserContext, chromium, type Locator, type Page } from "playwright";
import {
  allowedHosts,
  clampText,
  DEFAULT_LOGIN_MARKERS,
  type InputEvent,
  looksLikeLogin,
  urlAllowed,
  VIEWPORT,
} from "./logic.js";
import { groupRhk, overlapsYear, parseSkpBlock, type Rhk, type RhkRow, type SkpSummary } from "./ekinerja.js";
import {
  BUTTON_LABELS,
  type FillStep,
  FORBIDDEN_BUTTON,
  indicatorsToCheck,
  modalPasses,
  monthSummary,
  MONTH_NAMES,
  monthName,
  normalize,
  parseItems,
  plannedSteps,
  type RenaksiRow,
  rowKey,
  syncPlan,
} from "./ekinerja-renaksi.js";
import {
  incompleteRows,
  isSubmitButton,
  pickSubmitConfirm,
  rowDifference,
  type SubmitRequest,
  submitOutcome,
} from "./ekinerja-submit.js";
import {
  classifyFields,
  infoDialogButton,
  isRememberCheckbox,
  loginStage,
  pickLoginEntry,
  pickSubmit,
} from "./login-form.js";
import {
  mergeReferenceItems,
  parseReferenceRows,
  parseSenderUnits,
  SENDER_UNIT_LABEL,
  parseTotal,
  DEFAULT_REFERENCE_CATEGORIES,
  maxReferencePages,
  REFERENCE_PAGES,
  type ReferenceCategory,
  type ReferenceItem,
} from "./srikandi-reference.js";
import {
  attachmentName,
  isFileResponse,
  isSigned,
  letterFileName,
  looksLikePdf,
  mimeForName,
  type OutgoingLetter,
  parseLetterRow,
  sameSite,
  validFileBody,
} from "./srikandi.js";
import {
  DETAIL_PATH_MARK,
  detailMatches,
  findSendRow,
  pickSendConfirm,
  SEND_BUTTON,
  sendOutcome,
  type SendRequest,
  UNSENT_MARK,
} from "./srikandi-send.js";
import {
  findDraft,
  LOG_PATH,
  type LogRow,
  pickOption,
  REGISTER_PATH,
  type RegisterForm,
  type RegisterPick,
  SELECT_LABELS,
  type SelectKey,
  searchTerm,
  detailIdOf,
  normalizeOption,
} from "./srikandi-register.js";
import {
  INBOX_PAGES,
  type InboxItem,
  type InboxKind,
  MAX_INBOX_PAGES,
  mergeInboxItems,
  parseInboxRows,
} from "./srikandi-inbox.js";
import {
  describePlan,
  EDIT_MARKER,
  findEditRow,
  type EditState,
  isRowRemovalConfirm,
  planEdit,
  planIsEmpty,
  recipientMenu,
  type UpdateForm,
} from "./srikandi-register-edit.js";

/** Alamat yang tampak seperti berkas lampiran. */
const FILE_URL = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|jpe?g|png|zip)$/i;
/** Batas butir per job (satu bulan) agar job tidak berjalan tanpa akhir. */
const MAX_RENAKSI_STEPS = 60;

/** Sesi tersimpan = cookie + localStorage + IndexedDB (format `storageState` Playwright), dikelola backend (terenkripsi). */
export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface Target {
  /** Alamat utama sistem (mis. https://srikandi.arsip.go.id) */
  baseUrl: string;
  /** Host tambahan yang boleh dibuka (mis. server SSO) */
  extraHosts?: string[];
  /** Penanda alamat halaman login khusus sistem ini */
  loginMarkers?: string[];
  storageState?: StorageState | null;
}

/** SKP + RHK-nya (null = Detail SKP tidak dibaca karena di luar tahun yang diminta). */
export type SkpWithRhk = SkpSummary & { rhk: Rhk[] | null };

/** PDF naskah ber-TTD yang ditangkap dari halaman detail (`pdf` base64; null = tidak tertangkap, `pages` = jejak respons). */
export interface FetchedLetter {
  key: string;
  name: string;
  pdf: string | null;
  attachments: FetchedAttachment[];
  pages: string[];
}

/** Lampiran naskah (`data` base64; null = tidak tertangkap / melebihi batas). */
export interface FetchedAttachment {
  name: string;
  data: string | null;
  mimeType: string;
}

const MAX_PDF_BYTES = 25 * 1024 * 1024;
/** Batas halaman tabel referensi yang dibaca per menu (10 baris/halaman). */
const MAX_ATTACHMENTS = 10;
/** Batas total lampiran per naskah (respons robot → backend) */
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

interface LiveSession {
  context: BrowserContext;
  page: Page;
  hosts: string[];
  markers: string[];
  lastUsed: number;
}

/** Sesi login jarak jauh ditutup otomatis bila tidak dipakai selama ini. */
const IDLE_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 4;
const NAV_TIMEOUT = 45_000;

/**
 * Satu Chromium bersama; setiap sesi/job memakai context terpisah (tidak berbagi cookie). Robot tidak menyimpan apa pun
 * di disk: sesi masuk sebagai `storageState` dari backend dan dikembalikan setelah selesai.
 */
export class BrowserPool {
  private browser?: Promise<Browser>;
  private readonly sessions = new Map<string, LiveSession>();

  constructor() {
    setInterval(() => void this.sweep(), 60_000).unref();
  }

  get size() {
    return this.sessions.size;
  }

  private async getBrowser(): Promise<Browser> {
    this.browser ??= chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
    const browser = await this.browser;
    if (!browser.isConnected()) {
      this.browser = undefined;
      return this.getBrowser();
    }
    return browser;
  }

  private async newContext(target: Target, options: { downloads?: boolean } = {}) {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      // Unduhan hanya untuk job yang membutuhkannya (lampiran SRIKANDI) — berkas sementara, dihapus setelah dibaca
      acceptDownloads: options.downloads ?? false,
      storageState: target.storageState ?? undefined,
    });
    context.setDefaultNavigationTimeout(NAV_TIMEOUT);
    context.setDefaultTimeout(20_000);
    const hosts = allowedHosts(target.baseUrl, target.extraHosts);
    return { context, hosts, markers: [...DEFAULT_LOGIN_MARKERS, ...(target.loginMarkers ?? [])] };
  }

  private async open(page: Page, url: string, hosts: string[]) {
    if (!urlAllowed(url, hosts)) throw new Error(`Alamat di luar konektor: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  }

  private async describe(page: Page, markers: string[]) {
    const url = page.url();
    const hasPassword =
      (await page
        .locator("input[type=password]:visible")
        .count()
        .catch(() => 0)) > 0;
    return { url, title: await page.title().catch(() => ""), loggedIn: !looksLikeLogin(url, hasPassword, markers) };
  }

  // ---------------------------------------------------------------- Login jarak jauh

  async startSession(target: Target & { startUrl?: string }) {
    if (this.sessions.size >= MAX_SESSIONS) throw new Error("Terlalu banyak sesi login terbuka. Tutup yang lain dulu.");
    const { context, hosts, markers } = await this.newContext(target);
    const page = await context.newPage();
    const id = randomUUID();
    const session: LiveSession = { context, page, hosts, markers, lastUsed: Date.now() };
    this.sessions.set(id, session);
    // Popup / tab baru (mis. jendela SSO) menjadi halaman yang ditayangkan; saat ditutup kembali ke tab sebelumnya
    context.on("page", (p: Page) => {
      session.page = p;
      p.on("close", () => {
        if (session.page === p) session.page = context.pages().at(-1) ?? page;
      });
    });
    try {
      await this.open(page, target.startUrl ?? target.baseUrl, hosts);
    } catch (error) {
      await this.closeSession(id);
      throw error;
    }
    return { id, ...(await this.describe(page, markers)) };
  }

  private live(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new NotFound("Sesi login tidak ditemukan atau sudah ditutup.");
    session.lastUsed = Date.now();
    return session;
  }

  async frame(id: string) {
    const { page, markers } = this.live(id);
    const image = await page.screenshot({ type: "jpeg", quality: 60 });
    return { image, ...(await this.describe(page, markers)) };
  }

  async input(id: string, event: InputEvent) {
    const { page, hosts, markers } = this.live(id);
    switch (event.type) {
      case "click":
        await page.mouse.click(event.x, event.y);
        break;
      case "dblclick":
        await page.mouse.dblclick(event.x, event.y);
        break;
      case "move":
        await page.mouse.move(event.x, event.y);
        break;
      case "scroll":
        await page.mouse.move(event.x, event.y);
        await page.mouse.wheel(0, event.dy);
        break;
      case "type":
        await page.keyboard.type(event.text, { delay: 20 });
        break;
      case "key":
        await page.keyboard.press(event.key === "Space" ? " " : event.key);
        break;
      case "goto":
        await this.open(page, event.url, hosts);
        break;
      case "back":
        await page.goBack().catch(() => undefined);
        break;
      case "reload":
        await page.reload().catch(() => undefined);
        break;
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
    return this.describe(page, markers);
  }

  /** Simpan sesi (cookie + storage) lalu tutup. */
  async finishSession(id: string) {
    const { context, page, markers } = this.live(id);
    await this.dismissInfoDialog(page);
    const info = await this.describe(page, markers);
    const storageState = await context.storageState({ indexedDB: true });
    await this.closeSession(id);
    return { ...info, storageState };
  }

  async closeSession(id: string) {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    await session?.context.close().catch(() => undefined);
  }

  private async sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (now - s.lastUsed > IDLE_MS) await this.closeSession(id);
  }

  // ---------------------------------------------------------------- Job singkat (tanpa tayangan)

  /** Buka halaman utama dengan sesi tersimpan → masih login? (sesi diperbarui dikembalikan). */
  async check(target: Target & { homeUrl?: string }) {
    return this.withPage(target, async (page, hosts, markers) => {
      await this.open(page, target.homeUrl ?? target.baseUrl, hosts);
      await this.dismissInfoDialog(page);
      return this.describe(page, markers);
    });
  }

  /**
   * Eksplor: buka satu halaman sistem dengan sesi tersimpan lalu kembalikan tangkapan layar + snapshot aksesibilitas
   * (struktur formulir/tombol) — bahan untuk memetakan alur pengisian bersama pengguna.
   */
  async capture(target: Target & { url: string }) {
    return this.withPage(target, async (page, hosts, markers) => {
      await this.open(page, target.url, hosts);
      return this.record(page, markers);
    });
  }

  /**
   * Rekam halaman yang sedang tampil di browser jarak jauh (mis. setelah pengguna membuka Rencana Aksi atau formulir
   * tambah) — keadaan yang tidak bisa dicapai lewat alamat saja. Tidak mengklik apa pun.
   */
  async captureSession(id: string) {
    const { context, page, markers } = this.live(id);
    const result = await this.record(page, markers);
    return { ...result, storageState: await context.storageState({ indexedDB: true }) };
  }

  /**
   * e-Kinerja: baca daftar SKP (`/skp`) lalu tabel Hasil Kerja tiap Detail SKP yang beririsan dengan `year` (satu tahun
   * bisa beberapa SKP). Hanya membuka halaman & membaca teks — tidak mengklik apa pun.
   */
  async ekinerjaSkp(target: Target & { year?: number; maxDetails?: number }) {
    return this.withPage(target, async (page, hosts, markers) => {
      const base = target.baseUrl.replace(/\/+$/, "");
      await this.open(page, `${base}/skp`, hosts);
      await this.dismissInfoDialog(page);
      const info = await this.describe(page, markers);
      if (!info.loggedIn) return { ...info, skps: [] as SkpWithRhk[] };

      // Tabel Periode & Status diikuti tautan Rencana Aksi milik SKP yang sama (urutan dokumen)
      const blocks = await page.evaluate(() => {
        const found: { href: string; text: string }[] = [];
        let period = "";
        let status = "";
        for (const el of document.querySelectorAll("table, a[href*='/skp/renaksi/']")) {
          if (el instanceof HTMLAnchorElement) {
            found.push({ href: el.href, text: `${period}\n${status}` });
            period = status = "";
          } else {
            const text = (el as HTMLElement).innerText;
            if (/Periode\s*:/i.test(text)) period = text;
            else if (/Status\s*:/i.test(text)) status = text;
          }
        }
        return found;
      });
      const skps = blocks.map((b) => parseSkpBlock(b.text, b.href)).filter((s): s is SkpSummary => !!s);
      const wanted = skps.filter((s) => !target.year || overlapsYear(s, target.year)).slice(0, target.maxDetails ?? 8);

      const result: SkpWithRhk[] = skps.map((s) => ({ ...s, rhk: null }));
      for (const skp of wanted) {
        await this.open(page, `${base}/skp/detail/${skp.externalId}`, hosts);
        const rows = await page.evaluate(() => {
          const table = [...document.querySelectorAll("table")].find((t) =>
            [...t.querySelectorAll("th")].some((th) => /^\s*RENCANA HASIL KERJA\s*$/i.test(th.textContent ?? "")),
          );
          if (!table) return null;
          let section = "UTAMA";
          const out: Record<string, string>[] = [];
          for (const tr of table.querySelectorAll("tbody tr")) {
            // Tombol di dalam sel (Edit RHK / Hapus RHK pada SKP draft) bukan bagian narasi → dibuang sebelum dibaca
            const cells = [...(tr as HTMLTableRowElement).cells].map((c) => {
              const copy = c.cloneNode(true) as HTMLElement;
              copy.querySelectorAll("button, a, [role=group], .btn-group, .dropdown").forEach((x) => x.remove());
              return (copy.innerText || copy.textContent || "").trim();
            });
            if (cells.length === 1) {
              if (cells[0]) section = cells[0];
            } else if (cells.length >= 6) {
              const [no, leader, rhk, aspect, indicator, target] = cells;
              out.push({ section, no, leader, rhk, aspect, indicator, target });
            }
          }
          return out;
        });
        const item = result.find((r) => r.externalId === skp.externalId)!;
        item.rhk = rows ? groupRhk(rows as unknown as RhkRow[]) : [];
      }
      return { ...info, skps: result };
    });
  }

  /**
   * e-Kinerja: isi Rencana Aksi satu bulan pada `/skp/renaksi/<id SKP>`.
   * - `mode: "add"` (bawaan): centang indikator yang dipetakan Akasha (tidak pernah melepas) lalu tambahkan butir yang
   *   belum ada (idempoten).
   * - `mode: "sync"`: isi bulan disamakan dengan Akasha (`rows` = seluruh isian bulan itu) — indikator yang tidak diminta
   *   dilepas, baris yang memuat butir di luar Akasha ditulis ulang (lepas centang → centang lagi → isi ulang), lalu butir
   *   yang kurang ditambahkan. Backend selalu membaca & mengimpor isi e-Kinerja lebih dulu sehingga tidak ada butir yang hilang.
   * Berhenti di draf: "Kirim Penilaian Ke Atasan" tidak pernah diklik, bulan yang sudah diajukan ditolak.
   */
  async ekinerjaRenaksi(
    target: Target & {
      skpExternalId: string;
      period: string;
      rows: RenaksiRow[];
      dryRun?: boolean;
      mode?: "add" | "sync";
    },
  ) {
    return this.withPage(target, async (page, hosts, markers) => {
      const month = monthName(target.period);
      if (!month) throw new Error("Periode tidak valid.");
      const base = target.baseUrl.replace(/\/+$/, "");
      const url = `${base}/skp/renaksi/${encodeURIComponent(target.skpExternalId)}`;
      await this.open(page, url, hosts);
      await this.dismissInfoDialog(page);
      const info = await this.describe(page, markers);
      const empty = {
        month,
        checked: [] as string[],
        unchecked: [] as string[],
        rewritten: [] as string[],
        added: [] as FillStep[],
        missing: [] as string[],
        rows: [] as unknown[],
      };
      if (!info.loggedIn) return { ...info, ...empty, status: "logged_out" as const, screenshot: null };

      let block = await this.renaksiBlock(page, month);
      if (!block.found) throw new Error(`Blok bulan ${month} tidak ditemukan di halaman Rencana Aksi.`);
      if (block.submitted) {
        return { ...info, ...empty, rows: block.rows, status: "submitted" as const, screenshot: await this.jpeg(page) };
      }
      const sync = target.mode === "sync";
      const plan = sync ? syncPlan(block.rows, target.rows) : null;

      // Periksa saja: baca isi bulan + rencana langkah tanpa mengklik apa pun
      if (target.dryRun) {
        // Mode sinkron: baris yang ditulis ulang dihitung kosong, indikator yang akan dicentang dihitung sebagai baris baru
        const previewRows = plan
          ? [
              ...block.rows.map((r) =>
                plan.rewrite.includes(r.key) ? { ...r, renaksi: [], realisasi: [], bukti: [] } : r,
              ),
              ...plan.check.map((key) => ({ key, renaksi: [], realisasi: [], bukti: [] })),
            ]
          : block.rows;
        const preview = plannedSteps(previewRows, target.rows);
        return {
          ...info,
          ...empty,
          status: "preview" as const,
          planned: preview.steps,
          missing: preview.missing,
          check:
            plan?.check ??
            target.rows.map((r) => rowKey(r.rhk, r.indicator)).filter((k) => !block.rows.some((r) => r.key === k)),
          uncheck: plan?.uncheck ?? [],
          rewrite: plan?.rewrite ?? [],
          rows: block.rows,
          screenshot: await this.jpeg(page),
        };
      }

      // Langkah 1: pilihan indikator (centang baru; mode sync juga melepas & menulis ulang)
      let checked: string[] = [];
      let unchecked: string[] = [];
      let missing: string[] = [];
      const wantedKeys = target.rows.map((r) => rowKey(r.rhk, r.indicator));
      const needsModal = plan
        ? plan.check.length + plan.uncheck.length + plan.rewrite.length > 0
        : wantedKeys.some((k) => !block.rows.some((r) => r.key === k));
      if (needsModal) {
        const opened = await this.openIndicatorModal(page, block);
        missing = wantedKeys.filter((k) => !opened.options.some((o) => o.key === k));
        if (plan) {
          const passes = modalPasses(
            opened.options.map((o) => o.key),
            opened.options.filter((o) => o.checked).map((o) => o.key),
            plan,
          );
          if (!passes) throw new Error("Semua indikator SKP perlu ditulis ulang sekaligus — lakukan dari e-Kinerja.");
          await this.applyIndicatorModal(page, opened, passes.first);
          checked = passes.first.check;
          unchecked = passes.first.uncheck;
          block = await this.renaksiBlock(page, month);
          if (passes.second) {
            const again = await this.openIndicatorModal(page, block);
            await this.applyIndicatorModal(page, again, passes.second);
            block = await this.renaksiBlock(page, month);
          }
        } else {
          const pick = indicatorsToCheck(opened.options, target.rows);
          missing = pick.missing;
          checked = pick.check;
          await this.applyIndicatorModal(page, opened, { check: pick.check, uncheck: [] });
          block = await this.renaksiBlock(page, month);
        }
      }

      // Langkah 2: tambah butir yang belum ada (dibaca ulang setiap kali karena halaman dimuat ulang setelah Simpan)
      const steps = plannedSteps(block.rows, target.rows);
      missing = [...new Set([...missing, ...steps.missing])];
      const added: FillStep[] = [];
      for (const step of steps.steps.slice(0, MAX_RENAKSI_STEPS)) {
        const row = block.rows.find((r) => r.key === step.key);
        if (!row) continue;
        const button = page
          .locator(`tr[data-akasha-row="${row.index}"] button`)
          .filter({ hasText: BUTTON_LABELS[step.kind] });
        await this.safeClick(button.first());
        const modal = page
          .locator(".modal.show, .modal.in, [role=dialog]")
          .filter({ has: page.locator("textarea:visible") });
        await modal.first().waitFor({ state: "visible", timeout: 15_000 });
        await modal.first().locator("textarea:visible").first().fill(step.value);
        await this.saveModal(page, modal.first());
        added.push(step);
        block = await this.renaksiBlock(page, month);
      }
      const done = plannedSteps(block.rows, target.rows);
      const leftover = plan ? syncPlan(block.rows, target.rows) : null;
      const clean = !done.steps.length && !done.missing.length && (!leftover || !leftover.rewrite.length);
      return {
        ...info,
        month,
        status: clean ? ("filled" as const) : ("partial" as const),
        checked,
        unchecked,
        rewritten: plan?.rewrite ?? [],
        added,
        missing,
        rows: block.rows,
        screenshot: await this.jpeg(page),
      };
    });
  }

  /**
   * e-Kinerja: baca semua blok bulan Rencana Aksi satu SKP (status, tanggal pengajuan, rating, isi per indikator,
   * feedback). Hanya membaca — tidak ada yang diklik.
   */
  async ekinerjaRenaksiRead(target: Target & { skpExternalId: string }) {
    return this.withPage(target, async (page, hosts, markers) => {
      const base = target.baseUrl.replace(/\/+$/, "");
      await this.open(page, `${base}/skp/renaksi/${encodeURIComponent(target.skpExternalId)}`, hosts);
      await this.dismissInfoDialog(page);
      await page
        .waitForFunction(() => /januari/i.test(document.body.innerText), undefined, { timeout: 20_000 })
        .catch(() => undefined);
      const info = await this.describe(page, markers);
      if (!info.loggedIn) return { ...info, months: [] };
      const months = [];
      for (const [index, month] of MONTH_NAMES.entries()) {
        const block = await this.renaksiBlock(page, month);
        if (!block.found) continue;
        const summary = monthSummary(block.text, block.canFill, block.canEdit, block.rows.length);
        months.push({
          month: index + 1,
          ...summary,
          rows: block.rows.map(({ key, text, feedback, renaksi, realisasi, bukti }) => ({
            key,
            text,
            feedback,
            renaksi,
            realisasi,
            bukti,
          })),
        });
      }
      return { ...info, months };
    });
  }

  /**
   * e-Kinerja: **Kirim Penilaian Ke Atasan** satu bulan draf. Tanpa konfirmasi (dryRun, bawaan server) robot hanya membaca
   * blok bulan, memeriksa isinya sama dengan Akasha & lengkap, lalu menandai tombol (garis merah di tangkapan layar) tanpa
   * mengklik. Kirim sungguhan hanya setelah backend memeriksa PIN pemilik.
   */
  async ekinerjaSubmit(target: Target & { request: SubmitRequest }) {
    return this.withPage(target, async (page, hosts, markers) => {
      const req = target.request;
      const month = monthName(req.period)!;
      const base = target.baseUrl.replace(/\/+$/, "");
      const url = `${base}/skp/renaksi/${encodeURIComponent(req.skpExternalId)}`;
      await this.open(page, url, hosts);
      await this.dismissInfoDialog(page);
      await page
        .waitForFunction(() => /januari/i.test(document.body.innerText), undefined, { timeout: 20_000 })
        .catch(() => undefined);
      const info = await this.describe(page, markers);
      const none = { month, rows: [] as unknown[], incomplete: [] as unknown[], difference: null, message: "" };
      if (!info.loggedIn) return { ...info, ...none, status: "logged_out" as const, screenshot: null };

      const block = await this.renaksiBlock(page, month);
      if (!block.found) return { ...info, ...none, status: "not_found" as const, screenshot: await this.jpeg(page) };
      const rows = block.rows.map(({ key, renaksi, realisasi, bukti }) => ({ key, renaksi, realisasi, bukti }));
      const summary = monthSummary(block.text, block.canFill, block.canEdit, block.rows.length);
      if (summary.status === "submitted" || summary.status === "rated") {
        return {
          ...info,
          ...none,
          rows,
          status: "already_submitted" as const,
          message: summary.submittedAt ?? "",
          screenshot: await this.jpeg(page),
        };
      }
      if (!block.canSubmit) {
        return {
          ...info,
          ...none,
          rows,
          status: "not_ready" as const,
          message: "Tombol Kirim Penilaian tidak ada di bulan ini.",
          screenshot: await this.jpeg(page),
        };
      }
      // Isi e-Kinerja harus sama dengan Akasha & lengkap: yang sampai ke atasan = yang dilihat pemilik di Akasha
      const difference = rowDifference(rows, req.expectedKeys);
      if (difference.onlyEkinerja.length || difference.onlyAkasha.length) {
        return { ...info, ...none, rows, difference, status: "mismatch" as const, screenshot: await this.jpeg(page) };
      }
      const incomplete = incompleteRows(rows);
      if (incomplete.length) {
        return { ...info, ...none, rows, incomplete, status: "incomplete" as const, screenshot: await this.jpeg(page) };
      }
      const button = page.locator("[data-akasha-renaksi=submit]").first();
      const label = (await button.textContent({ timeout: 10_000 }).catch(() => "")) ?? "";
      if (!isSubmitButton(label) || !(await button.isEnabled().catch(() => false))) {
        return {
          ...info,
          ...none,
          rows,
          status: "not_ready" as const,
          message: "Tombol Kirim Penilaian tidak aktif.",
          screenshot: await this.jpeg(page),
        };
      }
      await button.scrollIntoViewIfNeeded().catch(() => undefined);
      if (req.dryRun) {
        await button.evaluate((el) => ((el as HTMLElement).style.outline = "3px solid #e11d48")).catch(() => undefined);
        return { ...info, ...none, rows, status: "ready" as const, url: page.url(), screenshot: await this.jpeg(page) };
      }

      // —— Kirim sungguhan (hanya atas permintaan pemilik ber-PIN) ——
      if (!page.url().includes(`/skp/renaksi/${req.skpExternalId}`))
        throw new Error("Robot tidak berada di halaman Rencana Aksi SKP yang diminta.");
      const before = new Set((await this.visibleDialogs(page)).map((d) => d.text));
      await button.click({ timeout: 10_000 });
      let message = "";
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(500);
        const dialogs = (await this.visibleDialogs(page)).filter((d) => !before.has(d.text));
        const result = dialogs.find((d) => submitOutcome(d.text) !== "unknown");
        if (result) {
          message = result.text;
          break;
        }
        const confirm = dialogs
          .map((d) => ({
            d,
            label: pickSubmitConfirm(
              d.text,
              d.buttons.map((b) => b.text),
            ),
          }))
          .find((x) => x.label);
        if (confirm) {
          const b = confirm.d.buttons.find((x) => x.text === confirm.label)!;
          await page.locator(`[data-akasha-send-button="${b.id}"]`).click({ timeout: 10_000 });
          before.add(confirm.d.text);
          continue;
        }
        if (dialogs.length && i >= 6) {
          // Dialog tak dikenal: jangan menebak — batalkan dan laporkan
          message = dialogs[0].text;
          await page.keyboard.press("Escape").catch(() => undefined);
          return { ...info, ...none, rows, status: "unconfirmed" as const, message, screenshot: await this.jpeg(page) };
        }
      }
      const shot = await this.jpeg(page);
      if (submitOutcome(message) === "failed") {
        return { ...info, ...none, rows, status: "failed" as const, message, screenshot: shot };
      }
      // Periksa ulang: bulan terkirim = tombol Edit/Kirim hilang / ada tanggal pengajuan
      await this.dismissInfoDialog(page);
      await this.open(page, url, hosts).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      const after = await this.renaksiBlock(page, month).catch(() => null);
      const afterStatus = after ? monthSummary(after.text, after.canFill, after.canEdit, after.rows.length) : null;
      const sent = afterStatus
        ? afterStatus.status === "submitted" || afterStatus.status === "rated"
        : submitOutcome(message) === "sent";
      return {
        ...info,
        ...none,
        rows,
        status: sent ? ("sent" as const) : ("unknown" as const),
        message: afterStatus?.submittedAt ? `${message} ${afterStatus.submittedAt}`.trim() : message,
        screenshot: (await this.jpeg(page)) ?? shot,
      };
    });
  }

  /** Buka modal "Pilih Indikator Kinerja" (tombol Isi … Bulan / Edit Rencana Aksi Kerja) dan baca pilihannya. */
  private async openIndicatorModal(page: Page, block: { canFill: boolean; canEdit: boolean }) {
    const opener = block.canFill ? "[data-akasha-renaksi=fill]" : block.canEdit ? "[data-akasha-renaksi=edit]" : null;
    if (!opener) throw new Error("Bulan ini belum bisa diisi (tombol Isi/Edit Rencana Aksi Kerja tidak ada).");
    await this.safeClick(page.locator(opener).first());
    const modal = page.locator(".modal.show, .modal.in, [role=dialog]").filter({ hasText: "Pilih Indikator Kinerja" });
    await modal.first().waitFor({ state: "visible", timeout: 15_000 });
    const options = await modal.first().evaluate((box) => {
      const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
      return Array.from(box.querySelectorAll("tbody tr")).flatMap((tr, index) => {
        const input = tr.querySelector("input[type=checkbox]") as HTMLInputElement | null;
        const cell = (tr as HTMLTableRowElement).cells[1];
        if (!input || !cell) return [];
        input.setAttribute("data-akasha-pick", String(index));
        return [{ index, text: clean(cell.innerText || cell.textContent), checked: input.checked }];
      });
    });
    return { modal: modal.first(), options: options.map((o) => ({ ...o, key: normalize(o.text) })) };
  }

  /** Centang / lepas pilihan indikator lalu Simpan; tanpa perubahan → modal ditutup tanpa menyimpan. */
  private async applyIndicatorModal(
    page: Page,
    opened: { modal: Locator; options: { index: number; key: string }[] },
    change: { check: string[]; uncheck: string[] },
  ) {
    const find = (key: string) => opened.options.find((o) => o.key === key);
    const toCheck = change.check.map(find).filter((o): o is NonNullable<typeof o> => !!o);
    const toUncheck = change.uncheck.map(find).filter((o): o is NonNullable<typeof o> => !!o);
    if (!toCheck.length && !toUncheck.length) {
      await opened.modal
        .locator("button.close, button[aria-label=Close], [data-dismiss=modal], [data-bs-dismiss=modal]")
        .first()
        .click({ timeout: 3_000 })
        .catch(() => page.keyboard.press("Escape"));
      await page.waitForTimeout(500);
      return;
    }
    for (const o of toCheck) await opened.modal.locator(`[data-akasha-pick="${o.index}"]`).check({ timeout: 5_000 });
    for (const o of toUncheck) {
      await opened.modal.locator(`[data-akasha-pick="${o.index}"]`).uncheck({ timeout: 5_000 });
    }
    await this.saveModal(page, opened.modal);
  }

  private async jpeg(page: Page) {
    return (
      (await page.screenshot({ type: "jpeg", quality: 60, fullPage: false }).catch(() => null))?.toString("base64") ??
      null
    );
  }

  /** Klik dengan pengaman: tombol kirim/ajukan/hapus tidak pernah diklik. */
  private async safeClick(locator: Locator) {
    const text = (await locator.textContent({ timeout: 10_000 })) ?? "";
    if (FORBIDDEN_BUTTON.test(text)) throw new Error(`Tombol "${text.trim()}" tidak boleh diklik robot.`);
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await locator.click({ timeout: 10_000 });
  }

  /** Simpan modal (tombol "Simpan" di dalamnya), tunggu halaman tenang, tolak bila e-Kinerja menampilkan gagal. */
  private async saveModal(page: Page, modal: Locator) {
    await this.safeClick(
      modal
        .locator("button, input[type=submit]")
        .filter({ hasText: /^\s*Simpan\s*$/ })
        .first(),
    );
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const error = await page
      .locator(".swal2-popup:visible, .swal-modal:visible")
      .filter({ hasText: /gagal|error|harus/i })
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => null);
    if (error) throw new Error(`e-Kinerja menolak: ${error.replace(/\s+/g, " ").trim().slice(0, 200)}`);
    await this.dismissInfoDialog(page);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  }

  /**
   * Tandai blok bulan di halaman (urutan dokumen: judul bulan → tabel & tombol bulan itu) lalu baca barisnya. Elemen
   * diberi penanda `data-akasha-*` agar diklik lewat locator.
   */
  private async renaksiBlock(page: Page, month: string) {
    const raw = await page.evaluate(
      ({ month, months }) => {
        const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
        document.querySelectorAll("[data-akasha-renaksi], [data-akasha-row]").forEach((el) => {
          el.removeAttribute("data-akasha-renaksi");
          el.removeAttribute("data-akasha-row");
        });
        // Nama bulan bisa berupa node teks lepas di wadah bersama ("oktober", "juli Rating Hasil Kerja : …") →
        // telusuri node (elemen + teks) sesuai urutan dokumen; teks di dalam tabel/modal bukan judul bulan
        let current = "";
        let text = "";
        let found = false;
        const tables: HTMLTableElement[] = [];
        const buttons: HTMLElement[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
          if (!parent || parent.closest(".modal, [role=dialog], script, style")) continue;
          // Halaman memuat templat tersembunyi (rating kosong, tab Perilaku) → hanya yang terlihat
          if (!parent.getClientRects().length || getComputedStyle(parent).visibility === "hidden") continue;
          if (node.nodeType === Node.TEXT_NODE) {
            if (parent.closest("table, button")) continue;
            const value = clean(node.textContent);
            if (!value) continue;
            const first = value.toLowerCase().split(" ")[0] ?? "";
            if (months.includes(first)) {
              current = first;
              if (current === month) found = true;
            }
            if (current === month) text += ` ${value}`;
            continue;
          }
          if (current !== month) continue;
          if (node instanceof HTMLTableElement) tables.push(node);
          if (
            node instanceof HTMLButtonElement ||
            (node instanceof HTMLAnchorElement && node.classList.contains("btn"))
          ) {
            buttons.push(node as HTMLElement);
          }
        }
        let canFill = false;
        let canEdit = false;
        let canSubmit = false;
        for (const b of buttons) {
          const label = clean(b.textContent);
          if (/^Isi Rencana Aksi Kerja Bulan/i.test(label) && label.toLowerCase().endsWith(month)) {
            b.setAttribute("data-akasha-renaksi", "fill");
            canFill = true;
          } else if (/^Edit Rencana Aksi Kerja/i.test(label)) {
            b.setAttribute("data-akasha-renaksi", "edit");
            canEdit = true;
          } else if (/kirim penilaia+n ke atasan/i.test(label)) {
            // Hanya ditandai; diklik semata oleh ekinerjaSubmit atas permintaan pemilik ber-PIN
            b.setAttribute("data-akasha-renaksi", "submit");
            canSubmit = true;
          }
        }
        // Sel "Rencana Aksi dan Realisasi": judul bagian (Renaksi / Realisasi / Bukti Data Dukung) lalu butir <li>;
        // struktur pembungkusnya tidak dijamin → telusuri node berurutan, teks di luar <li> yang berupa judul = bagian baru
        const sectionsOf = (cell: Element) => {
          const sections: { label: string; items: string[] }[] = [];
          const walker = document.createTreeWalker(cell, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.nodeType === Node.TEXT_NODE) {
              const value = clean(n.textContent);
              if (value && !n.parentElement?.closest("li") && /^(renaksi|realisasi|bukti)/i.test(value)) {
                sections.push({ label: value, items: [] });
              }
            } else if ((n as Element).tagName === "LI" && sections.length) {
              sections[sections.length - 1].items.push(clean((n as HTMLElement).innerText || n.textContent));
            }
          }
          return sections;
        };
        let index = 0;
        const rows: {
          index: number;
          text: string;
          sections: { label: string; items: string[] }[];
          feedback: string;
        }[] = [];
        for (const table of tables) {
          // Kolom ke-4: "Feedback" (bulan diajukan) atau "Aksi" (draf, berisi tombol isi)
          const fourth = clean(table.querySelector("thead th:nth-child(4)")?.textContent);
          const hasFeedback = /feedback/i.test(fourth);
          for (const tr of Array.from(table.querySelectorAll("tbody tr"))) {
            const cells = (tr as HTMLTableRowElement).cells;
            if (cells.length < 3) continue;
            tr.setAttribute("data-akasha-row", String(index));
            const sections = sectionsOf(cells[2]);
            // Feedback atasan: "👍" / "Belum ada feedback"
            const feedback = hasFeedback && cells[3] ? clean((cells[3] as HTMLElement).innerText) : "";
            rows.push({ index, text: clean((cells[1] as HTMLElement).innerText), sections, feedback });
            index++;
          }
        }
        return { found, text: clean(text), canFill, canEdit, canSubmit, rows };
      },
      { month, months: MONTH_NAMES },
    );
    return {
      found: raw.found,
      // Bulan yang sudah diajukan menampilkan rating di judulnya dan tidak punya tombol Isi/Edit; robot berhenti
      submitted:
        /Rating Hasil Kerja\s*:\s*[A-Z]/.test(raw.text) || (!raw.canFill && !raw.canEdit && raw.rows.length > 0),
      canFill: raw.canFill,
      canEdit: raw.canEdit,
      canSubmit: raw.canSubmit,
      text: raw.text,
      rows: raw.rows.map((r) => ({
        index: r.index,
        key: normalize(r.text),
        text: r.text,
        feedback: r.feedback,
        ...parseItems(r.sections),
      })),
    };
  }

  /**
   * SRIKANDI: baca Daftar Naskah Keluar, lalu untuk naskah yang sudah ditandatangani dan belum dikenal backend (`known` =
   * nomor naskah) buka halaman detailnya dan tangkap PDF naskah yang dimuat penampil (maks. `maxFetch`). Tidak ada
   * tombol yang diklik.
   */
  async srikandiOutgoing(target: Target & { known?: string[]; haveMain?: string[]; maxFetch?: number }) {
    return this.withPage(
      target,
      async (page, hosts, markers) => {
        const base = target.baseUrl.replace(/\/+$/, "");
        await this.open(page, `${base}/pembuatan-naskah-keluar/naskah-keluar`, hosts);
        await this.dismissInfoDialog(page);
        const info = await this.describe(page, markers);
        if (!info.loggedIn) return { ...info, letters: [] as OutgoingLetter[], files: [] as FetchedLetter[] };

        // Tabel diisi lewat API setelah halaman tampil → tunggu tautan detail / keterangan akhir data
        await page
          .waitForFunction(
            () =>
              !!document.querySelector("a[href*='naskah-keluar/detail']") ||
              /Semua data telah dimuat|Tidak ada data|Data tidak ditemukan/i.test(document.body.innerText),
            undefined,
            { timeout: 20_000 },
          )
          .catch(() => undefined);
        const rows = await page.evaluate(() =>
          [...document.querySelectorAll("table tbody tr")].map((tr) => ({
            cells: [...(tr as HTMLTableRowElement).cells].map((c) => (c as HTMLElement).innerText.trim()),
            href: (tr.querySelector("a[href*='naskah-keluar/detail']") as HTMLAnchorElement | null)?.href ?? null,
          })),
        );
        const letters = rows.map((r) => parseLetterRow(r.cells, r.href)).filter((l): l is OutgoingLetter => !!l);

        const known = new Set(target.known ?? []);
        const wanted = letters
          .filter((l) => isSigned(l.signStatus) && !known.has(l.key))
          .slice(0, target.maxFetch ?? 5);
        const files: FetchedLetter[] = [];
        const haveMain = new Set(target.haveMain ?? []);
        for (const letter of wanted) files.push(await this.capturePdf(page, letter, hosts, !haveMain.has(letter.key)));
        return { ...info, letters, files };
      },
      { downloads: true },
    );
  }

  /**
   * Buka detail naskah: PDF pertama yang dimuat penampil = naskah utama. Lampiran baru dimuat setelah "Lihat" di daftar
   * lampiran diklik → robot hanya mengklik teks persis "Lihat" pada butir yang berupa nama berkas (melihat, bukan
   * mengubah), menangkap berkas dari respons jaringan (termasuk tab baru), lalu menutup penampil dengan Esc.
   */
  private async capturePdf(
    page: Page,
    letter: OutgoingLetter,
    hosts: string[],
    withMain: boolean,
  ): Promise<FetchedLetter> {
    const context = page.context();
    const captured: { url: string; type: string; body: Buffer }[] = [];
    const seen: string[] = [];
    let pending: Promise<void>[] = [];
    const onResponse = (response: import("playwright").Response) => {
      const type = response.headers()["content-type"] ?? "";
      if (!isFileResponse(type)) return;
      const url = response.url();
      seen.push(`${type.split(";")[0]} ${url.split("?")[0].slice(0, 160)}`);
      pending.push(
        response
          .body()
          .then((body) => {
            if (body.length > 4 && body.length <= MAX_PDF_BYTES) captured.push({ url, type, body });
          })
          .catch(() => undefined),
      );
    };
    const settle = async (timeout: number) => {
      await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);
      await Promise.all(pending);
      pending = [];
    };
    // Lampiran yang dibuka di tab/iframe = unduhan di Chromium headless → tangkap juga unduhan & alamat berkas yang diminta
    const downloads: import("playwright").Download[] = [];
    const requested: string[] = [];
    const site = new URL(letter.detailUrl, page.url()).toString();
    const onDownload = (d: import("playwright").Download) => void downloads.push(d);
    const onPage = (p: Page) => void p.on("download", onDownload);
    const onRequest = (request: import("playwright").Request) => {
      const url = request.url();
      if (!sameSite(url, site)) return;
      // Berkas di host penyimpanan (mis. s3.arsip.go.id) sering tanpa ekstensi di alamatnya
      const fileHost = new URL(url).hostname !== new URL(site).hostname;
      const kind = request.resourceType();
      if (FILE_URL.test(url.split("?")[0]) || (fileHost && (kind === "document" || kind === "fetch" || kind === "xhr")))
        requested.push(url);
    };
    page.on("download", onDownload);
    context.on("page", onPage);
    context.on("request", onRequest);
    context.on("response", onResponse);
    let main: Buffer | null = null;
    const attachments: FetchedAttachment[] = [];
    try {
      await this.open(page, new URL(letter.detailUrl, page.url()).toString(), hosts);
      await settle(20_000);
      main = captured.find((c) => looksLikePdf(c.body))?.body ?? null;

      // Daftar lampiran: butir yang teksnya nama berkas (+ "Lihat")
      const items = await page.evaluate(() =>
        [...document.querySelectorAll("li")].map((li) => (li as HTMLElement).innerText.replace(/\s+/g, " ").trim()),
      );
      const names = [...new Set(items.map(attachmentName).filter((n): n is string => !!n))].slice(0, MAX_ATTACHMENTS);
      let total = 0;
      for (const name of names) {
        const before = captured.length;
        const beforeDownloads = downloads.length;
        const beforeRequests = requested.length;
        const item = page.locator("li", { hasText: name }).first();
        const view = item.getByText("Lihat", { exact: true }).first();
        if (!(await view.count())) {
          attachments.push({ name, data: null, mimeType: mimeForName(name) });
          continue;
        }
        const popup = context.waitForEvent("page", { timeout: 4_000 }).catch(() => null);
        const clicked = await view
          .click({ timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        const opened = await popup;
        if (opened) await opened.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
        await settle(30_000);
        // Tunggu sebentar bila belum ada respons / unduhan / permintaan berkas baru
        for (let i = 0; i < 20; i++) {
          if (captured.length > before || downloads.length > beforeDownloads || requested.length > beforeRequests)
            break;
          await page.waitForTimeout(500);
        }
        await Promise.all(pending);
        let body: Buffer | null =
          captured.slice(before).find((c) => validFileBody(c.body, name) && (!main || !c.body.equals(main)))?.body ??
          null;
        const download = downloads[beforeDownloads];
        if (!body && download) {
          const path = await download.path().catch(() => null);
          if (path) body = await readFile(path).catch(() => null);
          await download.delete().catch(() => undefined);
          seen.push(`unduhan ${download.suggestedFilename().slice(0, 80)}`);
        }
        if (!body) {
          for (const url of requested.slice(beforeRequests)) {
            const res = await context.request.get(url, { timeout: 60_000, maxRedirects: 3 }).catch(() => null);
            const data = res?.ok() ? await res.body().catch(() => null) : null;
            seen.push(`ambil-ulang ${res?.status() ?? "galat"} ${url.split("?")[0].slice(0, 120)}`);
            if (data && data.length <= MAX_PDF_BYTES && validFileBody(data, name)) {
              body = data;
              break;
            }
          }
        }
        if (body && !validFileBody(body, name)) body = null;
        if (body && total + body.length <= MAX_TOTAL_BYTES) {
          total += body.length;
          attachments.push({ name, data: body.toString("base64"), mimeType: mimeForName(name) });
        } else {
          seen.push(`lampiran gagal: ${name.slice(0, 80)} (klik ${clicked ? "ok" : "gagal"})`);
          attachments.push({ name, data: null, mimeType: mimeForName(name) });
        }
        if (opened) await opened.close().catch(() => undefined);
        await page.keyboard.press("Escape").catch(() => undefined);
        await page.waitForTimeout(300);
      }
    } finally {
      context.off("response", onResponse);
      context.off("request", onRequest);
      context.off("page", onPage);
      page.off("download", onDownload);
    }
    return {
      key: letter.key,
      name: letterFileName(letter),
      pdf: withMain && main ? main.toString("base64") : null,
      attachments,
      pages: seen.slice(0, 15),
    };
  }

  /**
   * SRIKANDI → Pengguna: baca tabel referensi (penandatangan, tujuan, verifikator, tembusan, grup) semua halaman. Hanya
   * tombol halaman berikutnya di navigasi tabel yang diklik — Tambah Baru / Edit / Sync / Hapus tidak pernah disentuh.
   */
  /**
   * SRIKANDI: isi formulir Registrasi Naskah Keluar dari entri Register Akasha lalu SIMPAN (draf di Log Naskah Keluar).
   * Pilihan react-select dipilih dengan mengklik opsinya (Enter di kotak cari tanpa opsi ikut mengirim formulir).
   * Draf berhal sama yang belum terkirim tidak dibuat ulang. Kirim Konsep / Kirim Naskah / TTE tidak pernah diklik.
   * `dryRun` = isi formulir lalu berhenti (tidak disimpan) untuk diperiksa.
   */
  async srikandiRegister(target: Target & { form: RegisterForm; dryRun?: boolean }) {
    return this.withPage(target, async (page, hosts, markers) => {
      const form = target.form;
      const base = target.baseUrl.replace(/\/+$/, "");
      await this.open(page, base + LOG_PATH, hosts);
      await this.dismissInfoDialog(page);
      const info = await this.describe(page, markers);
      const empty = { filled: [] as string[], draft: null as LogRow | null };
      if (!info.loggedIn) return { ...info, ...empty, status: "logged_out" as const, screenshot: null };

      const existing = findDraft(await this.readLog(page), form.subject);
      if (existing) {
        return { ...info, ...empty, draft: existing, status: "exists" as const, screenshot: await this.jpeg(page) };
      }

      await this.open(page, base + REGISTER_PATH, hosts);
      await this.dismissInfoDialog(page);
      await page.getByText("Form Registrasi Naskah Keluar").first().waitFor({ timeout: 20_000 });
      const filled: string[] = [];

      await page
        .getByRole("radio", { name: form.formType === "final" ? "Naskah Final" : "Naskah Keluar", exact: true })
        .check();
      await page.waitForTimeout(500);
      const pick = async (key: SelectKey, values: RegisterPick[]) => {
        for (const value of values) {
          await this.pickSelect(page, key, value);
          filled.push(`${SELECT_LABELS[key]}: ${value.label}`);
        }
      };
      await pick("unit", [{ label: form.unit }]);
      await pick("docType", [{ label: form.docType }]);
      await pick("nature", [{ label: form.nature }]);
      await pick("classification", [{ label: form.classification }]);

      const number = page.getByPlaceholder("Masukkan Nomor Naskah...");
      if (form.autoNumber) {
        await this.safeClick(page.getByRole("button", { name: "Ambil Nomor", exact: true }));
        await page.waitForFunction(
          () =>
            !!(document.querySelector("input[placeholder='Masukkan Nomor Naskah...']") as HTMLInputElement | null)
              ?.value,
          undefined,
          { timeout: 15_000 },
        );
      } else {
        await number.fill(form.number ?? "");
      }
      filled.push(`Nomor Naskah: ${await number.inputValue()}`);
      await page.getByPlaceholder("Masukkan Hal..").fill(form.subject);
      await page.getByPlaceholder("Masukkan Isi Ringkas..").fill(form.summary);

      const files = page.locator("input[type=file]");
      const toFile = (f: RegisterForm["file"]) => ({
        name: f.name,
        mimeType: f.mimeType,
        buffer: Buffer.from(f.data, "base64"),
      });
      await files.nth(0).setInputFiles(toFile(form.file));
      filled.push(`File naskah: ${form.file.name}`);
      if (form.attachments.length) {
        const input = files.nth(1);
        const multiple = await input.evaluate((el) => (el as HTMLInputElement).multiple);
        if (multiple) await input.setInputFiles(form.attachments.map(toFile));
        else for (const a of form.attachments) await input.setInputFiles(toFile(a));
        filled.push(`Lampiran: ${form.attachments.map((a) => a.name).join(", ")}`);
      }
      await page.waitForTimeout(800);

      await pick("recipientGroups", form.recipientGroups);
      await pick("recipients", form.recipients);
      await pick("recipientsExternal", form.recipientsExternal);
      await pick("ccGroups", form.ccGroups);
      await pick("cc", form.cc);
      await pick("ccExternal", form.ccExternal);
      if (form.formType === "keluar") {
        await pick("verifiers", form.verifiers);
        if (form.signer) await pick("signer", [form.signer]);
        await page
          .getByRole("radio", {
            name: form.signatureType === "konvensional" ? "Konvensional" : "Elektronik",
            exact: true,
          })
          .check();
        if (form.signatureType === "elektronik") {
          await page
            .getByRole("radio", { name: form.visualTte === "spesimen" ? "Spesimen Gambar" : "QR Code", exact: true })
            .check();
        }
      }

      if (target.dryRun) {
        return {
          ...info,
          filled,
          draft: null,
          status: "preview" as const,
          url: page.url(),
          screenshot: await this.fullJpeg(page),
        };
      }

      await this.safeClick(page.getByRole("button", { name: "Simpan", exact: true }));
      const popup = page.locator(".swal2-popup:visible, .swal-modal:visible").first();
      await popup.waitFor({ timeout: 30_000 });
      const message = ((await popup.textContent()) ?? "").replace(/\s+/g, " ").trim();
      if (!/berhasil/i.test(message)) throw new Error(`SRIKANDI menolak: ${message.slice(0, 300)}`);
      await this.dismissInfoDialog(page);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

      await this.open(page, base + LOG_PATH, hosts);
      const draft = findDraft(await this.readLog(page), form.subject);
      return { ...info, url: page.url(), filled, draft, status: "saved" as const, screenshot: await this.jpeg(page) };
    });
  }

  /** Pilih satu nilai pada react-select berlabel `SELECT_LABELS[key]`: ketik istilah cari → klik opsi yang cocok. */
  private async pickSelect(page: Page, key: SelectKey, value: RegisterPick) {
    const label = SELECT_LABELS[key];
    const marked = await page.evaluate(
      ({ label, key }) => {
        const clean = (t: string | null | undefined) => (t ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (clean(node.textContent) !== label || !node.parentElement) continue;
          const anchor = node.parentElement;
          const input = Array.from(document.querySelectorAll("input[role=combobox]")).find(
            (el) => anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
          );
          if (input) {
            input.setAttribute("data-akasha-select", key);
            return true;
          }
        }
        return false;
      },
      { label, key },
    );
    if (!marked) throw new Error(`Kolom "${label}" tidak ditemukan di formulir.`);
    await this.chooseOption(page, page.locator(`[data-akasha-select="${key}"]`), value, label);
  }

  /** Ketik istilah cari di react-select lalu klik opsi yang cocok (Enter tidak pernah dipakai: bisa mengirim formulir). */
  private async chooseOption(page: Page, input: Locator, value: RegisterPick, label: string) {
    await input.scrollIntoViewIfNeeded().catch(() => undefined);
    await input.click();
    await input.fill("");
    await input.pressSequentially(searchTerm(value.label), { delay: 25 });
    // Opsi dimuat dari server: tunggu sampai opsi yang cocok muncul (atau "Data tidak ditemukan")
    let index = -1;
    let texts: string[] = [];
    for (let i = 0; i < 30 && index < 0; i++) {
      await page.waitForTimeout(400);
      texts = await page
        .getByRole("option")
        .allTextContents()
        .catch(() => []);
      index = pickOption(texts, value);
      if (index < 0 && i > 8 && (await page.getByText("Data tidak ditemukan").count()) > 0) break;
    }
    if (index < 0) {
      await page.keyboard.press("Escape");
      throw new Error(`Pilihan "${value.label}" tidak ditemukan di kolom ${label}.`);
    }
    await page.getByRole("option").nth(index).click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
  }

  /**
   * SRIKANDI: perbarui konsep yang sudah didaftarkan lewat **Edit** di Log Naskah Keluar. Konsep dicari dari hal saat
   * terakhir dikirim (`findSubject`); hanya konsep yang masih punya tautan Edit (belum dikirim) yang bisa diubah. Robot
   * membaca isi halaman Edit, menyusun rencana (`planEdit`), lalu hanya mengubah yang berbeda: bagian atas → Perbarui
   * Naskah; lampiran, tujuan, verifikator, penandatangan → Tambah (modal + Simpan) dan ikon hapus baris (konfirmasi
   * "Data … akan dihapus ?" saja). `dryRun` = baca + rencana tanpa klik. Kirim Konsep tidak pernah disentuh.
   */
  async srikandiRegisterUpdate(target: Target & { form: UpdateForm; dryRun?: boolean }) {
    return this.withPage(target, async (page, hosts, markers) => {
      const form = target.form;
      const base = target.baseUrl.replace(/\/+$/, "");
      await this.open(page, base + LOG_PATH, hosts);
      await this.dismissInfoDialog(page);
      const info = await this.describe(page, markers);
      const empty = { plan: [] as string[], warnings: [] as string[], draft: null as LogRow | null };
      if (!info.loggedIn) return { ...info, ...empty, status: "logged_out" as const, screenshot: null };

      const rows = await this.readLog(page);
      const row = findEditRow(rows, form.findSubject, form.subject);
      if (!row) return { ...info, ...empty, status: "not_found" as const, screenshot: await this.jpeg(page) };
      if (!row.editHref) {
        return { ...info, ...empty, draft: row, status: "locked" as const, screenshot: await this.jpeg(page) };
      }

      await this.open(page, new URL(row.editHref, base + "/").toString(), hosts);
      await this.dismissInfoDialog(page);
      await page.getByText("Ubah Log Naskah Keluar").first().waitFor({ timeout: 20_000 });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      const before = await this.readEditState(page);
      const plan = planEdit(form, before);
      const steps = describePlan(plan);
      if (target.dryRun || planIsEmpty(plan)) {
        return {
          ...info,
          draft: row,
          plan: steps,
          warnings: plan.warnings,
          before,
          status: planIsEmpty(plan) ? ("unchanged" as const) : ("preview" as const),
          url: page.url(),
          screenshot: await this.fullJpeg(page),
        };
      }

      // 1. Bagian atas + file naskah → Perbarui Naskah
      if (plan.top.length) {
        const selects: [SelectKey, string, string][] = [
          ["unit", "Dikirimkan melalui", form.unit],
          ["docType", "Jenis Naskah", form.docType],
          ["nature", "Sifat Naskah", form.nature],
          ["classification", "Klasifikasi", form.classification],
        ];
        // Pilihan berantai: mengganti satu pilihan mengosongkan pilihan di bawahnya (Sifat → Klasifikasi & Nomor), jadi
        // mulai dari pilihan pertama yang berubah semua pilihan sesudahnya dipilih ulang berurutan
        const first = selects.findIndex(([, label]) => plan.top.includes(label));
        if (first >= 0)
          for (const [key, , value] of selects.slice(first)) await this.pickSelect(page, key, { label: value });
        // Tanpa nomor, Perbarui Naskah ditolak diam-diam → isi ulang
        const number = page.getByPlaceholder("Masukkan Nomor Naskah...");
        if (plan.top.includes("Nomor Naskah") || !(await number.inputValue()).trim()) {
          if (form.autoNumber) {
            await this.safeClick(page.getByRole("button", { name: "Ambil Nomor", exact: true }));
            const failure = page.locator(".swal2-popup:visible, [role=dialog]:visible").filter({ hasText: /gagal/i });
            for (let i = 0; i < 30 && !(await number.inputValue()).trim(); i++) {
              if (await failure.count()) {
                const text = ((await failure.first().textContent()) ?? "").replace(/\s+/g, " ").trim();
                throw new Error(`Ambil Nomor ditolak SRIKANDI: ${text.slice(0, 250)}`);
              }
              await page.waitForTimeout(500);
            }
            if (!(await number.inputValue()).trim()) throw new Error("Ambil Nomor tidak mengisi nomor naskah.");
          } else await number.fill(form.number ?? "");
        }
        if (plan.top.includes("Hal")) await page.getByPlaceholder(/^Masukkan Hal/).fill(form.subject);
        if (plan.top.includes("Isi Ringkas")) await page.getByPlaceholder(/^Masukkan Isi Ringkas/).fill(form.summary);
        if (plan.top.includes("Tipe Tanda Tangan")) {
          await page
            .getByRole("radio", {
              name: form.signatureType === "konvensional" ? "Konvensional" : "Elektronik",
              exact: true,
            })
            .check();
        }
        if (plan.top.includes("Visual TTE")) {
          await page
            .getByRole("radio", { name: form.visualTte === "spesimen" ? "Spesimen Gambar" : "QR Code", exact: true })
            .check();
        }
        if (plan.replaceFile && form.file) {
          await page
            .locator("input[type=file]")
            .first()
            .setInputFiles({
              name: form.file.name,
              mimeType: form.file.mimeType,
              buffer: Buffer.from(form.file.data, "base64"),
            });
          await page.waitForTimeout(800);
        }
        await this.safeClick(page.getByRole("button", { name: "Perbarui Naskah", exact: true }));
        await this.expectSuccess(page);
        // Perbarui Naskah kembali ke Log ("Berhasil — Update Naskah Keluar"): buka lagi Edit dengan hal terbaru
        if (!page.url().includes(EDIT_MARKER)) await this.openEditPage(page, base, hosts, form.subject);
      }

      // 2. Tabel: tambah dulu, hapus kemudian (daftar verifikator/penandatangan tidak pernah kosong di tengah proses).
      // Simpan di tabel bisa memuat ulang / berpindah halaman → pastikan berada di halaman Edit sebelum tiap langkah.
      const onEdit = async () => {
        const here = page.url().includes(EDIT_MARKER) && (await page.getByText("Ubah Log Naskah Keluar").count()) > 0;
        if (!here) await this.openEditPage(page, base, hosts, form.subject);
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      };
      for (const file of plan.attachmentsAdd) {
        await onEdit();
        const modal = await this.openAddModal(page, "Lampiran");
        await modal
          .locator("input[type=file]")
          .first()
          .setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.data, "base64") });
        await page.waitForTimeout(600);
        await this.saveEditModal(page, modal);
      }
      for (const r of plan.recipientsAdd) {
        await onEdit();
        const modal = await this.openAddModal(page, "Tujuan", recipientMenu(r.slot));
        await this.chooseInModal(page, modal, r.pick);
        await this.saveEditModal(page, modal);
      }
      for (const v of plan.verifiersAdd) {
        await onEdit();
        const modal = await this.openAddModal(page, "Daftar Verifikator");
        await this.chooseInModal(page, modal, v);
        await this.saveEditModal(page, modal);
      }
      if (plan.signerAdd) {
        await onEdit();
        const modal = await this.openAddModal(page, "Daftar Penandatangan");
        await this.chooseInModal(page, modal, plan.signerAdd);
        await this.saveEditModal(page, modal);
      }
      const removals: [string, string[], number][] = [
        ["Lampiran", plan.attachmentsRemove, 0],
        ["Tujuan", plan.recipientsRemove, 0],
        ["Daftar Verifikator", plan.verifiersRemove, 1],
        ["Daftar Penandatangan", plan.signersRemove, 1],
      ];
      for (const [heading, names, column] of removals) {
        for (const name of names) {
          await onEdit();
          await this.removeEditRow(page, heading, name, column);
        }
      }

      await this.openEditPage(page, base, hosts, form.subject);
      const after = await this.readEditState(page);
      const rest = describePlan(planEdit({ ...form, file: undefined }, after));
      return {
        ...info,
        draft: row,
        plan: steps,
        warnings: plan.warnings,
        remaining: rest,
        before,
        after,
        status: "updated" as const,
        url: page.url(),
        screenshot: await this.fullJpeg(page),
      };
    });
  }

  /** Baca isi halaman Edit konsep (bagian atas + empat tabel). */
  private async readEditState(page: Page): Promise<EditState> {
    const raw = await page.evaluate(() => {
      const clean = (t: string | null | undefined) => (t ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
      const textNodes = () => {
        const out: Text[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) if (clean(node.textContent)) out.push(node as Text);
        return out;
      };
      const nodes = textNodes();
      const labelNode = (label: string) => nodes.find((n) => clean(n.textContent) === label) ?? null;
      const selectValue = (label: string) => {
        const anchor = labelNode(label)?.parentElement;
        if (!anchor) return "";
        const input = Array.from(document.querySelectorAll("input[role=combobox]")).find(
          (el) => anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
        let box: Element | null = input ?? null;
        for (let i = 0; i < 6 && box; i++) {
          const single = box.querySelector("[class*=singleValue]");
          if (single) return clean(single.textContent);
          box = box.parentElement;
        }
        return "";
      };
      const fileName = (() => {
        const start = nodes.findIndex((n) => clean(n.textContent) === "File naskah");
        if (start < 0) return "";
        const next = nodes[start + 1];
        const text = next ? clean(next.textContent) : "";
        return /^Format yang didukung/i.test(text) ? "" : text;
      })();
      const table = (heading: string) => {
        const h = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).find(
          (el) => clean(el.textContent) === heading,
        );
        let box: Element | null = h ?? null;
        while (box && !box.querySelector("table")) box = box.parentElement;
        const t = box?.querySelector("table");
        if (!t) return [] as string[][];
        return Array.from(t.querySelectorAll("tbody tr"))
          .filter((tr) => !tr.querySelector("input"))
          .map((tr) => Array.from((tr as HTMLTableRowElement).cells).map((c) => clean(c.textContent)))
          .filter((cells) => cells.length > 1 && cells.some((c) => c));
      };
      const value = (sel: string) => ((document.querySelector(sel) as HTMLInputElement | null)?.value ?? "").trim();
      return {
        unit: selectValue("Dikirimkan melalui"),
        docType: selectValue("Jenis Naskah"),
        nature: selectValue("Sifat Naskah"),
        classification: selectValue("Klasifikasi"),
        number: value("input[placeholder^='Masukkan Nomor Naskah']"),
        subject: value("textarea[placeholder^='Masukkan Hal'], input[placeholder^='Masukkan Hal']"),
        summary: value("textarea[placeholder^='Masukkan Isi Ringkas'], input[placeholder^='Masukkan Isi Ringkas']"),
        fileName,
        attachments: table("Lampiran").map((c) => c[0]),
        recipients: table("Tujuan").map((c) => ({ name: c[0], kind: c[1] ?? "" })),
        verifiers: table("Daftar Verifikator").map((c) => c[1] ?? ""),
        signers: table("Daftar Penandatangan").map((c) => c[1] ?? ""),
      };
    });
    const checked = async (name: string) =>
      page
        .getByRole("radio", { name, exact: true })
        .isChecked({ timeout: 2_000 })
        .catch(() => false);
    return {
      ...raw,
      signatureType: (await checked("Konvensional"))
        ? "konvensional"
        : (await checked("Elektronik"))
          ? "elektronik"
          : "",
      visualTte: (await checked("Spesimen Gambar")) ? "spesimen" : (await checked("QR Code")) ? "qr" : "",
    };
  }

  /** Bagian tabel halaman Edit (kartu yang memuat judul + tabelnya). */
  private editSection(page: Page, heading: string) {
    return page.getByRole("heading", { name: heading, exact: true }).locator("xpath=ancestor::*[.//table][1]");
  }

  /** Klik Tambah di satu bagian (Tujuan: lewat menu induk → anak), lalu kembalikan modal yang terbuka. */
  private async openAddModal(page: Page, heading: string, menu?: { parent: string; child: string }) {
    const section = this.editSection(page, heading);
    await this.safeClick(section.getByRole("button", { name: "Tambah" }).first());
    if (menu) {
      const items = page.getByRole("menuitem");
      await items.first().waitFor({ timeout: 10_000 });
      // Item anak muncul di bawah induknya; buka induk bila anaknya belum terlihat
      const names = (await items.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
      const parentAt = names.indexOf(menu.parent);
      const childAfter = names.findIndex((n, i) => i > parentAt && n === menu.child);
      const nextParent = names.findIndex((n, i) => i > parentAt && (n === "Tujuan Utama" || n === "Tembusan"));
      if (childAfter < 0 || (nextParent >= 0 && childAfter > nextParent)) {
        await items.nth(parentAt).click();
        await page.waitForTimeout(400);
      }
      const fresh = (await items.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
      const p = fresh.indexOf(menu.parent);
      const c = fresh.findIndex((n, i) => i > p && n === menu.child);
      if (p < 0 || c < 0) throw new Error(`Menu "${menu.parent} → ${menu.child}" tidak ditemukan.`);
      await items.nth(c).click();
    }
    // Modal SRIKANDI bukan role=dialog: tandai wadah terdekat judul "… Baru" yang memuat tombol Simpan
    await page.waitForTimeout(600);
    const marked = await page.evaluate(() => {
      const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      document
        .querySelectorAll("[data-akasha-edit-modal]")
        .forEach((el) => el.removeAttribute("data-akasha-edit-modal"));
      const titles = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span,p"))
        .filter((el) => visible(el) && el.children.length <= 2 && /baru$/i.test(clean(el.textContent)))
        .reverse();
      for (const title of titles) {
        let box: Element | null = title.parentElement;
        for (let i = 0; i < 8 && box; i++, box = box.parentElement) {
          const hasSave = Array.from(box.querySelectorAll("button")).some((b) =>
            /^simpan$/i.test(clean(b.textContent)),
          );
          if (hasSave) {
            box.setAttribute("data-akasha-edit-modal", "1");
            return clean(title.textContent);
          }
        }
      }
      return null;
    });
    if (!marked) throw new Error(`Modal Tambah di bagian ${heading} tidak terbuka.`);
    return page.locator("[data-akasha-edit-modal]");
  }

  /** Pilih nilai react-select di dalam modal Tambah. */
  private async chooseInModal(page: Page, modal: Locator, value: RegisterPick) {
    const input = modal.locator("input[role=combobox]").first();
    if ((await input.count()) === 0) {
      // Eksternal non SRIKANDI bisa berupa kotak teks biasa
      await modal.locator("input[type=text], textarea").first().fill(value.label);
      return;
    }
    await this.chooseOption(page, input, value, "modal Tambah");
  }

  /** Simpan modal Tambah lalu pastikan SRIKANDI menyatakan berhasil. */
  private async saveEditModal(page: Page, modal: Locator) {
    await this.safeClick(modal.getByRole("button", { name: /^simpan$/i }).first());
    await this.expectSuccess(page);
  }

  /** Tunggu pesan SRIKANDI setelah menyimpan: selain "berhasil" = galat. Lalu tutup pesannya. */
  private async expectSuccess(page: Page) {
    const popup = page
      .locator(".swal2-popup:visible, .swal-modal:visible, [role=dialog]:visible, [role=alertdialog]:visible")
      .filter({ hasText: /berhasil|sukses|gagal|galat|error|wajib|harus|akan dihapus/i })
      .first();
    let message = "";
    // Popup konfirmasi sebelumnya bisa masih terlihat sesaat: tunggu pesan hasil
    for (let i = 0; i < 60; i++) {
      try {
        await popup.waitFor({ timeout: 30_000 });
      } catch {
        throw new Error(
          `SRIKANDI tidak menampilkan pesan hasil (${page.url()}). ${await this.visibleErrors(page)}`.trim(),
        );
      }
      message = ((await popup.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
      if (message && !/akan dihapus/i.test(message)) break;
      await page.waitForTimeout(500);
    }
    if (!/berhasil|sukses/i.test(message)) throw new Error(`SRIKANDI menolak: ${message.slice(0, 300)}`);
    await this.dismissInfoDialog(page);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }

  /** Pesan validasi yang terlihat di halaman (untuk galat yang bisa dibaca bila SRIKANDI tidak menyimpan). */
  private async visibleErrors(page: Page) {
    const texts = await page
      .evaluate(() => {
        const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
        return Array.from(
          document.querySelectorAll(
            ".invalid-feedback, .text-danger, [class*=error], [class*=Error], [role=alert], .Toastify__toast, .toast",
          ),
        )
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => clean(el.textContent))
          .filter((t) => t && t.length < 300);
      })
      .catch(() => [] as string[]);
    return texts.length ? `Pesan di halaman: ${[...new Set(texts)].slice(0, 5).join(" | ")}` : "";
  }

  /** Buka halaman Edit konsep berhal `subject` dari Log (tautan Edit terenkripsi berganti setiap muat). */
  private async openEditPage(page: Page, base: string, hosts: string[], subject: string) {
    await this.open(page, base + LOG_PATH, hosts);
    await this.dismissInfoDialog(page);
    const want = normalizeOption(subject);
    const row = (await this.readLog(page)).find((r) => normalizeOption(r.subject) === want && r.editHref);
    if (!row?.editHref) throw new Error(`Konsep "${subject}" tidak lagi bisa diubah di Log Naskah Keluar.`);
    await this.open(page, new URL(row.editHref, base + "/").toString(), hosts);
    await this.dismissInfoDialog(page);
    await page.getByText("Ubah Log Naskah Keluar").first().waitFor({ timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  }

  /**
   * Hapus satu baris tabel halaman Edit. Satu-satunya tempat robot mengklik "Hapus": konfirmasi harus berbunyi
   * "Data <nama> akan dihapus ?" di halaman Edit (`isRowRemovalConfirm`) — hapus konsep dari Log tidak pernah.
   */
  private async removeEditRow(page: Page, heading: string, name: string, column: number) {
    const section = this.editSection(page, heading);
    const rows = section.locator("tbody tr");
    const want = normalizeOption(name);
    let target: Locator | null = null;
    // Tabel dimuat terpisah dari halaman: tunggu barisnya muncul (maks. ± 10 dtk)
    for (let attempt = 0; attempt < 20 && !target; attempt++) {
      if (attempt) await page.waitForTimeout(500);
      const count = await rows.count();
      for (let i = 0; i < count; i++) {
        const cell =
          (await rows
            .nth(i)
            .locator("td")
            .nth(column)
            .textContent()
            .catch(() => "")) ?? "";
        if (normalizeOption(cell) === want) {
          target = rows.nth(i);
          break;
        }
      }
    }
    if (!target) throw new Error(`Baris "${name}" di bagian ${heading} tidak ditemukan.`);
    const icon = target.locator("td").last().locator("img[alt='Hapus'], img, svg, button").first();
    await icon.scrollIntoViewIfNeeded().catch(() => undefined);
    await icon.click({ timeout: 10_000 });
    const popup = page.locator(".swal2-popup:visible, .swal-modal:visible").first();
    await popup.waitFor({ timeout: 10_000 });
    const body = popup.locator(".swal2-html-container, .swal2-content, .swal-text").first();
    const message = (((await body.count()) ? await body.textContent() : await popup.textContent()) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!isRowRemovalConfirm(page.url(), message)) {
      await popup
        .getByRole("button", { name: /batal/i })
        .first()
        .click()
        .catch(() => undefined);
      throw new Error(`Konfirmasi tak dikenal, dibatalkan: ${message.slice(0, 200)}`);
    }
    await popup
      .getByRole("button", { name: /^hapus$/i })
      .first()
      .click({ timeout: 10_000 });
    await this.expectSuccess(page);
  }

  /**
   * SRIKANDI: **Kirim Konsep** satu konsep di Log Naskah Keluar (naskah sampai ke verifikator). Hanya dipanggil backend
   * setelah pemilik memasukkan PIN. Konsep dicari dari hal (+ nomor) → halaman Detail → dipastikan masih "Naskah ini belum
   * dikirim" dan halnya sama → `dryRun` (bawaan) berhenti di sini dengan tangkapan layar dan menandai tombol yang akan
   * diklik. Tanpa `dryRun`: klik tombol "Kirim Konsep" (satu-satunya tombol kirim yang boleh diklik robot, hanya di halaman
   * Detail Log), setujui dialog hanya bila jelas tentang pengiriman (`pickSendConfirm`), lalu periksa ulang halaman detail.
   */
  async srikandiSendDraft(target: Target & { request: SendRequest }) {
    return this.withPage(target, async (page, hosts, markers) => {
      const req = target.request;
      const base = target.baseUrl.replace(/\/+$/, "");
      await this.open(page, base + LOG_PATH, hosts);
      await this.dismissInfoDialog(page);
      const info = await this.describe(page, markers);
      const none = { draft: null as LogRow | null, detail: null as { subject: string; number: string } | null };
      if (!info.loggedIn) return { ...info, ...none, status: "logged_out" as const, message: "", screenshot: null };

      const row = findSendRow(await this.readLog(page), req);
      if (!row)
        return { ...info, ...none, status: "not_found" as const, message: "", screenshot: await this.jpeg(page) };
      if (!row.editHref || /terkirim/i.test(row.sendStatus) || !row.detailId) {
        return {
          ...info,
          ...none,
          draft: row,
          status: "already_sent" as const,
          message: "",
          screenshot: await this.jpeg(page),
        };
      }

      const detailUrl = `${base}${LOG_PATH}/detail?id=${encodeURIComponent(row.detailId)}`;
      await this.open(page, detailUrl, hosts);
      await this.dismissInfoDialog(page);
      await page.getByText("Detail Log Naskah Keluar").first().waitFor({ timeout: 20_000 });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      const detail = await this.readSendDetail(page);
      const button = page.getByRole("button", { name: SEND_BUTTON }).first();
      const visible = await button.isVisible().catch(() => false);
      const enabled = visible && (await button.isEnabled().catch(() => false));
      if (!detailMatches(detail, req)) {
        return {
          ...info,
          draft: row,
          detail,
          status: "mismatch" as const,
          message: "",
          screenshot: await this.fullJpeg(page),
        };
      }
      if (!detail.unsent || !visible) {
        return {
          ...info,
          draft: row,
          detail,
          status: "already_sent" as const,
          message: "",
          screenshot: await this.fullJpeg(page),
        };
      }
      if (!enabled) {
        return {
          ...info,
          draft: row,
          detail,
          status: "not_ready" as const,
          message: "Tombol Kirim Konsep tidak aktif.",
          screenshot: await this.fullJpeg(page),
        };
      }
      if (req.dryRun) {
        // Tandai tombol yang akan diklik (garis merah di tangkapan layar) tanpa mengkliknya
        await button.evaluate((el) => ((el as HTMLElement).style.outline = "3px solid #e11d48")).catch(() => undefined);
        return {
          ...info,
          draft: row,
          detail,
          status: "ready" as const,
          message: "",
          url: page.url(),
          screenshot: await this.fullJpeg(page),
        };
      }

      // —— Kirim sungguhan (hanya atas permintaan pemilik ber-PIN) ——
      if (!page.url().includes(DETAIL_PATH_MARK))
        throw new Error("Robot tidak berada di halaman Detail Log Naskah Keluar.");
      const before = new Set((await this.visibleDialogs(page)).map((d) => d.text));
      await button.click({ timeout: 10_000 });
      let message = "";
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(500);
        const dialogs = (await this.visibleDialogs(page)).filter((d) => !before.has(d.text));
        const result = dialogs.find((d) => sendOutcome(d.text) !== "unknown");
        if (result) {
          message = result.text;
          break;
        }
        const confirm = dialogs
          .map((d) => ({
            d,
            label: pickSendConfirm(
              d.text,
              d.buttons.map((b) => b.text),
            ),
          }))
          .find((x) => x.label);
        if (confirm) {
          const b = confirm.d.buttons.find((x) => x.text === confirm.label)!;
          await page.locator(`[data-akasha-send-button="${b.id}"]`).click({ timeout: 10_000 });
          before.add(confirm.d.text);
          continue;
        }
        if (dialogs.length && i >= 6) {
          // Dialog tak dikenal: jangan menebak — batalkan dan laporkan
          message = dialogs[0].text;
          await page.keyboard.press("Escape").catch(() => undefined);
          return {
            ...info,
            draft: row,
            detail,
            status: "unconfirmed" as const,
            message,
            screenshot: await this.fullJpeg(page),
          };
        }
      }
      const shot = await this.fullJpeg(page);
      if (sendOutcome(message) === "failed") {
        return { ...info, draft: row, detail, status: "failed" as const, message, screenshot: shot };
      }
      // Periksa ulang: konsep terkirim = halaman detail tidak lagi "belum dikirim"
      await this.dismissInfoDialog(page);
      await this.open(page, detailUrl, hosts).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      const after = await this.readSendDetail(page).catch(() => null);
      const sent = after ? !after.unsent : sendOutcome(message) === "sent";
      return {
        ...info,
        draft: row,
        detail,
        status: sent ? ("sent" as const) : ("unknown" as const),
        message,
        screenshot: (await this.fullJpeg(page)) ?? shot,
      };
    });
  }

  /** Isi ringkas halaman Detail Log Naskah Keluar: hal, nomor, dan apakah masih "Naskah ini belum dikirim". */
  private async readSendDetail(page: Page) {
    const text = await page.evaluate(() => document.body.innerText.replace(/\r/g, ""));
    const after = (label: string) => {
      const lines = text.split("\n").map((l) => l.trim());
      const i = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
      return i >= 0 ? (lines.slice(i + 1).find((l) => l) ?? "") : "";
    };
    return { subject: after("Hal"), number: after("Nomor Naskah"), unsent: UNSENT_MARK.test(text) };
  }

  /** Dialog yang terlihat + tombolnya (ditandai `data-akasha-send-button` agar bisa diklik tepat). */
  private async visibleDialogs(page: Page) {
    return page
      .evaluate(() => {
        const visible = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
        };
        const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
        return Array.from(
          document.querySelectorAll(
            ".swal2-popup, .swal-modal, [role=dialog], [role=alertdialog], .modal.show, .modal.in, .bootbox, .Toastify__toast",
          ),
        )
          .filter(visible)
          .map((box, d) => ({
            text: clean(box.textContent).slice(0, 400),
            buttons: Array.from(box.querySelectorAll("button, a.btn, input[type=button], input[type=submit]"))
              .filter(visible)
              .map((el, index) => {
                const id = `${d}-${index}`;
                el.setAttribute("data-akasha-send-button", id);
                return { id, text: clean((el as HTMLInputElement).value || el.textContent) };
              }),
          }))
          .filter((d) => d.text);
      })
      .catch(() => [] as { text: string; buttons: { id: string; text: string }[] }[]);
  }

  /** Baca baris halaman pertama Log Naskah Keluar (kolom dikenali dari judulnya). */
  private async readLog(page: Page): Promise<LogRow[]> {
    await page
      .getByText("Daftar Log Naskah Keluar")
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    const rows = await page.evaluate(() => {
      const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
      const table = document.querySelector("table");
      if (!table) return [];
      const headers = Array.from(table.querySelectorAll("thead th")).map((th) => clean(th.textContent).toLowerCase());
      const col = (name: string) => headers.indexOf(name);
      const [number, subject, send] = [col("nomor naskah"), col("hal"), col("status kirim")];
      return Array.from(table.querySelectorAll("tbody tr")).flatMap((tr) => {
        const cells = Array.from((tr as HTMLTableRowElement).cells).map((c) => clean(c.textContent));
        const link = tr.querySelector("a[href*='detail?id=']")?.getAttribute("href") ?? null;
        const edit = tr.querySelector("a[href*='formode=Ubah']")?.getAttribute("href") ?? null;
        if (!link || subject < 0) return [];
        return [
          { number: cells[number] ?? "", subject: cells[subject] ?? "", sendStatus: cells[send] ?? "", link, edit },
        ];
      });
    });
    return rows.map(({ link, edit, ...r }) => ({ ...r, detailId: detailIdOf(link), editHref: edit }));
  }

  private async fullJpeg(page: Page) {
    return (
      (await page.screenshot({ type: "jpeg", quality: 55, fullPage: true }).catch(() => null))?.toString("base64") ??
      null
    );
  }

  /**
   * SRIKANDI → Naskah Masuk: baca halaman daftar Naskah Masuk, Tembusan, Disposisi, Koordinasi, Arahan (semua halaman).
   * Hanya membaca daftar — detail naskah tidak pernah dibuka (bisa mengubah Status Baca), tombol yang diklik hanya
   * Hitung Total dan halaman berikutnya.
   */
  async srikandiInbox(target: Target & { kinds?: InboxKind[] }) {
    return this.withPage(target, async (page, hosts, markers) => {
      const base = target.baseUrl.replace(/\/+$/, "");
      const result: { kind: InboxKind; items: InboxItem[]; pages: number; total: number | null }[] = [];
      let info = await this.describe(page, markers);
      const wanted = target.kinds ?? INBOX_PAGES.map((p) => p.kind);
      for (const inbox of INBOX_PAGES.filter((p) => wanted.includes(p.kind))) {
        await this.open(page, `${base}${inbox.path}`, hosts);
        await this.dismissInfoDialog(page);
        info = await this.describe(page, markers);
        if (!info.loggedIn) return { ...info, inbox: result };
        const read = await this.readTablePages(page, MAX_INBOX_PAGES);
        // SRIKANDI baru mengalihkan ke /auth/login setelah memuat data → periksa ulang
        info = await this.describe(page, markers);
        if (!info.loggedIn) return { ...info, inbox: result };
        const items = mergeInboxItems(read.pages.map((t) => parseInboxRows(inbox.kind, t.headers, t.rows)));
        result.push({ kind: inbox.kind, items, pages: read.pages.length, total: read.total });
      }
      return { ...info, inbox: result };
    });
  }

  /**
   * Baca tabel pertama halaman ini, semua halaman: tunggu data, klik Hitung Total (pembanding), lalu tombol halaman
   * berikutnya sampai isi tidak berganti / tombol nonaktif / batas halaman.
   */
  private async readTablePages(page: Page, maxPages: number) {
    await page
      .waitForFunction(
        () =>
          document.querySelectorAll("table tbody tr").length > 1 ||
          /Tidak ada data|Data tidak ditemukan|Belum ada data/i.test(document.body.innerText),
        undefined,
        { timeout: 20_000 },
      )
      .catch(() => undefined);
    let total: number | null = null;
    const counter = page.getByRole("button", { name: /Hitung Total/i }).first();
    if (await counter.count()) {
      await counter.click({ timeout: 10_000 }).catch(() => undefined);
      await page
        .waitForFunction(() => !/Mohon Tunggu/i.test(document.body.innerText), undefined, { timeout: 45_000 })
        .catch(() => undefined);
      const nav = page.locator("nav[aria-label='Table navigation']");
      total = parseTotal(await nav.innerText().catch(() => ""));
    }
    const pages: { headers: string[]; rows: string[][] }[] = [];
    for (let i = 0; i < maxPages; i++) {
      const table = await page.evaluate(() => {
        const el = document.querySelector("table");
        if (!el) return null;
        const headers = [...el.querySelectorAll("thead th, tr:first-child th")].map(
          (th) => (th as HTMLElement).innerText,
        );
        const rows = [...el.querySelectorAll("tbody tr")].map((tr) =>
          [...(tr as HTMLTableRowElement).cells].map((c) => (c as HTMLElement).innerText),
        );
        return {
          headers: [...new Set(headers)],
          rows,
          signature: (el.querySelector("tbody") as HTMLElement)?.innerText ?? "",
        };
      });
      if (!table) break;
      pages.push({ headers: table.headers, rows: table.rows });
      if (/Tidak ada data|Data tidak ditemukan/i.test(table.signature)) break;
      const next = page
        .locator("nav[aria-label='Table navigation'] button")
        .filter({ hasNotText: /Hitung Total/i })
        .last();
      if (!(await next.count())) break;
      let enabled = false;
      for (let j = 0; j < 20 && !enabled; j++) {
        enabled = !(await next.isDisabled().catch(() => true));
        if (!enabled) await page.waitForTimeout(500);
      }
      if (!enabled) break;
      await next.click({ timeout: 10_000 }).catch(() => undefined);
      const changed = await page
        .waitForFunction(
          (old) => {
            const text = (document.querySelector("table tbody") as HTMLElement | null)?.innerText ?? "";
            return text !== old && !/memuat|loading/i.test(text);
          },
          table.signature,
          { timeout: 15_000 },
        )
        .then(() => true)
        .catch(() => false);
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      if (!changed) break;
    }
    return { pages, total };
  }

  async srikandiReferences(target: Target & { categories?: ReferenceCategory[] }) {
    return this.withPage(target, async (page, hosts, markers) => {
      const base = target.baseUrl.replace(/\/+$/, "");
      const result: {
        category: ReferenceCategory;
        items: ReferenceItem[];
        pages: number;
        total: number | null;
        nav: string;
      }[] = [];
      let info = await this.describe(page, markers);
      const wanted = target.categories ?? DEFAULT_REFERENCE_CATEGORIES;
      for (const ref of REFERENCE_PAGES.filter((p) => wanted.includes(p.category))) {
        if (ref.category === "sender_unit") {
          const units = await this.readSenderUnits(page, `${base}${ref.path}`, hosts, markers);
          info = units.info;
          if (!info.loggedIn) return { ...info, references: result };
          result.push({ category: ref.category, items: units.items, pages: units.steps, total: null, nav: units.note });
          continue;
        }
        await this.open(page, `${base}${ref.path}`, hosts);
        await this.dismissInfoDialog(page);
        info = await this.describe(page, markers);
        if (!info.loggedIn) return { ...info, references: result };
        await page
          .waitForFunction(
            () =>
              document.querySelectorAll("table tbody tr").length > 1 ||
              /Tidak ada data|Data tidak ditemukan|Belum ada data/i.test(document.body.innerText),
            undefined,
            { timeout: 20_000 },
          )
          .catch(() => undefined);
        // Token kedaluwarsa: aplikasi SRIKANDI baru mengalihkan ke /auth/login setelah memuat data → periksa ulang
        info = await this.describe(page, markers);
        if (!info.loggedIn) return { ...info, references: result };
        // "Hitung Total" hanya menghitung jumlah data (tidak mengubah apa pun) → pembanding kelengkapan
        const nav = page.locator("nav[aria-label='Table navigation']");
        const counter = nav.getByRole("button", { name: /Hitung Total/i });
        let total: number | null = null;
        if (await counter.count()) {
          await counter.click({ timeout: 10_000 }).catch(() => undefined);
          // Selama menghitung SRIKANDI menampilkan "Mohon Tunggu" dan menonaktifkan tombol halaman
          await page
            .waitForFunction(
              () =>
                !/Mohon Tunggu/i.test(
                  (document.querySelector("nav[aria-label='Table navigation']") as HTMLElement | null)?.innerText ?? "",
                ),
              undefined,
              { timeout: 45_000 },
            )
            .catch(() => undefined);
          total = parseTotal(await nav.innerText().catch(() => ""));
        }
        const navHtml = (await nav.innerHTML().catch(() => "")).replace(/\s+/g, " ").slice(0, 1500);
        const collected: ReferenceItem[][] = [];
        let pages = 0;
        let unique = 0;
        let idle = 0;
        for (; pages < maxReferencePages(ref.category); pages++) {
          const table = await page.evaluate(() => {
            const el = document.querySelector("table");
            if (!el) return null;
            const headers = [...el.querySelectorAll("thead th, tr:first-child th")].map(
              (th) => (th as HTMLElement).innerText,
            );
            const rows = [...el.querySelectorAll("tbody tr")].map((tr) =>
              [...(tr as HTMLTableRowElement).cells].map((c) => (c as HTMLElement).innerText),
            );
            return {
              headers: [...new Set(headers)],
              rows,
              signature: (el.querySelector("tbody") as HTMLElement)?.innerText ?? "",
            };
          });
          if (!table) break;
          collected.push(parseReferenceRows(ref.category, table.headers, table.rows));
          // Berhenti bila semua data sudah terbaca (sesuai Hitung Total) atau 2 halaman berturut-turut tidak menambah data
          const now = mergeReferenceItems(collected).length;
          idle = now > unique ? 0 : idle + 1;
          unique = now;
          if ((total !== null && unique >= total) || idle >= 2) break;
          // Tombol halaman berikutnya = tombol terakhir di navigasi tabel selain "Hitung Total"
          const next = page
            .locator("nav[aria-label='Table navigation'] button")
            .filter({ hasNotText: /Hitung Total/i })
            .last();
          if (!(await next.count())) break;
          // Tombol halaman dinonaktifkan sementara saat memuat → tunggu aktif (tetap nonaktif = halaman terakhir)
          let enabled = false;
          for (let i = 0; i < 30 && !enabled; i++) {
            enabled = !(await next.isDisabled().catch(() => true));
            if (!enabled) await page.waitForTimeout(500);
          }
          if (!enabled) break;
          await next.click({ timeout: 10_000 }).catch(() => undefined);
          // Tunggu isi tabel berganti dan selesai dimuat (bukan baris "memuat")
          const changed = await page
            .waitForFunction(
              (old) => {
                const text = (document.querySelector("table tbody") as HTMLElement | null)?.innerText ?? "";
                return (
                  text !== old &&
                  !/memuat|loading/i.test(text) &&
                  document.querySelectorAll("table tbody tr").length > 1
                );
              },
              table.signature,
              { timeout: 15_000 },
            )
            .then(() => true)
            .catch(() => false);
          await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
          if (!changed) break;
          if (total !== null && mergeReferenceItems(collected).length >= total) break;
        }
        // Halaman terakhir yang baru dimuat ikut dibaca
        const last = await page.evaluate(() => {
          const el = document.querySelector("table");
          if (!el) return null;
          const headers = [...el.querySelectorAll("thead th, tr:first-child th")].map(
            (th) => (th as HTMLElement).innerText,
          );
          const rows = [...el.querySelectorAll("tbody tr")].map((tr) =>
            [...(tr as HTMLTableRowElement).cells].map((c) => (c as HTMLElement).innerText),
          );
          return { headers: [...new Set(headers)], rows };
        });
        if (last) collected.push(parseReferenceRows(ref.category, last.headers, last.rows));
        result.push({
          category: ref.category,
          items: mergeReferenceItems(collected),
          pages: collected.length,
          total,
          nav: navHtml,
        });
      }
      return { ...info, references: result };
    });
  }

  /**
   * Instansi Pengirim: buka formulir Registrasi Naskah Keluar, klik kolom "Dikirimkan melalui" (tanpa mengetik), lalu gulir
   * daftar pilihan sampai habis (pilihan dimuat bertahap saat digulir). Formulir tidak pernah diisi / disimpan: tidak ada
   * pilihan yang diklik, Enter tidak pernah ditekan, daftar ditutup dengan Esc.
   */
  private async readSenderUnits(page: Page, url: string, hosts: string[], markers: string[]) {
    await this.open(page, url, hosts);
    await this.dismissInfoDialog(page);
    let info = await this.describe(page, markers);
    const empty = { items: [] as ReferenceItem[], steps: 0, note: "" };
    if (!info.loggedIn) return { info, ...empty };
    await page.getByText(SENDER_UNIT_LABEL).first().waitFor({ timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    info = await this.describe(page, markers);
    if (!info.loggedIn) return { info, ...empty };
    const marked = await page.evaluate((label) => {
      const clean = (t: string | null | undefined) => (t ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (clean(node.textContent) !== label || !node.parentElement) continue;
        const anchor = node.parentElement;
        const input = Array.from(document.querySelectorAll("input[role=combobox]")).find(
          (el) => anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
        if (input) {
          input.setAttribute("data-akasha-sender", "1");
          return true;
        }
      }
      return false;
    }, SENDER_UNIT_LABEL);
    if (!marked) throw new Error(`Kolom "${SENDER_UNIT_LABEL}" tidak ditemukan di formulir Registrasi.`);
    const input = page.locator("[data-akasha-sender='1']");
    await input.scrollIntoViewIfNeeded().catch(() => undefined);
    await input.click();
    await page
      .getByRole("option")
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => undefined);
    const texts: string[] = [];
    let steps = 0;
    let idle = 0;
    let last = 0;
    for (; steps < 400 && idle < 4; steps++) {
      const round = await page.evaluate(() => {
        const options = Array.from(document.querySelectorAll("[role=option]")) as HTMLElement[];
        const list = options[0]?.parentElement ?? null;
        // Wadah gulir = leluhur terdekat yang bisa digulir (react-select MenuList)
        let box: HTMLElement | null = list;
        while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement;
        if (box && box !== document.body && box !== document.documentElement) box.scrollTop = box.scrollHeight;
        const menu = document.querySelector("[id*='-listbox']") as HTMLElement | null;
        return { texts: options.map((o) => o.innerText), menuText: (menu?.innerText ?? "").slice(-200) };
      });
      texts.push(...round.texts);
      const unique = new Set(texts.map((t) => t.replace(/\s+/g, " ").trim().toLowerCase())).size;
      idle = unique > last ? 0 : idle + 1;
      last = unique;
      await page.waitForTimeout(idle ? 900 : 500);
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    const items = parseSenderUnits(texts);
    return { info, items, steps, note: `${items.length} pilihan setelah ${steps} kali gulir` };
  }

  private async record(page: Page, markers: string[]) {
    const info = await this.describe(page, markers);
    const screenshot = (await page.screenshot({ type: "jpeg", quality: 70, fullPage: true })).toString("base64");
    const aria = clampText(
      await page
        .locator("body")
        .ariaSnapshot()
        .catch(() => ""),
    );
    return { ...info, screenshot, aria };
  }

  private async withPage<T>(
    target: Target,
    run: (page: Page, hosts: string[], markers: string[]) => Promise<T>,
    options: { downloads?: boolean } = {},
  ) {
    const { context, hosts, markers } = await this.newContext(target, options);
    try {
      const page = await context.newPage();
      const result = await run(page, hosts, markers);
      return { ...result, storageState: await context.storageState({ indexedDB: true }) };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- Login otomatis (kredensial dari brankas Akasha)

  /**
   * Pindai formulir yang terlihat: setiap input/tombol diberi penanda `data-akasha-*` lalu dikenali oleh logika murni
   * (`classifyFields`, `pickSubmit`). Pesan galat situs (alert/SweetAlert/toast) ikut dibaca.
   */
  private async scan(page: Page) {
    const data = await page.evaluate(() => {
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
      const inputs = Array.from(document.querySelectorAll("input")).filter(visible);
      const fields = inputs.map((el, index) => {
        el.setAttribute("data-akasha-field", String(index));
        const labels = el.labels ? Array.from(el.labels).map((l) => l.textContent) : [];
        const text = clean(
          [...labels, el.placeholder, el.name, el.id, el.getAttribute("aria-label"), el.autocomplete].join(" "),
        ).toLowerCase();
        return {
          index,
          type: (el.type || "text").toLowerCase(),
          text,
          maxLength: el.maxLength > 0 ? el.maxLength : null,
          inputMode: el.inputMode || "",
        };
      });
      const buttonEls = Array.from(
        document.querySelectorAll("button, input[type=submit], input[type=button], [role=button]"),
      ).filter(visible);
      const buttons = buttonEls.map((el, index) => {
        el.setAttribute("data-akasha-button", String(index));
        return {
          index,
          text: clean((el as HTMLInputElement).value || el.textContent || el.getAttribute("aria-label")),
        };
      });
      const messages = Array.from(
        document.querySelectorAll(
          "[role=alert], .alert, .swal2-html-container, .swal2-title, .toast, .invalid-feedback, .text-danger, .error-message, .validation-summary-errors",
        ),
      )
        .filter(visible)
        .map((el) => clean(el.textContent))
        .filter(Boolean)
        .slice(0, 3);
      return { fields, buttons, messages };
    });
    return {
      fields: classifyFields(data.fields),
      submit: pickSubmit(data.buttons),
      entry: pickLoginEntry(data.buttons),
      message: data.messages.join(" · ").slice(0, 300) || undefined,
    };
  }

  /** Gambar CAPTCHA: elemen img/canvas bertanda captcha, atau yang terdekat di atas kolom CAPTCHA (cadangan: area di atasnya). */
  private async captchaImage(page: Page, captchaIndex: number) {
    const clip = await page.evaluate((index) => {
      const input = document.querySelector(`[data-akasha-field="${index}"]`);
      if (!input) return null;
      const box = input.getBoundingClientRect();
      const candidates = Array.from(document.querySelectorAll("img, canvas, svg"))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 20 && r.height > 12 && r.width < 500 && r.height < 200);
      const marked = candidates.find(({ el }) =>
        /captcha/i.test([el.getAttribute("src"), el.id, el.getAttribute("class"), el.getAttribute("alt")].join(" ")),
      );
      const near = candidates
        .filter(({ r }) => r.bottom <= box.top + 4 && box.top - r.bottom < 160)
        .sort((a, b) => box.top - a.r.bottom - (box.top - b.r.bottom))[0];
      const pick = (marked ?? near)?.r;
      const r = pick ?? { left: box.left - 10, top: box.top - 90, width: box.width + 20, height: 86 };
      return {
        x: Math.max(0, r.left - 6 + window.scrollX),
        y: Math.max(0, r.top - 6 + window.scrollY),
        width: r.width + 12,
        height: r.height + 12,
      };
    }, captchaIndex);
    if (!clip) return undefined;
    const image = await page.screenshot({ type: "png", clip, fullPage: true }).catch(() => undefined);
    return image?.toString("base64");
  }

  /** Centang kotak "ingat browser/perangkat ini" yang terlihat (sesi tersimpan lebih lama); kotak lain tidak disentuh. */
  private async checkRemember(page: Page) {
    const indexes = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("input[type=checkbox]"))
          .map((el, index) => {
            const input = el as HTMLInputElement;
            const labels = input.labels ? Array.from(input.labels).map((l) => l.textContent) : [];
            el.setAttribute("data-akasha-check", String(index));
            const box = input.getBoundingClientRect();
            return {
              index,
              checked: input.checked,
              visible: box.width > 0 || labels.length > 0,
              text: [...labels, input.name, input.id, input.getAttribute("aria-label")].join(" "),
            };
          })
          .filter((c) => !c.checked && c.visible),
      )
      .catch(() => []);
    for (const c of indexes) {
      if (!isRememberCheckbox(c.text)) continue;
      await page
        .locator(`[data-akasha-check="${c.index}"]`)
        .check({ force: true, timeout: 2_000 })
        .catch(() => undefined);
    }
  }

  private async fill(page: Page, index: number | undefined, value: string) {
    if (index === undefined) return;
    await page.locator(`[data-akasha-field="${index}"]`).fill(value);
  }

  private async submit(page: Page, submit: number | null, lastField: number | undefined) {
    if (submit !== null) await page.locator(`[data-akasha-button="${submit}"]`).click();
    else if (lastField !== undefined) await page.locator(`[data-akasha-field="${lastField}"]`).press("Enter");
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_200);
  }

  /** Keadaan login saat ini + gambar CAPTCHA bila diminta. */
  /**
   * Tutup modal informasi yang menghalangi setelah login (mis. "Login berhasil" + OK). Modal keputusan (kirim, hapus,
   * setujui, tanda tangan) tidak disentuh — lihat `infoDialogButton`.
   */
  private async dismissInfoDialog(page: Page) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const dialogs = await page
        .evaluate(() => {
          const visible = (el: Element) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
          };
          const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
          const boxes = Array.from(
            document.querySelectorAll(
              ".swal2-popup, .swal-modal, [role=dialog], [role=alertdialog], .modal.show, .modal.in, .bootbox",
            ),
          ).filter(visible);
          return boxes.map((box, d) => ({
            text: clean(box.textContent).slice(0, 400),
            buttons: Array.from(box.querySelectorAll("button, a.btn, input[type=button], input[type=submit]"))
              .filter(visible)
              .map((el, index) => {
                el.setAttribute("data-akasha-modal-button", `${d}-${index}`);
                return { index, text: clean((el as HTMLInputElement).value || el.textContent) };
              }),
          }));
        })
        .catch(() => []);
      const target = dialogs
        .map((dlg, d) => ({ d, button: infoDialogButton(dlg.text, dlg.buttons) }))
        .find((x) => x.button !== null);
      if (!target) return;
      await page
        .locator(`[data-akasha-modal-button="${target.d}-${target.button}"]`)
        .click({ timeout: 3_000 })
        .catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
      await page.waitForTimeout(600);
    }
  }

  private async loginState(page: Page, markers: string[]) {
    await this.dismissInfoDialog(page);
    const info = await this.describe(page, markers);
    const form = await this.scan(page);
    const stage = loginStage(info.loggedIn, form.fields);
    const captchaImage =
      stage === "captcha" && form.fields.captcha !== undefined
        ? await this.captchaImage(page, form.fields.captcha)
        : undefined;
    return { ...info, stage, message: form.message, captchaImage };
  }

  /**
   * Isi nama pengguna & kata sandi. Bila ada CAPTCHA, berhenti dan kembalikan gambarnya untuk diketik pengguna; bila tidak,
   * langsung kirim formulir. Kredensial tidak pernah dicatat atau disimpan di robot.
   */
  async autofill(id: string, credentials: { username: string; password: string }) {
    const { page, markers } = this.live(id);
    const info = await this.describe(page, markers);
    if (info.loggedIn) return { ...info, stage: "done" as const };
    let form = await this.scan(page);
    // Beranda dengan tombol "Login" yang mengalihkan ke SSO (mis. SIMAN → KemenkeuID): klik dulu, lalu pindai lagi
    if (form.fields.password === undefined && form.entry !== null) {
      await page.locator(`[data-akasha-button="${form.entry}"]`).click({ timeout: 5_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1_200);
      if ((await this.describe(page, markers)).loggedIn) return this.loginState(page, markers);
      form = await this.scan(page);
    }
    if (form.fields.password === undefined) return this.loginState(page, markers);
    await this.fill(page, form.fields.username, credentials.username);
    await this.fill(page, form.fields.password, credentials.password);
    await this.checkRemember(page);
    if (form.fields.captcha === undefined) await this.submit(page, form.submit, form.fields.password);
    return this.loginState(page, markers);
  }

  /** Jawaban pengguna (CAPTCHA / OTP) diisikan lalu formulir dikirim; kata sandi diisi ulang bila dikosongkan situs. */
  async answer(
    id: string,
    kind: "captcha" | "otp",
    value: string,
    credentials?: { username: string; password: string },
  ) {
    const { page, markers } = this.live(id);
    const form = await this.scan(page);
    if (kind === "captcha") {
      if (form.fields.captcha === undefined) return this.loginState(page, markers);
      if (credentials && form.fields.password !== undefined) {
        const current = await page.locator(`[data-akasha-field="${form.fields.password}"]`).inputValue();
        if (!current) {
          await this.fill(page, form.fields.username, credentials.username);
          await this.fill(page, form.fields.password, credentials.password);
        }
      }
      await this.fill(page, form.fields.captcha, value);
      await this.submit(page, form.submit, form.fields.captcha);
    } else {
      if (!form.fields.otp.length) return this.loginState(page, markers);
      if (form.fields.otp.length > 1) {
        await page.locator(`[data-akasha-field="${form.fields.otp[0]}"]`).click();
        await page.keyboard.type(value, { delay: 60 });
      } else {
        await this.fill(page, form.fields.otp[0], value);
      }
      await this.checkRemember(page);
      await this.submit(page, form.submit, form.fields.otp.at(-1));
    }
    return this.loginState(page, markers);
  }

  async close() {
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}

export class NotFound extends Error {}
