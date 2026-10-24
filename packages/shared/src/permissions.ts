/**
 * What a logged-in SIMRS user may do in Simha.
 *
 * Simha has no roles of its own: every capability below is derived from one
 * or more boolean rights in Khanza's `user` table (an `admin` row in Khanza's
 * `admin` table gets everything). The mapping is deliberately explicit and
 * small: a harness feature is gated only when it has a direct Khanza menu
 * equivalent. Features without one (Tanya Data, patient search, visit
 * history) stay available to every SIMRS login, like they do in Khanza.
 *
 * The rights are read at login and can be refreshed with
 * `POST /api/auth/refresh`; else a user logs out and in again, exactly like
 * Khanza reads `akses` once at login.
 */
import { Schema } from "effect";

/** Khanza rights that gate a fix on each table Simha may change (see FIX_ALLOW_LIST). */
export const FIX_TABLE_RIGHTS: Readonly<Record<string, ReadonlyArray<string>>> = {
  kamar_inap: ["kamar_inap"],
  kamar: ["kamar_inap"],
  reg_periksa: ["registrasi"],
  rawat_jl_pr: ["tindakan_ralan"],
  rawat_inap_pr: ["tindakan_ranap"],
  bridging_surat_kontrol_bpjs: ["bpjs_surat_kontrol", "skdp_bpjs"],
};

/** Tables a fix may change, in the order shown to the user. */
export const FIX_TABLES: ReadonlyArray<string> = Object.keys(FIX_TABLE_RIGHTS);

/**
 * The capabilities the UI and the API check. `fixTables` is the list of
 * tables whose data the user may approve a fix for.
 */
export const Permissions = Schema.Struct({
  cpptRalan: Schema.Boolean,
  cpptRanap: Schema.Boolean,
  resume: Schema.Boolean,
  radiology: Schema.Boolean,
  berkas: Schema.Boolean,
  fixTables: Schema.Array(Schema.String),
});
export type Permissions = typeof Permissions.Type;

export type PermissionKey = "cpptRalan" | "cpptRanap" | "resume" | "radiology" | "berkas";

/** A Khanza right is granted for both `true` (driver) and the `enum('true','false')` Khanza uses. */
export const hasRight = (rights: Readonly<Record<string, unknown>>, right: string): boolean => {
  const value = rights[right];
  return value === true || value === 1 || value === "1" || value === "true";
};

/**
 * Turns the right columns of a Khanza `user` row into Simha capabilities.
 * `admin` means a matching row in Khanza's `admin` table (Admin Utama), which
 * sees every menu in Khanza; a Simha admin therefore sees every feature.
 */
export const derivePermissions = (rights: Readonly<Record<string, unknown>>, admin: boolean): Permissions => ({
  cpptRalan: admin || hasRight(rights, "tindakan_ralan"),
  cpptRanap: admin || hasRight(rights, "tindakan_ranap"),
  resume: admin || hasRight(rights, "data_resume_pasien"),
  radiology: admin || hasRight(rights, "periksa_radiologi"),
  berkas: admin || hasRight(rights, "berkas_digital_perawatan"),
  fixTables: admin ? FIX_TABLES : FIX_TABLES.filter((table) => (FIX_TABLE_RIGHTS[table] ?? []).some((right) => hasRight(rights, right))),
});

/** Nothing granted; used for local/legacy rows and as a safe default. */
export const NO_PERMISSIONS: Permissions = {
  cpptRalan: false,
  cpptRanap: false,
  resume: false,
  radiology: false,
  berkas: false,
  fixTables: [],
};

/** Everything granted; for CLI tools and tests that run without a SIMRS session. */
export const ALL_PERMISSIONS: Permissions = {
  cpptRalan: true,
  cpptRanap: true,
  resume: true,
  radiology: true,
  berkas: true,
  fixTables: FIX_TABLES,
};

/** May this user approve (or roll back) a fix on `table`? */
export const canApproveFix = (permissions: Permissions, table: string): boolean =>
  permissions.fixTables.includes(table);

/** The Khanza rights behind a fix table, e.g. for an explanation in the UI. */
export const fixTableRights = (table: string): ReadonlyArray<string> => FIX_TABLE_RIGHTS[table] ?? [];
