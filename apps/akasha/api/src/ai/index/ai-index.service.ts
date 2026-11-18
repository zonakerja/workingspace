import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import IORedis from "ioredis";
import { AssetExtractionStatus, Prisma } from "../../generated/prisma/client";
import { ExtractionQueueService } from "../../extraction/extraction-queue.service";
import { isExtractable, normalizeMimeType } from "../../extraction/text-extractors";
import { PrismaService } from "../../prisma/prisma.service";
import { DomainRow, rowToPayload } from "../../records/record-mapper";
import { RECORD_TABLES, type RecordType, type TableSpec } from "../../records/record-schema";
import { REDIS_CLIENT } from "../../redis/redis.module";
import { AiService, type EmbeddingCredential } from "../ai.service";
import { AiProviderError } from "../providers/ai-client";
import { parsePrefs } from "../../knowledge/vault-editor";
import { AiIndexQueueService } from "./ai-index-queue.service";
import {
  displayTitle,
  groupBySource,
  likePattern,
  moduleOf,
  prefixTsQuery,
  queryTerms,
  readableRecordText,
  searchSnippet,
  type SmartModule,
  type SmartSearchMode,
} from "./smart-search";
import { embedDocuments, embedQuery } from "./embedding";
import { KNOWLEDGE_VAULT_CONTEXT } from "../../knowledge/knowledge-constants";
import {
  EXPORT_DIR,
  knowledgeMetadata,
  noteIndexText,
  TEMPLATE_DIR,
  normalizeField,
} from "../../knowledge/vault-parser";
import { LockService } from "../../security/lock.service";
import {
  ASSET_SOURCE,
  chunkSource,
  hashText,
  INDEXED_TYPES,
  isIndexedType,
  KNOWLEDGE_COLLECTION,
  NOTEBOOK_SOURCE,
  OBSIDIAN_SOURCE,
  reciprocalRankFusion,
  renderRecord,
  toVectorLiteral,
  WORKSPACE_COLLECTION,
} from "./index-text";

export interface SourceDocument {
  sourceType: string;
  sourceId: string;
  title: string;
  text: string;
  /** `knowledge` (vault Obsidian & berkasnya) atau `workspace` (data kerja) */
  collection: string;
  metadata?: Record<string, unknown> | null;
}

/** Pemuat sumber yang dimiliki modul lain (mis. Canvas vault dibaca dari disk oleh modul knowledge). */
export interface ExternalSourceLoader {
  load(userId: string, sourceId: string): Promise<SourceDocument | null>;
  loadAll(userId: string): Promise<SourceDocument[]>;
}

interface FindManyDelegate {
  findMany(args: object): Promise<DomainRow[]>;
  findUnique(args: object): Promise<DomainRow | null>;
}

/** Batasi pencarian ke sumber tertentu (mis. sumber satu notebook). */
interface SourceRef {
  sourceType: string;
  sourceId: string;
}

export interface SearchHit {
  id: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  title: string;
  content: string;
  collection: string;
  metadata: Record<string, unknown> | null;
  score: number;
}

export interface SearchOptions {
  /** Batasi ke sumber tertentu (mis. sumber satu notebook) */
  only?: SourceRef[];
  /** Batasi ke koleksi tertentu */
  collections?: string[];
  /** Buang potongan berstatus ini (`metadata.status`), mis. `dicabut` */
  excludeStatuses?: string[];
  /** Hanya potongan yang boleh dipakai publik (`metadata.publik = true`) */
  publicOnly?: boolean;
  /** Bersama `publicOnly`: juga potongan khusus grup kontak ini (`metadata.grup` memuat kode, huruf besar) */
  audienceGroup?: string;
  /** Hanya bidang aktif pemilik (`knowledge_prefs.activeField`) + catatan tanpa bidang */
  useActiveField?: boolean;
  /** false = hanya pencarian kata (tanpa embedding pertanyaan, tanpa biaya AI) */
  semantic?: boolean;
  /**
   * Pencarian saat mengetik: kata boleh belum lengkap (awalan) dan judul yang memuat kueri ikut (didahulukan).
   * `"any"` = cukup salah satu kata (cadangan bila semua kata tidak ditemukan bersama).
   */
  prefix?: boolean | "any";
  /** Maks. potongan per sumber di antara kandidat (hasil beragam; dokumen besar tidak mendominasi) */
  perSource?: number;
  /**
   * Sertakan item terkunci PIN. Bawaan tidak: isinya tetap terindeks tetapi hanya dipakai saat sesi pemilik sudah
   * memasukkan PIN (chatbot / Notebook meneruskan status sesi); agen, MCP, bot WhatsApp tidak pernah.
   */
  includeLocked?: boolean;
}

