/** Aturan isian profil akun (logika murni, diuji di profile-logic.spec.ts). */

export interface ProfileInput {
  phone?: string | null;
  address?: string | null;
  occupation?: string | null;
  workplace?: string | null;
}

export type ProfileFields = { [K in keyof Required<ProfileInput>]?: string | null };

export const PROFILE_LIMITS = { phone: 30, address: 300, occupation: 100, workplace: 150 } as const;

/**
 * Nomor HP → bentuk baku "+62812…": spasi, titik, tanda hubung, kurung dibuang; awalan 0 (Indonesia) → +62.
 * null bila tidak sah (8–15 angka setelah kode negara).
 */
export function normalizePhone(raw: string): string | null {
  const compact = raw.replace(/[\s.\-()]/g, "");
  let digits: string;
  if (/^\+\d+$/.test(compact)) digits = compact.slice(1);
  else if (/^00\d+$/.test(compact)) digits = compact.slice(2);
  else if (/^0\d+$/.test(compact)) digits = `62${compact.slice(1)}`;
  else if (/^62\d+$/.test(compact)) digits = compact;
  else return null;
  if (digits.length < 9 || digits.length > 15) return null;
  return `+${digits}`;
}

/**
 * Isian profil yang dikirim → nilai untuk disimpan (hanya key yang dikirim; teks kosong = dihapus) atau pesan galat.
 */
export function profileChanges(input: ProfileInput): { fields: ProfileFields } | { error: string } {
  const fields: ProfileFields = {};
  for (const key of Object.keys(PROFILE_LIMITS) as (keyof ProfileInput)[]) {
    const value = input[key];
    if (value === undefined) continue;
    const text = (value ?? "").replace(/\s+/g, " ").trim();
    if (!text) {
      fields[key] = null;
      continue;
    }
    if (text.length > PROFILE_LIMITS[key])
      return { error: `Isian terlalu panjang (maks. ${PROFILE_LIMITS[key]} karakter).` };
    if (key === "phone") {
      const phone = normalizePhone(text);
      if (!phone) return { error: "Nomor HP tidak valid. Contoh: 0812 3456 7890 atau +62 812 3456 7890." };
      fields.phone = phone;
    } else fields[key] = text;
  }
  return { fields };
}
