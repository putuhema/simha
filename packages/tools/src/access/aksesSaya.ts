/**
 * "Who am I, and what may I open?" for the logged-in SIMRS account.
 *
 * The agent builds this tool per run, with the current `User` captured, so it
 * can answer questions about the account itself and check a menu, form or
 * right against the generated Khanza app map (`docs/khanza-app`). It only
 * reads: the answer comes from the rights snapshot taken at login/refresh and
 * the app map, never from a Khanza query.
 */
import { FIX_TABLE_RIGHTS, FIX_TABLES, type User } from "@simha/shared";
import { Effect, Schema } from "effect";
import { AppDocs } from "../app/AppDocs.ts";
import { searchApp } from "../app/search.ts";
import { defineTool } from "../tool.ts";

const NAME = "aksesSaya";

const Cek = Schema.Struct({
  jenis: Schema.Literals(["menu", "form", "hak", "fitur"]),
  nama: Schema.String,
  judul: Schema.String,
  hak: Schema.Array(Schema.String),
  diizinkan: Schema.Boolean,
  catatan: Schema.NullOr(Schema.String),
});

const Fitur = Schema.Struct({
  nama: Schema.String,
  hak: Schema.Array(Schema.String),
  diizinkan: Schema.Boolean,
});

const Output = Schema.Struct({
  akun: Schema.Struct({
    username: Schema.String,
    displayName: Schema.String,
    admin: Schema.Boolean,
    peran: Schema.String,
    namaPegawai: Schema.NullOr(Schema.String),
    namaDokter: Schema.NullOr(Schema.String),
    namaPetugas: Schema.NullOr(Schema.String),
    jumlahHak: Schema.Number,
  }),
  fitur: Schema.Array(Fitur),
  cek: Schema.Array(Cek),
  catatan: Schema.Array(Schema.String),
  petunjuk: Schema.String,
});

type Cek = typeof Cek.Type;
type Fitur = typeof Fitur.Type;

