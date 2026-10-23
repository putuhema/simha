/**
 * M5 server features: login and roles, AI settings, transcripts, stats,
 * audit log, patient card, editing a fix, and serving the web UI.
 */
import { fakeTurn } from "@simha/llm";
import type {
  AuditPage,
  AuthState,
  ConversationSummary,
  Fix,
  LlmSettingsView,
  LlmTestResult,
  Stats,
  Transcript,
  User,
} from "@simha/shared";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vitest";
import { makeTestApp, readEvents, testDb } from "./harness.ts";

describe.skipIf(testDb === null)("login", () => {
  it("needs a first admin, then refuses a second setup", async () => {
    const app = makeTestApp([]);
    try {
      const state = (await (await app.raw("GET", "/api/auth/state")).json()) as AuthState;
      expect(state).toEqual({ setupNeeded: true, user: null });

      const setup = await app.raw("POST", "/api/auth/setup", { username: "kepala-it", displayName: "Kepala IT", password: "panjang-sekali" });
      expect(setup.status).toBe(200);
      const cookie = setup.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(/simha_session=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect((await setup.json()) as User).toMatchObject({ username: "kepala-it", role: "admin" });

      const again = await app.raw("POST", "/api/auth/setup", { username: "lain", displayName: "Lain", password: "panjang-sekali" });
      expect(again.status).toBe(409);
    } finally {
      await app.dispose();
    }
  });

  it("protects the API: 401 without a session, 403 for staff on admin routes", async () => {
    const app = makeTestApp([]);
    try {
      await app.sessionFor("it-budi");
      for (const [method, path] of [
        ["GET", "/api/conversations"],
        ["POST", "/api/ask"],
        ["GET", "/api/fixes"],
        ["POST", "/api/fixes/x/approve"],
        ["GET", "/api/audit"],
        ["GET", "/api/stats"],
      ] as const) {
        expect((await app.raw(method, path)).status, `${method} ${path}`).toBe(401);
      }
      expect((await app.raw("GET", "/api/health")).status).toBe(200);

      expect((await app.callAs("ns-staff", "GET", "/users")).status).toBe(403);
      expect((await app.callAs("ns-staff", "PUT", "/settings/llm", { provider: "fake", model: "x", maskPii: true })).status).toBe(403);
      expect((await app.callAs("ns-staff", "GET", "/conversations")).status).toBe(200);
      expect((await app.call("GET", "/users")).status).toBe(200);
    } finally {
      await app.dispose();
    }
  });

  it("rejects wrong passwords, locks after 5 tries and logs every attempt", async () => {
    const app = makeTestApp([]);
    try {
      await app.sessionFor("it-budi");
      for (let i = 0; i < 5; i++) {
        const wrong = await app.raw("POST", "/api/auth/login", { username: "it-budi", password: "salah-salah" });
        expect(wrong.status).toBe(401);
        expect(((await wrong.json()) as { error: string }).error).toBe("Username atau password salah.");
      }
      const locked = await app.raw("POST", "/api/auth/login", { username: "IT-BUDI", password: app.password });
      expect(locked.status).toBe(429);
      const unknown = await app.raw("POST", "/api/auth/login", { username: "tidak-ada", password: "apa-saja-123" });
      expect(unknown.status).toBe(401);

      const events = (await (await app.call("GET", "/audit?kind=events&q=login_failed")).json()) as AuditPage;
      expect(events.total).toBe(6);
    } finally {
      await app.dispose();
    }
  });

  it("disabling a user or resetting a password ends their sessions; logout ends one", async () => {
    const app = makeTestApp([]);
    try {
      expect((await app.callAs("ns-ayu", "GET", "/conversations")).status).toBe(200);
      const users = (await (await app.call("GET", "/users")).json()) as Array<User>;
      const ayu = users.find((u) => u.username === "ns-ayu");
      if (!ayu) throw new Error("no user");

      const self = users.find((u) => u.username === "it-budi");
      expect((await app.call("PATCH", `/users/${self?.id}`, { active: false })).status).toBe(400);

      expect((await app.call("PATCH", `/users/${ayu.id}`, { active: false })).status).toBe(200);
      expect((await app.callAs("ns-ayu", "GET", "/conversations")).status).toBe(401);
      const login = await app.raw("POST", "/api/auth/login", { username: "ns-ayu", password: app.password });
      expect(((await login.json()) as { error: string }).error).toMatch(/dinonaktifkan/);

      const logout = await app.call("POST", "/auth/logout");
      expect(logout.status).toBe(204);
      expect(logout.headers.get("set-cookie")).toMatch(/simha_session=;|Max-Age=0|Expires=/i);
      expect((await app.call("GET", "/conversations")).status).toBe(401);
    } finally {
      await app.dispose();
    }
  });

  it("records who asked and in which mode", async () => {
    const app = makeTestApp([fakeTurn("Selesai.")]);
    try {
      const events = await readEvents(
        await app.callAs("ns-staff", "POST", "/ask", { question: "Tidak bisa pindah kamar", mode: "investigasi" }),
      );
      const started = events[0];
      if (started?._tag !== "run_started") throw new Error("expected run_started");
      const transcript = (await (await app.call("GET", `/conversations/${started.conversationId}`)).json()) as Transcript;
      expect(transcript.runs[0]).toMatchObject({ askedBy: "ns-staff", mode: "investigasi", finalText: "Selesai." });
    } finally {
      await app.dispose();
    }
  });
});

describe.skipIf(testDb === null)("AI settings", () => {
  it("shows the settings without the key, switches provider at runtime and logs the change", async () => {
    const app = makeTestApp([fakeTurn("dari skrip")]);
    try {
      const before = (await (await app.call("GET", "/settings/llm")).json()) as LlmSettingsView;
      expect(before).toMatchObject({ provider: "fake", model: "fake-model", source: "env", apiKeySet: false });

      const bad = await app.call("PUT", "/settings/llm", { provider: "vikey", model: "m", maskPii: true });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toMatch(/LLM_BASE_URL/);

      const saved = await app.call("PUT", "/settings/llm", { provider: "fake", model: "model-baru", apiKey: "sk-rahasia", maskPii: false });
      const view = (await saved.json()) as LlmSettingsView;
      expect(view).toMatchObject({ model: "model-baru", source: "app", updatedBy: "it-budi", apiKeySet: true, maskPii: false });
      expect(JSON.stringify(view)).not.toContain("sk-rahasia");

      const events = await readEvents(await app.call("POST", "/ask", { question: "Halo" }));
      expect(events[0]).toMatchObject({ _tag: "run_started", model: "model-baru" });

      const changes = (await (await app.call("GET", "/audit?kind=events&q=llm_settings")).json()) as AuditPage;
      expect(changes.rows[0]).toMatchObject({ actor: "it-budi", detail: "fake / model-baru" });
    } finally {
      await app.dispose();
    }
  });

  it("tests a connection without saving", async () => {
    const app = makeTestApp([]);
    try {
      const ok = (await (
        await app.call("POST", "/settings/llm/test", { provider: "fake", model: "x", maskPii: true })
      ).json()) as LlmTestResult;
      expect(ok).toMatchObject({ ok: true, reply: "Selesai.", error: null });
      const broken = (await (
        await app.call("POST", "/settings/llm/test", { provider: "ollama-lain", model: "x", maskPii: true })
      ).json()) as LlmTestResult;
      expect(broken).toMatchObject({ ok: false, error: expect.stringMatching(/LLM_BASE_URL/) });
      expect(((await (await app.call("GET", "/settings/llm")).json()) as LlmSettingsView).source).toBe("env");
    } finally {
      await app.dispose();
    }
  });
});

describe.skipIf(testDb === null)("views", () => {
  it("stats count today's registrations and active inpatients from Khanza", async () => {
    const app = makeTestApp([]);
    try {
      const stats = (await (await app.call("GET", "/stats")).json()) as Stats;
      expect(stats).toMatchObject({ perbaikanMenunggu: 0, khanzaError: null });
      expect(typeof stats.registrasiHariIni).toBe("number");
      expect(stats.pasienRawatInap).toBeGreaterThanOrEqual(1);
    } finally {
      await app.dispose();
    }
  });

  it("rebuilds a Tanya Data thread with its steps and blocks", async () => {
    const app = makeTestApp([
      fakeTurn("", [{ name: "jalankanQueryBaca", args: { sql: "SELECT COUNT(*) AS jumlah FROM poliklinik", alasan: "uji" } }]),
      (request) => {
        const tool = request.messages.filter((m) => m.role === "tool").at(-1);
        const queryId = tool?.role === "tool" ? (JSON.parse(tool.content) as { queryId: string }).queryId : "";
        return fakeTurn("", [{ name: "tampilkan", args: { tipe: "stat", judul: "Jumlah poli", queryId } }]);
      },
      fakeTurn("Ada 2 poli."),
    ]);
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Berapa poli?" }));
      const started = events[0];
      if (started?._tag !== "run_started") throw new Error("no run");

      const transcript = (await (await app.call("GET", `/conversations/${started.conversationId}`)).json()) as Transcript;
      const [run] = transcript.runs;
      expect(run).toMatchObject({ question: "Berapa poli?", askedBy: "it-budi", finalText: "Ada 2 poli.", status: "ok" });
      expect(run?.steps.map((s) => [s.name, s.ok])).toEqual([
        ["jalankanQueryBaca", true],
        ["tampilkan", true],
      ]);
      expect(run?.blocks[0]).toMatchObject({ tipe: "stat", baris: [{ jumlah: 2 }] });

      const list = (await (await app.call("GET", "/conversations?mine=1")).json()) as Array<{ id: string; firstQuestion: string }>;
      expect(list[0]).toMatchObject({ id: started.conversationId, firstQuestion: "Berapa poli?" });
      expect((await app.callAs("orang-lain", "GET", "/conversations?mine=1").then((r) => r.json())) as Array<unknown>).toEqual([]);
      expect((await app.call("GET", "/conversations/tidak-ada")).status).toBe(404);
    } finally {
      await app.dispose();
    }
  });

  it("pins, archives and removes a thread, and only its owner may change it", async () => {
    const app = makeTestApp([fakeTurn("ok"), fakeTurn("ok")]);
    try {
      const ask = async (question: string) => {
        const events = await readEvents(await app.call("POST", "/ask", { question }));
        const started = events[0];
        if (started?._tag !== "run_started") throw new Error("no run");
        return started.conversationId;
      };
      const first = await ask("Thread pertama");
      const second = await ask("Thread kedua");
      const list = async () =>
        (await (await app.call("GET", "/conversations?mine=1")).json()) as Array<ConversationSummary>;

      expect((await list()).find((c) => c.id === first)).toMatchObject({ pinned: false, archived: false });

      expect((await app.call("PATCH", `/conversations/${first}`, { pinned: true })).status).toBe(204);
      let threads = await list();
      expect(threads[0]).toMatchObject({ id: first, pinned: true });
      expect(threads.find((c) => c.id === second)).toMatchObject({ pinned: false, archived: false });

      expect((await app.call("PATCH", `/conversations/${second}`, { archived: true })).status).toBe(204);
      threads = await list();
      expect(threads.find((c) => c.id === second)).toMatchObject({ archived: true });
      // An archived thread can still be opened, it is only moved out of the main list.
      expect((await app.call("GET", `/conversations/${second}`)).status).toBe(200);

      expect((await app.call("PATCH", `/conversations/${second}`, {})).status).toBe(400);
      expect((await app.call("PATCH", `/conversations/${second}`, { archived: false })).status).toBe(204);
      expect((await list()).find((c) => c.id === second)).toMatchObject({ archived: false });
      expect((await app.call("PATCH", `/conversations/${second}`, { archived: true })).status).toBe(204);

      // Only the owner (or an admin) may change a thread.
      expect((await app.callAs("orang-lain", "PATCH", `/conversations/${first}`, { pinned: false })).status).toBe(403);
      expect((await app.callAs("orang-lain", "DELETE", `/conversations/${first}`)).status).toBe(403);

      expect((await app.call("DELETE", `/conversations/${second}`)).status).toBe(204);
      threads = await list();
      expect(threads.map((c) => c.id)).toEqual([first]);
      expect((await app.call("GET", `/conversations/${second}`)).status).toBe(404);
      const [left] = await app.audit<{ n: number }>(
        `SELECT COUNT(*) AS n FROM conversation_messages WHERE conversation_id = '${second}'`,
      );
      expect(left?.n).toBe(0);
    } finally {
      await app.dispose();
    }
  });

  it("filters the audit log by kind, text and date", async () => {
    const app = makeTestApp([fakeTurn("ok")]);
    try {
      await readEvents(await app.call("POST", "/ask", { question: "Pertanyaan audit unik" }));
      const runs = (await (await app.call("GET", "/audit?kind=runs&q=audit%20unik")).json()) as AuditPage;
      expect(runs).toMatchObject({ kind: "runs", total: 1 });
      expect(runs.rows[0]).toMatchObject({ question: "Pertanyaan audit unik", asked_by: "it-budi", provider: "fake" });

      const today = new Date().toISOString().slice(0, 10);
      const dated = (await (await app.call("GET", `/audit?kind=runs&from=${today}&to=${today}`)).json()) as AuditPage;
      expect(dated.total).toBe(1);
      const past = (await (await app.call("GET", "/audit?kind=runs&to=2000-01-01")).json()) as AuditPage;
      expect(past.total).toBe(0);
      expect((await app.call("GET", "/audit?kind=apa")).status).toBe(400);
    } finally {
      await app.dispose();
    }
  });

  it("shows a patient card without NIK, phone or address", async () => {
    const app = makeTestApp([]);
    try {
      const response = await app.call("GET", "/patients/000001");
      expect(response.status).toBe(200);
      const card = (await response.json()) as { pasien: { nm_pasien: string }; kunjungan: Array<unknown>; dpjp: Array<{ nm_dokter: string }> };
      expect(card.pasien.nm_pasien).toBe("BUDI SANTOSO");
      expect(card.kunjungan.length).toBeGreaterThan(0);
      expect(card.dpjp[0]?.nm_dokter).toBe("dr. Andi Fiktif");
      const json = JSON.stringify(card);
      expect(json).not.toContain("5171000000000001");
      expect(json).not.toContain("081300000001");
      expect((await app.call("GET", "/patients/999999")).status).toBe(404);
    } finally {
      await app.dispose();
    }
  });
});

