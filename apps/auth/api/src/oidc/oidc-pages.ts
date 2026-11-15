/** Halaman HTML kecil yang dirender oidc-provider sendiri (konfirmasi keluar, galat). Tanpa skrip/gaya luar. */

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STYLE = `body{font-family:system-ui,Arial,sans-serif;background:#f8fafc;color:#1f2937;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;border-radius:20px;padding:28px;max-width:380px;width:calc(100% - 32px);box-shadow:0 10px 30px rgba(15,23,42,.08)}
h1{font-size:20px;margin:0 0 8px}p{color:#4b5563;font-size:14px}button,a.btn{display:inline-block;margin-top:12px;padding:10px 18px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-size:14px;cursor:pointer;text-decoration:none}
@media (prefers-color-scheme:dark){body{background:#0f172a;color:#e5e7eb}main{background:#1e293b}p{color:#cbd5e1}}`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Workingspace</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/**
 * `form` = formulir bawaan oidc-provider (berisi token xsrf) → ditampilkan dengan tombol Keluar.
 * `form` null = sudah keluar.
 */
export function logoutPage(form: string | null, homeUrl?: string) {
  if (form === null)
    return page(
      "Sudah keluar",
      `<h1>Anda sudah keluar</h1><p>Sesi Workingspace di browser ini sudah diakhiri.</p>${homeUrl ? `<a class="btn" href="${escapeHtml(homeUrl)}">Masuk lagi</a>` : ""}`,
    );
  return page(
    "Keluar",
    `<h1>Keluar dari Workingspace?</h1><p>Anda akan keluar dari semua aplikasi Workingspace di browser ini.</p>${form}<button type="submit" form="op.logoutForm" name="logout" value="yes">Keluar</button>`,
  );
}

export function errorPage(message: string, homeUrl: string) {
  return page(
    "Galat",
    `<h1>Tidak bisa melanjutkan</h1><p>${escapeHtml(message)}</p><a class="btn" href="${escapeHtml(homeUrl)}">Kembali</a>`,
  );
}
