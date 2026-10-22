/**
 * HTML for patient documents: one self-contained page per document (inline
 * CSS, no scripts, A4 print layout). Pure functions; every value from the
 * database is escaped, so free text in Khanza cannot inject markup.
 *
 * The content comes only from Khanza data. Nothing here is written by the AI.
 */
import type { CpptEntry, Diagnosis, Hospital, Identity, LabResult, Visit, VisitDetails } from "./data.ts";

export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Escaped text with line breaks kept; "–" for empty. */
const text = (value: string | null | undefined) =>
  value && value.trim() !== "" ? escapeHtml(value.trim()).replaceAll(/\r?\n/g, "<br>") : '<span class="muted">–</span>';

const formatDate = (iso: string | null) => {
  if (!iso || iso.startsWith("0000")) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}-${m}-${y}` : iso;
};

const STYLE = `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #17201e; font: 10.5pt/1.45 "Segoe UI", "Helvetica Neue", Arial, sans-serif; background: #fff; }
  .page { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }
  header.kop { display: flex; gap: 12px; align-items: center; border-bottom: 2.5px solid #12302c; padding-bottom: 8px; }
  header.kop img { height: 56px; width: auto; }
  header.kop .nama { font-size: 15pt; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; }
  header.kop .alamat { font-size: 9pt; color: #44504c; }
  h1 { font-size: 13pt; text-align: center; margin: 14px 0 2px; letter-spacing: .06em; text-transform: uppercase; }
  .sub { text-align: center; color: #44504c; font-size: 9.5pt; margin-bottom: 12px; }
  h2 { font-size: 10.5pt; margin: 16px 0 6px; padding: 3px 8px; background: #e7f0ee; border-left: 3px solid #0e6b62; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; }
  .ident td { padding: 2px 6px; vertical-align: top; }
  .ident td.k { width: 22%; color: #44504c; }
  table.grid th, table.grid td { border: 1px solid #b9c4c0; padding: 4px 6px; vertical-align: top; text-align: left; }
  table.grid th { background: #f1f4f3; font-size: 9pt; text-transform: uppercase; letter-spacing: .03em; }
  .soap b { display: inline-block; min-width: 14px; color: #0e6b62; }
  .soap div + div { margin-top: 3px; }
  .vital { font-size: 9pt; color: #44504c; }
  .visit { border: 1px solid #b9c4c0; border-radius: 4px; padding: 8px 10px; margin-bottom: 8px; break-inside: avoid; }
  .visit .head { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; }
  .visit .meta { color: #44504c; font-size: 9.5pt; }
  .visit dl { display: grid; grid-template-columns: 26mm 1fr; gap: 2px 8px; margin: 6px 0 0; }
  .visit dt { color: #44504c; }
  .visit dd { margin: 0; }
  .muted { color: #8a938f; }
  .flag { color: #b42318; font-weight: 600; }
  .note { margin-top: 8px; padding: 6px 8px; border: 1px dashed #b45309; color: #7c3a06; font-size: 9pt; }
  tr, .visit { page-break-inside: avoid; }
  h2 { break-after: avoid; page-break-after: avoid; }
  .nowrap { white-space: nowrap; }
  footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #b9c4c0; font-size: 8.5pt; color: #6b7571; display: flex; justify-content: space-between; gap: 12px; }
  .sign { margin-top: 26px; display: flex; justify-content: flex-end; }
  .sign div { width: 60mm; text-align: center; }
  .sign .line { margin-top: 48px; border-top: 1px solid #17201e; padding-top: 2px; }
  @media screen { body { background: #ecebe6; } .page { background: #fff; padding: 12mm 14mm; margin: 12px auto; box-shadow: 0 1px 4px rgb(0 0 0 / .15); } }
`;

export interface DocumentMeta {
  readonly hospital: Hospital;
  readonly generatedAt: Date;
  readonly generatedBy: string | null;
}

const page = (title: string, subtitle: string, body: string, meta: DocumentMeta) => {
  const when = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Makassar" }).format(
    meta.generatedAt,
  );
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} – ${escapeHtml(subtitle)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
<header class="kop">
${meta.hospital.logo ? `<img src="${escapeHtml(meta.hospital.logo)}" alt="">` : ""}
<div><div class="nama">${escapeHtml(meta.hospital.nama)}</div>
<div class="alamat">${escapeHtml(meta.hospital.alamat)}${meta.hospital.kontak ? `<br>${escapeHtml(meta.hospital.kontak)}` : ""}</div></div>
</header>
<h1>${escapeHtml(title)}</h1>
<div class="sub">${escapeHtml(subtitle)}</div>
${body}
<footer><span>Dibuat dari data SIMRS Khanza oleh SIMRS Harness${meta.generatedBy ? ` untuk ${escapeHtml(meta.generatedBy)}` : ""}, ${escapeHtml(when)}.</span><span>Periksa kembali sebelum digunakan.</span></footer>
</div>
</body>
</html>`;
};

const identityTable = (p: Identity, extra: ReadonlyArray<readonly [string, string | null]> = []) => `
<table class="ident">
<tr><td class="k">Nama pasien</td><td>: <b>${escapeHtml(p.nama)}</b></td><td class="k">No. rekam medis</td><td>: ${escapeHtml(p.noRkmMedis)}</td></tr>
<tr><td class="k">Jenis kelamin</td><td>: ${p.jk === "L" ? "Laki-laki" : p.jk === "P" ? "Perempuan" : escapeHtml(p.jk)}</td><td class="k">Tanggal lahir</td><td>: ${formatDate(p.tglLahir)}${p.umur ? ` (${escapeHtml(p.umur)})` : ""}</td></tr>
${extra.length > 0 ? extra.reduce((rows, [k, v], i) => rows + (i % 2 === 0 ? "<tr>" : "") + `<td class="k">${escapeHtml(k)}</td><td>: ${text(v)}</td>` + (i % 2 === 1 || i === extra.length - 1 ? "</tr>" : ""), "") : ""}
</table>`;

const diagnosisList = (diagnosis: ReadonlyArray<Diagnosis>) =>
  diagnosis.length === 0
    ? '<span class="muted">Belum ada diagnosis.</span>'
    : diagnosis
        .map((d, i) => `${i === 0 ? "<b>" : ""}${escapeHtml(d.kode)} – ${escapeHtml(d.nama ?? "")}${i === 0 ? "</b>" : ""}`)
        .join("<br>");

const visitExtra = (v: Visit): ReadonlyArray<readonly [string, string | null]> => [
  ["No. rawat", v.noRawat],
  ["Tanggal masuk", `${formatDate(v.tanggal)} ${v.jam ?? ""}`.trim()],
  ["Layanan", v.jenis + (v.poli ? ` · ${v.poli}` : "")],
  ["Dokter", v.dokter],
  ["Penjamin", v.penjamin],
  ["Status", [v.status, v.statusBayar].filter(Boolean).join(" · ")],
];

export const riwayatHtml = (
  data: { readonly identity: Identity; readonly visits: ReadonlyArray<VisitDetails>; readonly more: boolean },
  meta: DocumentMeta,
) => {
  const visits = data.visits
    .map(
      (v) => `
<section class="visit">
<div class="head"><span>${formatDate(v.tanggal)} · ${escapeHtml(v.jenis)}${v.poli ? ` · ${escapeHtml(v.poli)}` : ""}</span><span class="muted">${escapeHtml(v.noRawat)}</span></div>
<div class="meta">${escapeHtml([v.dokter, v.penjamin, v.status].filter(Boolean).join(" · "))}</div>
<dl>
<dt>Diagnosis</dt><dd>${diagnosisList(v.diagnosis)}</dd>
${v.kamar.length > 0 ? `<dt>Kamar</dt><dd>${v.kamar.map((k) => `${escapeHtml(k.kamar)}${k.bangsal ? ` (${escapeHtml(k.bangsal)})` : ""} ${escapeHtml(k.masuk ?? "")} → ${escapeHtml(k.keluar ?? "sekarang")}${k.status ? ` · ${escapeHtml(k.status)}` : ""}`).join("<br>")}</dd>` : ""}
${v.tindakan.length > 0 ? `<dt>Tindakan</dt><dd>${v.tindakan.map(escapeHtml).join(", ")}</dd>` : ""}
${v.obat.length > 0 ? `<dt>Obat</dt><dd>${v.obat.map((o) => `${escapeHtml(o.nama)} × ${escapeHtml(o.jumlah)}`).join(", ")}</dd>` : ""}
</dl>
</section>`,
    )
    .join("");
  const body = `${identityTable(data.identity, [["Penjamin", data.identity.penjamin]])}
<h2>Kunjungan (${data.visits.length}${data.more ? `, terbaru` : ""})</h2>
${visits || '<p class="muted">Belum ada kunjungan.</p>'}
${data.more ? `<p class="note">Hanya ${data.visits.length} kunjungan terakhir yang ditampilkan.</p>` : ""}`;
  return page("Riwayat Pasien", `RM ${data.identity.noRkmMedis} · ${data.identity.nama ?? ""}`, body, meta);
};

const labTable = (lab: ReadonlyArray<LabResult>) =>
  lab.length === 0
    ? ""
    : `<h2>Hasil laboratorium</h2>
<table class="grid"><tr><th>Tanggal</th><th>Pemeriksaan</th><th>Hasil</th><th>Satuan</th><th>Nilai rujukan</th><th>Ket.</th></tr>
${lab.map((l) => `<tr><td class="nowrap">${formatDate(l.tanggal)}</td><td>${escapeHtml(l.item ?? l.jenisPemeriksaan ?? "")}</td><td${l.keterangan ? ' class="flag"' : ""}>${escapeHtml(l.nilai)}</td><td>${escapeHtml(l.satuan)}</td><td>${escapeHtml(l.rujukan)}</td><td>${escapeHtml(l.keterangan)}</td></tr>`).join("")}
</table>`;

const radiologyList = (items: ReadonlyArray<{ readonly tanggal: string | null; readonly laporanRadiologi: string | null }>) =>
  items.length === 0
    ? ""
    : `<h2>Radiologi</h2>
<table class="grid"><tr><th style="width:22mm">Tanggal</th><th>Hasil bacaan</th></tr>
${items.map((r) => `<tr><td>${formatDate(r.tanggal)}</td><td>${text(r.laporanRadiologi)}</td></tr>`).join("")}</table>`;

export const cpptHtml = (
  data: {
    readonly identity: Identity;
    readonly visit: Visit;
    readonly diagnosis: ReadonlyArray<Diagnosis>;
    readonly entries: ReadonlyArray<CpptEntry>;
    readonly lab: ReadonlyArray<LabResult>;
    readonly radiology: ReadonlyArray<{ readonly tanggal: string | null; readonly laporanRadiologi: string | null }>;
  },
  meta: DocumentMeta,
) => {
  const rows = data.entries
    .map(
      (e) => `<tr>
<td style="width:24mm" class="nowrap">${formatDate(e.tanggal)}<br><span class="muted">${escapeHtml(e.jam?.slice(0, 5))}</span></td>
<td style="width:30mm"><b>${escapeHtml(e.petugas)}</b><br><span class="muted">${escapeHtml(e.profesi)}</span></td>
<td class="soap">
<div><b>S</b> ${text(e.subjektif)}</div>
<div><b>O</b> ${text(e.objektif)}${e.tandaVital ? `<div class="vital">${escapeHtml(e.tandaVital)}</div>` : ""}</div>
<div><b>A</b> ${text(e.asesmen)}</div>
<div><b>P</b> ${text(e.plan)}</div>
</td>
<td style="width:42mm">${text(e.instruksi)}${e.evaluasi && e.evaluasi.trim() !== "-" ? `<div class="vital" style="margin-top:4px">Evaluasi: ${text(e.evaluasi)}</div>` : ""}</td>
</tr>`,
    )
    .join("");
  const allergies = [...new Set(data.entries.map((e) => e.alergi).filter((a): a is string => !!a && !/^(tidak ada|-)$/i.test(a.trim())))];
  const body = `${identityTable(data.identity, visitExtra(data.visit))}
<h2>Diagnosis</h2><p>${diagnosisList(data.diagnosis)}</p>
${allergies.length > 0 ? `<p class="flag">Alergi: ${allergies.map(escapeHtml).join(", ")}</p>` : ""}
<h2>Catatan perkembangan pasien terintegrasi (CPPT)</h2>
${data.entries.length === 0 ? '<p class="muted">Belum ada catatan SOAP untuk kunjungan ini.</p>' : `<table class="grid"><tr><th>Tanggal / jam</th><th>Profesional pemberi asuhan</th><th>Hasil asesmen (S O A P)</th><th>Instruksi &amp; evaluasi</th></tr>${rows}</table>`}
${labTable(data.lab)}
${radiologyList(data.radiology)}`;
  return page("Catatan Perkembangan Pasien Terintegrasi", `${data.visit.noRawat} · ${data.identity.nama ?? ""}`, body, meta);
};

export const resumeHtml = (
  data: {
    readonly identity: Identity;
    readonly visit: VisitDetails;
    readonly resume: { readonly dokter: string | null; readonly bagian: ReadonlyArray<{ readonly label: string; readonly isiResume: string }> } | null;
    readonly firstEntry: CpptEntry | undefined;
    readonly lab: ReadonlyArray<LabResult>;
  },
  meta: DocumentMeta,
) => {
  const fromKhanza = data.resume !== null;
  const rows: ReadonlyArray<{ label: string; isi: string | null }> = fromKhanza
    ? (data.resume?.bagian ?? []).map((b) => ({ label: b.label, isi: b.isiResume }))
    : [
        { label: "Keluhan utama", isi: data.firstEntry?.subjektif ?? null },
        { label: "Pemeriksaan fisik", isi: [data.firstEntry?.objektif, data.firstEntry?.tandaVital].filter(Boolean).join("\n") || null },
        { label: "Jalannya penyakit", isi: null },
        { label: "Diagnosa utama", isi: data.visit.diagnosis[0] ? `${data.visit.diagnosis[0].nama ?? ""} (${data.visit.diagnosis[0].kode})` : null },
        { label: "Diagnosa sekunder", isi: data.visit.diagnosis.slice(1).map((d) => `${d.nama ?? ""} (${d.kode})`).join("\n") || null },
        { label: "Tindakan", isi: data.visit.tindakan.join(", ") || null },
        { label: "Obat selama dirawat", isi: data.visit.obat.map((o) => `${o.nama} × ${o.jumlah}`).join(", ") || null },
        { label: "Keadaan pulang", isi: null },
        { label: "Obat pulang / kontrol", isi: null },
      ];
  const body = `${identityTable(data.identity, visitExtra(data.visit))}
${fromKhanza ? "" : '<p class="note">Belum ada resume medis di Khanza untuk kunjungan ini. Ini <b>draf</b> yang disusun otomatis dari CPPT, diagnosis, tindakan dan obat; kolom kosong diisi oleh dokter.</p>'}
<h2>Resume medis</h2>
<table class="grid">${rows.map((r) => `<tr><th style="width:42mm">${escapeHtml(r.label)}</th><td>${text(r.isi)}</td></tr>`).join("")}</table>
${labTable(data.lab)}
<div class="sign"><div>Dokter penanggung jawab<div class="line">${escapeHtml(data.resume?.dokter ?? data.visit.dokter ?? "")}</div></div></div>`;
  return page(fromKhanza ? "Resume Medis" : "Draf Resume Medis", `${data.visit.noRawat} · ${data.identity.nama ?? ""}`, body, meta);
};
