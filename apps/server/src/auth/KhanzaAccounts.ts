/**
 * SIMRS Khanza is the only login for Simha.
 *
 * Khanza stores credentials encrypted with the same two fixed keys its desktop
 * app uses:
 *
 *   admin.usere / admin.passworde  AES_ENCRYPT(?, 'nur') / AES_ENCRYPT(?, 'windi')
 *   user.id_user / user.password   AES_ENCRYPT(?, 'nur') / AES_ENCRYPT(?, 'windi')
 *
 * We run the exact comparison Khanza's `akses.setData` runs, through the
 * SELECT-only pool. A row in `admin` is an Admin Utama (every right); a row in
 * `user` carries one boolean/enum column per Khanza right. Only the granted
 * rights are kept, and the password is never stored, logged or returned.
 *
 * `rightsOf` re-reads a logged-in username without its password, for
 * POST /api/auth/refresh after IT changed the account's rights in Khanza.
 */
import { KhanzaRead } from "@simha/tools";
import { Context, Effect, Layer } from "effect";

export interface KhanzaAccount {
  readonly username: string;
  readonly displayName: string;
  /** Matching row in Khanza's `admin` table: Admin Utama, all rights. */
  readonly admin: boolean;
  /** Granted rights only, keyed by the Khanza `user` column name. */
  readonly rights: Readonly<Record<string, boolean>>;
  /** Employee master by NIK (= the username for most accounts). */
  readonly employeeName: string | null;
  /** Doctor master by kd_dokter (= the username for doctor accounts). */
  readonly doctorName: string | null;
  /** Petugas/nurse master by NIP. */
  readonly staffName: string | null;
}

type Row = Record<string, unknown>;

/** Khanza uses `enum('true','false')`; other installs use tinyint. Accept both. */
const granted = (value: unknown): boolean =>
  value === true || value === 1 || value === "1" || value === "true" || value === "TRUE";

/** The right columns of a `user` row, without the encrypted credentials. */
const rightsOfRow = (row: Row): Readonly<Record<string, boolean>> => {
  const rights: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "id_user" || key === "password") continue;
    if (granted(value)) rights[key] = true;
  }
  return rights;
};

/** "-" is Khanza's placeholder for an empty doctor name; never show it. */
const cleanName = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text === undefined || text === "" || text === "-" ? null : text;
};

const make = Effect.gen(function* () {
  const read = yield* KhanzaRead;

  /**
   * Names linked to the login. The username is a NIP for most staff, so the
   * same string is a NIK in `pegawai`, a NIP in `petugas`, and — for doctor
   * accounts that use their NIP — a kd_dokter in `dokter`. Missing tables are
   * normal on non-standard installs and simply give no name.
   */
  const profileOf = (username: string) =>
    Effect.gen(function* () {
      const [pegawai] = yield* read
        .query<{ readonly nama: string | null }>((sql) => sql`SELECT nama FROM pegawai WHERE nik = ${username} LIMIT 1`)
        .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<{ readonly nama: string | null }>)));
      const [petugas] = yield* read
        .query<{ readonly nama: string | null }>((sql) => sql`SELECT nama FROM petugas WHERE nip = ${username} LIMIT 1`)
        .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<{ readonly nama: string | null }>)));
      const [dokter] = yield* read
        .query<{ readonly nm_dokter: string | null }>(
          (sql) => sql`SELECT nm_dokter FROM dokter WHERE kd_dokter = ${username} LIMIT 1`,
        )
        .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<{ readonly nm_dokter: string | null }>)));

      const employeeName = cleanName(pegawai?.nama);
      const staffName = cleanName(petugas?.nama);
      const doctorName = cleanName(dokter?.nm_dokter);
      return {
        employeeName,
        doctorName,
        staffName,
        displayName: doctorName ?? employeeName ?? staffName,
      };
    });

  const accountOf = (username: string, admin: boolean, rights: Readonly<Record<string, boolean>>) =>
    Effect.map(profileOf(username), (profile) => ({
      username,
      displayName: profile.displayName ?? (admin ? "Admin Utama" : username),
      admin,
      rights,
      employeeName: profile.employeeName,
      doctorName: profile.doctorName,
      staffName: profile.staffName,
    }));

  /** The same check as `akses.setData` plus the rights of the matching user row. */
  const login = (username: string, password: string) =>
    Effect.gen(function* () {
      const admins = yield* read.query<{ readonly ok: number }>(
        (sql) => sql`
          SELECT 1 AS ok FROM admin
          WHERE usere = AES_ENCRYPT(${username}, 'nur')
            AND passworde = AES_ENCRYPT(${password}, 'windi')
          LIMIT 1`,
      );
      if (admins.length > 0) return yield* accountOf(username, true, {});

      const [row] = yield* read.query<Row>(
        (sql) => sql`
          SELECT * FROM user
          WHERE id_user = AES_ENCRYPT(${username}, 'nur')
            AND password = AES_ENCRYPT(${password}, 'windi')
          LIMIT 1`,
      );
      if (!row) return null;
      return yield* accountOf(username, false, rightsOfRow(row));
    });

  /** Re-read a session's rights by username, after login. Null when the account is gone. */
  const rightsOf = (username: string) =>
    Effect.gen(function* () {
      const admins = yield* read.query<{ readonly ok: number }>(
        (sql) => sql`SELECT 1 AS ok FROM admin WHERE usere = AES_ENCRYPT(${username}, 'nur') LIMIT 1`,
      );
      if (admins.length > 0) return yield* accountOf(username, true, {});

      const [row] = yield* read.query<Row>(
        (sql) => sql`SELECT * FROM user WHERE id_user = AES_ENCRYPT(${username}, 'nur') LIMIT 1`,
      );
      if (!row) return null;
      return yield* accountOf(username, false, rightsOfRow(row));
    });

  return { login, rightsOf };
});

export class KhanzaAccounts extends Context.Service<KhanzaAccounts, Effect.Success<typeof make>>()(
  "simha/KhanzaAccounts",
) {}

/** Needs the Khanza read pool (SELECT-only). */
export const KhanzaAccountsLive = Layer.effect(KhanzaAccounts, make);
