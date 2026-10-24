/**
 * The full record behind a `cariAplikasiKhanza` hit: every step of a flow with
 * what it does, who does it, the rights it needs and the tables it touches; or
 * every button, right-click action, right and table of a form; or a menu / right
 * with everything it opens.
 *
 * `cariAplikasiKhanza` stays the compact index (one line per hit, lists cut at
 * 12/8/6). This tool returns the full record for one id from the same in-memory
 * map — so an answer about a flow is read from the written doc instead of being
 * reconstructed from its step titles. Only a handful of dialogs are big enough
 * to need the list caps below.
 */
import { Effect, Schema } from "effect";
import { AppDocs, appMapStatus } from "./AppDocs.ts";
import { makeAppPaths } from "./paths.ts";
import { ToolError } from "../errors.ts";
import { defineTool } from "../tool.ts";

const Jenis = Schema.Literals(["alur", "form", "menu", "hak"]);

/**
 * A few dialogs are enormous: DlgKamarInap has 216 right-click actions and
 * DlgReg 277 (plus 177 written tables). Returning all of them made one call
 * ~100 KB (~25k tokens), so lists are cut with the `+N` marker search already
 * uses, and `cari` narrows them to the task at hand.
 */
const MAX_AKSI = 30;
const MAX_TABEL = 40;

const cutList = (items: ReadonlyArray<string>, max: number): ReadonlyArray<string> =>
  items.length <= max ? items : [...items.slice(0, max), `+${items.length - max}`];

const Peta = Schema.Struct({
  termuat: Schema.Boolean,
  commit: Schema.String,
  dibuat: Schema.String,
  jumlah: Schema.Struct({
    menu: Schema.Number,
    form: Schema.Number,
    alur: Schema.Number,
    hak: Schema.Number,
  }),
});

const Pintasan = Schema.Struct({
  jenis: Schema.Literals(["toolbar", "klik-kanan"]),
  jalur: Schema.String,
  aksi: Schema.String,
  dialog: Schema.NullOr(Schema.String),
  /** One action per line, ready to print as a numbered list. */
  langkah: Schema.Array(Schema.String),
});

