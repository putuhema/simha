import type { AgentEvent, RenderBlock } from "@simha/shared";
import { describe, expect, it } from "vitest";
import { chartOption } from "../components/blocks/chart-options.ts";
import { rmFromSteps, rmFromText, splitAnswer } from "./answer.ts";
import { fileNameFor, toCsv } from "./csv.ts";
import { formMentioned, noRawatIn, noRmIn } from "./desktop.ts";
import { formatAgo, formatRelative } from "./format.ts";
import { cardsByTurn, cardsFromTurns } from "./cards.ts";
import { applyEvent, emptyRun } from "./run.ts";
import { parseSseChunk } from "./sse.ts";
import { draftPreview, stepMark, stepSummary, type StepView } from "./steps.ts";

describe("parseSseChunk", () => {
  it("returns complete events and keeps the unfinished rest", () => {
    const text =
      'event: text_delta\ndata: {"_tag":"text_delta","text":"Ha"}\n\n' +
      'event: text_delta\r\ndata: {"_tag":"text_delta","text":"lo"}\r\n\r\n' +
      'event: done\ndata: {"_tag":"do';
    const { events, rest } = parseSseChunk(text);
    expect(events).toEqual([
      { _tag: "text_delta", text: "Ha" },
      { _tag: "text_delta", text: "lo" },
    ]);
    expect(rest).toBe('event: done\ndata: {"_tag":"do');
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and newlines, adds a BOM, and defuses spreadsheet formulas", () => {
    const csv = toCsv(["nama", "jumlah", "catatan"], [
      { nama: 'Poli "Gigi", lantai 2', jumlah: 3, catatan: "=HYPERLINK(1)" },
      { nama: "Umum", jumlah: -2, catatan: null },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "nama,jumlah,catatan",
      '"Poli ""Gigi"", lantai 2",3,\'=HYPERLINK(1)',
      "Umum,-2,",
      "",
    ]);
  });

  it("makes file names from titles", () => {
    expect(fileNameFor("10 Tindakan Terbanyak — Poli Gigi!")).toBe("10-tindakan-terbanyak-poli-gigi");
    expect(fileNameFor("???")).toBe("hasil");
  });
});

describe("splitAnswer", () => {
  it("splits the investigation sections, with bold or heading markers", () => {
    const text = "Ringkas.\n\n**Yang dicek**\n- a\n\n**Diagnosis**\nDua kamar aktif.\n\n### Saran perbaikan\nTutup MEL-02.";
    expect(splitAnswer(text)).toEqual({ intro: "Ringkas.", checked: "- a", diagnosis: "Dua kamar aktif.", suggestion: "Tutup MEL-02." });
  });

  it("keeps everything as the intro when there are no sections", () => {
    expect(splitAnswer("Ada 2 poli.")).toEqual({ intro: "Ada 2 poli.", checked: "", diagnosis: "", suggestion: "" });
  });
});

describe("RM detection", () => {
  it("finds the RM in the complaint or in tool calls", () => {
    expect(rmFromText("Pasien RM 012345 tidak bisa pindah")).toBe("012345");
    expect(rmFromText("no. RM: 000777")).toBe("000777");
    expect(rmFromText("kamar MAW-03 rusak")).toBeUndefined();
    expect(rmFromSteps([{ input: { noRawat: "x" }, output: { kunjungan: [{ no_rkm_medis: "000002" }] } }])).toBe("000002");
    expect(rmFromSteps([{ input: { noRkmMedis: "000009" }, output: null }])).toBe("000009");
  });
});

const step = (name: string, output: unknown, error: string | null = null): StepView => ({
  id: "1",
  name,
  input: {},
  output,
  error,
  durationMs: 5,
  running: false,
  draft: null,
});

