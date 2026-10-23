/**
 * Radiology images from Orthanc, through the server.
 */
import { fakeTurn } from "@simha/llm";
import type { AuditPage, PacsStudies, Transcript } from "@simha/shared";
import { describe, expect, it } from "vitest";
import { pacsLayer } from "@simha/tools";
import { FAKE_INSTANCES, FAKE_ORTHANC, FAKE_STUDY, makeFakeOrthanc } from "./fake-orthanc.ts";
import { makeTestApp, readEvents, testDb } from "./harness.ts";

describe.skipIf(testDb === null)("radiology images (PACS)", () => {
  it("lists the patient's studies and streams images, without exposing Orthanc", async () => {
    const orthanc = makeFakeOrthanc();
    const app = makeTestApp([], undefined, undefined, { pacs: pacsLayer(FAKE_ORTHANC, orthanc.fetch) });
    try {
      expect(await (await app.raw("GET", "/api/health")).json()).toMatchObject({ pacs: true });

      const response = await app.call("GET", "/patients/000002/radiologi");
      expect(response.status).toBe(200);
      const body = (await response.json()) as PacsStudies;
      expect(body.configured).toBe(true);
      expect(body.studies).toHaveLength(1);
      expect(body.studies[0]).toMatchObject({ id: FAKE_STUDY, date: "2026-10-21", time: "09:30", description: "THORAX PA" });
      // Series in SeriesNumber order.
      expect(body.studies[0]?.series.map((s) => s.description)).toEqual(["PA", "LATERAL"]);
      expect(JSON.stringify(body)).not.toContain("rahasia");

      // Patient matched by exact PatientID; Orthanc login sent by the server.
      const find = orthanc.requests.find((r) => r.path === "/tools/find");
      expect(JSON.parse(find?.body ?? "{}")).toMatchObject({ Level: "Study", Query: { PatientID: "000002" } });
      expect(find?.authorization).toMatch(/^Basic /);

      const thumb = await app.call("GET", `/pacs/instances/${FAKE_INSTANCES[0]}/thumb`);
      expect(thumb.status).toBe(200);
      expect(thumb.headers.get("content-type")).toBe("image/png");
      expect(thumb.headers.get("cache-control")).toContain("private");
      expect(new Uint8Array(await thumb.arrayBuffer()).subarray(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));

      const file = await app.call("GET", `/pacs/instances/${FAKE_INSTANCES[0]}/file`);
      expect(file.headers.get("content-disposition")).toContain(".dcm");

      const events = (await (await app.call("GET", "/audit?kind=events&q=radiology")).json()) as AuditPage;
      expect(events.total).toBe(1);
      const downloads = (await (await app.call("GET", "/audit?kind=events&q=dicom_downloaded")).json()) as AuditPage;
      expect(downloads.total).toBe(1);

      // Other patients have no studies; no wildcards, no bad IDs, no anonymous access.
      expect(((await (await app.call("GET", "/patients/000001/radiologi")).json()) as PacsStudies).studies).toEqual([]);
      expect((await app.call("GET", "/patients/0000*/radiologi")).status).toBe(400);
      expect((await app.call("GET", "/pacs/instances/../../tools/thumb")).status).not.toBe(200);
      expect((await app.call("GET", `/pacs/instances/${FAKE_INSTANCES[0]}/tags`)).status).toBe(404);
      expect((await app.call("GET", "/pacs/instances/not-an-id/thumb")).status).toBe(400);
      expect((await app.raw("GET", `/api/pacs/instances/${FAKE_INSTANCES[0]}/thumb`)).status).toBe(401);
      expect((await app.raw("GET", "/api/patients/000002/radiologi")).status).toBe(401);
    } finally {
      await app.dispose();
    }
  });

  it("says so when Orthanc is not set up or cannot be reached", async () => {
    const off = makeTestApp([]);
    try {
      expect(await (await off.raw("GET", "/api/health")).json()).toMatchObject({ pacs: false });
      expect(await (await off.call("GET", "/patients/000002/radiologi")).json()).toEqual({ configured: false, viewerBase: null, studies: [] });
    } finally {
      await off.dispose();
    }

    const wrongLogin = makeTestApp([], undefined, undefined, {
      pacs: pacsLayer({ ...FAKE_ORTHANC, user: "salah" }, makeFakeOrthanc().fetch),
    });
    try {
      const response = await wrongLogin.call("GET", "/patients/000002/radiologi");
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("menolak login") });
    } finally {
      await wrongLogin.dispose();
    }
  });

  it("one card shows Khanza's reading with the PACS images, and the AI is told not to repeat it", async () => {
    const app = makeTestApp(
      [
        fakeTurn("", [{ name: "hasilRadiologi", args: { noRawat: "2026/10/21/000002" } }]),
        fakeTurn("Berikut hasil radiologi kunjungan 2026/10/21/000002."),
      ],
      undefined,
      undefined,
      { pacs: pacsLayer(FAKE_ORTHANC, makeFakeOrthanc().fetch) },
    );
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "hasil baca radiologi 2026/10/21/000002" }));
      const shown = events.find((e) => e._tag === "radiology");
      expect(shown).toMatchObject({
        gallery: {
          noRkmMedis: "000002",
          noRawat: "2026/10/21/000002",
          pacsCatatan: null,
          pemeriksaan: [
            { tanggal: "2026-10-21", jam: "09:30", nama: "Thorax PA", dokter: "drg. Sari Fiktif", hasil: expect.stringContaining("Kesan: normal") },
          ],
          studies: [{ id: FAKE_STUDY }],
        },
      });
      expect(app.fake.requests[0]?.tools.map((t) => t.name)).toContain("hasilRadiologi");
      expect(app.fake.requests[0]?.tools.map((t) => t.name)).not.toContain("gambarRadiologi");

      // The model gets the exam list and image counts, not image IDs or the PACS address,
      // and the reading under a field name that is masked for external providers.
      const sent = JSON.stringify(app.fake.requests[1]?.messages);
      expect(sent).toContain("Thorax PA");
      expect(sent).toContain("laporanRadiologi");
      expect(sent).toContain("Jangan ulangi");
      expect(sent).not.toContain(FAKE_INSTANCES[0]);
      expect(sent).not.toContain("orthanc.test");

      // Reopening the conversation shows the card again.
      const started = events.find((e) => e._tag === "run_started");
      const conversationId = started?._tag === "run_started" ? started.conversationId : "";
      const transcript = (await (await app.call("GET", `/conversations/${conversationId}`)).json()) as Transcript;
      expect(transcript.runs[0]?.radiology[0]?.pemeriksaan[0]?.nama).toBe("Thorax PA");
      expect(transcript.runs[0]?.radiology[0]?.studies[0]?.id).toBe(FAKE_STUDY);
    } finally {
      await app.dispose();
    }
  });

  it("still shows the reading when PACS is not set up", async () => {
    const app = makeTestApp([
      fakeTurn("", [{ name: "hasilRadiologi", args: { noRkmMedis: "000002" } }]),
      fakeTurn("Berikut hasil radiologi pasien RM 000002."),
    ]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "hasil radiologi RM 000002" }));
      const shown = events.find((e) => e._tag === "radiology");
      expect(shown).toMatchObject({
        gallery: { pacsCatatan: expect.stringContaining("belum diatur"), studies: [], pemeriksaan: [{ nama: "Thorax PA" }] },
      });
    } finally {
      await app.dispose();
    }
  });
});
