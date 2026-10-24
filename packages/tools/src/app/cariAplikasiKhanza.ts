/**
 * Answers "where in the app" questions: which menu group and button, which
 * form, which access right, and which flow a task belongs to.
 *
 * The map is generated from the desktop source (docs/khanza-app), so it is a
 * snapshot of one Khanza commit — not the live database and not the webapps.
 */
import { Effect, Schema } from "effect";
import { AppDocs, appMapStatus } from "./AppDocs.ts";
import { makeAppPaths } from "./paths.ts";
import { asksAboutTables, searchApp, tablesInQuery } from "./search.ts";
import { defineTool } from "../tool.ts";

const Bagian = Schema.Literals(["semua", "menu", "alur", "form", "hak", "tabel"]);

/** Forms can have 20+ buttons and flows 8 steps; the model needs the shape, not everything. */
const MAX_LIST = 12;
const cut = (items: ReadonlyArray<string>) =>
  items.length <= MAX_LIST ? items : [...items.slice(0, MAX_LIST), `+${items.length - MAX_LIST}`];

/** Some registration forms touch 100+ tables; the first few say what kind of form it is. */
const MAX_TABLES = 8;
const cutTables = (items: ReadonlyArray<string>) =>
  items.length <= MAX_TABLES ? items : [...items.slice(0, MAX_TABLES), `+${items.length - MAX_TABLES}`];

