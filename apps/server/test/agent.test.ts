/**
 * The agent loop and HTTP API end to end: real routes, store, tools and audit
 * log, a scripted fake AI provider and the throwaway Khanza test DB.
 */
import { fakeTurn, type ChatRequest } from "@simrs/llm";
import type { AgentEvent, Ticket } from "@simrs/shared";
import { describe, expect, it } from "vitest";
import { MAX_STEPS } from "../src/agent/Agent.ts";
import { makeTestApp, readEvents, testDb } from "./harness.ts";

const lastToolMessages = (request: ChatRequest) => request.messages.filter((m) => m.role === "tool");

const tags = (events: ReadonlyArray<AgentEvent>) => events.map((e) => e._tag);

describe.skipIf(testDb === null)("agent over HTTP", () => {
  it("investigates a ticket with tools and streams every step", async () => {
    const app = makeTestApp([
      fakeTurn("Saya cek kunjungan pasien.", [{ name: "kunjunganAktif", args: { noRkmMedis: "000002" } }]),
      fakeTurn("", [{ name: "riwayatKamar", args: { noRawat: "2026/10/21/000002" } }]),
      (request) => {
        const kamar = lastToolMessages(request).at(-1);
        const twoActive = kamar?.role === "tool" && kamar.content.includes('"jumlahAktif":2');
        return fakeTurn(twoActive ? "Diagnosis: ada dua kamar aktif." : "Tidak ditemukan masalah.");
      },
    ]);
    try {
      const created = await app.call("POST", "/tickets", {
        nurseName: "Ns. Ayu",
        unit: "Mawar",
        complaint: "Pasien RM 000002 tidak bisa dipindah ke kamar Mawar",
      });
      expect(created.status).toBe(201);
      const ticket = (await created.json()) as Ticket;
      expect(ticket.status).toBe("open");

      const response = await app.call("POST", `/tickets/${ticket.id}/investigate`);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const events = await readEvents(response);

      expect(tags(events)).toEqual([
        "run_started",
        "text_delta",
        "tool_started",
        "tool_finished",
        "tool_started",
        "tool_finished",
        "text_delta",
        "done",
      ]);
      const finished = events.filter((e) => e._tag === "tool_finished");
      expect(finished.every((e) => e.ok)).toBe(true);
      expect(events.at(-1)).toMatchObject({ _tag: "done", text: "Diagnosis: ada dua kamar aktif.", steps: 3 });
      expect(events[0]).toMatchObject({ _tag: "run_started", provider: "fake", model: "fake-model" });

      // The model saw the complaint and the tool list.
      const first = app.fake.requests[0];
      expect(first?.messages[0]).toMatchObject({ role: "user" });
      expect(first?.messages[0]?.role === "user" && first.messages[0].text).toContain("tidak bisa dipindah");
      expect(first?.tools.map((t) => t.name)).toContain("riwayatKamar");

      const after = (await (await app.call("GET", `/tickets/${ticket.id}`)).json()) as Ticket;
      expect(after.status).toBe("diagnosed");
    } finally {
      await app.dispose();
    }
  });

  it("returns tool input errors to the model so it can retry", async () => {
    const app = makeTestApp([
      fakeTurn("", [{ name: "riwayatKamar", args: { noRawat: "" } }]),
      fakeTurn("", [{ name: "tidakAda", args: {} }]),
      (request) => {
        const [bad, unknown] = lastToolMessages(request);
        return fakeTurn(
          bad?.role === "tool" && bad.isError && unknown?.role === "tool" && unknown.isError ? "dua error diterima" : "?",
        );
      },
    ]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Riwayat kamar?" }));
      const finished = events.filter((e) => e._tag === "tool_finished");
      expect(finished.map((e) => e.ok)).toEqual([false, false]);
      expect(finished[0]?.error).toMatch(/noRawat/);
      expect(finished[1]?.error).toMatch(/tidak ada.*riwayatKamar/);
      expect(events.at(-1)).toMatchObject({ _tag: "done", text: "dua error diterima" });
    } finally {
      await app.dispose();
    }
  });

  it("masks NIK and phone numbers before they reach the AI provider", async () => {
    const app = makeTestApp([fakeTurn("ok")]);
    try {
      await readEvents(await app.call("POST", "/ask", { question: "Cari NIK 5171000000000001 hp 081300000001" }));
      const sent = JSON.stringify(app.fake.requests[0]?.messages);
      expect(sent).not.toContain("5171000000000001");
      expect(sent).not.toContain("081300000001");
      expect(sent).toContain("[NIK disamarkan]");
    } finally {
      await app.dispose();
    }
  });

  it("does not mask when the provider is configured as local (LLM_MASK_PII=false)", async () => {
    const app = makeTestApp([fakeTurn("ok")], { maskPii: false });
    try {
      await readEvents(await app.call("POST", "/ask", { question: "NIK 5171000000000001" }));
      expect(JSON.stringify(app.fake.requests[0]?.messages)).toContain("5171000000000001");
    } finally {
      await app.dispose();
    }
  });

  it("keeps context for follow-up questions in the same conversation", async () => {
    const app = makeTestApp([fakeTurn("Jawaban pertama."), fakeTurn("Jawaban kedua.")]);
    try {
      const first = await readEvents(await app.call("POST", "/ask", { question: "Pertanyaan satu" }));
      const started = first[0];
      if (started?._tag !== "run_started") throw new Error("expected run_started");
      await readEvents(
        await app.call("POST", "/ask", { question: "Sekarang per bulan", conversationId: started.conversationId }),
      );
      const history = app.fake.requests[1]?.messages ?? [];
      expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
      expect(history[1]).toMatchObject({ role: "assistant", text: "Jawaban pertama." });
    } finally {
      await app.dispose();
    }
  });

  it("streams a provider failure as an error event", async () => {
    const app = makeTestApp([{ fail: "Claude API 401 error (periksa LLM_API_KEY)" }]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Halo" }));
      expect(tags(events)).toEqual(["run_started", "error"]);
      expect(events[1]).toMatchObject({ message: expect.stringContaining("LLM_API_KEY") });
    } finally {
      await app.dispose();
    }
  });

  it("stops a model that never stops calling tools", async () => {
    const loop = fakeTurn("", [{ name: "statusKamar", args: { kdKamar: "MEL-01" } }]);
    const app = makeTestApp(Array.from({ length: MAX_STEPS + 5 }, () => loop));
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Ulangi terus" }));
      expect(events.at(-1)).toMatchObject({ _tag: "done", stopReason: "max_steps", steps: MAX_STEPS });
      expect(app.fake.requests).toHaveLength(MAX_STEPS);
    } finally {
      await app.dispose();
    }
  });

  it("rejects invalid request bodies with 400", async () => {
    const app = makeTestApp([]);
    try {
      const missing = await app.call("POST", "/tickets", { nurseName: "Ns. Ayu" });
      expect(missing.status).toBe(400);
      expect(((await missing.json()) as { error: string }).error).toMatch(/unit|complaint/);
      const empty = await app.call("POST", "/ask", { question: "" });
      expect(empty.status).toBe(400);
      const notFound = await app.call("POST", "/tickets/nope/investigate");
      expect(notFound.status).toBe(404);
    } finally {
      await app.dispose();
    }
  });

  it("reports health with the Khanza server and AI model", async () => {
    const app = makeTestApp([]);
    try {
      const health = (await (await app.call("GET", "/health")).json()) as {
        khanza: { readOnly: boolean };
        llm: { provider: string };
      };
      expect(health).toMatchObject({ khanza: { readOnly: true }, llm: { provider: "fake" } });
    } finally {
      await app.dispose();
    }
  });
});

