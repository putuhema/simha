/**
 * Client for the Khanza bridge (HarnessBridge.java in the hospital's Khanza
 * build): asks the running, logged-in Khanza to open a form for a visit.
 *
 * Khanza writes its port and a random token to
 * ~/.simrs-harness/khanza-bridge.properties after a login (owner-only) and
 * removes it at logout. One request per connection, one tab-separated line:
 *   TOKEN \t ping                    -> "OK <user>"
 *   TOKEN \t open \t FORM \t VALUE   -> "OK" or "ERR <reason>"
 * Khanza checks the user's own access rights before opening anything.
 */
import { readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Forms the bridge opens. "resume" and "soap" pick ranap or ralan from the visit. */
const BRIDGE_FORMS = ["resume", "soap", "riwayat", "resume_ranap", "resume_ralan", "soap_ranap", "soap_ralan"] as const;
export type BridgeForm = (typeof BRIDGE_FORMS)[number];

export interface BridgeTarget {
  readonly form: BridgeForm;
  /** No. rawat (riwayat also takes a no. RM). */
  readonly value: string;
}

const NO_RAWAT = /^\d{4}\/\d{2}\/\d{2}\/\d{6}$/;
const NO_RM = /^[0-9A-Za-z.-]{1,15}$/;

/** A valid request from the UI, or null. */
export const parseTarget = (input: unknown): BridgeTarget | null => {
  if (input === null || typeof input !== "object") return null;
  const { form, value } = input as { form?: unknown; value?: unknown };
  if (typeof form !== "string" || !(BRIDGE_FORMS as ReadonlyArray<string>).includes(form) || typeof value !== "string") return null;
  const ok = form === "riwayat" ? NO_RAWAT.test(value) || NO_RM.test(value) : NO_RAWAT.test(value);
  return ok ? { form: form as BridgeForm, value } : null;
};

export const FORM_LABELS: Readonly<Record<BridgeForm, string>> = {
  resume: "Resume medis",
  soap: "CPPT / SOAP",
  riwayat: "Riwayat perawatan",
  resume_ranap: "Resume ranap",
  resume_ralan: "Resume ralan",
  soap_ranap: "CPPT / SOAP ranap",
  soap_ralan: "CPPT / SOAP ralan",
};

const bridgeFile = () => path.join(os.homedir(), ".simrs-harness", "khanza-bridge.properties");

const readBridge = async (): Promise<{ port: number; token: string } | null> => {
  try {
    const text = await readFile(bridgeFile(), "utf8");
    const values = Object.fromEntries(
      text
        .split(/\r?\n/)
        .map((line) => line.split("="))
        .filter((parts) => parts.length >= 2)
        .map(([key, ...rest]) => [key?.trim(), rest.join("=").trim()]),
    );
    const port = Number(values["port"]);
    const token = values["token"];
    return Number.isInteger(port) && port > 0 && typeof token === "string" && /^[0-9a-f]{32,}$/.test(token) ? { port, token } : null;
  } catch {
    return null;
  }
};

/** Sends one line; resolves with Khanza's answer, or null when no bridge answers (not running, not logged in, old build). */
const request = async (fields: ReadonlyArray<string>, timeoutMs = 12_000): Promise<string | null> => {
  const bridge = await readBridge();
  if (!bridge) return null;
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: bridge.port });
    let reply = "";
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on("connect", () => socket.write(`${[bridge.token, ...fields].join("\t")}\n`));
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (reply.includes("\n")) finish(reply.split("\n")[0]?.trim() ?? "");
    });
    socket.on("error", () => finish(null));
    socket.on("close", () => finish(reply.trim() || null));
  });
};

/** The logged-in Khanza user, or null when no bridge answers. */
export const pingBridge = async (): Promise<string | null> => {
  const reply = await request(["ping"], 3000);
  return reply?.startsWith("OK") ? reply.slice(2).trim() || "?" : null;
};

export type OpenFormResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Asks Khanza to open the form; null when no bridge answers. */
export const openForm = async (target: BridgeTarget): Promise<OpenFormResult | null> => {
  const reply = await request(["open", target.form, target.value]);
  if (reply === null) return null;
  if (reply === "OK") return { ok: true };
  return { ok: false, message: reply.replace(/^ERR\s*/, "") || "Khanza menolak permintaan." };
};

/** Waits (up to `timeoutMs`) until a logged-in Khanza answers, e.g. after starting it. */
export const waitForBridge = async (timeoutMs: number, isCancelled: () => boolean): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !isCancelled()) {
    if (await pingBridge()) return true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
};
