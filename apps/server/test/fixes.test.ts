/**
 * Proposal -> approval -> apply -> rollback, against the throwaway Khanza
 * test DB. Each test creates its own rows (room codes TST-..., visit numbers
 * 2099/...), so tests do not disturb each other or the seed data.
 */
import { fakeTurn } from "@simha/llm";
import type { Fix, FixDetail } from "@simha/shared";
import { Effect } from "effect";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FixExecutor } from "../src/fixes/FixExecutor.ts";
import { makeTestApp, readEvents, testDb } from "./harness.ts";

let admin: mysql.Connection;
let counter = 0;

/** A fresh inpatient stay with one or two active rooms, unique to the calling test. */
const makeStay = async (rooms: ReadonlyArray<string>) => {
  const n = String(++counter).padStart(4, "0") + String(Date.now() % 10_000).padStart(4, "0");
  const noRawat = `2099/01/01/${n.slice(-6)}`;
  for (const [i, room] of rooms.entries()) {
    await admin.query(
      "INSERT INTO kamar (kd_kamar, kd_bangsal, trf_kamar, status, kelas, statusdata) VALUES (?, 'MAW', 100, 'ISI', 'Kelas 1', '1') ON DUPLICATE KEY UPDATE status = 'ISI'",
      [room],
    );
    await admin.query(
      "INSERT INTO kamar_inap (no_rawat, kd_kamar, trf_kamar, tgl_masuk, jam_masuk, tgl_keluar, jam_keluar, lama, ttl_biaya, stts_pulang) VALUES (?, ?, 100, '2099-01-01', ?, '0000-00-00', '00:00:00', 1, 100, '-')",
      [noRawat, room, `0${8 + i}:00:00`],
    );
  }
  return noRawat;
};

const kamarInap = async (noRawat: string) => {
  const [rows] = await admin.query(
    "SELECT kd_kamar, stts_pulang, tgl_keluar, jam_keluar FROM kamar_inap WHERE no_rawat = ? ORDER BY tgl_masuk, jam_masuk",
    [noRawat],
  );
  return rows as Array<{ kd_kamar: string; stts_pulang: string; tgl_keluar: string; jam_keluar: string }>;
};

const closeRoomSql =
  "UPDATE kamar_inap SET stts_pulang = ?, tgl_keluar = ?, jam_keluar = ? WHERE no_rawat = ? AND kd_kamar = ? AND stts_pulang = '-'";

/** Proposes a fix through the agent (fake model calls usulkanPerbaikan) and returns the tool result. */
const proposeViaAgent = async (app: ReturnType<typeof makeTestApp>) => {
  const events = await readEvents(await app.call("POST", "/ask", { question: "Perbaiki" }));
  const finished = events.find((e) => e._tag === "tool_finished");
  if (finished?._tag !== "tool_finished") throw new Error(`no tool result: ${JSON.stringify(events)}`);
  return finished;
};