describe("steps", () => {
  it("marks problems found by diagnose tools and failed calls", () => {
    expect(stepMark(step("diagnosaPindahKamar", { temuan: [], jumlahMasalah: 1 }))).toBe("warn");
    expect(stepMark(step("diagnosaPindahKamar", { temuan: [], jumlahMasalah: 0 }))).toBe("ok");
    expect(stepMark(step("riwayatKamar", { kamar: [{}, {}], jumlahAktif: 2 }))).toBe("warn");
    expect(stepMark(step("cariPasien", null, "Query ditolak"))).toBe("error");
    expect(stepSummary(step("jalankanQueryBaca", { jumlahBaris: 500, terpotong: true }))).toBe("500 baris (dipotong di 500)");
    expect(stepSummary(step("cariPasien", null, "Query ditolak"))).toBe("Query ditolak");
    expect(stepSummary(step("detailAplikasi", { alur: { langkah: [{}, {}] }, form: null, menu: null, hak: null }))).toBe("2 langkah");
    expect(
      stepSummary(step("detailAplikasi", { alur: null, form: { aksi: ["Simpan"], pintasan: [{}, {}] }, menu: null, hak: null })),
    ).toBe("1 tombol, 2 aksi klik-kanan");
  });
});

describe("applyEvent", () => {
  it("folds a streamed run into steps, blocks, fixes and the final text", () => {
    const block = { id: "b1", tipe: "stat" } as RenderBlock;
    const events: ReadonlyArray<AgentEvent> = [
      { _tag: "run_started", runId: "r1", conversationId: "c1", provider: "fake", model: "m" },
      { _tag: "text_delta", text: "Saya cek. " },
      { _tag: "tool_started", callId: "t1", name: "usulkanPerbaikan", args: { judul: "x" } },
      { _tag: "tool_finished", callId: "t1", name: "usulkanPerbaikan", ok: true, result: { fixId: "f1" }, durationMs: 3 },
      { _tag: "render", callId: "t2", block },
      { _tag: "done", runId: "r1", text: "Selesai.", stopReason: "end_turn", steps: 2 },
    ];
    const run = events.reduce(applyEvent, emptyRun("Pertanyaan", "tanya", "k"));
    expect(run).toMatchObject({ status: "done", runId: "r1", conversationId: "c1", model: "fake · m", text: "Selesai.", fixIds: ["f1"], blocks: [block] });
    expect(run.steps[0]).toMatchObject({ running: false, error: null, output: { fixId: "f1" } });
  });

  it("keeps earlier steps when a provider repeats a tool call id", () => {
    const events: ReadonlyArray<AgentEvent> = [
      { _tag: "tool_started", callId: "dup", name: "kunjunganAktif", args: {} },
      { _tag: "tool_finished", callId: "dup", name: "kunjunganAktif", ok: true, result: { n: 1 }, durationMs: 1 },
      { _tag: "tool_started", callId: "dup", name: "diagnosaPindahKamar", args: {} },
      { _tag: "tool_finished", callId: "dup", name: "diagnosaPindahKamar", ok: true, result: { jumlahMasalah: 1 }, durationMs: 2 },
    ];
    const run = events.reduce(applyEvent, emptyRun("q", "investigasi", "k"));
    expect(run.steps.map((s) => [s.name, s.output])).toEqual([
      ["kunjunganAktif", { n: 1 }],
      ["diagnosaPindahKamar", { jumlahMasalah: 1 }],
    ]);
  });

  it("shows a tool step while the AI is still writing it, then swaps in the real call", () => {
    const events: ReadonlyArray<AgentEvent> = [
      { _tag: "reasoning_delta", text: "Perlu hitung per poli." },
      { _tag: "tool_input_delta", draftId: "d0", name: "jalankanQueryBaca", delta: '{"sql":"SELECT nm' },
      { _tag: "tool_input_delta", draftId: "d0", name: "jalankanQueryBaca", delta: '_poli\\n FROM' },
    ];
    const drafting = events.reduce(applyEvent, emptyRun("q", "tanya", "k"));
    expect(drafting.reasoning).toBe("Perlu hitung per poli.");
    expect(drafting.steps).toHaveLength(1);
    expect(drafting.steps[0]).toMatchObject({ id: "d0", running: true, draft: '{"sql":"SELECT nm_poli\\n FROM' });
    expect(draftPreview(drafting.steps[0]?.draft ?? "")).toBe("SELECT nm_poli\n FROM");
    expect(stepSummary(drafting.steps[0]!)).toBe("AI sedang menulis query…");

    const started = applyEvent(drafting, { _tag: "tool_started", callId: "t1", name: "jalankanQueryBaca", args: { sql: "SELECT 1" }, draftId: "d0" });
    expect(started.steps).toEqual([expect.objectContaining({ id: "t1", draft: null, input: { sql: "SELECT 1" }, running: true })]);
    const finished = applyEvent(started, { _tag: "tool_finished", callId: "t1", name: "jalankanQueryBaca", ok: true, result: {}, durationMs: 1 });
    expect(finished.reasoning).toBe("");
  });

  it("previews half-written arguments without breaking on cut escapes", () => {
    expect(draftPreview('{"alasan":"x","sql":"SELECT \\"a')).toBe('SELECT "a');
    expect(draftPreview('{"sql":"SELECT 1\\')).toBe("SELECT 1");
    expect(draftPreview('{"judul":"Kunjungan per')).toBe("Kunjungan per");
    expect(draftPreview('{"lim')).toBe("");
  });

  it("keeps the error message of a failed run", () => {
    expect(applyEvent(emptyRun("q"), { _tag: "error", message: "401" })).toMatchObject({ status: "error", error: "401" });
  });
});

