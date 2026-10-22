/**
 * Tanya Data tools against the synthetic test database: jalankanQueryBaca's
 * guards (non-SELECT and protected columns never reach Khanza), the row
 * limit, the retry cap, tampilkan and lihatSkema.
 */
import { describe, expect, layer } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { jalankanQueryBaca, MAX_QUERY_FAILURES } from "../src/info/jalankanQueryBaca.ts";
import { lihatSkema } from "../src/info/lihatSkema.ts";
import { ResultStore, ResultStoreLive } from "../src/info/ResultStore.ts";
import { schemaDocsLayer } from "../src/info/SchemaDocs.ts";
import { tampilkan } from "../src/info/tampilkan.ts";
import { runTool } from "../src/tool.ts";
import { readTestLayer, testDb } from "./helpers.ts";

const DOCS = {
  schema: [
    "## `poliklinik`",
    "",
    "Purpose: Clinics",
    "",
    "| # | Column | Type | Null | Key | Default | Extra | Comment |",
    "|---|---|---|---|---|---|---|---|",
    "| 1 | `kd_poli` | char(5) | no | PRI |  |  |  |",
    "| 2 | `nm_poli` | varchar(50) | yes |  | NULL |  | name shown to patients |",
    "",
    "Foreign keys:",
    "",
    "- `kd_poli` → `reg_periksa.kd_poli`",
  ].join("\n"),
  notes: "# Notes\n\n- `kd_poli` for poli gigi is `GIG`.\n- Melati = TODO\n",
};

const perPoliSql =
  "SELECT p.nm_poli AS poli, COUNT(*) AS jumlah FROM reg_periksa r JOIN poliklinik p ON p.kd_poli = r.kd_poli GROUP BY p.nm_poli ORDER BY jumlah DESC";

/** Statements logged for the read pool, newest last. */
const loggedQueries = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return (yield* sql<{ sql: string }>`SELECT sql FROM queries ORDER BY id`).map((r) => r.sql);
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