export const cariAplikasiKhanza = defineTool({
  name: "cariAplikasiKhanza",
  kind: "read",
  description:
    "Find where something is done in the SIMRS Khanza desktop app: the menu group and button, the form it opens, " +
    "the access right that hides/shows it, the tables the form reads/writes, and the documented flow. Use it for " +
    "questions like 'di menu mana pindah kamar?', 'alur rawat inap sampai billing', 'hak apa yang membuat menu " +
    "kasir tidak muncul', 'form apa yang mengisi kamar_inap'. Covers the Java desktop app only (not the PHP " +
    "webapps). Returns menu paths like 'A/Rawat Inap' meaning: click Menu, choose group A, click Rawat Inap. If it " +
    "finds nothing, say the map does not cover it instead of guessing.",
  parameters: Schema.Struct({
    kataKunci: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(100)).annotate({
      description: "What the user wants to do or find, e.g. 'pindah kamar', 'resume', 'SEP', 'hapus tindakan'.",
    }),
    bagian: Schema.optionalKey(Bagian).annotate({
      description: "Narrow the search: menu, alur, form, hak, tabel. Default semua (all).",
    }),
  }),
  output: Schema.Struct({
    menu: Schema.Array(
      Schema.Struct({
        /** "Rekam Medis → Resume Pasien Ranap" (what to say). */
        jalur: Schema.String,
        /** "M/Resume Pasien Ranap" (stable id, for technical questions). */
        path: Schema.String,
        label: Schema.String,
        /** Short group name, e.g. "Rekam Medis". */
        grup: Schema.String,
        kode: Schema.String,
        hak: Schema.Array(Schema.String),
        /** Dialog header, e.g. "Data Resume Medis Pasien Rawat Inap". */
        form: Schema.NullOr(Schema.String),
        kelas: Schema.NullOr(Schema.String),
      }),
    ),
    alur: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        judul: Schema.String,
        file: Schema.String,
        langkah: Schema.Array(
          Schema.Struct({
            judul: Schema.String,
            menu: Schema.NullOr(Schema.String),
            form: Schema.NullOr(Schema.String),
          }),
        ),
      }),
    ),
    form: Schema.Array(
      Schema.Struct({
        judul: Schema.String,
        nama: Schema.String,
        paket: Schema.String,
        file: Schema.String,
        menu: Schema.Array(Schema.String),
        aksi: Schema.Array(Schema.String),
        /** Tables this form writes (insert/update/delete), e.g. ["kamar_inap"]. */
        tulis: Schema.Array(Schema.String),
        /** Tables this form only reads (select/join). */
        baca: Schema.Array(Schema.String),
      }),
    ),
    /** Only for a question that names a table: which forms write it, which read it. */
    tabel: Schema.Array(
      Schema.Struct({
        nama: Schema.String,
        tulis: Schema.Array(Schema.String),
        baca: Schema.Array(Schema.String),
      }),
    ),
    tombol: Schema.Array(Schema.String),
    tombolCocok: Schema.Array(Schema.String),
    pintasan: Schema.Array(
      Schema.Struct({
        jenis: Schema.Literals(["toolbar", "klik-kanan"]),
        jalur: Schema.String,
        aksi: Schema.String,
        dialog: Schema.NullOr(Schema.String),
        /** One action per line, ready to print as a numbered list. */
        langkah: Schema.Array(Schema.String),
      }),
    ),
    hak: Schema.Array(Schema.Struct({ hak: Schema.String, menu: Schema.Array(Schema.String) })),
    /** Whether the map loaded, so "not covered" is never claimed when the map is missing. */
    peta: Schema.Struct({
      termuat: Schema.Boolean,
      commit: Schema.String,
      dibuat: Schema.String,
      jumlah: Schema.Struct({
        menu: Schema.Number,
        form: Schema.Number,
        alur: Schema.Number,
        hak: Schema.Number,
      }),
    }),
    catatan: Schema.Array(Schema.String),
    petunjuk: Schema.String,
    sumber: Schema.String,
  }),
  handler: Effect.fn("cariAplikasiKhanza")(function* ({ kataKunci, bagian }) {
    const docs = yield* AppDocs;
    const peta = appMapStatus(docs);
    const found = searchApp(docs, kataKunci, bagian ?? "semua", docs.synonyms);
    // The menu's form is authoritative; free-text form search can match a distant form by a
    // shared word ("surat" in a permission name). Fall back to form search only without a menu.
    const paths = makeAppPaths(docs);
    const humanPath = paths.humanPath;
    const titleFor = paths.formTitle;
    const menuForms = found.menus
      .map((menu) => (menu.form === null ? undefined : docs.forms.find((form) => form.name === menu.form)))
      .filter((form): form is NonNullable<typeof form> => form !== undefined);
    const shownForms = found.menus.length > 0 ? [...new Map(menuForms.map((form) => [form.name, form])).values()] : found.forms;
    // A table question ("form apa yang mengisi kamar_inap") has no menu hit, but its
    // form does. Backfill the menus so the answer still says where to click.
    const fallbackMenus =
      found.menus.length === 0
        ? [
            ...new Map(
              shownForms
                .flatMap((form) => docs.menus.filter((menu) => menu.form === form.name))
                .map((menu) => [menu.path, menu]),
            ).values(),
          ].slice(0, 4)
        : [];
    const shownMenus = found.menus.length > 0 ? found.menus : fallbackMenus;
    const topForm = shownForms[0];
    const tombol = topForm?.actions ?? [];
    const buttonWords = kataKunci
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((word) => word.length >= 3);
    const tombolCocok = tombol.filter((button) => buttonWords.some((word) => button.toLowerCase().includes(word)));

    const matchedTables = bagian === "tabel" || asksAboutTables(kataKunci) ? tablesInQuery(kataKunci, docs.forms) : [];
    // Do not send table hints for an ordinary "where is X" question: the prompt
    // asks for a short navigation answer, and 200 table names only distract.
    const showTables = matchedTables.length > 0 || bagian === "tabel" || asksAboutTables(kataKunci);
    // Forms already found for the question come first; then the rest of the map,
    // so "kamar_inap" answers with DlgKamarInap before the BPJS search dialogs.
    const titlesOf = (forms: ReadonlyArray<(typeof docs.forms)[number]>) => {
      const ordered = [...shownForms.filter((shown) => forms.some((form) => form.name === shown.name)), ...forms];
      return [...new Set(ordered.map((form) => titleFor(form.name) ?? form.name))].slice(0, 6);
    };
    const tabel = matchedTables.map((nama) => ({
      nama,
      tulis: titlesOf(docs.forms.filter((form) => form.tables.write.includes(nama))),
      baca: titlesOf(docs.forms.filter((form) => form.tables.read.includes(nama))),
    }));
    // A form that touches 100 tables still has to show the one the user asked about.
    const orderTables = (tables: ReadonlyArray<string>) => [
      ...new Set([...matchedTables.filter((table) => tables.includes(table)), ...tables]),
    ];

    // A synonym note explains data behaviour ("stts_pulang", "kamar_inap"). That is useful for
    // "kenapa/gagal/tidak muncul", not for "cara ...": there it only makes the answer longer.
    const words = kataKunci.toLowerCase().split(/[^a-z0-9_]+/);
    const wantsDetail =
      bagian === "hak" ||
      bagian === "tabel" ||
      matchedTables.length > 0 ||
      words.some((word) =>
        ["kenapa", "mengapa", "tidak", "gagal", "error", "masalah", "stuck", "salah", "hilang", "muncul", "hak", "akses", "tabel", "mengisi", "kolom"].includes(word),
      );
    // Pure explanations (no menu/form) are answers in themselves, e.g. "apa itu grup A–T".
    const explanatory = found.synonyms.some((s) => s.menus.length === 0 && s.forms.length === 0);
    const catatan = wantsDetail || explanatory ? found.synonyms.map((s) => s.note) : [];
    const empty = found.menus.length === 0 && found.flows.length === 0 && found.forms.length === 0 && found.rights.length === 0;
    if (!peta.termuat) {
      // A missing map is not an answer: without this, an empty index looks exactly like
      // "that menu does not exist" and the model tells the user it does not exist.
      catatan.push(
        "Peta aplikasi tidak termuat di server ini (docs/khanza-app/index.json kosong atau tidak ada). " +
          "Jangan menyimpulkan menu, form, atau hak tidak ada; sampaikan bahwa peta aplikasi tidak termuat.",
      );
    } else if (empty && found.synonyms.length === 0) {
      catatan.push(
        "Tidak ada di peta aplikasi. Coba kata lain (nama menu, form, tabel, atau hak), atau lihat docs/khanza-app/.",
      );
    }

    return {
      menu: shownMenus.map((menu) => ({
        jalur: humanPath(menu.path),
        path: menu.path,
        label: menu.label,
        grup: menu.groupName,
        kode: menu.groupLetter,
        hak: [...menu.rights],
        form: titleFor(menu.form),
        kelas: menu.form,
      })),
      alur: found.flows.map((flow) => ({
        id: flow.id,
        judul: flow.title,
        file: flow.file,
        langkah: flow.steps.slice(0, 8).map((step) => ({
          judul: step.title,
          menu: step.menu === null ? null : step.menu.split(" / ").map(humanPath).join(" / "),
          form: titleFor(step.form),
        })),
      })),
      form: shownForms.map((form) => ({
        judul: titleFor(form.name) ?? form.title,
        nama: form.name,
        paket: form.package,
        file: form.file,
        menu: [...form.menus],
        aksi: cut(form.actions),
        tulis: showTables ? cutTables(orderTables(form.tables.write)) : [],
        baca: showTables ? cutTables(orderTables(form.tables.read)) : [],
      })),
      tabel,
      hak: found.rights.map((right) => ({ hak: right.name, menu: [...right.menus] })),
      tombol: cut(tombol),
      tombolCocok,
      pintasan: found.shortcuts.map(paths.shortcut),
      peta,
      catatan,
      petunjuk:
        "Jawab ringkas. Kalau jalurnya lebih dari dua langkah, tulis daftar bernomor satu aksi per baris " +
        "(buka → klik kanan → pilih submenu → isi → simpan); dua langkah cukup satu kalimat. " +
        "Utamakan pintasan 'klik-kanan' kalau ada: itu cara perawat bekerja (klik kanan baris pasien → aksi). " +
        "Baru pakai Menu/toolbar kalau tidak ada pintasan klik-kanan atau tugasnya tombol di dalam dialog. " +
        "Sebut judul dialog (field form) dan tombol yang cocok (tombolCocok). " +
        "Jangan pakai huruf grup sendirian atau nama kelas Java; huruf grup boleh sekali dalam kurung. " +
        "Sebut tabel hanya kalau user bertanya tabel/data/kolom atau form yang mengisi tabel; jangan sebut tabel untuk pertanyaan menu biasa. " +
        (matchedTables.length > 0
          ? `User menyebut tabel ${matchedTables.join(", ")}: jawab form yang menulis tabel itu (field tabel[].tulis), bukan semua form yang membacanya. `
          : "") +
        "Sebut hak akses hanya kalau menu tidak muncul atau user bertanya hak. Jangan daftar isi tool.",
      sumber: `Peta aplikasi dari source Khanza commit ${docs.source.commit}${
        peta.dibuat === "" ? "" : `, dibuat ${peta.dibuat.slice(0, 10)}`
      } (desktop, bukan webapps).`,
    };
  }),
});
