/**
 * Tanya Data end to end: the agent looks up the schema, runs a guarded
 * SELECT, shows the result as a render block with its SQL, and the result can
 * be saved as a favorite and re-run without the AI.
 */
import { fakeTurn, type ChatRequest } from "@simha/llm";
import type { AgentEvent, Favorite, RenderBlock } from "@simha/shared";
import { describe, expect, it } from "vitest";
import { makeTestApp, readEvents, testDb } from "./harness.ts";

const perPoliSql =
  "SELECT p.nm_poli AS poli, COUNT(*) AS jumlah FROM reg_periksa r JOIN poliklinik p ON p.kd_poli = r.kd_poli " +
  "WHERE r.tgl_registrasi BETWEEN '2026-10-01' AND '2026-10-31' GROUP BY p.nm_poli ORDER BY jumlah DESC, poli";

/** The last tool result the model received, parsed. */
const lastToolResult = (request: ChatRequest): Record<string, unknown> => {
  const tool = request.messages.filter((m) => m.role === "tool").at(-1);
  if (tool?.role !== "tool") throw new Error("no tool result");
  return JSON.parse(tool.content) as Record<string, unknown>;
};

const renders = (events: ReadonlyArray<AgentEvent>) =>
  events.filter((e): e is Extract<AgentEvent, { _tag: "render" }> => e._tag === "render").map((e) => e.block);

/** A scripted model that answers "kunjungan per poli bulan ini" with a bar chart. */
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
          asumsi: "bulan ini = 1–31 Okt 2026, semua jenis rawat",
          opsi: { satuan: "kunjungan" },
        },
      },
    ]),
  fakeTurn("Poli Gigi dan Poli Umum sama-sama 2 kunjungan."),
];

describe.skipIf(testDb === null)("Tanya Data over HTTP", () => {
  it("answers with a chart block that carries the SQL and the database rows", async () => {
    const app = makeTestApp(chartScript());
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Jumlah kunjungan per poli bulan ini" }));
      expect(events.map((e) => e._tag)).toEqual([
        "run_started",
        "text_delta",
        "tool_started",
        "tool_finished",
        "tool_started",
        "tool_finished",
        "tool_started",
        "tool_finished",
        "render",
        "text_delta",
        "done",
      ]);
      const [block] = renders(events);
      expect(block).toMatchObject({
        tipe: "bar",
        judul: "Kunjungan per poli, Oktober 2026",
        x: "poli",
        y: ["jumlah"],
        sql: `${perPoliSql}\nLIMIT 501`,
        asumsi: "bulan ini = 1–31 Okt 2026, semua jenis rawat",
        baris: [
          { poli: "Poli Gigi", jumlah: 2 },
          { poli: "Poli Umum", jumlah: 2 },
        ],
      });

      // The model got a short confirmation for tampilkan, not the rows again.
      const afterRender = app.fake.requests[3];
      const shown = afterRender ? lastToolResult(afterRender) : {};
      expect(shown).toMatchObject({ ditampilkan: true, tipe: "bar" });
      expect(shown).not.toHaveProperty("block");

      // The audit log links the question to the query that answered it.
      const started = events[0];
      if (started?._tag !== "run_started") throw new Error("expected run_started");
      const logged = await app.audit<{ question: string; sql: string }>(`
        SELECT r.question, q.sql FROM queries q
        JOIN tool_calls t ON t.id = q.tool_call_id JOIN agent_runs r ON r.id = t.session_id
        WHERE r.id = '${started.runId}' AND t.tool = 'jalankanQueryBaca' AND q.sql LIKE '%nm_poli%'`);
      expect(logged).toEqual([{ question: "Jumlah kunjungan per poli bulan ini", sql: expect.stringContaining("LIMIT 501") }]);
    } finally {
      await app.dispose();
    }
  });

  it("returns a rejected query to the model so it can fix it", async () => {
    const app = makeTestApp([
      fakeTurn("", [{ name: "jalankanQueryBaca", args: { sql: "SELECT nm_pasien, no_ktp FROM pasien", alasan: "daftar NIK" } }]),
      (request) => {
        const tool = request.messages.filter((m) => m.role === "tool").at(-1);
        return fakeTurn(tool?.role === "tool" && tool.isError ? `Ditolak: ${tool.content}` : "?");
      },
    ]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Daftar NIK pasien" }));
      const finished = events.find((e) => e._tag === "tool_finished");
      expect(finished).toMatchObject({ ok: false, error: expect.stringMatching(/no_ktp berisi data pribadi/) });
      expect(events.at(-1)).toMatchObject({ _tag: "done", text: expect.stringContaining("Query ditolak") });
      expect(renders(events)).toEqual([]);
    } finally {
      await app.dispose();
    }
  });

  it("saves a result as a favorite and re-runs it without the AI", async () => {
    const app = makeTestApp(chartScript());
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Jumlah kunjungan per poli bulan ini" }));
      const [block] = renders(events);
      if (!block) throw new Error("no block");

      const created = await app.call("POST", "/favorites", { blockId: block.id });
      expect(created.status).toBe(201);
      const favorite = (await created.json()) as Favorite;
      expect(favorite).toMatchObject({
        question: "Jumlah kunjungan per poli bulan ini",
        judul: block.judul,
        sql: perPoliSql,
        tipe: "bar",
        opsi: { x: "poli", y: ["jumlah"], satuan: "kunjungan" },
        asumsi: block.asumsi,
      });
      expect(((await (await app.call("GET", "/favorites")).json()) as Array<Favorite>).map((f) => f.id)).toEqual([favorite.id]);

      const requestsBefore = app.fake.requests.length;
      const run = await app.call("POST", `/favorites/${favorite.id}/run`);
      expect(run.status).toBe(200);
      const rerun = ((await run.json()) as { block: RenderBlock }).block;
      expect(rerun).toMatchObject({ tipe: "bar", sql: block.sql, baris: block.baris });
      expect(rerun.id).not.toBe(block.id);
      expect(app.fake.requests.length).toBe(requestsBefore);

      // The re-run went through the same tools and is in the audit log.
      const calls = await app.audit<{ tool: string }>(
        `SELECT tool FROM tool_calls WHERE session_id LIKE 'favorite:${favorite.id}:%' ORDER BY started_at`,
      );
      expect(calls.map((c) => c.tool)).toEqual(["jalankanQueryBaca", "tampilkan"]);

      expect((await app.call("DELETE", `/favorites/${favorite.id}`)).status).toBe(204);
      expect((await app.call("POST", `/favorites/${favorite.id}/run`)).status).toBe(404);
      expect((await app.call("POST", "/favorites", { blockId: "nope" })).status).toBe(404);
    } finally {
      await app.dispose();
    }
  });

  it("offers the Tanya Data tools to the model", async () => {
    const app = makeTestApp([fakeTurn("ok")]);
    try {
      await readEvents(await app.call("POST", "/ask", { question: "Halo" }));
      const names = app.fake.requests[0]?.tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["lihatSkema", "jalankanQueryBaca", "tampilkan"]));
    } finally {
      await app.dispose();
    }
  });
});