describe.skipIf(testDb === null)("Tanya Data tools", () => {
  if (testDb === null) return;

  const testLayer = Layer.mergeAll(ResultStoreLive, schemaDocsLayer(DOCS)).pipe(Layer.provideMerge(readTestLayer(testDb)));

  layer(testLayer, { excludeTestServices: true })((it) => {
    it.effect("jalankanQueryBaca runs a SELECT, adds the row limit and stores the result", () =>
      Effect.gen(function* () {
        const out = yield* runTool(jalankanQueryBaca, { sql: perPoliSql, alasan: "kunjungan per poli" });
        expect(out.kolom).toEqual(["poli", "jumlah"]);
        expect(out.baris).toEqual([
          { poli: "Poli Umum", jumlah: 3 },
          { poli: "Poli Gigi", jumlah: 2 },
        ]);
        expect(out).toMatchObject({ jumlahBaris: 2, terpotong: false });
        expect(out.sql).toBe(`${perPoliSql}\nLIMIT 501`);

        const stored = yield* (yield* ResultStore).getResult(out.queryId);
        expect(stored).toMatchObject({ sqlOriginal: perPoliSql, sqlFinal: out.sql, reason: "kunjungan per poli" });
        expect((yield* loggedQueries).at(-1)).toContain("LIMIT 501");
      }),
    );

    const rejected: ReadonlyArray<readonly [string, RegExp]> = [
      ["UPDATE pasien SET nm_pasien = 'X' WHERE no_rkm_medis = '000001'", /Hanya query SELECT/],
      ["DELETE FROM reg_periksa", /Hanya query SELECT/],
      ["SELECT 1; DROP TABLE pasien", /satu query/],
      ["SELECT nm_pasien, no_ktp FROM pasien", /no_ktp berisi data pribadi/],
      ["SELECT p.nm_pasien, p.no_tlp FROM pasien p", /no_tlp berisi data pribadi/],
      ["SELECT nm_pasien, CONCAT('x', alamat) AS a FROM pasien", /alamat berisi data pribadi/],
      ["SELECT * FROM pasien", /SELECT \* dari tabel pasien.*no_ktp/],
    ];
    it.effect.each(rejected)("rejects %s before it reaches Khanza", ([sql, expected]) =>
      Effect.gen(function* () {
        const before = (yield* loggedQueries).length;
        const error = yield* Effect.flip(runTool(jalankanQueryBaca, { sql, alasan: "uji" }));
        expect(error._tag).toBe("ToolError");
        expect(message(error)).toMatch(expected);
        // Only the information_schema lookup of column names may have run, never the statement itself.
        const logged = (yield* loggedQueries).slice(before);
        expect(logged.every((q) => q.includes("information_schema.COLUMNS"))).toBe(true);
      }),
    );

    it.effect("protected columns may be filtered on and counted", () =>
      Effect.gen(function* () {
        const out = yield* runTool(jalankanQueryBaca, {
          sql: "SELECT COUNT(*) AS n, COUNT(DISTINCT no_ktp) AS ktp FROM pasien WHERE no_tlp LIKE '0813%'",
          alasan: "uji",
        });
        expect(out.baris).toEqual([{ n: 4, ktp: 4 }]);
      }),
    );

    it.effect("cuts results at 500 rows and tells the model it only sees 50", () =>
      Effect.gen(function* () {
        const out = yield* runTool(jalankanQueryBaca, {
          sql: "WITH RECURSIVE n AS (SELECT 1 AS x UNION ALL SELECT x + 1 FROM n WHERE x < 600) SELECT x FROM n",
          alasan: "uji batas baris",
        });
        expect(out).toMatchObject({ jumlahBaris: 500, terpotong: true });
        const forModel = jalankanQueryBaca.forModel?.(out) as { baris: ReadonlyArray<unknown>; catatan: string };
        expect(forModel.baris).toHaveLength(50);
        expect(forModel.catatan).toMatch(/50 dari 500.*dipotong di 500/);
      }),
    );

    it.effect("returns SQL errors to the model and stops after 3 failures in a row", () =>
      Effect.gen(function* () {
        const session = { sessionId: `run-${crypto.randomUUID()}` };
        const bad = { sql: "SELECT kolom_tidak_ada FROM poliklinik", alasan: "uji" };
        const first = yield* Effect.flip(runTool(jalankanQueryBaca, bad, session));
        expect(first._tag).toBe("KhanzaQueryError");
        expect(message(first)).toMatch(/kolom_tidak_ada/);
        // A guard rejection counts as a failure too.
        yield* Effect.flip(runTool(jalankanQueryBaca, { sql: "DELETE FROM poliklinik", alasan: "uji" }, session));
        yield* Effect.flip(runTool(jalankanQueryBaca, bad, session));
        const blocked = yield* Effect.flip(runTool(jalankanQueryBaca, { sql: perPoliSql, alasan: "uji" }, session));
        expect(message(blocked)).toMatch(new RegExp(`gagal ${MAX_QUERY_FAILURES} kali`));

        // Other runs are not affected.
        const other = yield* runTool(jalankanQueryBaca, { sql: perPoliSql, alasan: "uji" }, { sessionId: "run-lain" });
        expect(other.jumlahBaris).toBe(2);
      }),
    );

    it.effect("a successful query resets the failure count", () =>
      Effect.gen(function* () {
        const session = { sessionId: `run-${crypto.randomUUID()}` };
        const bad = { sql: "SELECT x FROM tabel_tidak_ada", alasan: "uji" };
        yield* Effect.flip(runTool(jalankanQueryBaca, bad, session));
        yield* Effect.flip(runTool(jalankanQueryBaca, bad, session));
        yield* runTool(jalankanQueryBaca, { sql: perPoliSql, alasan: "uji" }, session);
        yield* Effect.flip(runTool(jalankanQueryBaca, bad, session));
        yield* Effect.flip(runTool(jalankanQueryBaca, bad, session));
        expect((yield* runTool(jalankanQueryBaca, { sql: perPoliSql, alasan: "uji" }, session)).jumlahBaris).toBe(2);
      }),
    );

    it.effect("tampilkan builds a block from the stored rows, with the SQL", () =>
      Effect.gen(function* () {
        const query = yield* runTool(jalankanQueryBaca, { sql: perPoliSql, alasan: "uji" });
        const { block } = yield* runTool(tampilkan, {
          tipe: "bar",
          judul: "Kunjungan per poli",
          queryId: query.queryId,
          asumsi: "semua tanggal",
          opsi: { satuan: "kunjungan" },
        });
        expect(block).toMatchObject({
          tipe: "bar",
          x: "poli",
          y: ["jumlah"],
          sql: query.sql,
          asumsi: "semua tanggal",
          satuan: "kunjungan",
          baris: query.baris,
        });
        const stored = yield* (yield* ResultStore).getBlock(block.id);
        expect(stored?.block).toEqual(block);
        expect(tampilkan.forModel?.({ blockId: block.id, block })).not.toHaveProperty("baris");
      }),
    );

    it.effect("tampilkan rejects unknown query ids and columns", () =>
      Effect.gen(function* () {
        const missing = yield* Effect.flip(runTool(tampilkan, { tipe: "table", judul: "x", queryId: "tidak-ada" }));
        expect(message(missing)).toMatch(/tidak ditemukan/);
        const query = yield* runTool(jalankanQueryBaca, { sql: perPoliSql, alasan: "uji" });
        const wrong = yield* Effect.flip(
          runTool(tampilkan, { tipe: "bar", judul: "x", queryId: query.queryId, opsi: { y: ["total"] } }),
        );
        expect(message(wrong)).toMatch(/"total" tidak ada/);
        const stat = yield* Effect.flip(runTool(tampilkan, { tipe: "stat", judul: "x", queryId: query.queryId }));
        expect(message(stat)).toMatch(/tepat 1 baris/);
      }),
    );

    it.effect("lihatSkema combines the docs, the notes and the live schema", () =>
      Effect.gen(function* () {
        const out = yield* runTool(lihatSkema, { kataKunci: "poli" });
        expect(out.dariDokumen[0]).toEqual({
          tabel: "poliklinik",
          keterangan: "Clinics",
          kolom: ["kd_poli char(5) [PK]", "nm_poli varchar(50) — name shown to patients"],
          relasi: ["kd_poli → reg_periksa.kd_poli"],
        });
        expect(out.catatan).toEqual(["- `kd_poli` for poli gigi is `GIG`."]);
        expect(out.kolomCocok).toContain("reg_periksa.kd_poli");
      }),
    );

    it.effect("lihatSkema lists undocumented tables from the database and marks personal columns", () =>
      Effect.gen(function* () {
        const out = yield* runTool(lihatSkema, { kataKunci: "pasien" });
        const pasien = out.dariDatabase.find((t) => t.tabel === "pasien");
        expect(pasien?.kolom).toContain("no_rkm_medis varchar(15) [PK]");
        expect(pasien?.kolom.find((c) => c.startsWith("no_ktp"))).toMatch(/pribadi/);
        const none = yield* runTool(lihatSkema, { kataKunci: "zz qqq" });
        expect(none.petunjuk).toMatch(/Tidak ada tabel/);
      }),
    );
  });
});
