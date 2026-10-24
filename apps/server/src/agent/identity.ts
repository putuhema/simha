/**
 * The logged-in SIMRS account, added to every user turn.
 *
 * Simha already knows who is asking; the model must not answer "I cannot see
 * who you are". This block is small (names and feature rights) and is stored
 * in the turn's `modelText`, so it replays exactly on follow-ups. For a
 * specific menu/form/right the agent can call the `aksesSaya` tool.
 */
import type { User } from "@simha/shared";

const yes = (value: boolean) => (value ? "boleh" : "tidak");

const role = (user: User): string => {
  if (user.khanzaAdmin) return "Admin Utama SIMRS";
  if (user.doctorName !== null) return "Dokter";
  if (user.staffName !== null) return "Petugas / perawat";
  return "Pegawai";
};

export const identityPrompt = (user: User): string => {
  const names = [
    user.doctorName === null ? null : `Nama dokter: ${user.doctorName}`,
    user.staffName === null ? null : `Nama petugas/perawat: ${user.staffName}`,
    user.employeeName === null ? null : `Nama pegawai: ${user.employeeName}`,
  ].filter((line): line is string => line !== null);

  return [
    "[Akun SIMRS yang sedang login]",
    `Username: ${user.username}`,
    `Nama tampilan: ${user.displayName}`,
    ...names,
    `Peran: ${role(user)}`,
    user.khanzaAdmin
      ? "Hak: Admin Utama SIMRS — semua menu dan hak."
      : `Hak Khanza: ${user.rights.length} hak terbaca.`,
    `Fitur: CPPT rawat jalan=${yes(user.permissions.cpptRalan)}, CPPT rawat inap=${yes(user.permissions.cpptRanap)}, ` +
      `resume=${yes(user.permissions.resume)}, radiologi=${yes(user.permissions.radiology)}, ` +
      `berkas digital=${yes(user.permissions.berkas)}.`,
    `Perbaikan data yang boleh disetujui: ${user.permissions.fixTables.length === 0 ? "tidak ada" : user.permissions.fixTables.join(", ")}.`,
    "Ini identitas pengguna yang bertanya. Jangan menjawab bahwa kamu tidak punya data login atau identitasnya. " +
      "Untuk pertanyaan tentang menu, form, atau hak tertentu, panggil aksesSaya.",
  ].join("\n");
};
