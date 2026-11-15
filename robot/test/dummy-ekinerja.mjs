// Uji Kirim Penilaian Ke Atasan TANPA e-Kinerja sungguhan (docs/AI-AGENT.md §21.16): halaman e-Kinerja tiruan berisi data
// dummy di localhost DALAM container robot, lalu robot dipanggil langsung untuk 7 skenario (ready, mismatch, incomplete,
// sudah diajukan, dialog asing dibatalkan, konfirmasi dummy → sent). Menjalankan (robot menyala):
//   wsl -e sh -c "docker cp /mnt/d/Development/Application/LifeOS/robot/test/dummy-ekinerja.mjs lifeos-robot:/tmp/ && docker exec lifeos-robot node /tmp/dummy-ekinerja.mjs"

import { createServer } from "node:http";

const PORT = 4999;
const ROBOT = `http://127.0.0.1:${process.env.PORT ?? 4100}`;
const TOKEN = process.env.ROBOT_TOKEN ?? "";
const sent = new Set();

// SKP 1 = lengkap + konfirmasi dikenal; 2 = baris belum diisi; 3 = dialog tak dikenal; 4 = sudah diajukan
const row = (rhk, full) => `<tr><td>1</td><td>RHK ${rhk} Indikator Jumlah Laporan</td><td>
  Renaksi ${full ? "<ol><li>Menyusun laporan dummy</li></ol>" : "Belum diisi"}
  Realisasi ${full ? "<ol><li>Laporan dummy Oktober</li></ol>" : "Belum diisi"}
  Bukti Data Dukung ${full ? "<ol><li>https://contoh.test/bukti</li></ol>" : "Belum diisi"}</td>
  <td><button>Isi Rencana Aksi</button></td></tr>`;

function page(id) {
  const submitted = sent.has(id) || id === "4";
  const october = submitted
    ? `<div>oktober</div><table><thead><tr><th>No</th><th>Indikator</th><th>Rencana Aksi dan Realisasi</th><th>Feedback</th></tr></thead>
       <tbody>${row("Uji Dummy", true)}</tbody></table><span>Tanggal Pengajuan Penilaiaan : 15-11-2026 ( Hari Kerja Ke-10 )</span>`
    : `<div>oktober</div><table><thead><tr><th>No</th><th>Indikator</th><th>Rencana Aksi dan Realisasi</th><th>Aksi</th></tr></thead>
       <tbody>${row("Uji Dummy", id !== "2")}</tbody></table>
       <div role="group"><button> Edit Rencana Aksi Kerja</button><button id="kirim"> Kirim Penilaiaan Ke Atasan</button></div>`;
  return `<!doctype html><html><body>
  <div>januari Rating Hasil Kerja : SESUAI</div>
  ${october}
  <div>november Belum ada pengisian Rencana Aksi</div><button>Isi Rencana Aksi Kerja Bulan november</button>
  <script>
    const box = (html) => { const d = document.createElement("div"); d.className = "swal2-popup"; d.innerHTML = html; document.body.append(d); return d; };
    document.getElementById("kirim")?.addEventListener("click", () => {
      const d = ${id === "3"} ? box("Pilih atasan penilai: <select><option>A</option></select> <button>OK</button>")
        : box("Apakah Anda yakin akan mengirim penilaian ke atasan? <button id='ya'>Ya, Kirim</button> <button>Batal</button>");
      d.querySelector("#ya")?.addEventListener("click", async () => {
        await fetch("/sent?id=${id}", { method: "POST" });
        d.remove();
        box("Berhasil diajukan <button onclick='this.parentElement.remove()'>OK</button>");
      });
    });
  </script></body></html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/sent") {
    sent.add(url.searchParams.get("id"));
    return res.end("ok");
  }
  const m = /^\/skp\/renaksi\/(\d+)$/.exec(url.pathname);
  res.setHeader("content-type", "text/html");
  res.end(m ? page(m[1]) : "<html><body>dummy</body></html>");
});
await new Promise((r) => server.listen(PORT, r));

const call = async (skp, extra = {}) => {
  const r = await fetch(`${ROBOT}/jobs/ekinerja/renaksi/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      baseUrl: `http://127.0.0.1:${PORT}`,
      skpExternalId: skp,
      period: "2026-10",
      expectedKeys: ["RHK Uji Dummy Indikator Jumlah Laporan"],
      ...extra,
    }),
  });
  const j = await r.json();
  return { http: r.status, status: j.status, message: j.message, incomplete: j.incomplete, difference: j.difference };
};

const results = {
  "1 tanpa confirm (dryRun: false diabaikan)": await call("1", { dryRun: false }),
  "1 sesudahnya masih draf (tidak terkirim)": sent.has("1") ? "TERKIRIM — SALAH" : "belum terkirim ✓",
  "1 isi beda dengan LifeOS": await call("1", { expectedKeys: ["RHK Lain Indikator X"] }),
  "2 baris belum diisi": await call("2"),
  "4 sudah diajukan": await call("4"),
  "3 kirim + dialog tak dikenal": await call("3", { dryRun: false, confirm: "KIRIM_PENILAIAN" }),
  "3 sesudahnya": sent.has("3") ? "TERKIRIM — SALAH" : "belum terkirim ✓",
  "1 kirim dummy (confirm)": await call("1", { dryRun: false, confirm: "KIRIM_PENILAIAN" }),
};
console.log(JSON.stringify(results, null, 1));
server.close();
