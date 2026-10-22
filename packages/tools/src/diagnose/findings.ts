import { Schema } from "effect";

/** One check of a diagnosis: ok, problem, or information. */
export const Finding = Schema.Struct({
  cek: Schema.String,
  hasil: Schema.Literals(["ok", "masalah", "info"]),
  keterangan: Schema.String,
});
export type Finding = typeof Finding.Type;

export const DiagnosisOutput = Schema.Struct({
  temuan: Schema.Array(Finding),
  jumlahMasalah: Schema.Number,
});

export const summarize = (temuan: ReadonlyArray<Finding>) => ({
  temuan,
  jumlahMasalah: temuan.filter((t) => t.hasil === "masalah").length,
});
