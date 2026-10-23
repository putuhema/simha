/**
 * Server for end-to-end tests and UI demos: the real routes, agent, tools and
 * fix executor, on the throwaway synthetic test DB (never real Khanza data),
 * with a scripted "AI" that answers a few questions by keyword, a fresh
 * in-memory audit DB, and the built web UI (apps/web/dist).
 *
 *   node apps/server/test/e2e-server.ts        (E2E_PORT, default 8799)
 *
 * Scripted answers:
 * - a ticket mentioning "RM 000002": checks the visit and the room move,
 *   finds two active rooms and proposes closing the old one;
 * - "per poli": a bar chart of visits per clinic;
 * - "hari ini": the number of registrations today;
 * - "riwayat": the history document of RM 000002;
 * - "radiologi" / "foto thorax": the reading and images of 2026/10/21/000002 (fake PACS);
 * - anything else: a short text answer.
 *
 * PACS is a fake Orthanc with one synthetic chest X-ray study for RM 000002.
 */
import { NodeFileSystem, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { fakeTurn, makeFakeClient, type ChatRequest, type FakeTurn } from "@simrs/llm";
import { AuditLogMemory, FixStoreLive, khanzaReadLayer, khanzaWriteLayer, pacsLayer, ResultStoreLive, SchemaDocsLive } from "@simrs/tools";
import { startTestDb } from "@simrs/tools/testing/db";
import { Duration, Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { createServer } from "node:http";
import * as NodePath from "node:path";
import { AgentLive } from "../src/agent/Agent.ts";
import { systemPromptLayer } from "../src/agent/prompt.ts";
import { AuthLive } from "../src/auth/Auth.ts";
import { HttpSettings } from "../src/config.ts";
import { FixExecutorLive } from "../src/fixes/FixExecutor.ts";
import { Routes } from "../src/http/routes.ts";
import { llmSettingsLayer } from "../src/llm/LlmSettings.ts";
import { FAKE_ORTHANC, makeFakeOrthanc } from "./fake-orthanc.ts";
import { StoreLive } from "../src/store.ts";
import { ViewsLive } from "../src/views.ts";

const lastUserText = (request: ChatRequest) => {
  const user = request.messages.findLast((m) => m.role === "user");
  return user?.role === "user" ? user.text : "";
};

/** Tool results since the last user message, parsed. */
const toolResults = (request: ChatRequest) => {
  const lastUser = request.messages.findLastIndex((m) => m.role === "user");
  return request.messages
    .slice(lastUser + 1)
    .flatMap((m) => (m.role === "tool" ? [JSON.parse(m.isError ? "{}" : m.content) as Record<string, unknown>] : []));
};

const respond = (request: ChatRequest): ReturnType<typeof fakeTurn> => {
  const question = lastUserText(request);
  const results = toolResults(request);
  const step = results.length;

  // Radiology images from the (fake) PACS.
  if (/radiologi|foto thorax|rontgen/i.test(question)) {
    if (step === 0) return fakeTurn("", [{ name: "hasilRadiologi", args: { noRawat: "2026/10/21/000002" } }]);
    return fakeTurn("Berikut hasil radiologi kunjungan 2026/10/21/000002.");
  }
  // Resume medis: start a draft, ask for what is missing; a follow-up with answers fills the draft.
  if (/buat resume/i.test(question)) {
    if (step === 0) return fakeTurn("", [{ name: "buatDraftResume", args: { noRawat: "2026/10/21/000002" } }]);
    return fakeTurn("Draf resume sudah saya isi dari data Khanza. Yang belum ada:\n1. Jalannya penyakit (wajib)\n2. Keadaan pulang\n3. Tanggal kontrol");
  }
  if (/jalannya penyakit:/i.test(question)) {
    if (step === 0) {
      const earlier = request.messages.flatMap((m) =>
        m.role === "tool" && m.name === "buatDraftResume" ? [JSON.parse(m.content) as { draftId: string }] : [],
      );
      const draftId = earlier.at(-1)?.draftId ?? "";
      return fakeTurn("", [
        {
          name: "isiDraft",
          args: { draftId, isian: { jalannya_penyakit: "Rehidrasi IV dua hari, diare berkurang.", keadaan: "Membaik", kontrol: "2026-10-28 09:00" } },
        },
      ]);
    }
    return fakeTurn("Sudah saya masukkan ke draf. Periksa kartunya, lalu klik Isi di Khanza dan Simpan di Khanza.");
  }

  if (/riwayat/i.test(question)) {
    if (step === 0) return fakeTurn("", [{ name: "dokumenPasien", args: { jenis: "riwayat", noRkmMedis: "000002" } }]);
    return fakeTurn("Ringkasan AI (periksa kembali): satu kunjungan rawat inap dengan diare akut.");
  }

  if (/RM 000002/.test(question)) {
    switch (step) {
      case 0:
        return fakeTurn("Saya cek kunjungan pasien dulu.", [{ name: "kunjunganAktif", args: { noRkmMedis: "000002" } }]);
      case 1:
        return fakeTurn("", [{ name: "diagnosaPindahKamar", args: { noRawat: "2026/10/21/000002", kdKamarTujuan: "MAW-03" } }]);
      case 2:
        return fakeTurn("", [
          {
            name: "usulkanPerbaikan",
            args: {
              judul: "Tutup kamar lama MEL-02 pasien 2026/10/21/000002",
              sql: "UPDATE kamar_inap SET stts_pulang = ?, tgl_keluar = ?, jam_keluar = ? WHERE no_rawat = ? AND kd_kamar = ? AND stts_pulang = '-'",
              params: ["Pindah Kamar", "2026-10-21", "14:00:00", "2026/10/21/000002", "MEL-02"],
              alasan: "Pasien punya dua kamar aktif; kamar lama MEL-02 belum ditutup saat pindah ke MAW-01.",
            },
          },
        ]);
      default:
        return fakeTurn(
          [
            "Pasien SITI AMINAH masih tercatat di dua kamar sekaligus.",
            "",
            "**Yang dicek**",
            "- Kunjungan 2026/10/21/000002: rawat inap, belum bayar.",
            "- Riwayat kamar: MEL-02 dan MAW-01 sama-sama aktif.",
            "",
            "**Diagnosis**",
            "Saat pindah ke MAW-01, baris kamar lama MEL-02 tidak ditutup (`stts_pulang` masih `-`). Khanza menolak pindah kamar baru selama ada dua kamar aktif.",
            "",
            "**Saran perbaikan**",
            "Tutup baris MEL-02 dengan status *Pindah Kamar*. Usulan perbaikan sudah dibuat dan menunggu persetujuan.",
          ].join("\n"),
        );
    }
  }

  if (/per poli/i.test(question)) {
    if (step === 0) {
      return fakeTurn("", [
        {
          name: "jalankanQueryBaca",
          args: {
            sql: "SELECT p.nm_poli AS poli, COUNT(*) AS jumlah FROM reg_periksa r JOIN poliklinik p ON p.kd_poli = r.kd_poli GROUP BY p.nm_poli ORDER BY jumlah DESC, poli",
            alasan: "Jumlah kunjungan per poli",
          },
        },
      ]);
    }
    if (step === 1) {
      return fakeTurn("", [
        {
          name: "tampilkan",
          args: {
            tipe: "bar",
            judul: "Kunjungan per poli",
            queryId: results[0]?.["queryId"],
            asumsi: "semua tanggal di data uji, rawat jalan dan rawat inap",
            opsi: { satuan: "kunjungan" },
          },
        },
      ]);
    }
    return fakeTurn("Poli Gigi dan Poli Umum masing-masing punya beberapa kunjungan.");
  }

  if (/hari ini/i.test(question)) {
    if (step === 0) {
      return fakeTurn("", [
        {
          name: "jalankanQueryBaca",
          args: { sql: "SELECT COUNT(*) AS jumlah FROM reg_periksa WHERE tgl_registrasi = '2026-10-22'", alasan: "Registrasi hari ini" },
        },
      ]);
    }
    if (step === 1) {
      return fakeTurn("", [
        {
          name: "tampilkan",
          args: { tipe: "stat", judul: "Pasien daftar hari ini", queryId: results[0]?.["queryId"], asumsi: "hari ini = 22 Okt 2026", opsi: { satuan: "pasien" } },
        },
      ]);
    }
    return fakeTurn("Ada 1 pendaftaran hari ini.");
  }

  return fakeTurn("Ini jawaban uji dari AI palsu.");
};

const main = Effect.gen(function* () {
  const { info, stop } = yield* Effect.promise(() => startTestDb());
  yield* Effect.addFinalizer(() => Effect.promise(stop));
  if (info === null) return yield* Effect.die(new Error("No test database: install MariaDB (mariadbd) or set KHANZA_TEST_DB_HOST."));

  const connection = (username: string, password: string) => ({
    host: info.host,
    port: info.port,
    database: info.database,
    username,
    password: Redacted.make(password),
  });
  const script: ReadonlyArray<FakeTurn> = Array.from({ length: 10_000 }, () => respond);
  const fake = makeFakeClient(script, { model: "skrip-uji", maskPii: true });
  const port = Number(process.env["E2E_PORT"] ?? 8799);
  const webDir = NodePath.resolve(import.meta.dirname, "..", "..", "web", "dist");

  const app = Layer.mergeAll(AgentLive, FixExecutorLive, ViewsLive).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        StoreLive,
        FixStoreLive,
        ResultStoreLive,
        SchemaDocsLive,
        AuthLive,
        llmSettingsLayer({
          env: { provider: "fake", model: "skrip-uji", baseUrl: undefined, apiKey: undefined, maskPii: true },
          initialClient: fake,
        }),
        Layer.succeed(HttpSettings, { webDir, secureCookie: false }),
        khanzaWriteLayer(connection(info.writeUser, info.writePass)),
        khanzaReadLayer({ connection: connection(info.readUser, info.readPass), timeout: Duration.seconds(5) }),
        systemPromptLayer("E2E test system prompt."),
        pacsLayer(FAKE_ORTHANC, makeFakeOrthanc().fetch),
      ),
    ),
    Layer.provideMerge(AuditLogMemory),
    Layer.provide(NodeFileSystem.layer),
  );

  console.log(`E2E server on http://127.0.0.1:${port} (test DB ${info.database} on port ${info.port})`);
  return yield* Layer.launch(
    HttpRouter.serve(Routes).pipe(
      Layer.provide(app),
      Layer.provide(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port })),
    ),
  );
});

NodeRuntime.runMain(Effect.scoped(main));
