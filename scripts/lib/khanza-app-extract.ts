/**
 * Reads the SIMRS Khanza desktop source and builds the app map: which menu
 * group and button opens which form, which access right guards it, and which
 * tables the form's SQL mentions.
 *
 * The menu is not a JMenuBar: `frmUtama` opens `DlgHome`, whose `cmbMenu`
 * selects one of 20 groups [A]–[T]; `isCombo()` then adds the buttons for that
 * group to a grid. Each `btnXxxActionPerformed` creates a form object, and the
 * form's SQL strings name the tables.
 *
 * Plain text parsing, pinned by the caller to one commit. The result is a map
 * of references, not a claim that a form writes only those tables.
 */

export interface TableUse {
  /** Tables the form reads (`from` / `join`). */
  readonly read: ReadonlyArray<string>;
  /** Tables the form writes (`insert into` / `update` / `delete from`). */
  readonly write: ReadonlyArray<string>;
}

interface MenuEntry {
  readonly label: string;
  readonly button: string;
  /** Rights of which at least one must be true for the button to appear. */
  readonly rights: ReadonlyArray<string>;
  readonly form: string | null;
}

export interface MenuGroup {
  readonly index: number;
  readonly letter: string;
  /** Short name for answers ("Rekam Medis"), from group-names.json. */
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly entries: ReadonlyArray<MenuEntry>;
}

export interface FormInfo {
  readonly name: string;
  readonly file: string;
  readonly package: string;
  /** "A/Registrasi" style menu paths that open this form. */
  readonly menus: ReadonlyArray<string>;
  /** Rights the form checks itself (`isCek` / `isCek2` / `tampil`). */
  readonly rights: ReadonlyArray<string>;
  /** Visible dialog header, e.g. "Data Resume Medis Pasien Rawat Inap". */
  readonly title: string;
  /** Right-click menu entries inside the dialog, e.g. "Obat → Input Resep Pulang". */
  readonly popup: ReadonlyArray<Shortcut>;
  /** Buttons inside the form, e.g. "Simpan", "Pindah", "Pulang". */
  readonly actions: ReadonlyArray<string>;
  readonly tables: TableUse;
}

/** A menu path in the toolbar or a right-click menu. */
export interface Shortcut {
  /** "Obat → Input Resep Pulang" or "Billing/Pembayaran Pasien". */
  readonly path: string;
  /** Dialog the item opens, when the handler opens one. */
  readonly form: string | null;
}

export interface ToolbarEntry {
  readonly label: string;
  readonly button: string;
  readonly form: string | null;
}

export interface AppIndex {
  readonly source: {
    readonly root: string;
    readonly commit: string;
    readonly generatedAt: string;
    readonly tablesInSchema: number;
    readonly groups: number;
    readonly menuEntries: number;
    readonly labelledEntries: number;
    readonly resolvedForms: number;
    readonly forms: number;
  };
  readonly groups: ReadonlyArray<MenuGroup>;
  readonly toolbar: ReadonlyArray<ToolbarEntry>;
  readonly forms: Readonly<Record<string, FormInfo>>;
  readonly rights: Readonly<Record<string, { readonly menus: ReadonlyArray<string>; readonly forms: ReadonlyArray<string> }>>;
}

export interface RawEntry {
  readonly group: number;
  readonly button: string;
  readonly label: string;
  /** The button has its own `setText` label, not just a camel-case fallback. */
  readonly labelled: boolean;
  readonly rights: ReadonlyArray<string>;
  readonly form: string | null;
}

export interface ParseReport {
  readonly groups: number;
  readonly entries: number;
  readonly labelled: number;
  readonly resolved: number;
  readonly unresolved: ReadonlyArray<string>;
}


/** Table names in the `sik.sql` dump, used to reject identifiers that are only variables. */
export const tableNamesFromSql = (sql: string): ReadonlyArray<string> => {
  const names = new Set<string>();
  for (const match of sql.matchAll(/CREATE TABLE\s+`([a-z_][a-z0-9_]*)`/gi)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names].toSorted();
};

/** Index just after the bracket that matches `open`. -1 when unbalanced. */
const balance = (text: string, open: number, opener: string, closer: string): number => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/** The 20 `cmbMenu` titles, in menu order. */
const parseComboTitles = (java: string): ReadonlyArray<string> => {
  const marker = "cmbMenu.setModel(new javax.swing.DefaultComboBoxModel(new String[] {";
  const start = java.indexOf(marker);
  if (start === -1) return [];
  const open = java.indexOf("{", start);
  const close = java.indexOf("}));", open);
  if (open === -1 || close === -1) return [];
  const titles: string[] = [];
  for (const match of java.slice(open + 1, close).matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const title = match[1];
    if (title !== undefined) titles.push(title);
  }
  return titles;
};