export interface SmartSearchResult {
  sourceType: string;
  sourceId: string;
  module: SmartModule;
  title: string;
  snippet: string;
  matches: number;
  /** Status kearsipan resource (File Control) */
  archivalStatus?: string | null;
  /** Berkas: jenis & nama asli */
  mimeType?: string | null;
  fileName?: string | null;
  /** Sumber My Notebook: notebook pemiliknya */
  notebookId?: string | null;
  /** Catatan / canvas vault: path */
  path?: string | null;
  /** Item terkunci PIN (cuplikan disembunyikan) */
  locked?: boolean;
}

/** Status pengindeksan per user di Redis (bukan data penting → TTL 30 hari). */
const statusKey = (userId: string) => `ai:index:status:${userId}`;
const STATUS_TTL_SECONDS = 30 * 24 * 3600;
/** Jumlah dokumen yang diproses per gelombang saat membangun ulang indeks. */
const REBUILD_BATCH = 40;
/** Nilai `model` untuk potongan tanpa embedding (hanya pencarian kata). */
const KEYWORD_ONLY_MODEL = "none";

/**
 * Indeks pengetahuan (RAG tahap 1): mengubah data user (record + isi berkas) menjadi potongan teks di `ai_chunks`.
 * Embedding memakai API key Gemini milik pemilik data; tanpa key Gemini potongan hanya mendukung pencarian kata, dan bila
 * indeks dimatikan user tidak ada yang disimpan maupun dikirim ke Google.
 */
@Injectable()
export class AiIndexService {
  private readonly logger = new Logger(AiIndexService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly queue: AiIndexQueueService,
    @Inject(forwardRef(() => ExtractionQueueService)) private readonly extraction: ExtractionQueueService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
    private readonly locks: LockService,
  ) {}

  private readonly loaders = new Map<string, ExternalSourceLoader>();

  /** Daftarkan pemuat untuk `sourceType` milik modul lain (tanpa ketergantungan melingkar). */
  registerSourceLoader(sourceType: string, loader: ExternalSourceLoader) {
    this.loaders.set(sourceType, loader);
  }

  // ---------------------------------------------------------------- Pemrosesan job