const uniq = <A>(items: ReadonlyArray<A>, key: (item: A) => string): A[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const roleLabel = (user: User): string => {
  if (user.khanzaAdmin) return "Admin Utama SIMRS";
  if (user.doctorName !== null) return "Dokter";
  if (user.staffName !== null) return "Petugas / perawat";
  return "Pegawai";
};

/**
 * The per-run tool. `user` is the session's account snapshot (names, rights,
 * derived permissions); `AppDocs` is the generated map read from docs/.
 */
export const makeAksesSaya = (user: User) =>
  defineTool({
    name: NAME,
    kind: "read",
    description:
      "Who is logged in and what this SIMRS account may open. Use it for 'siapa saya?', 'nama dokter/perawat saya', " +
      "'apa hak akses saya?', 'apakah saya bisa membuka menu kasir / resume / CPPT?', 'punya hak tindakan_ranap?'. " +
      "It returns the account's username, display name, employee/doctor/nurse name, the rights that gate Simha's " +
      "features, and — when `tanya` names a menu, form or right — the exact Khanza right(s) and whether this account " +
      "has them. Use this instead of guessing from the app map. It does not change anything.",
    parameters: Schema.Struct({
      tanya: Schema.optionalKey(
        Schema.String.check(Schema.isMaxLength(200)).annotate({
          description:
            "Optional menu, form or right to check, e.g. 'kasir', 'Resume Pasien Ranap', 'tindakan_ranap', " +
            "'menu radiologi'. Leave empty for just the account's identity and feature rights.",
        }),
      ),
    }),
    output: Output,
    handler: Effect.fn(NAME)(function* ({ tanya }) {
      const docs = yield* AppDocs;
      const grant = (right: string) => user.khanzaAdmin || user.rights.includes(right);

      const fitur: Fitur[] = [
        { nama: "CPPT / SOAP rawat jalan", hak: ["tindakan_ralan"], diizinkan: user.permissions.cpptRalan },
        { nama: "CPPT / SOAP rawat inap", hak: ["tindakan_ranap"], diizinkan: user.permissions.cpptRanap },
        { nama: "Resume medis dan draf resume", hak: ["data_resume_pasien"], diizinkan: user.permissions.resume },
        { nama: "Radiologi dan gambar PACS", hak: ["periksa_radiologi"], diizinkan: user.permissions.radiology },
        { nama: "Berkas digital", hak: ["berkas_digital_perawatan"], diizinkan: user.permissions.berkas },
        ...FIX_TABLES.map((table) => ({
          nama: `Perbaikan data ${table}`,
          hak: [...(FIX_TABLE_RIGHTS[table] ?? [])],
          diizinkan: user.permissions.fixTables.includes(table),
        })),
      ];

      const query = tanya?.trim() ?? "";
      const cek: Cek[] = [];
      const catatan: string[] = [];
      const fiturCocok = (pattern: RegExp) => fitur.filter((item) => pattern.test(item.nama) || item.hak.some((right) => pattern.test(right)));
      const addFitur = (items: ReadonlyArray<Fitur>) => {
        for (const item of items) {
          cek.push({
            jenis: "fitur",
            nama: item.nama,
            judul: item.nama,
            hak: [...item.hak],
            diizinkan: item.diizinkan,
            catatan: null,
          });
        }
      };

      if (query !== "") {
        // App-map matches: menu, form, and (already filtered) rights.
        const found = searchApp(docs, query, "semua", docs.synonyms);
        for (const menu of found.menus.slice(0, 4)) {
          cek.push({
            jenis: "menu",
            nama: menu.path,
            judul: `${menu.groupName} → ${menu.label}`,
            hak: [...menu.rights],
            diizinkan: menu.rights.length === 0 || menu.rights.some(grant),
            catatan: menu.rights.length === 0 ? "Menu ini selalu tampil setelah login (tidak memakai hak)." : null,
          });
        }
        for (const form of found.forms.slice(0, 3)) {
          const menuRights = [
            ...new Set(
              form.menus.flatMap((path) => docs.menus.find((menu) => menu.path === path)?.rights ?? []),
            ),
          ];
          const required = menuRights.length > 0 ? menuRights : [...form.rights];
          const extra = form.rights.filter((right) => !required.includes(right));
          cek.push({
            jenis: "form",
            nama: form.name,
            judul: form.title,
            hak: required,
            diizinkan: required.length === 0 || required.some(grant),
            catatan:
              extra.length > 0
                ? `Tombol di dalam form juga memeriksa: ${extra.join(", ")}.`
                : null,
          });
        }
        const rightsHit = searchApp(docs, query, "hak", docs.synonyms).rights.slice(0, 4);
        for (const right of rightsHit) {
          cek.push({
            jenis: "hak",
            nama: right.name,
            judul: `Hak ${right.name}`,
            hak: [right.name],
            diizinkan: grant(right.name),
            catatan: right.menus.length > 0 ? `Membuka menu: ${right.menus.slice(0, 3).join(", ")}.` : null,
          });
        }
        // A raw right name the map does not index (e.g. a new local column).
        const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter((word) => word.length >= 3);
        const raw = user.rights
          .filter((right) => words.some((word) => right.toLowerCase().includes(word)))
          .slice(0, 4);
        for (const right of raw) {
          cek.push({ jenis: "hak", nama: right, judul: `Hak ${right}`, hak: [right], diizinkan: grant(right), catatan: null });
        }

        // Feature names staff actually use, which are not always menu labels.
        if (/\bcppt\b|\bsoap\b/i.test(query)) addFitur(fiturCocok(/CPPT/i));
        if (/\bresume\b/i.test(query)) addFitur(fiturCocok(/resume/i));
        if (/radiolog|rontgen|pacs/i.test(query)) addFitur(fiturCocok(/radiologi|periksa_radiologi/i));
        if (/berkas|dokumen digital|file pasien/i.test(query)) addFitur(fiturCocok(/berkas/i));
        if (/perbaikan|setuju|approve|rollback|pindah kamar|hapus tindakan/i.test(query)) {
          addFitur(fitur.filter((item) => item.nama.startsWith("Perbaikan")));
        }
        const mentionedFixTables = FIX_TABLES.filter((table) => query.toLowerCase().includes(table.toLowerCase()));
        if (mentionedFixTables.length > 0) {
          addFitur(fitur.filter((item) => mentionedFixTables.some((table) => item.nama.includes(table))));
        }

        if (docs.menus.length === 0) {
          catatan.push("Peta aplikasi tidak termuat di server ini; jawaban menu/form mungkin tidak lengkap.");
        } else if (cek.length === 0) {
          catatan.push(
            "Tidak ada menu, form, atau hak yang cocok di peta aplikasi. Sebutkan nama menu/form/hak yang lebih spesifik; " +
              "jangan menyimpulkan bahwa menu itu tidak ada.",
          );
        } else {
          catatan.push("Peta menu/form berasal dari aplikasi desktop Khanza, bukan webapps PHP.");
        }
      }

      if (user.khanzaAdmin) {
        catatan.push("Akun ini Admin Utama SIMRS: semua menu dan hak di Khanza boleh dipakai.");
      } else if (user.rights.length === 0) {
        catatan.push("Belum ada hak Khanza yang terbaca pada akun ini. Minta IT memeriksa baris `user` di Khanza.");
      }

      return {
        akun: {
          username: user.username,
          displayName: user.displayName,
          admin: user.khanzaAdmin,
          peran: roleLabel(user),
          namaPegawai: user.employeeName,
          namaDokter: user.doctorName,
          namaPetugas: user.staffName,
          jumlahHak: user.rights.length,
        },
        fitur,
        cek: uniq(cek, (item) => `${item.jenis}|${item.nama}`),
        catatan,
        petunjuk:
          "Jawab sebagai akun ini. Untuk 'siapa saya', sebut username dan nama yang ada (pegawai/dokter/petugas). " +
          "Untuk menu/form/hak, sebut nama, jalur menu, dan haknya; jika diizinkan=false, sebut hak yang perlu " +
          "diminta ke IT. Jangan mengarang menu atau hak di luar hasil tool ini.",
      };
    }),
  });
