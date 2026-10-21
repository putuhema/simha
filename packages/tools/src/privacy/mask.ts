/**
 * Masks patient identifiers before data is sent to an AI provider.
 *
 * Two layers:
 * 1. By field name: values of NIK, phone and address columns are replaced
 *    whole, whatever they look like.
 * 2. By pattern, in every string: 16-digit numbers (NIK) and Indonesian
 *    phone numbers, in case they appear in free text or unexpected columns.
 *
 * Patient names, RM numbers and visit numbers are kept: the agent needs them.
 */

const NIK_MASK = "[NIK disamarkan]";
const PHONE_MASK = "[telepon disamarkan]";
const ADDRESS_MASK = "[alamat disamarkan]";
const EMAIL_MASK = "[email disamarkan]";

/** Column names (Khanza and common variants) that always hold a protected value. */
const fieldMask = (key: string): string | undefined => {
  const k = key.toLowerCase();
  if (k === "no_ktp" || k === "ktp" || k === "nik_pasien") return NIK_MASK;
  if (/^(no_?tl?p|no_telp|notelp|notelep|no_hp|nohp|telepon|telp|phone|hp)$/.test(k)) return PHONE_MASK;
  if (/^(alamat|almt)/.test(k) || k.endsWith("alamat")) return ADDRESS_MASK;
  if (k === "email") return EMAIL_MASK;
  return undefined;
};

/** 16-digit NIK, not part of a longer number. */
const NIK_PATTERN = /(?<!\d)\d{16}(?!\d)/g;
/** Indonesian mobile numbers: 08..., 628..., +628..., with optional separators. */
const PHONE_PATTERN = /(?<![\d/])(?:\+?62|0)8\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,5}(?![\d/])/g;

export const maskText = (text: string): string =>
  text.replaceAll(NIK_PATTERN, NIK_MASK).replaceAll(PHONE_PATTERN, PHONE_MASK);

/** Returns a copy of `value` with protected fields and patterns masked. */
export const maskPii = (value: unknown): unknown => {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(maskPii);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => {
        const mask = fieldMask(key);
        return [key, mask !== undefined && v !== null && v !== "" ? mask : maskPii(v)];
      }),
    );
  }
  return value;
};
