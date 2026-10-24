/**
 * Turns map ids into what a person sees in Khanza: "A/Rawat Inap" becomes
 * "Registrasi & Billing → Rawat Inap", a form class becomes its dialog header,
 * and a right-click hit becomes the numbered steps to click it.
 *
 * Shared by `cariAplikasiKhanza` (one-line door) and `detailAplikasi` (full
 * record), so both answer with the same wording.
 */
import type { AppDocsService } from "./AppDocs.ts";
import type { ShortcutHit } from "./search.ts";

/** A right-click or toolbar action, already written as steps for the answer. */
export interface AppShortcutSteps {
  readonly jenis: "toolbar" | "klik-kanan";
  /** "Rawat Inap → klik kanan → Billing/Pembayaran Pasien". */
  readonly jalur: string;
  readonly aksi: string;
  readonly dialog: string | null;
  /** One action per line, ready to print as a numbered list. */
  readonly langkah: ReadonlyArray<string>;
}

export interface AppPaths {
  /** "M/Resume Pasien Ranap" → "Rekam Medis → Resume Pasien Ranap". */
  readonly humanPath: (path: string) => string;
  /** Form class name → visible dialog header ("DlgKamarInap" → "Daftar Pasien Rawat Inap"). */
  readonly formTitle: (name: string | null | undefined) => string | null;
  readonly shortcut: (hit: ShortcutHit) => AppShortcutSteps;
}

export const makeAppPaths = (docs: AppDocsService): AppPaths => {
  const groupName = new Map(docs.menus.map((menu) => [menu.groupLetter, menu.groupName]));

  const humanPath = (path: string) => {
    const [letter, ...rest] = path.split("/");
    const name = letter === undefined ? undefined : groupName.get(letter);
    return name === undefined ? path : `${name} → ${rest.join("/")}`;
  };

  // Some Khanza forms leave NetBeans' "About Program" header and set the real
  // title from the caller; the menu label is what the user sees in that case.
  const formTitle = (name: string | null | undefined) => {
    if (name === null || name === undefined) return null;
    const form = docs.forms.find((candidate) => candidate.name === name);
    if (form === undefined) return name;
    if (form.title.trim() === "" || /^(?:::\[\s*)?about program(?:\s*\]::)?$/i.test(form.title)) {
      return docs.menus.find((menu) => menu.form === name)?.label ?? form.title;
    }
    return form.title;
  };

  const shortcut = (hit: ShortcutHit): AppShortcutSteps => {
    // How the user reaches the dialog: the toolbar button if there is one, else the menu.
    const toolbarEntry = hit.form === null ? undefined : docs.toolbar.find((entry) => entry.form === hit.form?.name);
    const openPath = toolbarEntry?.label ?? (hit.form?.menus[0] === undefined ? null : humanPath(hit.form.menus[0]));
    const segments = hit.path.split(" → ");
    const openSteps =
      openPath === null
        ? [`Buka ${formTitle(hit.form?.name) ?? "daftar pasien"}`]
        : toolbarEntry !== undefined
          ? [`Buka **${toolbarEntry.label}**`]
          : (() => {
              const [group, ...rest] = openPath.split(" → ");
              return ["Klik **Menu**", `Pilih grup **${group}**`, ...rest.map((item) => `Klik **${item}**`)];
            })();
    const clickSteps =
      hit.kind === "toolbar" ? [] : ["Klik kanan baris pasien", ...segments.map((segment) => `Pilih **${segment}**`)];
    return {
      jenis: hit.kind,
      jalur:
        hit.kind === "toolbar"
          ? hit.path
          : `${openPath ?? formTitle(hit.form?.name) ?? "dialog"} → klik kanan → ${hit.path}`,
      aksi: hit.label,
      dialog: formTitle(hit.form?.name) ?? null,
      langkah: [...openSteps, ...clickSteps],
    };
  };

  return { humanPath, formTitle, shortcut };
};