/**
 * One entry per `Panelmenu.add(btn)`, with the rights of every `if (...)`
 * block around it. A block that adds several buttons gives each the same
 * OR-set of rights, which is how the source gates them.
 */
const parseComboEntries = (
  java: string,
): ReadonlyArray<{ group: number; button: string; rights: ReadonlyArray<string> }> => {
  const start = java.indexOf("private void isCombo()");
  if (start === -1) return [];
  const after = java.slice(start);
  const endMatch = /private void (?:isCari|setLayout)\w*\(/.exec(after.slice(1));
  const body = endMatch === null ? after : after.slice(0, 1 + (endMatch.index ?? 0));

  const out: Array<{ group: number; button: string; rights: ReadonlyArray<string> }> = [];
  const branches = body.split(/cmbMenu\.getSelectedIndex\(\)\s*==\s*(\d+)/);
  for (let b = 1; b < branches.length; b += 2) {
    const group = Number(branches[b]);
    const segment = branches[b + 1] ?? "";
    const stack: Array<ReadonlyArray<string>> = [];
    let p = 0;
    while (p < segment.length) {
      const nextIf = segment.indexOf("if (", p);
      const nextAdd = segment.indexOf("Panelmenu.add(", p);
      const nextClose = segment.indexOf("}", p);
      const candidates = [nextIf, nextAdd, nextClose].filter((n) => n !== -1);
      if (candidates.length === 0) break;
      const at = Math.min(...candidates);

      if (at === nextIf) {
        const paren = segment.indexOf("(", at);
        const condEnd = balance(segment, paren, "(", ")");
        if (condEnd === -1) break;
        const brace = segment.indexOf("{", condEnd);
        if (brace === -1) break;
        const cond = segment.slice(paren + 1, condEnd);
        // `== false` / `!= true` would invert the meaning; keep only granted rights.
        const negated = /==\s*false|!=\s*true/.test(cond);
        const rights = negated
          ? []
          : [...cond.matchAll(/akses\.get(\w+)\(\)/g)].map((m) => m[1]).filter((r): r is string => r !== undefined);
        stack.push(rights);
        p = brace + 1;
        continue;
      }

      if (at === nextAdd) {
        const match = /Panelmenu\.add\((\w+)\)/.exec(segment.slice(at));
        if (match?.[1] !== undefined) out.push({ group, button: match[1], rights: [...new Set(stack.flat())] });
        p = at + (match?.[0].length ?? 1);
        continue;
      }

      if (stack.length > 0) stack.pop();
      p = at + 1;
    }
  }
  return out;
};

/** Final `setText` per button, from the generated `initComponents()`. */
const parseButtonLabels = (java: string): ReadonlyMap<string, string> => {
  const labels = new Map<string, string>();
  for (const match of java.matchAll(/\b([Bb]tn[A-Za-z0-9_]*)\.setText\("((?:[^"\\]|\\.)*)"\)/g)) {
    const variable = match[1];
    const text = match[2];
    if (variable !== undefined && text !== undefined) labels.set(variable, text.replaceAll('\\"', '"'));
  }
  return labels;
};

/** Body of every `*ActionPerformed` method, by method name. */
export const parseActionBodies = (java: string): ReadonlyMap<string, string> => {
  const bodies = new Map<string, string>();
  const re = /private void (\w+ActionPerformed)\(java\.awt\.event\.ActionEvent[^)]*\)\s*\{/g;
  for (const match of java.matchAll(re)) {
    const name = match[1];
    const brace = (match.index ?? 0) + match[0].length - 1;
    const end = balance(java, brace, "{", "}");
    if (name !== undefined && end !== -1) bodies.set(name, java.slice(brace + 1, end));
  }
  return bodies;
};

/** `private DlgReg reg = new DlgReg(...)` → reg → DlgReg. */
export const parseFieldTypes = (java: string): ReadonlyMap<string, string> => {
  const types = new Map<string, string>();
  for (const match of java.matchAll(/\b(?:private|protected|public)\s+(?:final\s+)?([A-Z]\w*)\s+(\w+)\s*=/g)) {
    const type = match[1];
    const name = match[2];
    if (type !== undefined && name !== undefined) types.set(name, type);
  }
  return types;
};

