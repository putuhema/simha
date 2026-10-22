import type { AgentEvent, RenderBlock } from "@simrs/shared";
import { describe, expect, it } from "vitest";
import { chartOption } from "../components/blocks/chart-options.ts";
import { rmFromSteps, rmFromText, splitAnswer } from "./answer.ts";
import { fileNameFor, toCsv } from "./csv.ts";
import { formatRelative } from "./format.ts";
import { applyEvent, emptyRun } from "./run.ts";
import { parseSseChunk } from "./sse.ts";
import { stepMark, stepSummary, type StepView } from "./steps.ts";

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
  it("splits the ticket sections, with bold or heading markers", () => {
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
});

describe("steps", () => {
  it("marks problems found by diagnose tools and failed calls", () => {
    expect(stepMark(step("diagnosaPindahKamar", { temuan: [], jumlahMasalah: 1 }))).toBe("warn");
    expect(stepMark(step("diagnosaPindahKamar", { temuan: [], jumlahMasalah: 0 }))).toBe("ok");
    expect(stepMark(step("riwayatKamar", { kamar: [{}, {}], jumlahAktif: 2 }))).toBe("warn");
    expect(stepMark(step("cariPasien", null, "Query ditolak"))).toBe("error");
    expect(stepSummary(step("jalankanQueryBaca", { jumlahBaris: 500, terpotong: true }))).toBe("500 baris (dipotong di 500)");
    expect(stepSummary(step("cariPasien", null, "Query ditolak"))).toBe("Query ditolak");
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
    const run = events.reduce(applyEvent, emptyRun("Pertanyaan", "k"));
    expect(run).toMatchObject({ status: "done", runId: "r1", conversationId: "c1", model: "fake · m", text: "Selesai.", fixIds: ["f1"], blocks: [block] });
    expect(run.steps[0]).toMatchObject({ running: false, error: null, output: { fixId: "f1" } });
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

describe("formatRelative", () => {
  it("says minutes and hours ago", () => {
    const now = Date.parse("2026-10-22T10:00:00Z");
    expect(formatRelative("2026-10-22T09:59:30Z", now)).toBe("baru saja");
    expect(formatRelative("2026-10-22T09:45:00Z", now)).toBe("15 menit lalu");
    expect(formatRelative("2026-10-22T07:00:00Z", now)).toBe("3 jam lalu");
  });
});
