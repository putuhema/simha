/**
 * Patient documents over HTTP and through the agent.
 */
import { fakeTurn } from "@simrs/llm";
import type { AuditPage, DocumentInfo, Transcript } from "@simrs/shared";
import { describe, expect, it } from "vitest";
import { makeTestApp, readEvents, testDb } from "./harness.ts";

describe.skipIf(testDb === null)("patient documents", () => {
  it("makes a document without the AI and serves it as locked-down HTML", async () => {
    const app = makeTestApp([]);
    try {
      const created = await app.call("POST", "/documents", { jenis: "cppt", noRawat: "2026/10/21/000002" });
      expect(created.status).toBe(201);
      const document = (await created.json()) as DocumentInfo;
      expect(document).toMatchObject({ jenis: "cppt", dibuatOleh: "it-budi" });

      const page = await app.call("GET", `/documents/${document.id}`);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(page.headers.get("x-frame-options")).toBe("SAMEORIGIN");
      expect(await page.text()).toContain("Catatan Perkembangan Pasien Terintegrasi");

      const download = await app.call("GET", `/documents/${document.id}?download=1`);
      expect(download.headers.get("content-disposition")).toMatch(/attachment; filename="cppt-RM-000002-SITI-AMINAH-2026-10-21-000002\.html"/);
      const events = (await (await app.call("GET", "/audit?kind=events&q=document_downloaded")).json()) as AuditPage;
      expect(events.total).toBe(1);

      expect((await app.raw("GET", `/api/documents/${document.id}`)).status).toBe(401);
      expect((await app.call("GET", "/documents/tidak-ada")).status).toBe(404);
      expect((await app.call("POST", "/documents", { jenis: "cppt" })).status).toBe(404);
      expect((await app.call("POST", "/documents", { jenis: "lain" })).status).toBe(400);
    } finally {
      await app.dispose();
    }
  });

  it("the agent shows the document, and an external AI never sees the SOAP text", async () => {
    const app = makeTestApp([
      fakeTurn("", [{ name: "dokumenPasien", args: { jenis: "cppt", noRawat: "2026/10/21/000002" } }]),
      fakeTurn("Ringkasan AI (periksa kembali): diare akut dengan dehidrasi, membaik."),
    ]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Buatkan CPPT pasien 2026/10/21/000002" }));
      const shown = events.find((e) => e._tag === "document");
      expect(shown).toMatchObject({ document: { jenis: "cppt", dibuatOleh: "it-budi" } });

      const sent = JSON.stringify(app.fake.requests[1]?.messages);
      expect(sent).not.toContain("BAB cair 6x");
      expect(sent).toContain("[catatan klinis tidak dikirim ke AI]");
      expect(sent).toContain("Diare dan gastroenteritis");
      expect(sent).toContain("TD 100/70 mmHg");

      const started = events[0];
      if (started?._tag !== "run_started") throw new Error("no run");
      const transcript = (await (await app.call("GET", `/conversations/${started.conversationId}`)).json()) as Transcript;
      expect(transcript.runs[0]?.documents.map((d) => d.jenis)).toEqual(["cppt"]);
    } finally {
      await app.dispose();
    }
  });

  it("a local AI (masking off) gets the notes to summarise", async () => {
    const app = makeTestApp(
      [fakeTurn("", [{ name: "dokumenPasien", args: { jenis: "cppt", noRawat: "2026/10/21/000002" } }]), fakeTurn("ok")],
      { maskPii: false },
    );
    try {
      await readEvents(await app.call("POST", "/ask", { question: "CPPT 2026/10/21/000002" }));
      expect(JSON.stringify(app.fake.requests[1]?.messages)).toContain("BAB cair 6x");
    } finally {
      await app.dispose();
    }
  });
});