/** Which form a button opens: `new DlgXxx(...)`, else the form behind its `<var>.isCek()`. */
const resolveButtonForm = (
  button: string,
  bodies: ReadonlyMap<string, string>,
  fieldTypes: ReadonlyMap<string, string>,
  classNames: ReadonlySet<string>,
  depth = 0,
): string | null => {
  const body = bodies.get(`${button}ActionPerformed`);
  if (body === undefined) return null;
  for (const match of body.matchAll(/new\s+(\w+)\s*\(/g)) {
    const name = match[1];
    if (name !== undefined && classNames.has(name)) return name;
  }
  for (const match of body.matchAll(/\b(\w+)\.isCek(?:2)?\(\)/g)) {
    const variable = match[1];
    const type = variable === undefined ? undefined : fieldTypes.get(variable);
    if (type !== undefined && classNames.has(type)) return type;
  }
  // A menu handler may only call another handler (e.g. btnKasir -> BtnToolKasir).
  if (depth < 2) {
    for (const match of body.matchAll(/\b(\w+ActionPerformed)\s*\(/g)) {
      const target = match[1];
      if (target !== undefined && bodies.has(target)) {
        const form = resolveButtonForm(target.replace(/ActionPerformed$/, ""), bodies, fieldTypes, classNames, depth + 1);
        if (form !== null) return form;
      }
    }
  }
  return null;
};

const READ_RE = /\b(?:from|join)\s+`?([a-z_][a-z0-9_]*)`?/gi;
const WRITE_RE = /\b(?:insert\s+into|replace\s+into|update|delete\s+from)\s+`?([a-z_][a-z0-9_]*)`?/gi;
/** Khanza writes through helpers too: Sequel.menyimpan("kamar_inap", ...). */
const HELPER_WRITE_RE = /Sequel\.(?:menyimpan|menyimpantf2?|mengedit|mengedittf)\(\s*"([a-z_][a-z0-9_]*)"/gi;

/** Table names the form's SQL mentions, filtered to the real schema. */
export const parseFormTables = (java: string, tables: ReadonlySet<string>): TableUse => {
  const read = new Set<string>();
  const write = new Set<string>();
  for (const match of java.matchAll(READ_RE)) {
    const name = match[1]?.toLowerCase();
    if (name !== undefined && tables.has(name)) read.add(name);
  }
  for (const match of java.matchAll(WRITE_RE)) {
    const name = match[1]?.toLowerCase();
    if (name !== undefined && tables.has(name)) write.add(name);
  }
  for (const match of java.matchAll(HELPER_WRITE_RE)) {
    const name = match[1]?.toLowerCase();
    if (name !== undefined && tables.has(name)) write.add(name);
  }
  for (const name of write) read.delete(name);
  return { read: [...read].toSorted(), write: [...write].toSorted() };
};

/** Body of a `void name(...)` method, by brace matching. */
const methodBody = (java: string, name: string): string | null => {
  const signature = new RegExp(`\\bvoid\\s+${name}\\s*\\(`).exec(java);
  if (signature === null) return null;
  const brace = java.indexOf("{", signature.index + signature[0].length);
  if (brace === -1) return null;
  const end = balance(java, brace, "{", "}");
  return end === -1 ? null : java.slice(brace + 1, end);
};

/**
 * Visible header of a form: the `internalFrame1` TitledBorder, else setTitle.
 * Khanza's NetBeans template leaves `::[ About Program ]::` in forms whose real
 * title is set by the caller (`setJudul`), so that placeholder is ignored.
 */
export const parseFormTitle = (java: string, className: string): string => {
  const main = /internalFrame1\.setBorder\([^;]*?"::\[\s*([^"\]]+?)\s*\]::"/s.exec(java);
  const titled = /createTitledBorder\([^;]*?"::\[\s*([^"\]]+?)\s*\]::"/s.exec(java);
  const dialog = /setTitle\("([^"]{3,120})"\)/.exec(java);
  const raw = (main?.[1] ?? titled?.[1] ?? dialog?.[1])?.trim().replaceAll(/\s+/g, " ");
  // setTitle() keeps the `::[ ... ]::` decoration; the border captures only the text.
  const title = raw?.replace(/^::\[\s*/, "").replace(/\s*\]::$/, "");
  if (title === undefined || title === "" || /^about program$/i.test(title)) {
    return className.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  return title;
};

