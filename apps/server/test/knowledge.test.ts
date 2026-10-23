/**
 * The learning loop end to end: a successful result becomes an automatic
 * example, 👍 verifies it, 👎 disables it and stores the correction, staff can
 * moderate, and the next question carries the matching knowledge into the AI
 * turn (as modelText, so the visible question stays clean).
 */
import { fakeTurn, type ChatRequest } from "@simha/llm";
import type { AgentEvent, Knowledge } from "@simha/shared";
import { describe, expect, it } from "vitest";
import { knowledgePrompt, userTurn } from "../src/agent/knowledge.ts";
import { makeTestApp, readEvents, testDb } from "./harness.ts";

const perPoliSql =
  "SELECT p.nm_poli AS poli, COUNT(*) AS jumlah FROM reg_periksa r JOIN poliklinik p ON p.kd_poli = r.kd_poli " +
  "WHERE r.tgl_registrasi BETWEEN '2026-10-01' AND '2026-10-31' GROUP BY p.nm_poli ORDER BY jumlah DESC, poli";

const lastToolResult = (request: ChatRequest): Record<string, unknown> => {
  const tool = request.messages.filter((m) => m.role === "tool").at(-1);
  if (tool?.role !== "tool") throw new Error("no tool result");
  return JSON.parse(tool.content) as Record<string, unknown>;
};

const renders = (events: ReadonlyArray<AgentEvent>) =>
  events.filter((e): e is Extract<AgentEvent, { _tag: "render" }> => e._tag === "render").map((e) => e.block);

const chartScript = () => [
  fakeTurn("Saya cek skema dulu.", [{ name: "lihatSkema", args: { kataKunci: "poli" } }]),
  fakeTurn("", [{ name: "jalankanQueryBaca", args: { sql: perPoliSql, alasan: "Kunjungan per poli Oktober 2026" } }]),
  (request: ChatRequest) =>
    fakeTurn("", [
      {
        name: "tampilkan",
        args: {
          tipe: "bar",
          judul: "Kunjungan per poli, Oktober 2026",
          queryId: lastToolResult(request)["queryId"],
          asumsi: "bulan ini = 1–31 Okt 2026",
          opsi: { satuan: "kunjungan" },
        },
      },
    ]),
  fakeTurn("Poli Gigi dan Poli Umum sama-sama 2 kunjungan."),
];

const listKnowledge = async (app: ReturnType<typeof makeTestApp>) =>
  (await (await app.call("GET", "/knowledge")).json()) as ReadonlyArray<Knowledge>;

const knowledgeItem = (id: string, kind: "example" | "note", text: string): Knowledge => ({
  id,
  kind,
  source: kind === "example" ? "auto" : "staff",
  text,
  sql: kind === "example" ? "SELECT 1" : null,
  renderType: kind === "example" ? "table" : null,
  title: null,
  verified: false,
  active: true,
  createdBy: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  uses: 0,
  lastUsedAt: null,
});

describe("knowledge prompt", () => {
  it("labels examples and notes and caps the block", () => {
    const prompt = knowledgePrompt([
      { item: knowledgeItem("a", "example", "Berapa pasien BPJS?"), score: 1 },
      { item: knowledgeItem("b", "note", "Kode penjamin BPJS adalah BPJ."), score: 0.9 },
      { item: knowledgeItem("c", "note", "x".repeat(5_000)), score: 0.8 },
    ]);
    expect(prompt).toContain("[Pengetahuan dari pertanyaan sebelumnya]");
    expect(prompt).toContain("Contoh (otomatis, belum dicek)");
    expect(prompt).toContain("Catatan: Kode penjamin");
    expect(prompt.length).toBeLessThan(1_700);
    expect(knowledgePrompt([])).toBe("");
  });

  it("keeps the question as text and sends the knowledge block as modelText", () => {
    expect(userTurn("kedua", "[Pengetahuan]\n- x")).toEqual({
      role: "user",
      text: "kedua",
      modelText: "kedua\n\n[Pengetahuan]\n- x",
    });
    expect(userTurn("kedua", "")).toEqual({ role: "user", text: "kedua" });
  });
});

