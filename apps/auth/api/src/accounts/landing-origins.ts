/** Asal halaman depan dari env LANDING_URL (dipisah koma) → daftar origin bersih (logika murni, diuji). */
export function landingOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? [url.origin] : [];
      } catch {
        return [];
      }
    });
}
