import { Schema } from "effect";

export const Str = Schema.String;
export const NullableStr = Schema.NullOr(Schema.String);
export const NullableNum = Schema.NullOr(Schema.Number);

/** Visit number, e.g. "2026/10/21/000123" (reg_periksa.no_rawat, varchar(17)). */
export const NoRawat = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(17)).annotate({
  description: 'Visit number (no_rawat), e.g. "2026/10/21/000123".',
});

/** Medical record number (pasien.no_rkm_medis, varchar(15)). */
export const NoRkmMedis = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(15)).annotate({
  description: 'Medical record number (no_rkm_medis / RM), e.g. "012345".',
});

/**
 * LIKE pattern that matches all words in order: "budi santoso" -> "%budi%santoso%".
 * `%`, `_` and `\` typed by the user are matched literally.
 */
export const containsWords = (text: string): string => {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w.replaceAll(/[\\%_]/g, (c) => `\\${c}`));
  return `%${words.join("%")}%`;
};

/** Active kamar_inap row: the patient is still in that room. */
export const ACTIVE_STAY = "-";
