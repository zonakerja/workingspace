import type { AttachmentKind } from "./ai-providers";

/** Lampiran yang dikirim ke model AI (lewat gateway Akai). */
export interface AiAttachment {
  kind: AttachmentKind;
  mimeType: string;
  name: string;
  data: Buffer;
}

/** `credential` dipertahankan untuk data lama (alasan gagal tersimpan); jawaban Akai memakai jenis lain. */
export type AiErrorKind = "auth" | "quota" | "model" | "refusal" | "invalid" | "unavailable" | "credential";

/** Galat AI yang sudah diklasifikasikan; diterjemahkan ke HTTP oleh pemanggil (429 kuota / 422 lainnya). */
export class AiProviderError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    readonly providerMessage: string,
  ) {
    super(providerMessage);
    this.name = "AiProviderError";
  }
}
