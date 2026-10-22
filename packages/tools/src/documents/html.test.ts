import { describe, expect, it } from "vitest";
import { maskPii } from "../privacy/mask.ts";
import type { CpptEntry, Identity, Visit } from "./data.ts";
import { cpptHtml, escapeHtml } from "./html.ts";

const identity: Identity = { noRkmMedis: "000009", nama: "UJI <b>TEBAL</b>", jk: "P", tglLahir: "1990-01-02", umur: "36 Th", penjamin: "UMUM" };
const visit: Visit = {
  noRawat: "2026/10/22/000009",
  tanggal: "2026-10-22",
  jam: "08:00:00",
  jenis: "Rawat inap",
  poli: null,
  dokter: "dr. Uji",
  penjamin: "UMUM",
  status: "Dirawat",
  statusBayar: "Belum Bayar",
};
const entry: CpptEntry = {
  tanggal: "2026-10-22",
  jam: "09:15:00",
  petugas: "Ns. Uji",
  profesi: "Perawat/tenaga lain",
  layanan: "Rawat inap",
  tandaVital: "TD 120/80 mmHg",
  subjektif: '<script>alert(1)</script>\n<img src=x onerror="alert(2)">',
  objektif: "Baik",
  asesmen: null,
  plan: "Lanjut",
  instruksi: "Observasi",
  evaluasi: "-",
  alergi: "Penisilin",
};
const meta = { hospital: { nama: "RS UJI", alamat: "Jl. Uji", kontak: "", logo: null }, generatedAt: new Date("2026-10-22T02:00:00Z"), generatedBy: "it-budi" };

describe("document HTML", () => {
  it("escapes every database value, so notes cannot inject markup or scripts", () => {
    const html = cpptHtml({ identity, visit, diagnosis: [], entries: [entry], lab: [], radiology: [] }, meta);
    expect(html).not.toMatch(/<script|<img src=x|onerror="/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;<br>&lt;img src=x onerror=&quot;alert(2)&quot;&gt;");
    expect(html).toContain("UJI &lt;b&gt;TEBAL&lt;/b&gt;");
    expect(escapeHtml(`a&b'"`)).toBe("a&amp;b&#39;&quot;");
  });

  it("lays out SOAP with vital signs, allergies and the footer", () => {
    const html = cpptHtml({ identity, visit, diagnosis: [{ kode: "A09", nama: "Diare", prioritas: 1 }], entries: [entry], lab: [], radiology: [] }, meta);
    expect(html).toContain("<b>A09 – Diare</b>");
    expect(html).toContain("TD 120/80 mmHg");
    expect(html).toContain("Alergi: Penisilin");
    expect(html).toContain("22-10-2026");
    expect(html).toContain("untuk it-budi");
    expect(html).toContain("@page { size: A4");
  });
});

describe("masking clinical notes for external AI", () => {
  it("hides free text but keeps diagnoses, vital signs and lab values", () => {
    const masked = maskPii({
      cppt: [entry],
      diagnosis: [{ kode: "A09", nama: "Diare", prioritas: 1 }],
      lab: [{ item: "Hemoglobin", nilai: "14.2" }],
      resume: { bagian: [{ label: "Jalannya penyakit", isiResume: "Demam turun" }] },
      radiologi: [{ laporanRadiologi: "Normal" }],
      row: { keluhan: "nyeri", rtl: "obat", kd_penyakit: "A09" },
    }) as Record<string, unknown>;
    const json = JSON.stringify(masked);
    for (const secret of ["alert(1)", "Lanjut", "Observasi", "Demam turun", "Normal", "nyeri", '"obat"']) {
      expect(json).not.toContain(secret);
    }
    expect(json).toContain("[catatan klinis tidak dikirim ke AI]");
    for (const kept of ["Diare", "TD 120/80 mmHg", "14.2", "Hemoglobin", "A09", "Ns. Uji"]) expect(json).toContain(kept);
  });
});
