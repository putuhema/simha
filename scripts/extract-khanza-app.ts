/**
 * Builds the SIMRS Khanza desktop app map from the source tree and writes it to
 * docs/khanza-app/: index.json (for the agent) and markdown (for people).
 *
 * Usage (from the repo root):
 *   pnpm extract-khanza-app                          # reads ~/work/simrsmt
 *   pnpm extract-khanza-app --src /path/to/khanza    # another checkout
 *   pnpm extract-khanza-app --check                  # fail if the map is stale
 *
 * The output is tied to one commit of the Khanza source; `source.commit` in
 * index.json says which. Re-run it after a Khanza update and read the report:
 * a drop in resolved buttons means the menu code changed shape.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as NodePath from "node:path";
import { parseArgs } from "node:util";
import {
  buildIndex,
  parseActionBodies,
  parseActionLabels,
  parseFormTitle,
  parsePopupShortcuts,
  parseToolbar,
  parseFieldTypes,
  parseFormRights,
  parseFormTables,
  parseMainFrame,
  tableNamesFromSql,
  type FormInfo,
  type MenuGroup,
  type Shortcut,
  type TableUse,
} from "./lib/khanza-app-extract.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

const { values } = parseArgs({
  options: {
    src: { type: "string" },
    out: { type: "string", default: NodePath.join(repoRoot, "docs/khanza-app") },
    check: { type: "boolean", default: false },
  },
});

const home = homedir();
const sourceRoot = NodePath.resolve(values.src ?? NodePath.join(home, "work/simrsmt"));
/** Local paths in the committed map are written with `~`, so they do not leak a developer's home. */
const displayRoot = sourceRoot.startsWith(home) ? `~${sourceRoot.slice(home.length)}` : sourceRoot;
const outDir = NodePath.resolve(values.out ?? "");
const javaRoot = NodePath.join(sourceRoot, "src");

const readText = (path: string) => readFile(path, "utf8");
const readOr = (path: string, fallback: string) => readText(path).catch(() => fallback);

/** All Java files under a directory, recursively. */
const javaFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = NodePath.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await javaFiles(path)));
    else if (entry.name.endsWith(".java")) files.push(path);
  }
  return files;
};

