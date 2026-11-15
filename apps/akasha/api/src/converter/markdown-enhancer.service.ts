import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { AiService } from "../ai/ai.service";
import { estimateTokens } from "./converter-logic";
import {
  boilerplateLines,
  buildEnhancePrompt,
  checkEnhanced,
  cleanEnhanceOutput,
  ENHANCE_MAX_CHARS,
  splitForEnhance,
} from "./markdown-enhance";

/** Bagian yang dirapikan bersamaan (provider AI menolak terlalu banyak permintaan paralel). */
const PARALLEL = 2;

export interface EnhanceResult {
  markdown: string;
  /** Jumlah bagian / bagian yang hasil AI-nya ditolak penjaga (bagian asli dipakai) / gagal dipanggil. */
  parts: number;
  rejected: number;
  failed: number;
  /** Perkiraan token (± 4 karakter/token): prompt + Markdown masuk, Markdown keluar. */
  inputTokens: number;
  outputTokens: number;
  provider: string | null;
  model: string | null;
  durationMs: number;
  notes: string[];
}

/**
 * "Rapikan dengan AI" untuk Markdown hasil converter (tugas AI `document` di Pembagian tugas, docs/ARCHITECTURE.md §3.14):
 * struktur & salah baca saja. Bagian yang gagal / ditolak penjaga tetap memakai teks asli, jadi hasil tidak pernah lebih
 * buruk dari tanpa AI. Galat provider pada SEMUA bagian dilempar (pemanggil memutuskan memakai teks asli).
 */
@Injectable()
export class MarkdownEnhancerService {
  private readonly logger = new Logger(MarkdownEnhancerService.name);

  constructor(@Inject(forwardRef(() => AiService)) private readonly ai: AiService) {}

  async enhance(
    userId: string,
    markdown: string,
    context: { fileName: string; engine: string },
  ): Promise<EnhanceResult> {
    const started = Date.now();
    if (markdown.length > ENHANCE_MAX_CHARS) {
      throw new Error(`Teks lebih dari ${ENHANCE_MAX_CHARS.toLocaleString("id-ID")} karakter, tidak dirapikan.`);
    }
    const chunks = splitForEnhance(markdown);
    const boilerplate = boilerplateLines(markdown);
    const results: string[] = new Array(chunks.length);
    const notes: string[] = [];
    let rejected = 0;
    let failed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let provider: string | null = null;
    let model: string | null = null;
    let firstError: unknown;

    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const index = next++;
        const chunk = chunks[index];
        const prompt = buildEnhancePrompt(chunk, { ...context, part: index + 1, parts: chunks.length });
        inputTokens += estimateTokens(prompt);
        try {
          const answer = await this.ai.generate(userId, prompt, [], "document");
          provider ??= answer.provider;
          model ??= answer.model;
          const text = cleanEnhanceOutput(answer.text);
          outputTokens += estimateTokens(answer.text);
          const check = checkEnhanced(chunk, text, boilerplate);
          if (check.ok) {
            results[index] = text;
          } else {
            rejected++;
            results[index] = chunk;
            notes.push(`Bagian ${index + 1}: hasil AI ditolak (${check.reason}), teks asli dipakai.`);
          }
        } catch (error) {
          firstError ??= error;
          failed++;
          results[index] = chunk;
          notes.push(`Bagian ${index + 1}: AI gagal, teks asli dipakai.`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
    if (failed === chunks.length && firstError) throw firstError;
    const result: EnhanceResult = {
      markdown: results.join("\n\n").trim() + "\n",
      parts: chunks.length,
      rejected,
      failed,
      inputTokens,
      outputTokens,
      provider,
      model,
      durationMs: Date.now() - started,
      notes,
    };
    this.logger.log(
      `Rapikan ${context.fileName}: ${chunks.length} bagian, ditolak ${rejected}, gagal ${failed}, ± ${inputTokens}/${outputTokens} token`,
    );
    return result;
  }
}
