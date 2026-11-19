import type { ApiScope } from "../integrations/api-token-logic";
import { API_SCOPES } from "../integrations/api-token-logic";

/**
 * Logika murni penyiapan agen Hermes & proxy model (diuji di `agent-llm.spec.ts`).
 *
 * Hermes tidak menyimpan API key model: provider model Hermes = endpoint OpenAI-compatible Akasha (`/api/v1/agent/llm/v1`)
 * yang meneruskan permintaan ke gateway Akai (tugas Agen di Akai → Model). Hermes ↔ Akasha memakai satu kunci bersama
 * `HERMES_API_KEY` (= `API_SERVER_KEY` container) di dua arah: backend → API server Hermes, dan Hermes → Akasha (MCP + model)
 * sebagai token akses "Agen Hermes" milik pemilik agen.
 */

/** Nama model yang dilihat Hermes; model sungguhan dipilih Akai dari pembagian tugas akun. */
export const AGENT_MODEL_ID = "akasha-agent";

/** Nama & awalan token akses agen di Pengaturan → Integrasi (dibuat tombol "Siapkan agen"). */
export const AGENT_TOKEN_NAME = "Agen Hermes (otomatis)";
export const AGENT_TOKEN_PREFIX = "hermes";

/** Cakupan bawaan token agen: semua izin (bisa dikurangi user saat menyiapkan / dicabut di Integrasi). */
export const DEFAULT_AGENT_SCOPES: ApiScope[] = [...API_SCOPES];

/**
 * Panjang konteks yang dilaporkan ke Hermes (dipakai Hermes untuk memutuskan kapan meringkas riwayat). Sengaja konservatif:
 * model & cadangan dipilih Akai, jadi ringkasan lebih awal lebih aman daripada ditolak model.
 */
export const AGENT_CONTEXT_LENGTH = 128_000;

/** Respons `GET /models` untuk Hermes: satu model `akasha-agent`. */
export function modelsResponse(model: string | null) {
  return {
    object: "list",
    data: [
      {
        id: AGENT_MODEL_ID,
        object: "model",
        created: 0,
        owned_by: "akasha",
        context_length: AGENT_CONTEXT_LENGTH,
        ...(model ? { upstream_model: model } : {}),
      },
    ],
  };
}