const commit = (() => {
  try {
    return execFileSync("git", ["-C", sourceRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

const main = async () => {
  const [mainFrame, sqlDump, files] = await Promise.all([
    readText(NodePath.join(javaRoot, "simrskhanza/frmUtama.java")),
    readOr(NodePath.join(sourceRoot, "sik.sql"), ""),
    javaFiles(javaRoot),
  ]);

  const tableNames = tableNamesFromSql(sqlDump);
  const tableSet = new Set(tableNames);
  const classByName = new Map<string, string>();
  let duplicateClasses = 0;
  for (const file of files) {
    const name = NodePath.basename(file, ".java");
    if (classByName.has(name)) duplicateClasses++;
    else classByName.set(name, file);
  }

  const classNames = new Set(classByName.keys());
  const parsed = parseMainFrame(mainFrame, classNames);
  const groupNames = JSON.parse(await readOr(NodePath.join(outDir, "group-names.json"), "{}")) as Record<string, string>;

  // A few buttons open a form reached through a field chain, e.g.
  // `kasirralan.kamarinap.isCek()`; walk the chain across classes.
  const bodies = parseActionBodies(mainFrame);
  const mainFields = parseFieldTypes(mainFrame);
  const fieldCache = new Map<string, ReadonlyMap<string, string>>();
  const fieldsOf = async (cls: string) => {
    const cached = fieldCache.get(cls);
    if (cached !== undefined) return cached;
    const file = classByName.get(cls);
    const fields = file === undefined ? new Map<string, string>() : parseFieldTypes(await readText(file));
    fieldCache.set(cls, fields);
    return fields;
  };
  const resolveChain = async (button: string) => {
    const body = bodies.get(`${button}ActionPerformed`);
    if (body === undefined) return null;
    const match = /((?:[A-Za-z_]\w*\.)+[A-Za-z_]\w*)\.isCek2?\(\)/.exec(body);
    if (match?.[1] === undefined) return null;
    const segments = match[1].split(".");
    let type = mainFields.get(segments[0] ?? "");
    for (const segment of segments.slice(1)) {
      if (type === undefined) return null;
      type = (await fieldsOf(type)).get(segment);
    }
    return type !== undefined && classNames.has(type) ? type : null;
  };
  const toolbar = await Promise.all(
    parseToolbar(mainFrame, bodies, mainFields, classNames).map(async (entry) =>
      entry.form === null ? { ...entry, form: await resolveChain(entry.button) } : entry,
    ),
  );
  const entries = await Promise.all(
    parsed.entries.map(async (entry) =>
      entry.form === null ? { ...entry, form: await resolveChain(entry.button) } : entry,
    ),
  );

  const formCache = new Map<
    string,
    {
      file: string;
      package: string;
      tables: TableUse;
      rights: ReadonlyArray<string>;
      actions: ReadonlyArray<string>;
      title: string;
      popup: ReadonlyArray<Shortcut>;
    }
  >();
  const loadForm = async (name: string) => {
    const cached = formCache.get(name);
    if (cached !== undefined) return cached;
    const file = classByName.get(name);
    if (file === undefined) return undefined;
    const java = await readText(file);
    const info = {
      file: NodePath.relative(sourceRoot, file),
      package: NodePath.basename(NodePath.dirname(file)),
      tables: parseFormTables(java, tableSet),
      rights: parseFormRights(java),
      actions: parseActionLabels(java),
      title: parseFormTitle(java, name),
      popup: parsePopupShortcuts(java, parseActionBodies(java), parseFieldTypes(java), classNames),
    };
    formCache.set(name, info);
    return info;
  };

  const toolbarForms = toolbar.map((entry) => entry.form).filter((form): form is string => form !== null);
  const forms = new Map<
    string,
    {
      file: string;
      package: string;
      tables: TableUse;
      rights: ReadonlyArray<string>;
      actions: ReadonlyArray<string>;
      title: string;
      popup: ReadonlyArray<Shortcut>;
    }
  >();
  for (const name of new Set([...entries.map((e) => e.form), ...toolbarForms].filter((f): f is string => f !== null))) {
    const info = await loadForm(name);
    if (info !== undefined) forms.set(name, info);
  }

  const index = buildIndex({
    root: displayRoot,
    commit,
    generatedAt: new Date().toISOString(),
    tableNames,
    titles: parsed.titles,
    groupNames,
    entries,
    toolbar,
    forms,
  });

  const report = {
    source: displayRoot,
    commit,
    groups: index.source.groups,
    menuEntries: index.source.menuEntries,
    labelled: index.source.labelledEntries,
    forms: index.source.forms,
    tables: index.source.tablesInSchema,
    duplicateClasses,
    toolbar: toolbar.length,
    shortcuts: [...forms.values()].reduce((n, form) => n + form.popup.length, 0),
    unresolved: entries.filter((e) => e.form === null).map((e) => e.button),
  };

  const minResolved = Math.floor(index.source.menuEntries * 0.9);
  const problems: string[] = [];
  if (index.source.groups !== 20) problems.push(`expected 20 menu groups, found ${index.source.groups}`);
  if (index.source.resolvedForms < minResolved) {
    problems.push(`only ${index.source.resolvedForms}/${index.source.menuEntries} buttons resolved to a form (need ≥ 90%)`);
  }
  if (index.source.tablesInSchema < 900) problems.push(`only ${index.source.tablesInSchema} tables found in sik.sql`);

  if (values.check === true) {
    const current = await readOr(NodePath.join(outDir, "index.json"), "");
    const stale = (() => {
      try {
        const old = JSON.parse(current) as { source?: { commit?: string; menuEntries?: number } };
        return old.source?.commit !== commit || old.source?.menuEntries !== index.source.menuEntries;
      } catch {
        return true;
      }
    })();
    if (stale) problems.push("index.json was generated from a different source commit or menu count");
  }

  if (problems.length > 0) {
    console.error("extract-khanza-app: the map does not match the source:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("Most likely the Khanza menu code changed shape. Fix the parser before using the map.");
    process.exitCode = 1;
    if (values.check === true || index.source.resolvedForms < minResolved) return;
  }

  if (values.check === true) {
    console.log(JSON.stringify({ ...report, unresolved: report.unresolved.slice(0, 20) }, null, 2));
    console.log("map is up to date");
    return;
  }

  await mkdir(outDir, { recursive: true });
  await mkdir(NodePath.join(outDir, "menu"), { recursive: true });
  await mkdir(NodePath.join(outDir, "forms"), { recursive: true });

  await writeFile(NodePath.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await writeMenuDocs(index.groups, index.forms, outDir, commit);
  await writeFormDocs(index.forms, outDir, commit);
  await writeIndexDoc(index, outDir, commit);

  console.log(JSON.stringify({ ...report, unresolved: report.unresolved.slice(0, 20) }, null, 2));
  console.log(`written: ${NodePath.relative(repoRoot, outDir)}/index.json (${index.source.forms} forms, ${index.source.menuEntries} menu entries)`);
};

const escapeCell = (text: string) => text.replaceAll("|", "\\|");
const shortTables = (tables: ReadonlyArray<string>, max: number) =>
  tables.length <= max ? tables.join(", ") : `${tables.slice(0, max).join(", ")}, +${tables.length - max}`;

const tableRow = (use: TableUse) => {
  const write = use.write.length > 0 ? `**${shortTables(use.write, 4)}**` : "–";
  const read = use.read.length > 0 ? shortTables(use.read, 5) : "–";
  return `${write} | ${read}`;
};

const writeMenuDocs = async (
  groups: ReadonlyArray<MenuGroup>,
  forms: Readonly<Record<string, FormInfo>>,
  dir: string,
  sha: string,
) => {
  const byName = new Map(Object.entries(forms));
  const lines = [
    "# Menu peta (SIMRS Khanza desktop)",
    "",
    `Generated from commit \`${sha}\` by \`pnpm extract-khanza-app\`. Do not edit by hand.`,
    "",
    "The app opens `DlgHome` from the **Menu** button; `cmbMenu` picks a group [A]–[T], and the grid shows the buttons",
    "the logged-in user may use. One row here = one button in one group.",
    "",
    "| Group | Arti | Tombol |",
    "|---|---|---|",
    ...groups.map((g) => `| [${g.letter}](menu/${g.letter}.md) | ${escapeCell(g.description)} | ${g.entries.length} |`),
    "",
    "Kolom **Hak** = hak akses yang harus dimiliki user (kolom boolean di tabel `user`); salah satu cukup.",
    "Kolom **Tabel** = tabel yang disebut form itu di SQL-nya (tulis **tebal**, baca biasa) — petunjuk, bukan jaminan.",
    "",
  ];
  await writeFile(NodePath.join(dir, "menu/README.md"), lines.join("\n"), "utf8");

  for (const group of groups) {
    const rows = group.entries.map((entry, i) => {
      const info = entry.form === null ? undefined : byName.get(entry.form);
      const anchor = info === undefined ? "README.md" : `${info.package}.md#${info.name.toLowerCase()}`;
      const form = entry.form === null ? "–" : `[${entry.form}](../forms/${anchor})`;
      const rights = entry.rights.length === 0 ? "–" : entry.rights.join(" / ");
      return `| ${i + 1} | ${escapeCell(entry.label)} | \`${entry.button}\` | ${rights} | ${form} |`;
    });
    const doc = [
      `# ${group.title}`,
      "",
      `Group ${group.index} of 20 · ${group.entries.length} buttons · source \`frmUtama.java\` → \`isCombo()\`, commit \`${sha}\`.`,
      "",
      "| # | Menu | Variabel | Hak akses | Form |",
      "|---|---|---|---|---|",
      ...rows,
      "",
      "Tabel per form ada di [forms/](../forms/README.md); hak per menu ada di [roles.md](../roles.md).",
      "",
    ];
    await writeFile(NodePath.join(dir, `menu/${group.letter}.md`), doc.join("\n"), "utf8");
  }
};

const writeFormDocs = async (forms: Readonly<Record<string, FormInfo>>, dir: string, sha: string) => {
  const byPackage = new Map<string, FormInfo[]>();
  for (const form of Object.values(forms)) {
    const list = byPackage.get(form.package) ?? [];
    list.push(form);
    byPackage.set(form.package, list);
  }
  const packages = [...byPackage].toSorted(([a], [b]) => a.localeCompare(b));

  const indexDoc = [
    "# Form (SIMRS Khanza desktop)",
    "",
    `Generated from commit \`${sha}\` by \`pnpm extract-khanza-app\`. Do not edit by hand.`,
    "",
    "Only forms reachable from a menu button are listed. **Tabel tulis** are tables the form's SQL inserts into,",
    "updates or deletes from; **tabel baca** the ones it selects/joins. Both are static hints: a form can write",
    "through a helper class in `src/fungsi`. The authoritative table map is [index.json](../index.json).",
    "",
    "| Paket | Form |",
    "|---|---|",
    ...packages.map(([pkg, list]) => `| [${pkg}](${pkg}.md) | ${list.length} |`),
    "",
  ];
  await writeFile(NodePath.join(dir, "forms/README.md"), indexDoc.join("\n"), "utf8");

  for (const [pkg, list] of packages) {
    const rows = list
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((form) => {
        const menus = form.menus.length > 0 ? form.menus.slice(0, 2).join("<br>") : "–";
        const rights = form.rights.length > 8 ? `${form.rights.slice(0, 8).join(" ")} +${form.rights.length - 8}` : form.rights.join(" ");
        const actions = form.actions.length > 8 ? `${form.actions.slice(0, 8).join(", ")} +${form.actions.length - 8}` : form.actions.join(", ");
        const popup = form.popup.length > 4 ? `${form.popup.slice(0, 4).map((p) => p.path).join("; ")} +${form.popup.length - 4}` : form.popup.map((p) => p.path).join("; ");
        return `| <a id="${form.name.toLowerCase()}"></a>**${escapeCell(form.title)}**<br>\`${form.name}\` | ${escapeCell(menus)} | ${escapeCell(actions) || "–"} | ${escapeCell(popup) || "–"} | ${rights || "–"} | ${tableRow(form.tables)} | \`${form.file}\` |`;
      });
    const doc = [
      `# Form — paket \`${pkg}\``,
      "",
      `${list.length} form · commit \`${sha}\`.`,
      "",
      "| Dialog (judul / kelas) | Menu | Tombol | Klik kanan | Hak (isCek) | Tulis | Baca | File |",
      "|---|---|---|---|---|---|---|---|",
      ...rows,
      "",
    ];
    await writeFile(NodePath.join(dir, `forms/${pkg}.md`), doc.join("\n"), "utf8");
  }
};

const writeIndexDoc = async (index: ReturnType<typeof buildIndex>, dir: string, sha: string) => {
  const byPackage = new Map<string, number>();
  for (const form of Object.values(index.forms)) byPackage.set(form.package, (byPackage.get(form.package) ?? 0) + 1);
  const doc = [
    "# Peta aplikasi SIMRS Khanza (desktop)",
    "",
    `Sumber: \`${index.source.root}\`, commit \`${sha}\`, dibuat ${index.source.generatedAt.slice(0, 10)}.`,
    "Dibuat ulang oleh `pnpm extract-khanza-app`; jangan diedit tangan.",
    "",
    "Berkas ini yang dipakai agent lewat tool `cariAplikasiKhanza`.",
    "",
    "## Isi",
    "",
    "- [menu/](menu/README.md) — 20 grup menu [A]–[T], tombol, hak akses, form.",
    "- [forms/](forms/README.md) — form per paket: tombol di dalam form, hak, tabel yang dibaca/ditulis.",
    "- [cara-pakai.md](cara-pakai.md) — arti grup A–T, path menu, dan judul dialog.",
    "- [flows/](flows/README.md) — alur pasien dan data (registrasi, ranap, lab, farmasi, kasir, BPJS, ...).",
    "- [roles.md](roles.md) — cara hak akses bekerja dan kenapa menu tidak muncul.",
    "- [bridge.md](bridge.md) — cara SIMRS Harness membuka form di aplikasi desktop.",
    "- [synonyms.json](synonyms.json) — kata yang dipakai staf tetapi tidak ada di label menu (mis. \"pindah kamar\").",
    "- [index.json](index.json) — graf lengkap untuk mesin (menu, form, hak, tabel).",
    "",
    "## Angka",
    "",
    `- ${index.source.groups} grup menu, ${index.source.menuEntries} tombol (${index.source.labelledEntries} berlabel sendiri).`,
    `- ${index.source.resolvedForms} tombol menunjuk ke form yang dikenal; ${index.source.forms} form unik.`,
    `- ${index.source.tablesInSchema} tabel di \`sik.sql\` dipakai sebagai daftar nama tabel yang sah.`,
    `- ${index.toolbar.length} tombol toolbar dan ${Object.values(index.forms).reduce((n, form) => n + form.popup.length, 0)} item klik kanan.`,
    "",
    "## Paket form",
    "",
    "| Paket | Form |",
    "|---|---|",
    ...[...byPackage].toSorted(([a], [b]) => a.localeCompare(b)).map(([pkg, n]) => `| ${pkg} | ${n} |`),
    "",
    "## Cara membaca",
    "",
    "Menu di aplikasi: klik **Menu** → pilih grup di `cmbMenu` → klik tombol. Urutan itu yang ditulis",
    "sebagai `A/Registrasi`, `B/…` dan seterusnya. Hak akses adalah kolom boolean di tabel `user`;",
    "user dengan hak itu saja yang melihat tombolnya.",
    "",
  ];
  await writeFile(NodePath.join(dir, "README.md"), doc.join("\n"), "utf8");
};

await main();