/** Buttons inside a form (`btnPindah.setText("Pindah")`), in source order. */
export const parseActionLabels = (java: string): ReadonlyArray<string> => {
  const labels: string[] = [];
  for (const match of java.matchAll(/\b[Bb]tn[A-Za-z0-9_]*\.setText\("((?:[^"\\]|\\.)*)"\)/g)) {
    const label = match[1]?.replaceAll('\\"', '"').trim();
    if (label !== undefined && label !== "" && label !== "..." && label !== "-") labels.push(label);
  }
  return [...new Set(labels)].slice(0, 20);
};

/** Rights a form enables in `isCek()` / `isCek2()`, i.e. what it lets the user do. */
export const parseFormRights = (java: string): ReadonlyArray<string> => {
  const bodies = [methodBody(java, "isCek"), methodBody(java, "isCek2")].filter((b): b is string => b !== null);
  return [
    ...new Set(bodies.flatMap((body) => [...body.matchAll(/akses\.get(\w+)\(\)/g)].map((m) => m[1]))),
  ].filter((r): r is string => r !== undefined);
};

/** Menu label, with a readable fallback for buttons that never set one. */
const labelFor = (button: string, labels: ReadonlyMap<string, string>): string =>
  labels.get(button) ?? button.replace(/^[Bb]tn/, "").replaceAll(/([a-z])([A-Z])/g, "$1 $2");

/** Reads `frmUtama.java` into menu entries, each already pointing at its form. */
export const parseMainFrame = (
  java: string,
  classNames: ReadonlySet<string>,
): { titles: ReadonlyArray<string>; entries: ReadonlyArray<RawEntry>; report: ParseReport } => {
  const titles = parseComboTitles(java);
  const labels = parseButtonLabels(java);
  const bodies = parseActionBodies(java);
  const fieldTypes = parseFieldTypes(java);
  const combos = parseComboEntries(java);

  const entries: RawEntry[] = [];
  const unresolved: string[] = [];
  let labelled = 0;
  let resolved = 0;
  for (const combo of combos) {
    if (labels.has(combo.button)) labelled++;
    const form = resolveButtonForm(combo.button, bodies, fieldTypes, classNames);
    if (form === null) unresolved.push(combo.button);
    else resolved++;
    entries.push({
      group: combo.group,
      button: combo.button,
      label: labelFor(combo.button, labels),
      labelled: labels.has(combo.button),
      rights: combo.rights,
      form,
    });
  }

  return {
    titles,
    entries,
    report: {
      groups: titles.length,
      entries: entries.length,
      labelled,
      resolved,
      unresolved: [...new Set(unresolved)],
    },
  };
};

/** Buttons on the top quick-access bar (`BtnTool*` / `btnTool*`), minus Menu/Log/Keluar. */
export const parseToolbar = (
  java: string,
  bodies: ReadonlyMap<string, string>,
  fieldTypes: ReadonlyMap<string, string>,
  classNames: ReadonlySet<string>,
): ReadonlyArray<ToolbarEntry> => {
  const labels = parseButtonLabels(java);
  const out: ToolbarEntry[] = [];
  for (const [variable, label] of labels) {
    if (!/^[Bb]tnTool[A-Za-z0-9_]*$/.test(variable)) continue;
    out.push({ label, button: variable, form: resolveButtonForm(variable, bodies, fieldTypes, classNames) });
  }
  return out;
};

/** Right-click menus in a form: nested `JMenu` / `JMenuItem` items and their handlers. */
export const parsePopupShortcuts = (
  java: string,
  bodies: ReadonlyMap<string, string>,
  fieldTypes: ReadonlyMap<string, string>,
  classNames: ReadonlySet<string>,
): ReadonlyArray<Shortcut> => {
  const menus = new Map<string, "menu" | "item">();
  for (const match of java.matchAll(/\b(\w+)\s*=\s*new\s+javax\.swing\.J(Menu|MenuItem|CheckBoxMenuItem)\(\)/g)) {
    const variable = match[1];
    const kind = match[2] === "Menu" ? "menu" : "item";
    if (variable !== undefined) menus.set(variable, kind);
  }
  if (menus.size === 0) return [];

  const labels = new Map<string, string>();
  for (const match of java.matchAll(/\b(\w+)\.setText\("((?:[^"\\]|\\.)*)"\)/g)) {
    const variable = match[1];
    const label = match[2]?.replaceAll('\\"', '"').trim();
    if (variable !== undefined && menus.has(variable) && label !== undefined && label !== "") labels.set(variable, label);
  }

  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const match of java.matchAll(/\b(\w+)\.add\((\w+)\)/g)) {
    const parent = match[1];
    const child = match[2];
    if (parent === undefined || child === undefined || !menus.has(child)) continue;
    // Items added straight to the popup (jPopupMenu1) have no menu parent and are roots.
    if (!menus.has(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), child]);
    hasParent.add(child);
  }

  const seen = new Map<string, Shortcut>();
  const walk = (variable: string, prefix: ReadonlyArray<string>) => {
    const label = labels.get(variable);
    const path = label === undefined ? prefix : [...prefix, label];
    if (menus.get(variable) === "item") {
      if (path.length > 0) {
        const shortcut = { path: path.join(" → "), form: resolveButtonForm(variable, bodies, fieldTypes, classNames) };
        seen.set(`${shortcut.path}|${shortcut.form ?? ""}`, shortcut);
      }
      return;
    }
    for (const child of children.get(variable) ?? []) walk(child, path);
  };
  for (const variable of menus.keys()) if (!hasParent.has(variable)) walk(variable, []);
  return [...seen.values()];
};