describe.skipIf(testDb === null)("knowledge over HTTP", () => {
  it("saves a successful answer as an automatic, unverified example", async () => {
    const app = makeTestApp(chartScript());
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Jumlah kunjungan per poli bulan ini" }));
      const [block] = renders(events);
      if (!block) throw new Error("no block");
      const items = await listKnowledge(app);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: "example",
        source: "auto",
        text: "Jumlah kunjungan per poli bulan ini",
        sql: perPoliSql,
        title: block.judul,
        renderType: "bar",
        verified: false,
        active: true,
        createdBy: "it-budi",
      });
    } finally {
      await app.dispose();
    }
  });

  it("verifies the example on 👍 and disables it on 👎 with a correction note", async () => {
    const app = makeTestApp(chartScript());
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Jumlah kunjungan per poli bulan ini" }));
      const [block] = renders(events);
      if (!block) throw new Error("no block");

      const up = await app.call("POST", "/knowledge/feedback", { blockId: block.id, rating: "up" });
      expect(up.status).toBe(200);
      let items = await listKnowledge(app);
      expect(items[0]).toMatchObject({ verified: true, active: true });

      const down = await app.call("POST", "/knowledge/feedback", {
        blockId: block.id,
        rating: "down",
        comment: "Poli tanpa kunjungan tidak perlu ditampilkan; pakai INNER JOIN yang sama.",
      });
      expect(down.status).toBe(200);
      items = await listKnowledge(app);
      expect(items.find((i) => i.kind === "example")).toMatchObject({ active: false });
      expect(items.find((i) => i.kind === "note")).toMatchObject({
        source: "feedback",
        text: "Poli tanpa kunjungan tidak perlu ditampilkan; pakai INNER JOIN yang sama.",
        active: true,
        verified: false,
      });
    } finally {
      await app.dispose();
    }
  });

  it("lets staff add a note and admin verify and delete it", async () => {
    const app = makeTestApp([]);
    try {
      const created = await app.call("POST", "/knowledge", { text: "Pasien BPJS memakai penjab kd_pj = BPJ." });
      expect(created.status).toBe(201);
      const item = (await created.json()) as Knowledge;
      expect(item).toMatchObject({ kind: "note", source: "staff", verified: false, active: true, createdBy: "it-budi" });

      const verified = await app.call("PATCH", `/knowledge/${item.id}`, { verified: true });
      expect(verified.status).toBe(200);
      expect(await verified.json()).toMatchObject({ verified: true });

      expect((await app.call("DELETE", `/knowledge/${item.id}`)).status).toBe(204);
      expect(await listKnowledge(app)).toEqual([]);

      // Staff cannot moderate.
      const staffCreated = await app.callAs("staff-budi", "POST", "/knowledge", { text: "Kode poli gigi U0010." });
      const staffItem = (await staffCreated.json()) as Knowledge;
      expect((await app.callAs("staff-budi", "PATCH", `/knowledge/${staffItem.id}`, { verified: true })).status).toBe(403);
    } finally {
      await app.dispose();
    }
  });

  it("refuses notes and corrections that contain patient or visit numbers", async () => {
    const app = makeTestApp([]);
    try {
      expect((await app.call("POST", "/knowledge", { text: "Pasien 2026/10/21/000002 pindah kamar." })).status).toBe(400);
      expect((await app.call("POST", "/knowledge", { text: "NIK 5171000000000001." })).status).toBe(400);
    } finally {
      await app.dispose();
    }
  });

  it("injects matching notes into modelText, not the visible question, and replays it on a follow-up", async () => {
    const app = makeTestApp([fakeTurn("ok"), fakeTurn("ok")]);
    try {
      await app.call("POST", "/knowledge", {
        text: "Pasien BPJS memakai penjab kd_pj = BPJ; pasien umum memakai A09.",
      });
      const firstEvents = await readEvents(await app.call("POST", "/ask", { question: "Berapa pasien BPJS bulan ini?" }));
      const firstStarted = firstEvents[0];
      if (firstStarted?._tag !== "run_started") throw new Error("expected run_started");
      const first = app.fake.requests[0];
      const firstUser = first?.messages.find((m) => m.role === "user");
      expect(firstUser?.role === "user" && firstUser.modelText).toContain("[Pengetahuan dari pertanyaan sebelumnya]");
      expect(firstUser?.role === "user" && firstUser.modelText).toContain("kd_pj = BPJ");
      expect(firstUser?.role === "user" && firstUser.text).not.toContain("[Pengetahuan");

      // The stored question stays plain; the modelText rides along so the next
      // request replays exactly what the model saw (and the cache prefix matches).
      const started = await readEvents(
        await app.call("POST", "/ask", {
          question: "Kalau minggu lalu?",
          conversationId: firstStarted.conversationId,
        }),
      );
      const runStarted = started[0];
      if (runStarted?._tag !== "run_started") throw new Error("expected run_started");
      const replay = app.fake.requests[1]?.messages.find((m) => m.role === "user");
      expect(replay?.role === "user" && replay.text).not.toContain("[Pengetahuan");
      expect(replay?.role === "user" && replay.modelText).toContain("[Pengetahuan dari pertanyaan sebelumnya]");
      const transcript = (await (await app.call("GET", `/conversations/${runStarted.conversationId}`)).json()) as {
        runs: ReadonlyArray<{ question: string }>;
      };
      expect(transcript.runs.map((r) => r.question)).toContain("Kalau minggu lalu?");
    } finally {
      await app.dispose();
    }
  });

  it("saves a text answer on 👍 and a correction on 👎", async () => {
    const app = makeTestApp([fakeTurn("Grup A berisi registrasi dan billing."), fakeTurn("Grup B adalah barcode.")]);
    try {
      const first = await readEvents(await app.call("POST", "/ask", { question: "Apa isi grup A?" }));
      const started = first[0];
      if (started?._tag !== "run_started") throw new Error("expected run_started");
      const up = await app.call("POST", "/knowledge/feedback", { runId: started.runId, rating: "up" });
      expect(up.status).toBe(200);
      let items = await listKnowledge(app);
      const note = items.find((i) => i.kind === "note");
      expect(note).toMatchObject({ source: "feedback", verified: true, active: true });
      expect(note?.text).toContain("Apa isi grup A?");
      expect(note?.text).toContain("Grup A berisi registrasi dan billing.");

      const second = await readEvents(await app.call("POST", "/ask", { question: "Apa isi grup B?" }));
      const secondStarted = second[0];
      if (secondStarted?._tag !== "run_started") throw new Error("expected run_started");
      const down = await app.call("POST", "/knowledge/feedback", {
        runId: secondStarted.runId,
        rating: "down",
        comment: "Grup B bukan barcode; itu ada di grup lain.",
      });
      expect(down.status).toBe(200);
      items = await listKnowledge(app);
      expect(items.find((i) => i.text === "Grup B bukan barcode; itu ada di grup lain.")).toMatchObject({
        kind: "note",
        source: "feedback",
        active: true,
      });
    } finally {
      await app.dispose();
    }
  });

  it("requires exactly one feedback target", async () => {
    const app = makeTestApp([]);
    try {
      expect((await app.call("POST", "/knowledge/feedback", { rating: "up" })).status).toBe(400);
      expect(
        (await app.call("POST", "/knowledge/feedback", { blockId: "b", runId: "r", rating: "up" })).status,
      ).toBe(400);
    } finally {
      await app.dispose();
    }
  });

  it("lets the AI save its own note with catatPengetahuan", async () => {
    const app = makeTestApp([
      fakeTurn("", [{ name: "catatPengetahuan", args: { catatan: "Kamar Melati memakai kd_bangsal MW.", judul: "Kode bangsal Melati" } }]),
      fakeTurn("Catatan disimpan."),
    ]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Catat kode bangsal Melati" }));
      expect(events.find((e) => e._tag === "tool_finished")).toMatchObject({ name: "catatPengetahuan", ok: true });
      const items = await listKnowledge(app);
      expect(items[0]).toMatchObject({
        kind: "note",
        source: "ai",
        title: "Kode bangsal Melati",
        text: "Kamar Melati memakai kd_bangsal MW.",
        verified: false,
        active: true,
      });
    } finally {
      await app.dispose();
    }
  });

  it("offers catatPengetahuan to the model", async () => {
    const app = makeTestApp([fakeTurn("ok")]);
    try {
      await readEvents(await app.call("POST", "/ask", { question: "Halo" }));
      expect(app.fake.requests[0]?.tools.map((t) => t.name)).toContain("catatPengetahuan");
    } finally {
      await app.dispose();
    }
  });
});
