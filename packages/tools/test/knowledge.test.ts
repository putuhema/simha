/**
 * The knowledge store and search need no Khanza and no AI: an in-memory audit
 * DB is enough. These tests pin the learning rules: personal data is refused,
 * verified items win, and the AI's note tool stores what it was told.
 */
import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { AuditLog, AuditLogMemory } from "../src/audit/AuditLog.ts";
import { catatPengetahuan } from "../src/knowledge/catatPengetahuan.ts";
import { KnowledgeStore, KnowledgeStoreLive } from "../src/knowledge/KnowledgeStore.ts";
import { personalReason, rank, tokenize } from "../src/knowledge/search.ts";
import { runTool } from "../src/tool.ts";

const layer = KnowledgeStoreLive.pipe(Layer.provideMerge(AuditLogMemory));
const run = <A, E>(effect: Effect.Effect<A, E, KnowledgeStore | AuditLog>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)));

const note = (text: string, extra: { verified?: boolean; source?: "auto" | "ai" | "staff" | "feedback" } = {}) => ({
  kind: "note" as const,
  source: extra.source ?? ("staff" as const),
  text,
  verified: extra.verified ?? true,
  createdBy: "it-budi",
});

describe("knowledge search", () => {
  it("stems the common Indonesian endings", () => {
    expect(tokenize("tindakan pasiennya obat-obatan")).toEqual(["tindak", "pasien", "obat"]);
  });

  it("ranks verified items above automatic ones", () => {
    const items = [
      { id: "auto", text: "Berapa pasien BPJS hari ini?", verified: false, source: "auto" as const },
      { id: "verified", text: "Berapa pasien BPJS hari ini?", verified: true, source: "feedback" as const },
    ];
    expect(rank("berapa pasien BPJS", items, 5).map((m) => m.item.id)).toEqual(["verified", "auto"]);
  });

  it("refuses patient and visit identifiers", () => {
    expect(personalReason("no rawat 2026/10/21/000002")).toContain("nomor rawat");
    expect(personalReason("NIK 5171000000000001")).toContain("nomor panjang");
    expect(personalReason("Telepon 0813-0000-0001")).toContain("telepon");
    expect(personalReason("Email budi@example.com")).toContain("email");
    expect(personalReason("Pasien BPJS memakai penjab BPJ")).toBeNull();
  });
});

describe("KnowledgeStore", () => {
  it("stores, lists, updates and deletes a note", async () => {
    const created = await run(
      Effect.gen(function* () {
        const store = yield* KnowledgeStore;
        const item = yield* store.add(note("Kode poli gigi adalah U0010."));
        const listed = yield* store.list;
        const updated = yield* store.update(item.id, { verified: false, active: false });
        const removed = yield* store.remove(item.id);
        return { item, listed, updated, removed, after: yield* store.list };
      }),
    );
    expect(created.item).toMatchObject({ kind: "note", text: "Kode poli gigi adalah U0010.", verified: true, active: true });
    expect(created.listed.map((i) => i.id)).toContain(created.item.id);
    expect(created.updated).toMatchObject({ verified: false, active: false });
    expect(created.removed).toBe(true);
    expect(created.after).toEqual([]);
  });

  it("finds and deactivates the example saved from a result", async () => {
    const result = await run(
      Effect.gen(function* () {
        const store = yield* KnowledgeStore;
        const item = yield* store.add({
          kind: "example",
          source: "auto",
          text: "Jumlah kunjungan per poli bulan ini",
          sql: "SELECT p.nm_poli, COUNT(*) FROM reg_periksa r JOIN poliklinik p USING (kd_poli) GROUP BY p.nm_poli",
          verified: false,
          blockId: "block-1",
          createdBy: "it-budi",
        });
        const found = yield* store.forBlock("block-1");
        yield* store.deactivateForBlock("block-1");
        return { item, found, after: yield* store.get(item.id) };
      }),
    );
    expect(result.found?.id).toBe(result.item.id);
    expect(result.after?.active).toBe(false);
  });

  it("returns the most similar active items and counts their use", async () => {
    const result = await run(
      Effect.gen(function* () {
        const store = yield* KnowledgeStore;
        const bpjs = yield* store.add(note("Pasien BPJS memakai penjab kd_pj = BPJ; umum = A09."));
        yield* store.add(note("Kode poli gigi adalah U0010."));
        const example = yield* store.add({
          kind: "example",
          source: "feedback",
          text: "Berapa pasien BPJS bulan ini?",
          sql: "SELECT COUNT(*) FROM reg_periksa WHERE kd_pj = 'BPJ'",
          verified: true,
          blockId: "block-bpjs",
          createdBy: "it-budi",
        });
        const matches = yield* store.relevant("berapa pasien BPJS bulan ini");
        return { bpjs, example, matches, after: yield* store.get(bpjs.id) };
      }),
    );
    const ids = result.matches.map((m) => m.item.id);
    expect(ids).toContain(result.bpjs.id);
    expect(ids).toContain(result.example.id);
    expect(ids[0]).toBe(result.example.id);
    expect(result.after?.uses).toBeGreaterThan(0);
  });

  it("does not return inactive items", async () => {
    const result = await run(
      Effect.gen(function* () {
        const store = yield* KnowledgeStore;
        const item = yield* store.add(note("Kode penjamin BPJS adalah BPJ."));
        yield* store.update(item.id, { active: false });
        return yield* store.relevant("kode penjamin BPJS");
      }),
    );
    expect(result).toEqual([]);
  });
});

describe("catatPengetahuan", () => {
  it("stores a note the AI learned, with the actor and run", async () => {
    const { result, stored } = await run(
      Effect.gen(function* () {
        const outcome = yield* runTool(
          catatPengetahuan,
          { catatan: "Kamar Melati memakai kd_bangsal MW.", judul: "Kode bangsal Melati" },
          { actor: "it-budi", sessionId: "run-1" },
        );
        const store = yield* KnowledgeStore;
        return { result: outcome, stored: yield* store.list };
      }),
    );
    expect(result.pesan).toContain("disimpan");
    expect(stored[0]).toMatchObject({
      kind: "note",
      source: "ai",
      text: "Kamar Melati memakai kd_bangsal MW.",
      title: "Kode bangsal Melati",
      verified: false,
      active: true,
      createdBy: "it-budi",
    });
  });

  it("refuses a note with a visit number", async () => {
    const result = await run(
      runTool(catatPengetahuan, { catatan: "Pasien 2026/10/21/000002 pindah kamar." }, { actor: "it-budi" }).pipe(Effect.exit),
    );
    expect(result._tag).toBe("Failure");
  });
});
