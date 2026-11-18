/** Isi email SSO (logika murni). Teks biasa + HTML sederhana tanpa gambar/skrip luar. */

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, name: string, lines: string[], action: { label: string; url: string }, footer: string) {
  const text = [
    `Halo ${name},`,
    "",
    ...lines,
    "",
    `${action.label}: ${action.url}`,
    "",
    footer,
    "",
    "— Workingspace",
  ].join("\n");
  const html = `<!doctype html><html lang="id"><body style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
<p>Halo ${escapeHtml(name)},</p>
${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(action.label)}</a></p>
<p style="font-size:12px;color:#6b7280">Bila tombol tidak bisa diklik, salin alamat ini ke browser:<br>${escapeHtml(action.url)}</p>
<p style="font-size:12px;color:#6b7280">${escapeHtml(footer)}</p>
<p style="font-size:12px;color:#6b7280">— Workingspace · workingspace.id</p>
</body></html>`;
  return { subject: title, text, html };
}

export function verifyEmail(name: string, url: string): MailContent {
  return layout(
    "Verifikasi email akun Workingspace",
    name,
    ["Terima kasih telah mendaftar. Klik tombol di bawah untuk memverifikasi email Anda. Tautan berlaku 24 jam."],
    { label: "Verifikasi email", url },
    "Bila Anda tidak merasa mendaftar, abaikan email ini.",
  );
}

export function resetPassword(name: string, url: string): MailContent {
  return layout(
    "Atur ulang kata sandi Workingspace",
    name,
    [
      "Kami menerima permintaan untuk mengatur ulang kata sandi akun Anda. Tautan berlaku 1 jam dan hanya bisa dipakai sekali.",
      "Setelah kata sandi diganti, Anda keluar dari semua perangkat.",
    ],
    { label: "Atur ulang kata sandi", url },
    "Bila Anda tidak meminta ini, abaikan email ini; kata sandi Anda tidak berubah.",
  );
}

export function inviteEmail(name: string, url: string): MailContent {
  return layout(
    "Undangan akun Workingspace",
    name,
    [
      "Admin Workingspace membuatkan akun untuk Anda. Klik tombol di bawah untuk membuat kata sandi. Tautan berlaku 3 hari dan hanya bisa dipakai sekali.",
      "Setelah itu masuk dengan email ini di semua aplikasi workingspace.id yang diberikan kepada Anda.",
    ],
    { label: "Buat kata sandi", url },
    "Bila Anda tidak mengenal undangan ini, abaikan email ini.",
  );
}

/** Tanggal untuk isi email (WIB). */
export const mailDate = (date: Date) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(date);

export function accessRequestedEmail(
  adminName: string,
  input: { requester: string; email: string; app: string; purpose: string; renewal: boolean },
  url: string,
): MailContent {
  return layout(
    `${input.renewal ? "Perpanjangan" : "Pengajuan"} akses ${input.app}`,
    adminName,
    [
      `${input.requester} (${input.email}) mengajukan ${input.renewal ? "perpanjangan akses" : "akses"} ke ${input.app}.`,
      `Tujuan / kepentingan: ${input.purpose}`,
    ],
    { label: "Tinjau pengajuan", url },
    "Email ini dikirim ke super admin Workingspace.",
  );
}

export function accessApprovedEmail(name: string, app: string, expiresAt: Date | null, url: string): MailContent {
  return layout(
    `Akses ${app} disetujui`,
    name,
    [
      `Pengajuan akses Anda ke ${app} disetujui.`,
      expiresAt
        ? `Akses berlaku sampai ${mailDate(expiresAt)}. Perpanjangan bisa diajukan dari halaman akun mulai 30 hari sebelumnya.`
        : "Akses berlaku tanpa batas waktu.",
    ],
    { label: `Buka ${app}`, url },
    "Masuk dengan akun Workingspace Anda.",
  );
}

export function accessRejectedEmail(name: string, app: string, note: string | null, url: string): MailContent {
  return layout(
    `Pengajuan akses ${app} belum disetujui`,
    name,
    [`Pengajuan akses Anda ke ${app} belum disetujui.`, ...(note ? [`Catatan admin: ${note}`] : [])],
    { label: "Buka halaman akun", url },
    "Anda bisa mengajukan lagi dengan tujuan yang lebih lengkap.",
  );
}

/** Pengingat masa akses (tahap di access-logic.ts). */
export function accessNoticeEmail(
  name: string,
  input: { app: string; stage: number; expiresAt: Date; deleteAt: Date },
  url: string,
): MailContent {
  const { app, stage, expiresAt, deleteAt } = input;
  const backup =
    "Cadangkan data Anda sebelum tanggal itu (fitur backup ke Google Drive tersedia di aplikasi saat siap).";
  const lines: Record<number, [string, string[]]> = {
    1: [
      `Akses ${app} berakhir dalam 7 hari`,
      [
        `Masa akses Anda ke ${app} berakhir pada ${mailDate(expiresAt)}.`,
        "Setelah itu data hanya bisa dibaca selama 180 hari. Ajukan perpanjangan dari halaman akun bila masih membutuhkan.",
      ],
    ],
    2: [
      `Akses ${app} berakhir — data kini baca saja`,
      [
        `Masa akses Anda ke ${app} berakhir pada ${mailDate(expiresAt)}. Data Anda dibekukan: masih bisa dibuka & dibaca, tetapi tidak bisa diubah.`,
        `Data akan dihapus permanen pada ${mailDate(deleteAt)}. ${backup}`,
      ],
    ],
    3: [
      `Data ${app} dihapus dalam 30 hari`,
      [`Data Anda di ${app} akan dihapus permanen pada ${mailDate(deleteAt)}.`, backup],
    ],
    4: [
      `Data ${app} dihapus dalam 7 hari`,
      [`Data Anda di ${app} akan dihapus permanen pada ${mailDate(deleteAt)}.`, backup],
    ],
    5: [`Data ${app} dihapus besok`, [`Data Anda di ${app} akan dihapus permanen pada ${mailDate(deleteAt)}.`, backup]],
  };
  const [title, body] = lines[stage] ?? lines[2];
  return layout(
    title,
    name,
    body,
    { label: "Ajukan perpanjangan", url },
    "Perpanjangan yang disetujui sebelum data dihapus memulihkan akses penuh.",
  );
}