export interface BuildInput {
  readonly root: string;
  readonly commit: string;
  readonly generatedAt: string;
  readonly tableNames: ReadonlyArray<string>;
  readonly titles: ReadonlyArray<string>;
  readonly groupNames: Readonly<Record<string, string>>;
  readonly entries: ReadonlyArray<RawEntry>;
  readonly toolbar: ReadonlyArray<ToolbarEntry>;
  readonly forms: ReadonlyMap<
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
  >;
}

const splitGroupTitle = (raw: string) => {
  const match = /^\[([A-Z])\]\s*(.*)$/.exec(raw);
  return { letter: match?.[1] ?? "?", description: match?.[2] ?? raw };
};

/** Assembles the graph: groups → entries, and forms / rights back-references. */
export const buildIndex = (input: BuildInput): AppIndex => {
  const rightsMap = new Map<string, { menus: string[]; forms: Set<string> }>();
  const formMenus = new Map<string, string[]>();
  const perGroup: MenuEntry[][] = input.titles.map(() => []);
  const groups: MenuGroup[] = input.titles.map((raw, index) => {
    const { letter, description } = splitGroupTitle(raw);
    return { index, letter, name: input.groupNames[letter] ?? description, title: raw, description, entries: [] };
  });

  for (const entry of input.entries) {
    const group = groups[entry.group];
    if (group === undefined) continue;
    perGroup[entry.group]?.push({ label: entry.label, button: entry.button, rights: entry.rights, form: entry.form });
    const menuPath = `${group.letter}/${entry.label}`;
    for (const right of entry.rights) {
      const slot = rightsMap.get(right) ?? { menus: [], forms: new Set<string>() };
      slot.menus.push(menuPath);
      if (entry.form !== null) slot.forms.add(entry.form);
      rightsMap.set(right, slot);
    }
    if (entry.form !== null) {
      const menus = formMenus.get(entry.form) ?? [];
      menus.push(menuPath);
      formMenus.set(entry.form, menus);
    }
  }

  const forms: Record<string, FormInfo> = {};
  for (const [name, form] of input.forms) {
    const menus = formMenus.get(name) ?? [];
    // Forms without their own header fall back to the menu label ("Mutasi Berkas
    // RM"), which is what the user sees; the camel-case class name is not.
    const classTitle = name.replace(/([a-z])([A-Z])/g, "$1 $2");
    const menuLabel = menus[0]?.split("/").slice(1).join("/");
    forms[name] = {
      name,
      file: form.file,
      package: form.package,
      menus,
      rights: form.rights,
      title: form.title === classTitle && menuLabel !== undefined && menuLabel !== "" ? menuLabel : form.title,
      actions: form.actions,
      popup: form.popup,
      tables: form.tables,
    };
  }

  return {
    source: {
      root: input.root,
      commit: input.commit,
      generatedAt: input.generatedAt,
      tablesInSchema: input.tableNames.length,
      groups: groups.length,
      menuEntries: input.entries.length,
      labelledEntries: input.entries.filter((e) => e.labelled).length,
      resolvedForms: input.entries.filter((e) => e.form !== null).length,
      forms: input.forms.size,
    },
    groups: groups.map((group) => ({ ...group, entries: perGroup[group.index] ?? [] })),
    toolbar: input.toolbar,
    forms,
    rights: Object.fromEntries(
      [...rightsMap]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([right, slot]) => [right, { menus: [...new Set(slot.menus)], forms: [...slot.forms].toSorted() }]),
    ),
  };
};
