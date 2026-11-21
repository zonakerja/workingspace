/**
 * Usulan perubahan skill dari agen (folder skill Hermes dipasang baca saja di container): agen mengirim isi SKILL.md lengkap,
 * pemilik menyetujui di Approval → Usulan Agen, lalu server menulis berkasnya. Logika murni (validasi & ringkasan beda) →
 * `skill-change.spec.ts`.
 */

export const SKILL_CHANGE_KIND = "skill_change";
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{1,48}$/;
export const SKILL_MAX_CHARS = 60_000;

/** Frontmatter `---\nname: …\ndescription: …\n---` → nama & deskripsi; null bila tidak ada. */
export function skillFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) return null;
  const field = (key: string) => {
    const line = match[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    return line
      ? line
          .slice(key.length + 1)
          .trim()
          .replace(/^["']|["']$/g, "")
      : "";
  };
  const name = field("name");
  const description = field("description");
  return name && description ? { name, description } : null;
}

/** Periksa usulan: nama skill sah, isi tidak kosong/terlalu panjang, frontmatter `name` = nama folder, ada deskripsi. */
export function checkSkillChange(input: { skill: string; content: string; summary: string }) {
  const skill = input.skill.trim();
  if (!SKILL_NAME.test(skill))
    return { error: "Nama skill hanya huruf kecil, angka, dan tanda hubung (2–49 karakter)." };
  const content = input.content.replace(/\r\n/g, "\n").trimEnd() + "\n";
  if (content.trim().length < 50) return { error: "Isi SKILL.md terlalu pendek." };
  if (content.length > SKILL_MAX_CHARS) return { error: `Isi SKILL.md lebih dari ${SKILL_MAX_CHARS} karakter.` };
  const front = skillFrontmatter(content);
  if (!front) return { error: "SKILL.md wajib diawali frontmatter --- name: … description: … ---." };
  if (front.name !== skill)
    return { error: `Frontmatter name "${front.name}" harus sama dengan nama skill "${skill}".` };
  const summary = input.summary.trim();
  if (summary.length < 5) return { error: "Jelaskan singkat apa yang diubah dan mengapa (summary)." };
  return { skill, content, summary: summary.slice(0, 2000), description: front.description };
}

/** Ringkasan beda baris (jumlah ditambah / dihapus) untuk judul & riwayat. */
export function lineChangeCount(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  const count = (list: string[]) => list.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const ca = count(a);
  const cb = count(b);
  let added = 0;
  let removed = 0;
  for (const [line, n] of cb) added += Math.max(0, n - (ca.get(line) ?? 0));
  for (const [line, n] of ca) removed += Math.max(0, n - (cb.get(line) ?? 0));
  return { added, removed };
}
