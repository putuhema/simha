/**
 * The assistant's knowledge of the logged-in SIMRS account: who the user is,
 * the linked employee / doctor / petugas name, and whether a menu or form is
 * allowed by that account's Khanza rights.
 */
import { fakeTurn } from "@simha/llm";
import type { AgentEvent, AuthState } from "@simha/shared";
import { describe, expect, it } from "vitest";
import { makeTestApp, readEvents, testDb } from "./harness.ts";

const APP_DOCS = JSON.stringify({
  source: { commit: "test", generatedAt: "2026-10-24T00:00:00Z" },
  groups: [
    {
      letter: "A",
      name: "Registrasi",
      title: "Registrasi",
      entries: [{ label: "Kasir", button: "btnKasir", rights: ["kasir_ralan"], form: "DlgKasir" }],
    },
  ],
  forms: {
    DlgKasir: {
      title: "Kasir Rawat Jalan",
      file: "src/simrskhanza/DlgKasirRalan.java",
      package: "simrskhanza",
      menus: ["A/Kasir"],
      rights: ["kasir_ralan"],
      actions: ["Simpan"],
      popup: [],
      tables: { read: [], write: [] },
    },
  },
  rights: { kasir_ralan: { menus: ["A/Kasir"], forms: ["DlgKasir"] } },
});

type ToolFinished = Extract<AgentEvent, { _tag: "tool_finished" }>;

const toolFinished = (events: ReadonlyArray<AgentEvent>): ToolFinished => {
  const event = events.find((e) => e._tag === "tool_finished");
  if (event?._tag !== "tool_finished") throw new Error("no tool_finished event");
  return event;
};

const firstUserText = (request: {
  readonly messages: ReadonlyArray<{ readonly role: string; readonly text?: string; readonly modelText?: string }>;
}): string => {
  const message = request.messages[0];
  return message?.role === "user" ? (message.modelText ?? message.text ?? "") : "";
};

describe.skipIf(testDb === null)("identity and access", () => {
  it("links the SIMRS username to the doctor, petugas and employee master", async () => {
    const app = makeTestApp([]);
    try {
      const doctor = (await (await app.callAs("D001", "GET", "/auth/state")).json()) as AuthState;
      expect(doctor.user).toMatchObject({
        username: "D001",
        displayName: "dr. Andi Fiktif",
        doctorName: "dr. Andi Fiktif",
        employeeName: null,
        staffName: null,
        khanzaAdmin: false,
      });

      const nurse = (await (await app.callAs("P001", "GET", "/auth/state")).json()) as AuthState;
      expect(nurse.user).toMatchObject({
        username: "P001",
        displayName: "Ns. Rina Fiktif",
        doctorName: null,
        employeeName: null,
        staffName: "Ns. Rina Fiktif",
      });

      const employee = (await (await app.call("GET", "/auth/state")).json()) as AuthState;
      expect(employee.user).toMatchObject({
        username: "it-budi",
        displayName: "Budi Santika",
        employeeName: "Budi Santika",
        khanzaAdmin: true,
      });
      expect(employee.user?.rights).toEqual([]);
    } finally {
      await app.dispose();
    }
  });

  it("puts the account and its rights into the model turn and lets it check a menu", async () => {
    const app = makeTestApp(
      [
        fakeTurn("", [{ name: "aksesSaya", args: { tanya: "kasir" } }]),
        fakeTurn("Menu kasir tidak tersedia untuk akun Anda."),
      ],
      undefined,
      undefined,
      { appDocs: APP_DOCS },
    );
    try {
      await app.sessionFor("it-terbatas", "staff", ["tindakan_ralan"]);
      const events = await readEvents(
        await app.callAs("it-terbatas", "POST", "/ask", { question: "Apakah saya bisa membuka menu kasir?" }),
      );
      const finished = toolFinished(events);
      expect(finished.ok).toBe(true);
      const result = finished.result as {
        akun: { username: string; peran: string; namaPegawai: string | null; namaPetugas: string | null };
        cek: ReadonlyArray<{ jenis: string; nama: string; hak: ReadonlyArray<string>; diizinkan: boolean }>;
      };
      expect(result.akun).toMatchObject({
        username: "it-terbatas",
        peran: "Petugas / perawat",
        namaPegawai: "Ns. Terbatas Fiktif",
        namaPetugas: "Ns. Terbatas Fiktif",
      });
      expect(result.cek).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ jenis: "menu", nama: "A/Kasir", hak: ["kasir_ralan"], diizinkan: false }),
        ]),
      );

      const request = app.fake.requests[0];
      if (request === undefined) throw new Error("no model request");
      const text = firstUserText(request);
      expect(text).toContain("[Akun SIMRS yang sedang login]");
      expect(text).toContain("Username: it-terbatas");
      expect(text).toContain("Nama pegawai: Ns. Terbatas Fiktif");
      expect(text).toContain("Nama petugas/perawat: Ns. Terbatas Fiktif");
      expect(text).toContain("CPPT rawat inap=tidak");
      expect(request.tools.map((tool) => tool.name)).toContain("aksesSaya");
    } finally {
      await app.dispose();
    }
  });

  it("answers an admin's menu check as allowed", async () => {
    const app = makeTestApp(
      [
        fakeTurn("", [{ name: "aksesSaya", args: { tanya: "kasir" } }]),
        fakeTurn("Menu kasir bisa dibuka."),
      ],
      undefined,
      undefined,
      { appDocs: APP_DOCS },
    );
    try {
      const events = await readEvents(await app.call("POST", "/ask", { question: "Bisa buka menu kasir?" }));
      const result = toolFinished(events).result as {
        akun: { username: string; admin: boolean; peran: string };
        cek: ReadonlyArray<{ jenis: string; nama: string; diizinkan: boolean }>;
      };
      expect(result.akun).toMatchObject({ username: "it-budi", admin: true, peran: "Admin Utama SIMRS" });
      expect(result.cek).toEqual(
        expect.arrayContaining([expect.objectContaining({ jenis: "menu", nama: "A/Kasir", diizinkan: true })]),
      );
    } finally {
      await app.dispose();
    }
  });
});