export const detailAplikasi = defineTool({
  name: "detailAplikasi",
  kind: "read",
  description:
    "Read the full record behind a cariAplikasiKhanza hit. jenis 'alur' returns every step of a flow with " +
    "what it does, who does it, the rights and the tables; 'form' returns a dialog's buttons, right-click " +
    "actions, rights and tables; 'menu' a menu button with its rights and dialog; 'hak' an access right with " +
    "the menus and forms it gates. Pass the id from cariAplikasiKhanza (alur[].id, form[].nama, menu[].path, " +
    "hak[].hak). Use it when the answer needs the steps, buttons, rights or the exact warning text; never " +
    "reconstruct a step from its title. Very large dialogs cut their action and table lists (marked +N); pass " +
    "`cari` with a word from the task to narrow them.",
  parameters: Schema.Struct({
    jenis: Jenis.annotate({ description: "What kind of record: alur (flow), form (dialog), menu, or hak (right)." }),
    id: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(160)).annotate({
      description:
        "Id from cariAplikasiKhanza, e.g. 'rawat-inap' (alur), 'DlgKamarInap' (form), 'A/Rawat Inap' (menu), " +
        "'kamar_inap' (hak).",
    }),
    cari: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))).annotate({
      description:
        "Optional word to keep only the actions and tables that mention it, e.g. 'resep pulang', 'billing'. " +
        "Use it on a dialog whose list was cut.",
    }),
  }),
  output: Schema.Struct({
    jenis: Jenis,
    id: Schema.String,
    ditemukan: Schema.Boolean,
    alur: Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        judul: Schema.String,
        file: Schema.String,
        /** What the flow is about, before the first step. */
        ringkasan: Schema.String,
        menu: Schema.Array(Schema.String),
        form: Schema.Array(Schema.String),
        langkah: Schema.Array(
          Schema.Struct({
            judul: Schema.String,
            menu: Schema.NullOr(Schema.String),
            /** Visible dialog header; use this in the answer, not `kelas`. */
            dialog: Schema.NullOr(Schema.String),
            /** Java class name, for technical questions only. */
            kelas: Schema.NullOr(Schema.String),
            siapa: Schema.NullOr(Schema.String),
            tujuan: Schema.NullOr(Schema.String),
            hak: Schema.NullOr(Schema.String),
            tabel: Schema.NullOr(Schema.String),
          }),
        ),
      }),
    ),
    form: Schema.NullOr(
      Schema.Struct({
        nama: Schema.String,
        judul: Schema.String,
        paket: Schema.String,
        file: Schema.String,
        /** Menu paths, humanised ("Registrasi & Billing → Rawat Inap"). */
        jalur: Schema.Array(Schema.String),
        hak: Schema.Array(Schema.String),
        aksi: Schema.Array(Schema.String),
        pintasan: Schema.Array(Pintasan),
        tulis: Schema.Array(Schema.String),
        baca: Schema.Array(Schema.String),
      }),
    ),
    menu: Schema.NullOr(
      Schema.Struct({
        jalur: Schema.String,
        path: Schema.String,
        label: Schema.String,
        grup: Schema.String,
        kode: Schema.String,
        hak: Schema.Array(Schema.String),
        dialog: Schema.NullOr(Schema.String),
        kelas: Schema.NullOr(Schema.String),
        aksi: Schema.Array(Schema.String),
        /** Right-click entries of the dialog this button opens. */
        pintasan: Schema.Array(Schema.String),
      }),
    ),
    hak: Schema.NullOr(
      Schema.Struct({ hak: Schema.String, menu: Schema.Array(Schema.String), form: Schema.Array(Schema.String) }),
    ),
    peta: Peta,
    catatan: Schema.Array(Schema.String),
  }),
  handler: Effect.fn("detailAplikasi")(function* ({ jenis, id, cari }) {
    const docs = yield* AppDocs;
    const peta = appMapStatus(docs);
    if (!peta.termuat) {
      return yield* new ToolError({
        tool: "detailAplikasi",
        message:
          "Peta aplikasi tidak termuat di server ini (docs/khanza-app/index.json kosong atau tidak ada). " +
          "Jangan menyimpulkan menu, form, atau hak tidak ada; sampaikan bahwa peta aplikasi tidak termuat.",
      });
    }

    const paths = makeAppPaths(docs);
    const wanted = normalise(id);
    const catatan: string[] = [];
    const words = (cari ?? "")
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((word) => word.length >= 3);
    /** True when `cari` is unset, or all of its words appear in the text ("resep pulang"). */
    const mentions = (...texts: ReadonlyArray<string>) => {
      if (words.length === 0) return true;
      const text = texts.join(" ").toLowerCase();
      return words.every((word) => text.includes(word));
    };

    /** Suggests ids that contain the asked-for text, so a near miss is easy to fix. */
    const near = (ids: ReadonlyArray<string>): ReadonlyArray<string> => {
      const matches = ids.filter((candidate) => normalise(candidate).includes(wanted)).slice(0, 3);
      return matches.length === 0 ? [] : [`Mirip: ${matches.join(", ")}.`];
    };
    const notFound = (label: string, ids: ReadonlyArray<string>) => {
      catatan.push(
        `Tidak ada ${label} dengan id "${id}" di peta aplikasi. Cari dulu dengan cariAplikasiKhanza, lalu pakai id dari hasilnya.`,
        ...near(ids),
      );
    };

    if (jenis === "alur") {
      const flow =
        docs.flows.find((candidate) => normalise(candidate.id) === wanted) ??
        docs.flows.find((candidate) => normalise(candidate.title) === wanted) ??
        docs.flows.find((candidate) => normalise(candidate.id).includes(wanted)) ??
        docs.flows.find((candidate) => normalise(candidate.title).includes(wanted));
      if (flow === undefined) {
        notFound("alur", docs.flows.map((candidate) => candidate.id));
        return { jenis, id, ditemukan: false, alur: null, form: null, menu: null, hak: null, peta, catatan };
      }
      return {
        jenis,
        id: flow.id,
        ditemukan: true,
        alur: {
          id: flow.id,
          judul: flow.title,
          file: flow.file,
          ringkasan: flow.intro,
          menu: flow.menus.map(paths.humanPath),
          form: flow.forms.map((name) => paths.formTitle(name) ?? name),
          langkah: flow.steps.map((step) => ({
            judul: step.title,
            menu: step.menu === null ? null : step.menu.split(" / ").map(paths.humanPath).join(" / "),
            dialog: paths.formTitle(step.form),
            kelas: step.form,
            siapa: step.who,
            tujuan: step.does,
            hak: step.hak,
            tabel: step.tables,
          })),
        },
        form: null,
        menu: null,
        hak: null,
        peta,
        catatan,
      };
    }

    if (jenis === "form") {
      const form =
        docs.forms.find((candidate) => normalise(candidate.name) === wanted) ??
        docs.forms.find((candidate) => normalise(candidate.title) === wanted) ??
        docs.forms.find((candidate) => normalise(candidate.name).includes(wanted)) ??
        docs.forms.find((candidate) => normalise(candidate.title).includes(wanted));
      if (form === undefined) {
        notFound("form", docs.forms.map((candidate) => candidate.name));
        return { jenis, id, ditemukan: false, alur: null, form: null, menu: null, hak: null, peta, catatan };
      }
      const toolbar = docs.toolbar
        .filter((entry) => entry.form === form.name)
        .map((entry) => paths.shortcut({ kind: "toolbar", label: entry.label, path: `Toolbar → ${entry.label}`, form }));
      const popup = form.popup.map((item) =>
        paths.shortcut({
          kind: "klik-kanan",
          label: item.path.split(" → ").at(-1) ?? item.path,
          path: item.path,
          form,
        }),
      );
      // `cari` keeps only the actions and tables about the task; without it a
      // giant dialog is cut at MAX_AKSI / MAX_TABEL and says so in `catatan`.
      const allShortcuts = [...toolbar, ...popup];
      const shortcuts = allShortcuts.filter((item) => mentions(item.aksi, item.jalur, item.dialog ?? ""));
      const shownShortcuts = shortcuts.slice(0, MAX_AKSI);
      const tables = (names: ReadonlyArray<string>) => cutList(names.filter((name) => mentions(name)), MAX_TABEL);
      const tulis = tables(form.tables.write);
      const baca = tables(form.tables.read);
      if (words.length > 0 && shownShortcuts.length === 0 && tulis.length === 0 && baca.length === 0) {
        catatan.push(`Tidak ada aksi atau tabel yang menyebut "${cari ?? ""}". Coba kata lain atau tanpa cari.`);
      }
      if (shortcuts.length > shownShortcuts.length) {
        catatan.push(
          `${shortcuts.length} aksi klik-kanan/toolbar cocok; ${shownShortcuts.length} pertama ditampilkan. ` +
            `Panggil lagi dengan cari:"kata kunci" untuk menyaring.`,
        );
      }
      return {
        jenis,
        id: form.name,
        ditemukan: true,
        alur: null,
        form: {
          nama: form.name,
          judul: paths.formTitle(form.name) ?? form.title,
          paket: form.package,
          file: form.file,
          jalur: form.menus.map(paths.humanPath),
          hak: [...form.rights],
          aksi: [...form.actions],
          pintasan: shownShortcuts,
          tulis: [...tulis],
          baca: [...baca],
        },
        menu: null,
        hak: null,
        peta,
        catatan,
      };
    }

    if (jenis === "menu") {
      const menu =
        docs.menus.find((candidate) => sameMenu(candidate.path, id)) ??
        docs.menus.find((candidate) => normalise(candidate.label) === wanted) ??
        docs.menus.find((candidate) => sameMenu(paths.humanPath(candidate.path), id));
      if (menu === undefined) {
        notFound("menu", docs.menus.map((candidate) => candidate.path));
        return { jenis, id, ditemukan: false, alur: null, form: null, menu: null, hak: null, peta, catatan };
      }
      const form = menu.form === null ? undefined : docs.forms.find((candidate) => candidate.name === menu.form);
      return {
        jenis,
        id: menu.path,
        ditemukan: true,
        alur: null,
        form: null,
        menu: {
          jalur: paths.humanPath(menu.path),
          path: menu.path,
          label: menu.label,
          grup: menu.groupName,
          kode: menu.groupLetter,
          hak: [...menu.rights],
          dialog: paths.formTitle(menu.form),
          kelas: menu.form,
          aksi: form === undefined ? [] : [...form.actions],
          pintasan:
            form === undefined
              ? []
              : cutList(
                  form.popup.map((item) => item.path).filter((path) => mentions(path)),
                  MAX_AKSI,
                ),
        },
        hak: null,
        peta,
        catatan,
      };
    }

    const right = docs.rights.find((candidate) => normalise(candidate.name) === wanted);
    if (right === undefined) {
      notFound("hak", docs.rights.map((candidate) => candidate.name));
      return { jenis, id, ditemukan: false, alur: null, form: null, menu: null, hak: null, peta, catatan };
    }
    return {
      jenis,
      id: right.name,
      ditemukan: true,
      alur: null,
      form: null,
      menu: null,
      hak: {
        hak: right.name,
        menu: right.menus.map(paths.humanPath),
        form: right.forms.map((name) => paths.formTitle(name) ?? name),
      },
      peta,
      catatan,
    };
  }),
});

/** Case/spacing-insensitive key for matching an id typed by the model. */
const normalise = (text: string) => text.toLowerCase().replaceAll(/\s+/g, " ").trim();

/** "A/Rawat Inap" and "a / rawat inap" are the same menu. */
const sameMenu = (path: string, asked: string) =>
  path.toLowerCase().replaceAll(/\s*\/\s*/g, "/").trim() === asked.toLowerCase().replaceAll(/\s*\/\s*/g, "/").trim();
