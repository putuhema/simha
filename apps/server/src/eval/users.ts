/**
 * The two synthetic accounts an eval runs as. They mirror what a SIMRS login
 * produces (rights snapshot and derived permissions) without touching the
 * real `user`/`admin` tables, so the same scenarios can run on the test DB.
 */
import { ALL_PERMISSIONS, derivePermissions, type User } from "@simha/shared";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** An Admin Utama (every Khanza menu, every fix table). */
const EVAL_ADMIN: User = {
  id: "eval-admin",
  username: "it-budi",
  displayName: "Budi Santika",
  role: "admin",
  active: true,
  createdAt: CREATED_AT,
  khanzaAdmin: true,
  permissions: ALL_PERMISSIONS,
  rights: [],
  employeeName: "Budi Santika",
  doctorName: null,
  staffName: null,
};

/** A nurse/staff account with only the outpatient CPPT right. */
const EVAL_STAFF: User = {
  id: "eval-staff",
  username: "P001",
  displayName: "Ns. Rina Fiktif",
  role: "staff",
  active: true,
  createdAt: CREATED_AT,
  khanzaAdmin: false,
  permissions: derivePermissions({ tindakan_ralan: true }, false),
  rights: ["tindakan_ralan"],
  employeeName: null,
  doctorName: null,
  staffName: "Ns. Rina Fiktif",
};

export const evalUser = (kind: "admin" | "staff"): User => (kind === "admin" ? EVAL_ADMIN : EVAL_STAFF);