  /** Sinkronkan satu sumber: hapus potongannya bila sumber hilang/dihapus, atau embed ulang bila isinya berubah. */
  async indexSource(userId: string, sourceType: string, sourceId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { aiIndexEnabled: true } });
    const doc = user?.aiIndexEnabled ? await this.loadSource(userId, sourceType, sourceId) : null;
    if (!doc) {
      await this.prisma.aiChunk.deleteMany({ where: { userId, sourceType, sourceId } });
      return;
    }
    const failure = await this.indexDocuments(userId, await this.ai.embeddingCredential(userId), [doc]);
    if (failure) throw failure;
    await this.markSuccess(userId);
  }

  /** Bangun ulang seluruh indeks user: sumber baru/berubah di-embed, sumber yang sudah tidak ada dibuang. */
  async rebuild(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { aiIndexEnabled: true } });
    if (!user?.aiIndexEnabled) return this.purge(userId);
    let embedding = await this.ai.embeddingCredential(userId);
    await this.requeueUnextractedAssets(userId);
    const docs = await this.loadAllSources(userId);

    // Buang potongan dari sumber yang sudah dihapus
    const live = new Set(docs.map((d) => `${d.sourceType}|${d.sourceId}`));
    const existing = await this.prisma.aiChunk.findMany({
      where: { userId },
      distinct: ["sourceType", "sourceId"],
      select: { sourceType: true, sourceId: true },
    });
    for (const stale of existing.filter((e) => !live.has(`${e.sourceType}|${e.sourceId}`))) {
      await this.prisma.aiChunk.deleteMany({ where: { userId, ...stale } });
    }

    // Embedding gagal → sumber berikutnya tetap diindeks untuk pencarian kata, error dilaporkan di akhir
    let failure: AiProviderError | null = null;
    for (let i = 0; i < docs.length; i += REBUILD_BATCH) {
      const batchFailure = await this.indexDocuments(userId, embedding, docs.slice(i, i + REBUILD_BATCH));
      if (batchFailure) {
        failure ??= batchFailure;
        embedding = null;
      }
    }
    if (failure) throw failure;
    await this.markSuccess(userId);
    this.logger.log(`Indeks AI user ${userId} dibangun ulang (${docs.length} sumber).`);
  }

  async purge(userId: string) {
    await this.prisma.aiChunk.deleteMany({ where: { userId } });
  }

  /** Catat error terakhir agar terlihat di Tools → Indeks Pengetahuan. */
  async markError(userId: string, error: unknown) {
    const message =
      error instanceof AiProviderError
        ? `${error.kind}: ${error.providerMessage}`
        : error instanceof Error
          ? error.message
          : String(error);
    await this.redis
      .multi()
      .hset(statusKey(userId), { lastError: message.slice(0, 500), lastErrorAt: new Date().toISOString() })
      .expire(statusKey(userId), STATUS_TTL_SECONDS)
      .exec();
  }

  private async markSuccess(userId: string) {
    await this.redis
      .multi()
      .hset(statusKey(userId), { lastIndexedAt: new Date().toISOString() })
      .hdel(statusKey(userId), "lastError", "lastErrorAt")
      .expire(statusKey(userId), STATUS_TTL_SECONDS)
      .exec();
  }

  /**
   * Tulis ulang potongan dokumen yang isinya berubah (dibandingkan hash per potongan) dalam satu transaksi.
   * Dengan key Gemini: potongan di-embed (teks semua dokumen digabung per batch agar panggilan sedikit), termasuk
   * potongan lama yang belum ber-embedding. Tanpa key: potongan disimpan tanpa embedding (`model = "none"`) sehingga
   * pencarian kata persis tetap jalan dan tidak ada data yang dikirim ke luar. Embedding gagal (key ditolak, kuota,
   * provider sibuk) → perlakuan sama, lalu error dikembalikan agar dicatat & dicoba ulang; isi baru tetap bisa dicari
   * dan vektornya menyusul saat percobaan ulang / key diganti (`model` berbeda = dianggap berubah).
   */
  private async indexDocuments(
    userId: string,
    embedding: EmbeddingCredential | null,
    docs: SourceDocument[],
  ): Promise<AiProviderError | null> {
    const prepared = docs.map((doc) => {
      const chunks = chunkSource(doc.sourceType, doc.text);
      // Sumber tanpa isi (mis. hanya judul) tetap diindeks satu potongan berisi judul
      const contents = chunks.length ? chunks : [doc.title];
      // Koleksi & metadata ikut hash: perubahan status catatan menulis ulang potongannya
      const meta = `${doc.collection}|${JSON.stringify(doc.metadata ?? null)}`;
      return { doc, contents, hashes: contents.map((c) => hashText(`${meta}\n${doc.title}\n${c}`)) };
    });

    const existing = await this.prisma.aiChunk.findMany({
      where: { userId, OR: docs.map((d) => ({ sourceType: d.sourceType, sourceId: d.sourceId })) },
      select: { sourceType: true, sourceId: true, chunkIndex: true, contentHash: true, model: true },
    });
    const changed = prepared.filter(({ doc, hashes }) => {
      const current = existing
        .filter((e) => e.sourceType === doc.sourceType && e.sourceId === doc.sourceId)
        .sort((a, b) => a.chunkIndex - b.chunkIndex);
      return (
        current.length !== hashes.length ||
        current.some((e, i) => e.contentHash !== hashes[i] || (embedding !== null && e.model !== embedding.model))
      );
    });
    if (changed.length === 0) return null;

    const texts = changed.flatMap(({ doc, contents }) => contents.map((content) => ({ title: doc.title, content })));
    let vectors: number[][] | null = null;
    let model = KEYWORD_ONLY_MODEL;
    let failure: AiProviderError | null = null;
    if (embedding) {
      try {
        // Nama model = model yang benar-benar menjawab (lewat Akai bisa cadangan): pencarian hanya membandingkan model sama
        ({ vectors, model } = await embedDocuments(embedding, texts));
      } catch (error) {
        if (!(error instanceof AiProviderError)) throw error;
        failure = error;
      }
    }

    let offset = 0;
    for (const { doc, contents, hashes } of changed) {
      const rows = contents.map((content, i) => ({ content, hash: hashes[i], vector: vectors?.[offset + i] }));
      offset += contents.length;
      await this.prisma.$transaction([
        this.prisma.aiChunk.deleteMany({ where: { userId, sourceType: doc.sourceType, sourceId: doc.sourceId } }),
        ...rows.map(
          (row, i) => this.prisma.$executeRaw`
            INSERT INTO ai_chunks (id, user_id, source_type, source_id, chunk_index, title, content, content_hash, model,
                                   embedding, collection, metadata, created_at, updated_at)
            VALUES (${randomUUID()}, ${userId}, ${doc.sourceType}, ${doc.sourceId}, ${i}, ${doc.title}, ${row.content},
                    ${row.hash}, ${model}, ${row.vector ? toVectorLiteral(row.vector) : null}::vector, ${doc.collection},
                    ${doc.metadata ? JSON.stringify(doc.metadata) : null}::jsonb, now(), now())`,
        ),
      ]);
    }
    return failure;
  }

  // ---------------------------------------------------------------- Sumber data

  private async loadSource(userId: string, sourceType: string, sourceId: string): Promise<SourceDocument | null> {
    if (sourceType === NOTEBOOK_SOURCE) {
      const source = await this.prisma.notebookSource.findFirst({
        where: { id: sourceId, notebook: { userId }, content: { not: null } },
      });
      return source?.content?.trim()
        ? {
            sourceType,
            sourceId,
            title: `Sumber notebook: ${source.title}`,
            text: source.content,
            collection: WORKSPACE_COLLECTION,
          }
        : null;
    }
    const external = this.loaders.get(sourceType);
    if (external) return external.load(userId, sourceId).catch(() => null);
    if (sourceType === OBSIDIAN_SOURCE) {
      const note = await this.prisma.knowledgeNote.findFirst({ where: { id: sourceId, userId, kind: "note" } });
      return note ? this.noteDocument(note) : null;
    }
    if (sourceType === ASSET_SOURCE) {
      const asset = await this.prisma.asset.findFirst({
        where: { id: sourceId, userId },
        include: { extraction: true },
      });
      const text =
        asset?.extraction?.status === AssetExtractionStatus.completed ? asset.extraction.extractedText : null;
      return asset && text?.trim() ? this.assetDocument(asset, text) : null;
    }
    if (!isIndexedType(sourceType)) return null;
    const spec: TableSpec = RECORD_TABLES[sourceType];
    const row = await this.delegate(sourceType).findUnique({
      where: { userId_clientId: { userId, clientId: sourceId } },
    });
    if (!row || row.deletedAt) return null;
    return {
      sourceType,
      sourceId,
      collection: WORKSPACE_COLLECTION,
      ...renderRecord(sourceType, rowToPayload(spec, row), spec.titleKey),
    };
  }

  /** Catatan vault Obsidian → dokumen koleksi pengetahuan (templat tidak diindeks: isinya kerangka). */
  private noteDocument(note: {
    id: string;
    path: string;
    title: string;
    content: string | null;
    frontmatter: unknown;
  }): SourceDocument | null {
    // Templat = kerangka; cermin 80-Akasha = data kerja yang sudah diindeks sendiri (tidak boleh ganda)
    if ([TEMPLATE_DIR, EXPORT_DIR].includes(note.path.split("/")[0])) return null;
    const frontmatter = (note.frontmatter as Record<string, unknown> | null) ?? null;
    const tags = Array.isArray(frontmatter?.tags)
      ? frontmatter.tags.filter((t): t is string => typeof t === "string")
      : [];
    return {
      sourceType: OBSIDIAN_SOURCE,
      sourceId: note.id,
      title: `Pengetahuan: ${note.title}`,
      text: noteIndexText({ title: note.title, content: note.content ?? "", frontmatter }),
      collection: KNOWLEDGE_COLLECTION,
      metadata: { ...knowledgeMetadata(note.path, frontmatter, tags) },
    };
  }

  /** Isi berkas: berkas vault Obsidian masuk koleksi pengetahuan, berkas lain = data kerja. */
  private assetDocument(asset: { id: string; originalName: string; context: string | null }, text: string) {
    const knowledge = asset.context === KNOWLEDGE_VAULT_CONTEXT;
    return {
      sourceType: ASSET_SOURCE,
      sourceId: asset.id,
      title: knowledge ? `Pengetahuan (berkas): ${asset.originalName}` : `Berkas: ${asset.originalName}`,
      text,
      collection: knowledge ? KNOWLEDGE_COLLECTION : WORKSPACE_COLLECTION,
      metadata: knowledge ? { path: asset.originalName } : null,
    } satisfies SourceDocument;
  }

  private async loadAllSources(userId: string): Promise<SourceDocument[]> {
    const docs: SourceDocument[] = [];
    for (const type of Object.keys(INDEXED_TYPES) as RecordType[]) {
      const spec: TableSpec = RECORD_TABLES[type];
      const rows = await this.delegate(type).findMany({ where: { userId, deletedAt: null } });
      for (const row of rows) {
        docs.push({
          sourceType: type,
          sourceId: row.clientId as string,
          collection: WORKSPACE_COLLECTION,
          ...renderRecord(type, rowToPayload(spec, row), spec.titleKey),
        });
      }
    }
    const assets = await this.prisma.asset.findMany({
      where: { userId, extraction: { status: AssetExtractionStatus.completed, extractedText: { not: null } } },
      include: { extraction: { select: { extractedText: true } } },
    });
    for (const asset of assets) {
      const text = asset.extraction?.extractedText;
      if (text?.trim()) docs.push(this.assetDocument(asset, text));
    }
    const notebookSources = await this.prisma.notebookSource.findMany({
      where: { notebook: { userId }, content: { not: null } },
    });
    for (const source of notebookSources) {
      if (source.content?.trim()) {
        docs.push({
          sourceType: NOTEBOOK_SOURCE,
          sourceId: source.id,
          title: `Sumber notebook: ${source.title}`,
          text: source.content,
          collection: WORKSPACE_COLLECTION,
        });
      }
    }
    const notes = await this.prisma.knowledgeNote.findMany({ where: { userId, kind: "note" } });
    for (const note of notes) {
      const doc = this.noteDocument(note);
      if (doc) docs.push(doc);
    }
    for (const loader of this.loaders.values()) docs.push(...(await loader.loadAll(userId).catch(() => [])));
    return docs;
  }

  /** Berkas lama yang dulu belum bisa diekstrak (mis. PDF/DOCX sebelum ekstraktor ditambahkan) diekstrak ulang. */
  private async requeueUnextractedAssets(userId: string) {
    const assets = await this.prisma.asset.findMany({
      where: {
        userId,
        extraction: { status: { in: [AssetExtractionStatus.unsupported, AssetExtractionStatus.failed] } },
      },
      select: { id: true, mimeType: true, originalName: true },
    });
    for (const asset of assets.filter((a) => isExtractable(normalizeMimeType(a.mimeType, a.originalName)))) {
      await this.extraction.enqueue(asset.id, { rerun: true });
    }
  }

  private delegate(type: RecordType): FindManyDelegate {
    const model = RECORD_TABLES[type].model;
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    return (this.prisma as unknown as Record<string, FindManyDelegate>)[key];
  }

  // ---------------------------------------------------------------- Status & pencarian

  async status(userId: string) {
    const [user, counts, status, pending, embedding] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { aiIndexEnabled: true } }),
      this.prisma.$queryRaw<{ chunks: bigint; embedded: bigint; sources: bigint; last: Date | null }[]>`
        SELECT count(*) AS chunks, count(embedding) AS embedded, count(DISTINCT (source_type, source_id)) AS sources,
               max(updated_at) AS last
        FROM ai_chunks WHERE user_id = ${userId}`,
      this.redis.hgetall(statusKey(userId)),
      this.queue.pendingCount(),
      this.ai.embeddingCredential(userId),
    ]);
    return {
      enabled: user.aiIndexEnabled,
      embeddingAvailable: !!embedding,
      embeddingProvider: embedding?.provider ?? null,
      model: embedding?.model ?? null,
      sources: Number(counts[0]?.sources ?? 0),
      chunks: Number(counts[0]?.chunks ?? 0),
      embeddedChunks: Number(counts[0]?.embedded ?? 0),
      lastIndexedAt: status.lastIndexedAt ?? counts[0]?.last?.toISOString() ?? null,
      lastError: status.lastError ?? null,
      lastErrorAt: status.lastErrorAt ?? null,
      pendingJobs: pending,
    };
  }

  /** Bidang pengetahuan yang dipakai AI menjawab; null = semua bidang. */
  async activeField(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { knowledgePrefs: true } });
    return parsePrefs(user?.knowledgePrefs).activeField;
  }

  /**
   * Pencarian gabungan: kemiripan makna (pgvector, cosine) + kata persis (full-text PostgreSQL, penting untuk nomor
   * arsip/kode), digabung dengan Reciprocal Rank Fusion. Tanpa key embedding (Gemini/OpenAI) hanya pencarian kata.
   */
  async search(userId: string, query: string, limit = 8, options: SearchOptions = {}): Promise<SearchHit[]> {
    const {
      only,
      collections,
      excludeStatuses,
      publicOnly,
      audienceGroup,
      useActiveField,
      semantic: useVector = true,
      includeLocked = false,
    } = options;
    if (only && only.length === 0) return [];
    const locked = includeLocked ? [] : await this.locks.lockedSources(userId);
    if (collections && collections.length === 0) return [];
    const candidates = Math.max(limit * 3, 20);
    const activeField = useActiveField ? await this.activeField(userId) : null;
    // Filter: sumber tertentu (notebook), koleksi, status (mis. dicabut), publik
    const filters = [
      only
        ? Prisma.sql`AND (source_type, source_id) IN (${Prisma.join(
            only.map((ref) => Prisma.sql`(${ref.sourceType}, ${ref.sourceId})`),
          )})`
        : Prisma.empty,
      collections ? Prisma.sql`AND collection IN (${Prisma.join(collections)})` : Prisma.empty,
      locked.length
        ? Prisma.sql`AND (source_type, source_id) NOT IN (${Prisma.join(
            locked.map((ref) => Prisma.sql`(${ref.sourceType}, ${ref.sourceId})`),
          )})`
        : Prisma.empty,
      excludeStatuses?.length
        ? Prisma.sql`AND coalesce(metadata->>'status', '') NOT IN (${Prisma.join(excludeStatuses)})`
        : Prisma.empty,
      publicOnly && audienceGroup
        ? Prisma.sql`AND (metadata->>'publik' = 'true' OR coalesce(metadata->'grup', '[]'::jsonb) @> ${JSON.stringify([audienceGroup.trim().toUpperCase()])}::jsonb)`
        : publicOnly
          ? Prisma.sql`AND metadata->>'publik' = 'true'`
          : Prisma.empty,
    ];
    if (activeField) {
      filters.push(
        Prisma.sql`AND (coalesce(metadata->'bidang', '[]'::jsonb) = '[]'::jsonb OR metadata->'bidang' @> ${JSON.stringify([normalizeField(activeField)])}::jsonb)`,
      );
    }
    const scope = Prisma.join(filters, " ");
    type Row = Omit<SearchHit, "score"> & { contentHash: string };
    const prefixQuery = options.prefix ? prefixTsQuery(query, options.prefix === "any") : "";
    // Kata persis (websearch) + awalan kata saat mengetik + judul yang memuat kueri (nomor naskah, nama berkas)
    const tsQuery =
      options.prefix === "any" && prefixQuery
        ? Prisma.sql`to_tsquery('simple', ${prefixQuery})`
        : prefixQuery
          ? Prisma.sql`(websearch_to_tsquery('simple', ${query}) || to_tsquery('simple', ${prefixQuery}))`
          : Prisma.sql`websearch_to_tsquery('simple', ${query})`;
    const titleMatch = options.prefix ? Prisma.sql`OR title ILIKE ${likePattern(query)}` : Prisma.empty;
    // Urutan saat mengetik: judul memuat seluruh kueri → judul memuat lebih banyak kata kueri → peringkat teks
    const terms = options.prefix ? queryTerms(query) : [];
    const titleFirst = options.prefix
      ? Prisma.sql`(title ILIKE ${likePattern(query)}) DESC, (${
          terms.length
            ? Prisma.join(
                terms.map((term) => Prisma.sql`(title ILIKE ${likePattern(term)})::int`),
                " + ",
              )
            : Prisma.sql`0`
        }) DESC,`
      : Prisma.empty;
    const columns = Prisma.sql`id, source_type AS "sourceType", source_id AS "sourceId", chunk_index AS "chunkIndex",
      title, content, collection, metadata, content_hash AS "contentHash"`;
    /**
     * `perSource`: maks. N potongan per sumber sebelum diberi peringkat, agar satu dokumen besar (ratusan potongan) tidak
     * memenuhi semua kandidat. Tanpa itu = urutan biasa (memakai indeks HNSW).
     */
    const ranked = (where: Prisma.Sql, order: Prisma.Sql) =>
      options.perSource
        ? Prisma.sql`
          SELECT ${columns} FROM (
            SELECT *, row_number() OVER (PARTITION BY source_type, source_id ORDER BY ${order}) AS per_source_rank
            FROM ai_chunks WHERE ${where}
          ) ranked
          WHERE per_source_rank <= ${options.perSource}
          ORDER BY ${order}
          LIMIT ${candidates}`
        : Prisma.sql`SELECT ${columns} FROM ai_chunks WHERE ${where} ORDER BY ${order} LIMIT ${candidates}`;
    const keyword = await this.prisma.$queryRaw<Row[]>(
      ranked(
        Prisma.sql`user_id = ${userId} ${scope}
          AND (to_tsvector('simple', title || ' ' || content) @@ ${tsQuery} ${titleMatch})`,
        Prisma.sql`${titleFirst} ts_rank(to_tsvector('simple', title || ' ' || content), ${tsQuery}) DESC`,
      ),
    );

    let semantic: Row[] = [];
    const embedding = useVector ? await this.ai.embeddingCredential(userId) : null;
    const queried = embedding ? await this.embedQuery(userId, embedding, query) : null;
    if (queried?.vector) {
      const literal = toVectorLiteral(queried.vector);
      // `embedding IS NOT NULL` wajib agar indeks HNSW parsial terpakai; hanya vektor dari model yang sama yang sebanding
      semantic = await this.prisma.$queryRaw<Row[]>(
        ranked(
          Prisma.sql`user_id = ${userId} AND embedding IS NOT NULL AND model = ${queried.model} ${scope}`,
          Prisma.sql`embedding <=> ${literal}::vector`,
        ),
      );
    }
    // Berkas yang sama bisa diunggah berkali-kali (asset berbeda, isi identik) → tampilkan satu kali saja
    const seen = new Set<string>();
    return reciprocalRankFusion([semantic, keyword])
      .filter((hit) => !seen.has(hit.contentHash) && seen.add(hit.contentHash))
      .slice(0, limit)
      .map(({ contentHash, ...hit }) => {
        void contentHash;
        return hit;
      });
  }

  /**
   * Pencarian Pintar (Ctrl+K): satu baris per item/berkas dari semua modul, dengan cuplikan. Mode `text` tanpa biaya AI;
   * `meaning` menambah kemiripan makna (satu embedding pertanyaan). Hanya data milik sendiri yang terindeks; tidak
   * memakai bidang aktif karena tugasnya menemukan, bukan menjawab.
   */
  /**
   * Item terkunci PIN tetap ditemukan (judul), tetapi selama sesi belum memasukkan PIN cuplikan isinya dikosongkan dan
   * hasil ditandai `locked` (frontend meminta PIN saat dibuka).
   */
  async smartSearch(userId: string, query: string, mode: SmartSearchMode, limit = 40, unlocked = false) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { aiIndexEnabled: true } });
    if (!user?.aiIndexEnabled) return { indexEnabled: false, semantic: false, results: [] as SmartSearchResult[] };
    const semantic = mode === "meaning" && !!(await this.ai.embeddingCredential(userId));
    const options = { semantic: mode === "meaning", prefix: true, perSource: 2, includeLocked: true } as const;
    const lockedKeys = unlocked
      ? new Set<string>()
      : new Set((await this.locks.lockedSources(userId)).map((ref) => `${ref.sourceType}:${ref.sourceId}`));
    let hits = await this.search(userId, query, limit * 3, options);
    // Semua kata tidak ditemukan bersama → cukup salah satu kata
    if (!hits.length && queryTerms(query).length > 1)
      hits = await this.search(userId, query, limit * 3, { ...options, prefix: "any" });
    const groups = groupBySource(hits).slice(0, limit);
    const idsOf = (type: string) => groups.filter((g) => g.hit.sourceType === type).map((g) => g.hit.sourceId);
    const [resources, assets, sources] = await Promise.all([
      idsOf("para_resource").length
        ? this.prisma.resource.findMany({
            where: { userId, clientId: { in: idsOf("para_resource") } },
            select: { clientId: true, archivalStatus: true },
          })
        : [],
      idsOf(ASSET_SOURCE).length
        ? this.prisma.asset.findMany({
            where: { userId, id: { in: idsOf(ASSET_SOURCE) } },
            select: { id: true, originalName: true, mimeType: true },
          })
        : [],
      idsOf(NOTEBOOK_SOURCE).length
        ? this.prisma.notebookSource.findMany({
            where: { id: { in: idsOf(NOTEBOOK_SOURCE) }, notebook: { userId } },
            select: { id: true, notebookId: true },
          })
        : [],
    ]);
    const archival = new Map(resources.map((r) => [r.clientId, r.archivalStatus]));
    const files = new Map(assets.map((a) => [a.id, a]));
    const notebooks = new Map(sources.map((s) => [s.id, s.notebookId]));
    const results = groups.map(({ hit, matches }): SmartSearchResult => {
      const status = archival.get(hit.sourceId) ?? null;
      const file = files.get(hit.sourceId);
      const path = hit.metadata?.path;
      const locked = lockedKeys.has(`${hit.sourceType}:${hit.sourceId}`);
      return {
        ...(locked ? { locked: true } : {}),
        sourceType: hit.sourceType,
        sourceId: hit.sourceId,
        module: moduleOf(hit.sourceType, status),
        title: file?.originalName ?? displayTitle(hit.title),
        snippet: locked
          ? ""
          : searchSnippet(isIndexedType(hit.sourceType) ? readableRecordText(hit.content) : hit.content, query),
        matches,
        ...(hit.sourceType === "para_resource" ? { archivalStatus: status } : {}),
        ...(file ? { mimeType: file.mimeType, fileName: file.originalName } : {}),
        ...(hit.sourceType === NOTEBOOK_SOURCE ? { notebookId: notebooks.get(hit.sourceId) ?? null } : {}),
        ...(typeof path === "string" ? { path } : {}),
      };
    });
    return { indexEnabled: true, semantic, results };
  }

  /** Embedding pertanyaan; gagal (kuota, key ditolak) → null sehingga pencarian tetap jalan dengan kata kunci saja. */
  private async embedQuery(userId: string, embedding: EmbeddingCredential, query: string) {
    try {
      return await embedQuery(embedding, query);
    } catch (error) {
      if (!(error instanceof AiProviderError)) throw error;
      this.logger.warn(
        `Embedding pertanyaan user ${userId} gagal (${error.kind}), memakai pencarian kata: ${error.providerMessage}`,
      );
      return null;
    }
  }
}
