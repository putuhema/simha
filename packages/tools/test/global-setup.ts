/**
 * Vitest global setup: prepares a throwaway Khanza test database with
 * synthetic data (test/fixtures/*.sql). Never touches the real Khanza DB.
 *
 * Where the database comes from, in order:
 * 1. KHANZA_TEST_DB_HOST is set: use that server (e.g. `docker compose up -d`
 *    with the repo's docker-compose.yml). Needs an admin login
 *    (KHANZA_TEST_DB_ADMIN_USER / KHANZA_TEST_DB_ADMIN_PASS) to create the
 *    test database and users.
 * 2. `mariadbd` and `mariadb-install-db` are on PATH: start a temporary
 *    MariaDB in a temp folder on a free port, delete it afterwards.
 * 3. Neither: database tests are skipped (pure unit tests still run).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import * as NodePath from "node:path";
import mysql from "mysql2/promise";
import type { TestProject } from "vitest/node";
import { MISCONFIGURED, TEST_DB_NAME, type TestDbInfo } from "./test-db-info.ts";

const fixtures = NodePath.join(import.meta.dirname, "fixtures");

interface AdminTarget {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly socketPath?: string;
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

const onPath = (bin: string): boolean => spawnSync("which", [bin], { stdio: "ignore" }).status === 0;

const connectAdmin = (target: AdminTarget) =>
  mysql.createConnection({
    ...(target.socketPath ? { socketPath: target.socketPath } : { host: target.host, port: target.port }),
    user: target.user,
    password: target.password,
    multipleStatements: true,
  });

/**
 * Waits until mariadbd accepts connections on its socket. Uses a plain socket
 * instead of mysql2 because failed mysql2 connects crash Vite's stack-trace
 * hook while the server is still starting.
 */
const waitForServer = async (socketPath: string, child: ChildProcess, log: () => string): Promise<void> => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`mariadbd exited early:\n${log()}`);
    const ready = await new Promise<boolean>((resolve) => {
      const socket = connect(socketPath);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (ready) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`mariadbd did not start within 30s:\n${log()}`);
};

/** Starts a temporary MariaDB. Returns the admin target and a stop function. */
const startTemporaryMariadb = async (): Promise<{ target: AdminTarget; stop: () => Promise<void> }> => {
  const dir = mkdtempSync(NodePath.join(tmpdir(), "simrs-harness-testdb-"));
  const datadir = NodePath.join(dir, "data");
  const socketPath = NodePath.join(dir, "mysqld.sock");
  const port = await freePort();

  const install = spawnSync(
    "mariadb-install-db",
    ["--no-defaults", `--datadir=${datadir}`, "--auth-root-authentication-method=normal", "--skip-test-db"],
    { encoding: "utf8" },
  );
  if (install.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`mariadb-install-db failed:\n${install.stdout}\n${install.stderr}`);
  }

  let output = "";
  const child = spawn(
    "mariadbd",
    [
      "--no-defaults",
      `--datadir=${datadir}`,
      `--socket=${socketPath}`,
      `--port=${port}`,
      "--bind-address=127.0.0.1",
      "--skip-name-resolve",
      `--pid-file=${NodePath.join(dir, "mysqld.pid")}`,
      "--innodb-buffer-pool-size=32M",
      "--skip-log-bin",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));

  const target: AdminTarget = { host: "127.0.0.1", port, user: "root", password: "", socketPath };
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
    }
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    await waitForServer(socketPath, child, () => output);
  } catch (error) {
    await stop();
    throw error;
  }
  return { target, stop };
};

