/**
 * Login for IT staff, using their SIMRS Khanza account.
 *
 * There are no Simha passwords and no local user management: Khanza's
 * `admin` / `user` tables decide who may log in and which rights they have.
 * The audit SQLite DB keeps one row per SIMRS username (for sessions and the
 * audit log) and a snapshot of the granted Khanza rights, taken at login or
 * refreshed with POST /api/auth/refresh.
 *
 * - Sessions: a random token in an HttpOnly, SameSite=Strict cookie; only its
 *   SHA-256 hash is stored. Sessions expire after SESSION_HOURS.
 * - Failed logins: after MAX_FAILURES wrong passwords for a username, that
 *   username is locked for LOCK_SECONDS. Every login attempt is logged.
 * - A Khanza database outage is reported as 503, never as a wrong password.
 */
import { derivePermissions, type Role, type User } from "@simha/shared";
import { KhanzaQueryError } from "@simha/tools";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { createHash, randomBytes } from "node:crypto";
import { KhanzaAccounts, type KhanzaAccount } from "./KhanzaAccounts.ts";

export const SESSION_COOKIE = "simha_session";
export const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 60;

/** The logged-in user of the current request. */
export class CurrentUser extends Context.Service<CurrentUser, User>()("simha/CurrentUser") {}

/** A request the user may not make; `status` is the HTTP status. */
export class AuthError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503;
  constructor(status: AuthError["status"], message: string) {
    super(message);
    this.status = status;
  }
}

interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly display_name: string;
  readonly password_hash: string;
  readonly role: Role;
  readonly active: number;
  readonly created_at: string;
  readonly source: string;
  readonly rights_json: string | null;
  readonly khanza_admin: number;
}

/** Old rows (and malformed JSON) grant nothing. */
const parseRights = (json: string | null): Readonly<Record<string, boolean>> => {
  if (json === null) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === true));
  } catch {
    return {};
  }
};

const toUser = (r: UserRow): User => {
  const khanzaAdmin = r.khanza_admin === 1;
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    active: r.active === 1,
    createdAt: r.created_at,
    khanzaAdmin,
    permissions: derivePermissions(parseRights(r.rights_json), khanzaAdmin),
  };
};