const block = (over: Partial<RenderBlock>): RenderBlock => ({
  id: "b",
  tipe: "bar",
  judul: "x",
  asumsi: null,
  queryId: "q",
  sql: "SELECT 1",
  kolom: ["poli", "jumlah"],
  baris: [
    { poli: "Umum", jumlah: 3 },
    { poli: "Gigi", jumlah: 2 },
  ],
  x: "poli",
  y: ["jumlah"],
  satuan: null,
  terpotong: false,
  ...over,
});

describe("chartOption", () => {

  it("uses whole-number ticks for counts and turns long labels into horizontal bars", () => {
    const short = chartOption(block({})) as { xAxis: { type: string }; yAxis: { minInterval?: number } };
    expect(short.xAxis.type).toBe("category");
    expect(short.yAxis.minInterval).toBe(1);
    const long = chartOption(block({ baris: [{ poli: "Poliklinik Gigi & Mulut", jumlah: 1.5 }] })) as {
      xAxis: { type: string; minInterval?: number };
      yAxis: { type: string };
    };
    expect(long.yAxis.type).toBe("category");
    expect(long.xAxis.minInterval).toBeUndefined();
  });

  it("builds pie slices from x and the first y column", () => {
    const pie = chartOption(block({ tipe: "pie" })) as { series: Array<{ data: Array<{ name: string; value: unknown }> }> };
    expect(pie.series[0]?.data).toEqual([
      { name: "Umum", value: 3 },
      { name: "Gigi", value: 2 },
    ]);
  });
});


const documentFixture = {
  id: "doc1",
  jenis: "riwayat" as const,
  judul: "Riwayat pasien",
  subjek: "RM 000002",
  ringkas: "1 kunjungan",
  dibuatOleh: null,
  dibuatPada: "2026-10-22T00:00:00Z",
};

const draftFixture = (over: Record<string, unknown>) => ({
  id: "dr1",
  form: "resume_ranap" as const,
  noRawat: "2026/10/21/000002",
  subjek: "RM 000002 · SITI AMINAH",
  existing: false,
  fields: {},
  sources: {},
  createdBy: null,
  updatedAt: "2026-10-22T00:00:00Z",
  ...over,
});

describe("formatRelative", () => {
  it("says minutes and hours ago", () => {
    const now = Date.parse("2026-10-22T10:00:00Z");
    expect(formatRelative("2026-10-22T09:59:30Z", now)).toBe("baru saja");
    expect(formatRelative("2026-10-22T09:45:00Z", now)).toBe("15 menit lalu");
    expect(formatRelative("2026-10-22T07:00:00Z", now)).toBe("3 jam lalu");
  });

  it("keeps the sidebar times short", () => {
    const now = Date.parse("2026-10-22T10:00:00Z");
    expect(formatAgo("2026-10-22T09:59:30Z", now)).toBe("baru");
    expect(formatAgo("2026-10-22T09:45:00Z", now)).toBe("15 mnt");
    expect(formatAgo("2026-10-22T07:00:00Z", now)).toBe("3 j");
  });
});

