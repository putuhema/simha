/**
 * The agent loop and HTTP API end to end: real routes, store, tools and audit
 * log, a scripted fake AI provider and the throwaway Khanza test DB.
 */
import { fakeTurn, type ChatRequest } from "@simha/llm";
import type { AgentEvent, Transcript } from "@simha/shared";
import { describe, expect, it } from "vitest";
import { MAX_STEPS } from "../src/agent/Agent.ts";
import { makeTestApp, readEvents, testDb } from "./harness.ts";

const lastToolMessages = (request: ChatRequest) => request.messages.filter((m) => m.role === "tool");

const tags = (events: ReadonlyArray<AgentEvent>) => events.map((e) => e._tag);

describe.skipIf(testDb === null)("agent over HTTP", () => {
  it("investigates a complaint with tools and streams every step", async () => {
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
      const response = await app.call("POST", "/ask", {
        mode: "investigasi",
        question: "Pasien RM 000002 tidak bisa dipindah ke kamar Mawar",
      });
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

      // The model saw the complaint, the investigation format and the tool list.
      const first = app.fake.requests[0];
      expect(first?.messages[0]).toMatchObject({ role: "user" });
      expect(first?.messages[0]?.role === "user" && first.messages[0].text).toContain("tidak bisa dipindah");
      expect(first?.messages[0]?.role === "user" && first.messages[0].text).toContain("[Mode: investigasi keluhan]");
      // ...and where the registration data ends, so "7 hari terakhir" does not hit an empty range.
      expect(first?.messages[0]?.role === "user" && first.messages[0].text).toMatch(
        /data registrasi terakhir di database: \d{4}-\d{2}-\d{2}/,
      );
      expect(first?.tools.map((t) => t.name)).toContain("riwayatKamar");

      const started = events[0];
      if (started?._tag !== "run_started") throw new Error("expected run_started");
      const transcript = (await (await app.call("GET", `/conversations/${started.conversationId}`)).json()) as Transcript;
      expect(transcript.runs[0]).toMatchObject({ mode: "investigasi", status: "ok" });
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

  it("streams thinking and half-written tool calls before the turn ends", async () => {
    const sql = "SELECT COUNT(*) AS jumlah FROM reg_periksa";
    const args = JSON.stringify({ sql, alasan: "Hitung registrasi" });
    const app = makeTestApp([
      [
        { type: "reasoning_delta", text: "Perlu hitung registrasi." },
        { type: "tool_input_delta", index: 0, name: "jalankanQueryBaca", delta: args.slice(0, 15) },
        { type: "tool_input_delta", index: 0, name: "jalankanQueryBaca", delta: args.slice(15) },
        { type: "tool_call", call: { id: "q1", name: "jalankanQueryBaca", args: JSON.parse(args) } },
        { type: "done", stopReason: "tool_use" },
      ],
      fakeTurn("Ada registrasi."),
    ]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Berapa registrasi?" }));
      expect(tags(events)).toEqual([
        "run_started",
        "reasoning_delta",
        "tool_input_delta",
        "tool_input_delta",
        "tool_started",
        "tool_finished",
        "text_delta",
        "done",
      ]);
      const drafts = events.filter((e) => e._tag === "tool_input_delta");
      expect(drafts.map((d) => d.delta).join("")).toBe(args);
      expect(new Set(drafts.map((d) => d.draftId)).size).toBe(1);
      expect(events.find((e) => e._tag === "tool_started")).toMatchObject({ callId: "q1", draftId: drafts[0]?.draftId });
      // Thinking is shown, never sent back to the model.
      expect(JSON.stringify(app.fake.requests[1]?.messages)).not.toContain("Perlu hitung registrasi");
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

  it("drops old turns from a follow-up when the history exceeds the token budget", async () => {
    const big = "x".repeat(120_000);
    const app = makeTestApp([fakeTurn(big), fakeTurn("Lanjut.")]);
    try {
      const first = await readEvents(await app.call("POST", "/ask", { question: "Pertanyaan pertama" }));
      const started = first[0];
      if (started?._tag !== "run_started") throw new Error("expected run_started");
      await readEvents(await app.call("POST", "/ask", { question: "Lanjut", conversationId: started.conversationId }));
      const messages = app.fake.requests[1]?.messages ?? [];
      expect(messages[0]?.role === "user" && messages[0].text).toContain("[Ringkasan percakapan sebelumnya");
      expect(messages[0]?.role === "user" && messages[0].text).toContain("Pertanyaan pertama");
      expect(JSON.stringify(messages)).not.toContain("x".repeat(1_000));
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

  it("stops a model that never stops calling tools and forces a final answer", async () => {
    const loop = fakeTurn("", [{ name: "statusKamar", args: { kdKamar: "MEL-01" } }]);
    const app = makeTestApp([...Array.from({ length: MAX_STEPS - 1 }, () => loop), fakeTurn("Jawaban akhir.")]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Ulangi terus" }));
      expect(events.at(-1)).toMatchObject({ _tag: "done", text: "Jawaban akhir.", stopReason: "max_steps", steps: MAX_STEPS });
      expect(app.fake.requests).toHaveLength(MAX_STEPS);
      // The last turn is asked to answer without tools.
      expect(app.fake.requests.at(-1)?.tools).toEqual([]);
    } finally {
      await app.dispose();
    }
  });

  it("rejects invalid request bodies with 400", async () => {
    const app = makeTestApp([]);
    try {
      const empty = await app.call("POST", "/ask", { question: "" });
      expect(empty.status).toBe(400);
      const badMode = await app.call("POST", "/ask", { question: "Halo", mode: "salah" });
      expect(badMode.status).toBe(400);
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

  it("stores the tokens the provider reports, summed over every model turn", async () => {
    const app = makeTestApp([
      [
        { type: "tool_call", call: { id: "call_token", name: "statusKamar", args: { namaBangsal: "Mawar" } } },
        {
          type: "done",
          stopReason: "tool_use",
          usage: { inputTokens: 1_000, outputTokens: 100, cachedInputTokens: 600, cacheWriteTokens: 50 },
        },
      ],
      [
        { type: "text_delta", text: "Selesai." },
        {
          type: "done",
          stopReason: "end_turn",
          usage: { inputTokens: 1_500, outputTokens: 200, cachedInputTokens: 1_200 },
        },
      ],
    ]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Berapa kamar kosong?" }));
      const started = events[0];
      if (started?._tag !== "run_started") throw new Error("expected run_started");

      const [run] = await app.audit<{
        input_tokens: number;
        output_tokens: number;
        cached_input_tokens: number;
        cache_write_tokens: number;
      }>(
        `SELECT input_tokens, output_tokens, cached_input_tokens, cache_write_tokens
         FROM agent_runs WHERE id = '${started.runId}'`,
      );
      expect(run).toEqual({
        input_tokens: 2_500,
        output_tokens: 300,
        cached_input_tokens: 1_800,
        cache_write_tokens: 50,
      });
    } finally {
      await app.dispose();
    }
  });
});
