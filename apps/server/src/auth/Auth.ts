/**
 * Local login for IT staff: users, sessions and the app event log, all in the
 * audit SQLite DB. No external auth service (the app runs on the hospital
 * network).
 *
 * - Passwords: scrypt hashes (password.ts).
 * - Sessions: a random token in an HttpOnly, SameSite=Strict cookie; only its
 *   SHA-256 hash is stored. Sessions expire after SESSION_HOURS.
 * - Failed logins: after MAX_FAILURES wrong passwords for a username, that
 *   username is locked for LOCK_SECONDS. Every login attempt is logged.
 */
import type { CreateUserRequest, Role, UpdateUserRequest, User } from "@simha/shared";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./password.ts";

export const SESSION_COOKIE = "simha_session";
export const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 60;

/** The logged-in user of the current request. */
export class CurrentUser extends Context.Service<CurrentUser, User>()("simha/CurrentUser") {}

/** A request the user may not make; `status` is the HTTP status. */
export class AuthError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 429;
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
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  active: r.active === 1,
  createdAt: r.created_at,
});

const now = () => new Date().toISOString();
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const failures = new Map<string, { count: number; lockedUntil: number }>();

  const logEvent = (action: string, actor: string | null, detail: string | null = null, ip: string | null = null) =>
    sql`INSERT INTO app_events ${sql.insert({ action, actor, detail, ip, at: now() })}`.pipe(Effect.asVoid, Effect.orDie);

  const userCount = sql<{ n: number }>`SELECT COUNT(*) AS n FROM users`.pipe(
    Effect.map(([r]) => r?.n ?? 0),
    Effect.orDie,
  );

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

  const insertUser = (input: CreateUserRequest) =>
    Effect.gen(function* () {
      if (yield* findByUsername(input.username)) return yield* Effect.fail(new AuthError(409, "Username sudah dipakai."));
      const id = crypto.randomUUID();
      const passwordHash = yield* Effect.promise(() => hashPassword(input.password));
      yield* sql`INSERT INTO users ${sql.insert({
        id,
        username: input.username,
        display_name: input.displayName,
        password_hash: passwordHash,
        role: input.role,
        active: 1,
        created_at: now(),
        updated_at: now(),
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

  /** Creates the first admin. Fails once any user exists. */
  const setup = (input: { username: string; displayName: string; password: string }, ip: string | null) =>
    Effect.gen(function* () {
      if ((yield* userCount) > 0) return yield* Effect.fail(new AuthError(409, "Akun admin pertama sudah dibuat. Silakan login."));
      const user = yield* insertUser({ ...input, role: "admin" });
      yield* logEvent("setup", user.username, "Akun admin pertama dibuat.", ip);
      return { user, token: yield* createSession(user.id) };
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
      const row = yield* findByUsername(username);
      // Hash even when the user does not exist, so timing does not reveal valid usernames.
      const ok = row
        ? yield* Effect.promise(() => verifyPassword(password, row.password_hash))
        : yield* Effect.promise(() => hashPassword(password)).pipe(Effect.as(false));
      if (!row || !ok || row.active !== 1) {
        const count = (state?.count ?? 0) + 1;
        failures.set(key, { count, lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCK_SECONDS * 1000 : 0 });
        yield* logEvent("login_failed", username, row && ok ? "Akun nonaktif." : null, ip);
        return yield* Effect.fail(
          new AuthError(401, row && ok ? "Akun ini dinonaktifkan. Hubungi admin." : "Username atau password salah."),
        );
      }
      failures.delete(key);
      yield* logEvent("login", row.username, null, ip);
      return { user: toUser(row), token: yield* createSession(row.id) };
    });

  /** The active user of a session token, or undefined. Refreshes last_seen_at. */
  const userForToken = (token: string) =>
    Effect.gen(function* () {
      const hash = tokenHash(token);
      const [row] = yield* sql<UserRow & { expires_at: string }>`
        SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ${hash}`;
      if (!row || row.active !== 1 || row.expires_at < now()) return undefined;
      yield* sql`UPDATE sessions SET last_seen_at = ${now()} WHERE token_hash = ${hash}`;
      return toUser(row);
    }).pipe(Effect.orDie);

  const logout = (token: string, user: User) =>
    Effect.andThen(
      sql`DELETE FROM sessions WHERE token_hash = ${tokenHash(token)}`.pipe(Effect.orDie),
      logEvent("logout", user.username),
    );

  const listUsers = sql<UserRow>`SELECT * FROM users ORDER BY username`.pipe(
    Effect.map((rows) => rows.map(toUser)),
    Effect.orDie,
  );

  const createUser = (input: CreateUserRequest, actor: User) =>
    Effect.tap(insertUser(input), (user) => logEvent("user_created", actor.username, `${user.username} (${user.role})`));

  const updateUser = (id: string, input: UpdateUserRequest, actor: User) =>
    Effect.gen(function* () {
      const user = yield* getUser(id);
      if (!user) return yield* Effect.fail(new AuthError(404, "User tidak ditemukan."));
      if (user.id === actor.id && (input.active === false || input.role === "staff")) {
        return yield* Effect.fail(new AuthError(400, "Anda tidak bisa menonaktifkan atau menurunkan akun Anda sendiri."));
      }
      const passwordHash = input.password ? yield* Effect.promise(() => hashPassword(input.password ?? "")) : undefined;
      yield* sql`UPDATE users SET ${sql.update({
        updated_at: now(),
        ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.active !== undefined ? { active: input.active ? 1 : 0 } : {}),
        ...(passwordHash !== undefined ? { password_hash: passwordHash } : {}),
      })} WHERE id = ${id}`.pipe(Effect.orDie);
      // A disabled account or a reset password ends the user's sessions.
      if (input.active === false || passwordHash !== undefined) {
        yield* sql`DELETE FROM sessions WHERE user_id = ${id}`.pipe(Effect.orDie);
      }
      const changes = Object.keys(input).map((k) => (k === "password" ? "password direset" : k));
      yield* logEvent("user_updated", actor.username, `${user.username}: ${changes.join(", ")}`);
      return (yield* getUser(id)) as User;
    });

  const changePassword = (user: User, currentPassword: string, newPassword: string) =>
    Effect.gen(function* () {
      const row = yield* findByUsername(user.username);
      if (!row || !(yield* Effect.promise(() => verifyPassword(currentPassword, row.password_hash)))) {
        return yield* Effect.fail(new AuthError(400, "Password lama salah."));
      }
      const passwordHash = yield* Effect.promise(() => hashPassword(newPassword));
      yield* sql`UPDATE users SET password_hash = ${passwordHash}, updated_at = ${now()} WHERE id = ${user.id}`.pipe(Effect.orDie);
      yield* logEvent("password_changed", user.username);
    });

  return {
    setupNeeded: Effect.map(userCount, (n) => n === 0),
    setup,
    login,
    logout,
    userForToken,
    listUsers,
    createUser,
    updateUser,
    changePassword,
    logEvent,
  };
});

export class Auth extends Context.Service<Auth, Effect.Success<typeof make>>()("simha/Auth") {}

/** Needs the audit DB's SqlClient. */
export const AuthLive = Layer.effect(Auth, make);