describe("cardsFromTurns", () => {
  it("collects every result once and keeps a draft's latest state in its first position", () => {
    const first = {
      ...emptyRun("Kunjungan", "tanya", "t1"),
      status: "done" as const,
      blocks: [block({ id: "b1", judul: "Kunjungan per poli" })],
      documents: [documentFixture],
      drafts: [draftFixture({})],
    };
    const second = {
      ...emptyRun("Pasien", "tanya", "t2"),
      status: "done" as const,
      blocks: [block({ id: "b2", judul: "Pasien daftar hari ini" })],
      drafts: [draftFixture({ fields: { jalannya_penyakit: "Membaik" }, updatedAt: "2026-10-22T01:00:00Z" })],
    };
    const cards = cardsFromTurns([first, second]);
    expect(cards.map((card) => [card.kind, card.label])).toEqual([
      ["render", "Kunjungan per poli"],
      ["draft", "Resume medis rawat inap"],
      ["document", "Riwayat pasien"],
      ["render", "Pasien daftar hari ini"],
    ]);
    const latest = cards[1];
    expect(latest?.kind === "draft" ? latest.draft.fields : null).toEqual({ jalannya_penyakit: "Membaik" });
  });

  it("labels render cards by type and gives radiology a stable turn key", () => {
    const gallery = {
      pemeriksaan: [],
      pacsCatatan: null,
      noRkmMedis: "000002",
      noRawat: null,
      rentang: null,
      cocokKunjungan: false,
      viewerBase: null,
      studies: [],
    };
    const run = { ...emptyRun("Radiologi", "tanya", "t3"), status: "done" as const, radiology: [gallery, gallery] };
    const cards = cardsFromTurns([run]);
    expect(cards.map((card) => [card.kind, card.badge, card.summary])).toEqual([
      ["radiology", "Radiologi", "RM 000002"],
      ["radiology", "Radiologi", "RM 000002"],
    ]);
    expect(cards[0]?.key).not.toBe(cards[1]?.key);
  });
});

describe("cardsByTurn", () => {
  it("keeps a turn's card array stable while another turn changes", () => {
    const first = { ...emptyRun("Kunjungan", "tanya", "t1"), status: "done" as const, blocks: [block({ id: "b1" })] };
    const second = emptyRun("Pasien", "tanya", "t2");
    const before = cardsByTurn([first, second]);
    // A step or token on the running turn gives it a new object; the finished
    // turn keeps its identity, so its reference-stable cards skip a re-render.
    const after = cardsByTurn([first, { ...second, text: "Halo" }]);
    expect(after.get("t1")).toBe(before.get("t1"));
    expect(after.get("t2")).not.toBe(before.get("t2"));
  });

  it("moves a later edit of a draft onto the turn that introduced it", () => {
    const first = { ...emptyRun("Kunjungan", "tanya", "t1"), status: "done" as const, drafts: [draftFixture({})] };
    const second = {
      ...emptyRun("Catatan", "tanya", "t2"),
      status: "done" as const,
      drafts: [draftFixture({ fields: { jalannya_penyakit: "Membaik" }, updatedAt: "2026-10-22T01:00:00Z" })],
    };
    const before = cardsByTurn([first]).get("t1")?.[0];
    const after = cardsByTurn([first, second]);
    const card = after.get("t1")?.[0];
    expect(after.get("t2")).toEqual([]);
    // The draft card is owned by the first turn, but shows the latest state.
    expect(card).not.toBe(before);
    expect(card?.kind === "draft" ? card.draft.fields : null).toEqual({ jalannya_penyakit: "Membaik" });
  });
});

describe("Khanza targets", () => {
  it("finds the no. rawat and the no. RM to open in Khanza", () => {
    expect(noRawatIn("Resume untuk 2024/02/21/000213 (RM 018412)")).toBe("2024/02/21/000213");
    expect(noRawatIn(null, "tidak ada", '{"noRawat":"2026/10/23/000001"}')).toBe("2026/10/23/000001");
    expect(noRmIn("RM 000002 · SITI AMINAH")).toBe("000002");
    expect(noRawatIn("RM 000002")).toBeNull();
  });

  it("only offers Khanza for answers about a form Khanza has", () => {
    expect(formMentioned("Buka menu resume medis rawat inap di Khanza, cari 2024/02/21/000213.")).toBe("resume");
    expect(formMentioned("Catatan CPPT terakhir ada di kunjungan ini; resume belum ada.")).toBe("soap");
    expect(formMentioned("Lihat riwayat perawatan pasien RM 018412.")).toBe("riwayat");
    expect(formMentioned("Jumlah kunjungan per poli 7 hari terakhir: IGD 412.")).toBeNull();
    expect(formMentioned("Pasien RM 000002 punya 2 kamar aktif.")).toBeNull();
  });
});