const now = () => new Date().toISOString();
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const accounts = yield* KhanzaAccounts;
  const failures = new Map<string, { count: number; lockedUntil: number }>();

  const logEvent = (action: string, actor: string | null, detail: string | null = null, ip: string | null = null) =>
    sql`INSERT INTO app_events ${sql.insert({ action, actor, detail, ip, at: now() })}`.pipe(Effect.asVoid, Effect.orDie);

  const findByUsername = (username: string) =>
    sql<UserRow>`SELECT * FROM users WHERE username = ${username}`.pipe(
      Effect.map(([r]) => r),
      Effect.orDie,
    );

  const getUser = (id: string) =>
    sql<UserRow>`SELECT * FROM users WHERE id = ${id}`.pipe(
      Effect.map(([r]) => (r ? toUser(r) : undefined)),
      Effect.orDie,
    );

  /**
   * Creates or updates the local row for a SIMRS account. The local row is an
   * identity for sessions and audit rows, not a second source of truth.
   */
  const syncAccount = (account: KhanzaAccount) =>
    Effect.gen(function* () {
      const existing = yield* findByUsername(account.username);
      const role: Role = account.admin ? "admin" : "staff";
      const rightsJson = JSON.stringify(account.rights);
      const khanzaAdmin = account.admin ? 1 : 0;
      if (existing) {
        yield* sql`UPDATE users SET ${sql.update({
          display_name: account.displayName,
          role,
          active: 1,
          source: "simrs",
          password_hash: "",
          rights_json: rightsJson,
          khanza_admin: khanzaAdmin,
          rights_updated_at: now(),
          updated_at: now(),
        })} WHERE id = ${existing.id}`.pipe(Effect.orDie);
        return (yield* getUser(existing.id)) as User;
      }
      const id = crypto.randomUUID();
      yield* sql`INSERT INTO users ${sql.insert({
        id,
        username: account.username,
        display_name: account.displayName,
        password_hash: "",
        role,
        active: 1,
        created_at: now(),
        updated_at: now(),
        source: "simrs",
        rights_json: rightsJson,
        khanza_admin: khanzaAdmin,
        rights_updated_at: now(),
      })}`.pipe(Effect.orDie);
      return (yield* getUser(id)) as User;
    });

  const createSession = (userId: string) =>
    Effect.gen(function* () {
      const token = randomBytes(32).toString("base64url");
      const at = new Date();
      yield* sql`INSERT INTO sessions ${sql.insert({
        token_hash: tokenHash(token),
        user_id: userId,
        created_at: at.toISOString(),
        expires_at: new Date(at.getTime() + SESSION_HOURS * 3_600_000).toISOString(),
        last_seen_at: at.toISOString(),
      })}`.pipe(Effect.orDie);
      return token;
    });

  const login = (username: string, password: string, ip: string | null) =>
    Effect.gen(function* () {
      const key = username.toLowerCase();
      const state = failures.get(key);
      if (state && state.lockedUntil > Date.now()) {
        yield* logEvent("login_locked", username, null, ip);
        const seconds = Math.ceil((state.lockedUntil - Date.now()) / 1000);
        return yield* Effect.fail(new AuthError(429, `Terlalu banyak percobaan. Coba lagi dalam ${seconds} detik.`));
      }

      const lookup = yield* accounts.login(username, password).pipe(
        Effect.map((account) => ({ ok: true as const, account })),
        Effect.catch((error: KhanzaQueryError) => Effect.succeed({ ok: false as const, error })),
      );
      if (!lookup.ok) {
        yield* logEvent("login_failed", username, `Database SIMRS: ${lookup.error.message}`, ip);
        return yield* Effect.fail(
          new AuthError(503, "Tidak bisa memeriksa akun ke database SIMRS. Coba lagi, atau hubungi admin SIMRS."),
        );
      }

      if (lookup.account === null) {
        const count = (state?.count ?? 0) + 1;
        failures.set(key, { count, lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCK_SECONDS * 1000 : 0 });
        yield* logEvent("login_failed", username, null, ip);
        return yield* Effect.fail(new AuthError(401, "Username atau password SIMRS salah."));
      }

      failures.delete(key);
      const user = yield* syncAccount(lookup.account);
      yield* logEvent("login", user.username, lookup.account.admin ? "Admin Utama SIMRS" : "SIMRS", ip);
      return { user, token: yield* createSession(user.id) };
    });

  /** The active user of a session token, or undefined. Refreshes last_seen_at. */
  const userForToken = (token: string) =>
    Effect.gen(function* () {
      const hash = tokenHash(token);
      const [row] = yield* sql<UserRow & { expires_at: string }>`
        SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ${hash}`;
      if (!row || row.active !== 1 || row.source !== "simrs" || row.expires_at < now()) return undefined;
      yield* sql`UPDATE sessions SET last_seen_at = ${now()} WHERE token_hash = ${hash}`;
      return toUser(row);
    }).pipe(Effect.orDie);

  /**
   * Re-reads this session's Khanza account and rights. Used after IT changes a
   * right in Khanza, so the user does not have to log out and in again.
   */
  const refresh = (user: User) =>
    Effect.gen(function* () {
      const lookup = yield* accounts.rightsOf(user.username).pipe(
        Effect.map((account) => ({ ok: true as const, account })),
        Effect.catch((error: KhanzaQueryError) => Effect.succeed({ ok: false as const, error })),
      );
      if (!lookup.ok) {
        return yield* Effect.fail(
          new AuthError(503, "Tidak bisa membaca hak akses dari database SIMRS. Coba lagi, atau hubungi admin SIMRS."),
        );
      }
      if (lookup.account === null) {
        yield* sql`DELETE FROM sessions WHERE user_id = ${user.id}`.pipe(Effect.orDie);
        yield* logEvent("access_revoked", user.username, "Akun tidak ditemukan di SIMRS.");
        return yield* Effect.fail(new AuthError(401, "Akun ini sudah tidak ada di SIMRS. Silakan login lagi."));
      }
      const role: Role = lookup.account.admin ? "admin" : "staff";
      yield* sql`UPDATE users SET ${sql.update({
        display_name: lookup.account.displayName,
        role,
        active: 1,
        rights_json: JSON.stringify(lookup.account.rights),
        khanza_admin: lookup.account.admin ? 1 : 0,
        rights_updated_at: now(),
        updated_at: now(),
      })} WHERE id = ${user.id}`.pipe(Effect.orDie);
      yield* logEvent("access_refreshed", user.username, lookup.account.admin ? "Admin Utama SIMRS" : "SIMRS");
      return (yield* getUser(user.id)) as User;
    });

  const logout = (token: string, user: User) =>
    Effect.andThen(
      sql`DELETE FROM sessions WHERE token_hash = ${tokenHash(token)}`.pipe(Effect.orDie),
      logEvent("logout", user.username),
    );

  return {
    login,
    refresh,
    logout,
    userForToken,
    logEvent,
  };
});

export class Auth extends Context.Service<Auth, Effect.Success<typeof make>>()("simha/Auth") {}

/** Needs the audit DB's SqlClient and the Khanza account lookup. */
export const AuthLive = Layer.effect(Auth, make);