/** (Re)creates the test database, loads schema + synthetic data, creates the two test users. */
const prepareDatabase = async (target: AdminTarget): Promise<TestDbInfo> => {
  const conn = await connectAdmin(target);
  try {
    const [versionRows] = await conn.query("SELECT VERSION() AS v");
    const version = String((versionRows as Array<{ v: string }>)[0]?.v ?? "");

    await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB_NAME}\`; CREATE DATABASE \`${TEST_DB_NAME}\`;`);
    await conn.changeUser({ database: TEST_DB_NAME });
    // Same sql_mode as our live Khanza server (zero dates allowed).
    await conn.query(
      "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
    );
    await conn.query(readFileSync(NodePath.join(fixtures, "khanza-schema.sql"), "utf8"));
    await conn.query(readFileSync(NodePath.join(fixtures, "seed.sql"), "utf8"));

    const readUser = "harness_test_read";
    const writeUser = "harness_test_write";
    const readPass = "test-read-pass";
    const writePass = "test-write-pass";
    const db = `\`${TEST_DB_NAME}\``;
    await conn.query(
      [
        `DROP USER IF EXISTS '${readUser}'@'%'`,
        `DROP USER IF EXISTS '${writeUser}'@'%'`,
        `CREATE USER '${readUser}'@'%' IDENTIFIED BY '${readPass}'`,
        `CREATE USER '${writeUser}'@'%' IDENTIFIED BY '${writePass}'`,
        `GRANT SELECT ON ${db}.* TO '${readUser}'@'%'`,
        // Mirrors the write allow-list in README.md.
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${db}.kamar_inap TO '${writeUser}'@'%'`,
        `GRANT SELECT, UPDATE ON ${db}.kamar TO '${writeUser}'@'%'`,
        `GRANT SELECT, UPDATE ON ${db}.reg_periksa TO '${writeUser}'@'%'`,
        `GRANT SELECT, DELETE ON ${db}.rawat_jl_pr TO '${writeUser}'@'%'`,
        `GRANT SELECT, DELETE ON ${db}.rawat_inap_pr TO '${writeUser}'@'%'`,
        `GRANT SELECT, UPDATE ON ${db}.bridging_surat_kontrol_bpjs TO '${writeUser}'@'%'`,
        // Wrongly configured users, to prove the harness refuses them.
        `DROP USER IF EXISTS '${MISCONFIGURED.readCanWrite}'@'%'`,
        `DROP USER IF EXISTS '${MISCONFIGURED.writeGlobal}'@'%'`,
        `CREATE USER '${MISCONFIGURED.readCanWrite}'@'%' IDENTIFIED BY '${MISCONFIGURED.password}'`,
        `CREATE USER '${MISCONFIGURED.writeGlobal}'@'%' IDENTIFIED BY '${MISCONFIGURED.password}'`,
        `GRANT SELECT, UPDATE ON ${db}.* TO '${MISCONFIGURED.readCanWrite}'@'%'`,
        `GRANT SELECT, UPDATE ON *.* TO '${MISCONFIGURED.writeGlobal}'@'%'`,
      ].join(";\n") + ";",
    );

    return {
      host: target.host,
      port: target.port,
      database: TEST_DB_NAME,
      readUser,
      readPass,
      writeUser,
      writePass,
      adminUser: target.user,
      adminPass: target.password,
      version,
    };
  } finally {
    await conn.end();
  }
};

const nothingToStop = async (): Promise<void> => {};

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const env = process.env;
  let target: AdminTarget | undefined;
  let stop: () => Promise<void> = nothingToStop;

  if (env["KHANZA_TEST_DB_HOST"]) {
    target = {
      host: env["KHANZA_TEST_DB_HOST"],
      port: Number(env["KHANZA_TEST_DB_PORT"] ?? "3306"),
      user: env["KHANZA_TEST_DB_ADMIN_USER"] ?? "root",
      password: env["KHANZA_TEST_DB_ADMIN_PASS"] ?? "",
    };
  } else if (onPath("mariadbd") && onPath("mariadb-install-db")) {
    const started = await startTemporaryMariadb();
    target = started.target;
    stop = started.stop;
  }

  if (target === undefined) {
    console.warn(
      "[tools] No test database: Khanza DB tests are skipped. " +
        "Run `docker compose up -d` and set KHANZA_TEST_DB_HOST=127.0.0.1 KHANZA_TEST_DB_PORT=3307 " +
        "KHANZA_TEST_DB_ADMIN_PASS=test, or install MariaDB locally.",
    );
    project.provide("khanzaTestDb", null);
    return stop;
  }

  try {
    project.provide("khanzaTestDb", await prepareDatabase(target));
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}