describe.skipIf(testDb === null)("audit log", () => {
  it("records the question, the model, every tool call and its queries", async () => {
    const app = makeTestApp([fakeTurn("", [{ name: "statusKamar", args: { namaBangsal: "Mawar" } }]), fakeTurn("Selesai.")]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Kamar Mawar yang kosong?" }));
      const started = events[0];
      if (started?._tag !== "run_started") throw new Error("expected run_started");

      const [run] = await app.audit<{ question: string; provider: string; model: string; status: string; steps: number }>(
        `SELECT question, provider, model, status, steps FROM agent_runs WHERE id = '${started.runId}'`,
      );
      expect(run).toEqual({ question: "Kamar Mawar yang kosong?", provider: "fake", model: "fake-model", status: "ok", steps: 2 });

      const calls = await app.audit<{ tool: string; status: string; queries: number }>(
        `SELECT tc.tool, tc.status, (SELECT COUNT(*) FROM queries q WHERE q.tool_call_id = tc.id) AS queries
         FROM tool_calls tc WHERE tc.session_id = '${started.runId}'`,
      );
      expect(calls).toEqual([{ tool: "statusKamar", status: "ok", queries: 1 }]);

      const messages = await app.audit<{ role: string }>(
        `SELECT role FROM conversation_messages WHERE run_id = '${started.runId}' ORDER BY id`,
      );
      expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    } finally {
      await app.dispose();
    }
  });
});