describe.skipIf(testDb === null)("editing an AI proposal", () => {
  it("creates the edited fix and rejects the original", async () => {
    const app = makeTestApp([]);
    try {
      const original = (await (
        await app.call("POST", "/fixes", {
          title: "Ubah status kamar",
          reason: "uji",
          sql: "UPDATE kamar SET status = ? WHERE kd_kamar = ?",
          params: ["KOSONG", "MEL-01"],
        })
      ).json()) as Fix;
      const edited = await app.call("POST", "/fixes", {
        title: "Ubah status kamar (edit)",
        reason: "uji edit",
        sql: "UPDATE kamar SET status = ? WHERE kd_kamar = ?",
        params: ["DIBERSIHKAN", "MEL-01"],
        replaces: original.id,
      });
      expect(edited.status).toBe(201);
      const after = (await (await app.call("GET", `/fixes/${original.id}`)).json()) as { fix: Fix };
      expect(after.fix.status).toBe("rejected");
      expect((await app.call("POST", "/fixes", { title: "x", reason: "x", sql: "UPDATE kamar SET status = 'ISI' WHERE kd_kamar = 'MEL-01'", replaces: original.id })).status).toBe(400);
    } finally {
      await app.dispose();
    }
  });
});

describe.skipIf(testDb === null)("web UI files", () => {
  it("serves assets, falls back to index.html for app routes, and never leaves the folder", async () => {
    const dir = mkdtempSync(NodePath.join(tmpdir(), "simrs-web-"));
    mkdirSync(NodePath.join(dir, "assets"));
    writeFileSync(NodePath.join(dir, "index.html"), "<!doctype html><title>SIMRS</title>");
    writeFileSync(NodePath.join(dir, "assets", "app.js"), "console.log(1)");
    const app = makeTestApp([], undefined, undefined, { webDir: dir });
    try {
      const index = await app.raw("GET", "/tanya");
      expect(await index.text()).toContain("<title>SIMRS</title>");
      expect(index.headers.get("content-security-policy")).toContain("default-src 'self'");
      const asset = await app.raw("GET", "/assets/app.js");
      expect(asset.headers.get("content-type")).toContain("text/javascript");
      expect(asset.headers.get("cache-control")).toContain("immutable");
      const escape = await app.raw("GET", "/assets/..%2F..%2F..%2Fetc%2Fpasswd");
      expect(await escape.text()).toContain("<title>SIMRS</title>");
      const unknownApi = await app.raw("GET", "/api/tidak-ada");
      expect(unknownApi.status).toBe(404);
    } finally {
      await app.dispose();
    }
  });
});