describe.skipIf(testDb === null)("fixes", () => {
  beforeAll(async () => {
    const db = testDb;
    if (db === null) return;
    admin = await mysql.createConnection({
      host: db.host,
      port: db.port,
      user: db.adminUser,
      password: db.adminPass,
      database: db.database,
      dateStrings: true,
    });
  });
  afterAll(async () => {
    await admin?.end();
  });

  it("the AI only proposes: the fix is pending, previewed, and Khanza is unchanged", async () => {
    const noRawat = await makeStay(["TST-A1", "TST-A2"]);
    const args = { judul: "Tutup kamar lama", sql: closeRoomSql, params: ["Pindah Kamar", "2099-01-01", "09:00:00", noRawat, "TST-A1"], alasan: "Dua kamar aktif" };
    const app = makeTestApp([fakeTurn("", [{ name: "usulkanPerbaikan", args }]), fakeTurn("Usulan dibuat.")]);
    try {
      const finished = await proposeViaAgent(app);
      expect(finished.ok).toBe(true);
      const result = finished.result as { fixId: string; status: string; barisTerdampak: number; sql: string };
      expect(result).toMatchObject({ status: "menunggu_persetujuan", barisTerdampak: 1 });
      expect(result.sql).toContain(`'${noRawat}'`);

      const detail = (await (await app.call("GET", `/fixes/${result.fixId}`)).json()) as FixDetail;
      expect(detail.fix).toMatchObject({ status: "pending", table: "kamar_inap", kind: "update", expectedRows: 1, createdBy: "ai" });
      expect(detail.fix.preview).toEqual([expect.objectContaining({ kd_kamar: "TST-A1", stts_pulang: "-" })]);
      expect(detail.events.map((e) => e.action)).toEqual(["proposed"]);

      expect((await kamarInap(noRawat)).map((r) => r.stts_pulang)).toEqual(["-", "-"]);
      const writes = await app.audit<{ n: number }>("SELECT COUNT(*) AS n FROM queries WHERE pool = 'write'");
      expect(writes[0]?.n).toBe(0);
    } finally {
      await app.dispose();
    }
  });

  it("the AI gets a clear error for a statement outside the rules, and nothing is stored", async () => {
    const args = { judul: "x", sql: "UPDATE pasien SET nm_pasien = 'X' WHERE no_rkm_medis = '000001'", alasan: "x" };
    const app = makeTestApp([fakeTurn("", [{ name: "usulkanPerbaikan", args }]), fakeTurn("Tidak bisa.")]);
    try {
      const finished = await proposeViaAgent(app);
      expect(finished.ok).toBe(false);
      expect(finished.error).toMatch(/tidak termasuk daftar tabel/);
      expect(await (await app.call("GET", "/fixes")).json()).toEqual([]);
    } finally {
      await app.dispose();
    }
  });

  it("approve runs the fix in a transaction; rollback restores the rows", async () => {
    const noRawat = await makeStay(["TST-B1", "TST-B2"]);
    const app = makeTestApp([]);
    try {
      const created = await app.call("POST", "/fixes", {
        title: "Tutup kamar lama",
        reason: "Dua kamar aktif",
        sql: closeRoomSql,
        params: ["Pindah Kamar", "2099-01-01", "09:00:00", noRawat, "TST-B1"],
      });
      expect(created.status).toBe(201);
      const fix = (await created.json()) as Fix;

      const approved = (await (await app.call("POST", `/fixes/${fix.id}/approve`)).json()) as Fix;
      expect(approved).toMatchObject({ status: "applied", error: null });
      expect(approved.before).toEqual([expect.objectContaining({ kd_kamar: "TST-B1", stts_pulang: "-", tgl_keluar: "0000-00-00" })]);
      expect(approved.after).toEqual([expect.objectContaining({ kd_kamar: "TST-B1", stts_pulang: "Pindah Kamar", tgl_keluar: "2099-01-01" })]);
      expect(await kamarInap(noRawat)).toEqual([
        { kd_kamar: "TST-B1", stts_pulang: "Pindah Kamar", tgl_keluar: "2099-01-01", jam_keluar: "09:00:00" },
        { kd_kamar: "TST-B2", stts_pulang: "-", tgl_keluar: "0000-00-00", jam_keluar: "00:00:00" },
      ]);

      const rolledBack = (await (await app.callAs("it-sari", "POST", `/fixes/${fix.id}/rollback`)).json()) as Fix;
      expect(rolledBack.status).toBe("rolled_back");
      expect((await kamarInap(noRawat)).map((r) => [r.stts_pulang, r.tgl_keluar, r.jam_keluar])).toEqual([
        ["-", "0000-00-00", "00:00:00"],
        ["-", "0000-00-00", "00:00:00"],
      ]);

      const detail = (await (await app.call("GET", `/fixes/${fix.id}`)).json()) as FixDetail;
      expect(detail.events.map((e) => [e.action, e.actor])).toEqual([
        ["proposed", "it-budi"],
        ["approved", "it-budi"],
        ["applied", "it-budi"],
        ["rollback_requested", "it-sari"],
        ["rolled_back", "it-sari"],
      ]);
    } finally {
      await app.dispose();
    }
  });

  it("a row-count mismatch at approval aborts and changes nothing", async () => {
    const noRawat = await makeStay(["TST-C1"]);
    const app = makeTestApp([]);
    try {
      // Preview: 1 matching row.
      const fix = (await (
        await app.call("POST", "/fixes", {
          title: "Tutup semua kamar aktif",
          reason: "test",
          sql: "UPDATE kamar_inap SET stts_pulang = 'Pindah Kamar' WHERE no_rawat = ? AND stts_pulang = '-'",
          params: [noRawat],
        })
      ).json()) as Fix;
      expect(fix.expectedRows).toBe(1);

      // Data changes before approval: a second matching row appears.
      await admin.query(
        "INSERT INTO kamar_inap (no_rawat, kd_kamar, tgl_masuk, jam_masuk, stts_pulang) VALUES (?, 'TST-C2', '2099-01-01', '10:00:00', '-')",
        [noRawat],
      );

      const result = (await (await app.call("POST", `/fixes/${fix.id}/approve`)).json()) as Fix;
      expect(result.status).toBe("failed");
      expect(result.error).toMatch(/diharapkan 1 baris, ternyata 2/);
      expect((await kamarInap(noRawat)).map((r) => r.stts_pulang)).toEqual(["-", "-"]);

      const detail = (await (await app.call("GET", `/fixes/${fix.id}`)).json()) as FixDetail;
      expect(detail.events.map((e) => e.action)).toEqual(["proposed", "approved", "apply_failed"]);
    } finally {
      await app.dispose();
    }
  });

  it("a failure halfway through a transaction rolls back the writes already made", async () => {
    const noRawat = await makeStay(["TST-D1", "TST-D2"]);
    const app = makeTestApp([]);
    try {
      // Delete both room rows of the stay (DELETE is allowed on kamar_inap).
      const fix = (await (
        await app.call("POST", "/fixes", {
          title: "Hapus kamar",
          reason: "test",
          sql: "DELETE FROM kamar_inap WHERE no_rawat = ?",
          params: [noRawat],
        })
      ).json()) as Fix;
      expect(((await (await app.call("POST", `/fixes/${fix.id}/approve`)).json()) as Fix).status).toBe(
        "applied",
      );
      expect(await kamarInap(noRawat)).toEqual([]);

      // Someone re-creates the second row. Rollback re-inserts row 1, then fails on row 2 (duplicate key).
      await admin.query(
        "INSERT INTO kamar_inap (no_rawat, kd_kamar, tgl_masuk, jam_masuk, stts_pulang) VALUES (?, 'TST-D2', '2099-01-01', '09:00:00', 'Sehat')",
        [noRawat],
      );
      const response = await app.callAs("it-sari", "POST", `/fixes/${fix.id}/rollback`);
      expect(response.status).toBe(422);
      expect(((await response.json()) as { error: string }).error).toMatch(/Database menolak rollback/);

      // Row 1's re-insert was rolled back with the transaction: only the row someone else made is there.
      expect(await kamarInap(noRawat)).toEqual([
        { kd_kamar: "TST-D2", stts_pulang: "Sehat", tgl_keluar: null, jam_keluar: null },
      ]);
      const detail = (await (await app.call("GET", `/fixes/${fix.id}`)).json()) as FixDetail;
      expect(detail.fix.status).toBe("applied");
      expect(detail.events.at(-1)?.action).toBe("rollback_failed");
    } finally {
      await app.dispose();
    }
  });

  it("rollback refuses to overwrite rows that changed after the fix", async () => {
    const noRawat = await makeStay(["TST-E1"]);
    const app = makeTestApp([]);
    try {
      const fix = (await (
        await app.call("POST", "/fixes", {
          title: "Tutup kamar",
          reason: "test",
          sql: closeRoomSql,
          params: ["Pindah Kamar", "2099-01-01", "09:00:00", noRawat, "TST-E1"],
        })
      ).json()) as Fix;
      await app.call("POST", `/fixes/${fix.id}/approve`);
      await admin.query("UPDATE kamar_inap SET stts_pulang = 'Membaik' WHERE no_rawat = ?", [noRawat]);

      const response = await app.callAs("it-sari", "POST", `/fixes/${fix.id}/rollback`);
      expect(response.status).toBe(422);
      expect(((await response.json()) as { error: string }).error).toMatch(/sudah berubah/);
      expect((await kamarInap(noRawat))[0]?.stts_pulang).toBe("Membaik");
    } finally {
      await app.dispose();
    }
  });

  it("nothing is written to Khanza without an approval row", async () => {
    const noRawat = await makeStay(["TST-F1"]);
    const app = makeTestApp([]);
    try {
      const fix = (await (
        await app.call("POST", "/fixes", {
          title: "Tutup kamar",
          reason: "test",
          sql: closeRoomSql,
          params: ["Pindah Kamar", "2099-01-01", "09:00:00", noRawat, "TST-F1"],
        })
      ).json()) as Fix;

      // Calling the executor directly on a pending fix (no approval) is refused.
      const refused = await app.runtime.runPromise(
        Effect.flip(
          Effect.gen(function* () {
            const executor = yield* FixExecutor;
            return yield* executor.applyApproved(fix.id);
          }),
        ),
      );
      expect(refused).toMatchObject({ _tag: "FixActionError", status: 409 });
      expect((await kamarInap(noRawat))[0]?.stts_pulang).toBe("-");

      await app.call("POST", `/fixes/${fix.id}/approve`);

      // Every write statement in the audit log belongs to a fix whose approval was recorded first.
      const unapproved = await app.audit<{ n: number }>(`
        SELECT COUNT(*) AS n FROM queries q
        WHERE q.pool = 'write' AND NOT EXISTS (
          SELECT 1 FROM fix_events e
          WHERE e.fix_id = q.fix_id AND e.action = 'approved' AND e.at <= q.executed_at)`);
      expect(unapproved[0]?.n).toBe(0);
      const writes = await app.audit<{ n: number }>(`SELECT COUNT(*) AS n FROM queries WHERE pool = 'write' AND fix_id = '${fix.id}'`);
      expect(writes[0]?.n).toBeGreaterThanOrEqual(3);
    } finally {
      await app.dispose();
    }
  });

  it("a fix can be approved once, and not after it was rejected", async () => {
    const noRawat = await makeStay(["TST-G1"]);
    const app = makeTestApp([]);
    try {
      const propose = async () =>
        (await (
          await app.call("POST", "/fixes", {
            title: "Tutup kamar",
            reason: "test",
            sql: closeRoomSql,
            params: ["Pindah Kamar", "2099-01-01", "09:00:00", noRawat, "TST-G1"],
          })
        ).json()) as Fix;

      const first = await propose();
      const [a, b] = await Promise.all([
        app.call("POST", `/fixes/${first.id}/approve`),
        app.callAs("it-sari", "POST", `/fixes/${first.id}/approve`),
      ]);
      expect([a.status, b.status].toSorted()).toEqual([200, 409]);

      await app.call("POST", `/fixes/${first.id}/rollback`);
      const second = await propose();
      const rejected = (await (
        await app.callAs("it-sari", "POST", `/fixes/${second.id}/reject`, { reason: "Salah kamar" })
      ).json()) as Fix;
      expect(rejected.status).toBe("rejected");
      expect((await app.call("POST", `/fixes/${second.id}/approve`)).status).toBe(409);
    } finally {
      await app.dispose();
    }
  });

  it("INSERT fixes are checked for existing keys and rolled back by key", async () => {
    const noRawat = await makeStay(["TST-H1"]);
    const app = makeTestApp([]);
    try {
      const insert = {
        title: "Tambah kamar",
        reason: "test",
        sql: "INSERT INTO kamar_inap (no_rawat, kd_kamar, trf_kamar, tgl_masuk, jam_masuk, stts_pulang) VALUES (?, 'TST-H2', 100, '2099-01-02', '07:00:00', '-')",
        params: [noRawat],
      };
      const fix = (await (await app.call("POST", "/fixes", insert)).json()) as Fix;
      expect(fix).toMatchObject({ kind: "insert", expectedRows: 1, preview: [] });
      const applied = (await (await app.call("POST", `/fixes/${fix.id}/approve`)).json()) as Fix;
      expect(applied.status).toBe("applied");
      expect((await kamarInap(noRawat)).map((r) => r.kd_kamar)).toEqual(["TST-H1", "TST-H2"]);

      const duplicate = await app.call("POST", "/fixes", insert);
      expect(duplicate.status).toBe(400);
      expect(((await duplicate.json()) as { error: string }).error).toMatch(/sudah ada/);

      await app.call("POST", `/fixes/${fix.id}/rollback`);
      expect((await kamarInap(noRawat)).map((r) => r.kd_kamar)).toEqual(["TST-H1"]);
    } finally {
      await app.dispose();
    }
  });

  it("a deleted tindakan is restored by rollback (write user can re-insert)", async () => {
    const noRawat = await makeStay(["TST-J1"]);
    await admin.query(
      "INSERT INTO rawat_jl_pr (no_rawat, kd_jenis_prw, nip, tgl_perawatan, jam_rawat, material, bhp, tarif_tindakanpr, biaya_rawat, stts_bayar) VALUES (?, 'TST-PRW', 'TST-NIP', '2099-01-01', '10:00:00', 1, 2, 3, 6, 'Belum')",
      [noRawat],
    );
    const tindakan = async () =>
      ((await admin.query("SELECT kd_jenis_prw, biaya_rawat, stts_bayar FROM rawat_jl_pr WHERE no_rawat = ?", [noRawat]))[0] as Array<unknown>);
    const app = makeTestApp([]);
    try {
      const fix = (await (
        await app.call("POST", "/fixes", {
          title: "Hapus tindakan ganda",
          reason: "test",
          sql: "DELETE FROM rawat_jl_pr WHERE no_rawat = ? AND kd_jenis_prw = ?",
          params: [noRawat, "TST-PRW"],
        })
      ).json()) as Fix;
      expect(fix).toMatchObject({ kind: "delete", expectedRows: 1 });
      const applied = (await (await app.call("POST", `/fixes/${fix.id}/approve`)).json()) as Fix;
      expect(applied.status).toBe("applied");
      expect(await tindakan()).toEqual([]);

      const rolledBack = await app.call("POST", `/fixes/${fix.id}/rollback`);
      expect(rolledBack.status).toBe(200);
      expect(await tindakan()).toEqual([{ kd_jenis_prw: "TST-PRW", biaya_rawat: 6, stts_bayar: "Belum" }]);
    } finally {
      await app.dispose();
    }
  });
});
