/**
 * AI tools for drafting Khanza forms. `buatDraftResume` makes the draft from
 * Khanza data and shows it as a card; `isiDraft` stores what the user told
 * the AI. The user checks the card and fills Khanza's form from it (desktop
 * app), then saves in Khanza.
 */
import { formProblems, FormDraft, type FieldSource } from "@simha/shared";
import { Effect, Schema } from "effect";
import { ToolError } from "../errors.ts";
import { ResultStore } from "../info/ResultStore.ts";
import { CurrentActor, CurrentSession, CurrentToolCall } from "../khanza/current-tool-call.ts";
import { NoRawat } from "../read/common.ts";
import { defineTool } from "../tool.ts";
import { buildResumeDraft, draftForModel } from "./resumeDraft.ts";

const INSTRUCTIONS =
  "Draf sudah tampil sebagai kartu di layar pengguna; pengguna bisa mengubah isinya langsung. Tanyakan field " +
  "kosongWajib dulu, lalu field kosong yang penting (jalannya penyakit, edukasi, diet, kontrol, obat pulang, " +
  "dilanjutkan) dalam satu pesan singkat bernomor; sebut bahwa boleh dilewati. Jangan mengarang data klinis: isi " +
  "hanya dari jawaban pengguna atau dari data yang sudah ada. Simpan jawaban dengan isiDraft (pakai key field). " +
  "Setelah lengkap, minta pengguna memeriksa kartu lalu klik 'Isi di Khanza' dan Simpan di Khanza. Teks klinis " +
  "yang sudah terisi bisa disamarkan untuk AI; itu sudah ada di kartu.";

export const buatDraftResume = defineTool({
  name: "buatDraftResume",
  kind: "render",
  requires: (permissions) => permissions.resume,
  description:
    "Start a draft of Khanza's 'Resume Pasien Ranap' (resume medis rawat inap) for one inpatient visit, when the user " +
    "wants to make or complete a resume. The server fills what Khanza data shows (diagnoses, procedures, first CPPT, " +
    "lab, radiology, tindakan, obat, discharge status), or takes the resume already in Khanza, and shows the draft as " +
    "an editable card. Returns which fields are filled and which are empty. Then ask the user for the empty ones and " +
    "store the answers with isiDraft. The draft is put into Khanza's own form by the user (desktop app); never claim " +
    "that it is saved in Khanza.",
  parameters: Schema.Struct({ noRawat: NoRawat }),
  output: Schema.Struct({ draft: FormDraft }),
  handler: Effect.fn("buatDraftResume")(function* (params) {
    const store = yield* ResultStore;
    const built = yield* buildResumeDraft("buatDraftResume", params.noRawat.trim());
    const draft: FormDraft = {
      id: crypto.randomUUID(),
      form: "resume_ranap",
      noRawat: params.noRawat.trim(),
      subjek: built.subjek,
      existing: built.existing,
      fields: built.fields,
      sources: built.sources,
      createdBy: yield* CurrentActor,
      updatedAt: new Date().toISOString(),
    };
    yield* store.saveDraft(draft, { toolCallId: yield* CurrentToolCall, sessionId: yield* CurrentSession });
    return { draft };
  }),
  forModel: ({ draft }) => ({ ditampilkan: true, ...draftForModel(draft), catatan: INSTRUCTIONS }),
});

export const isiDraft = defineTool({
  name: "isiDraft",
  kind: "render",
  requires: (permissions) => permissions.resume,
  description:
    "Put the user's answers into a form draft made with buatDraftResume. isian: field key -> text, using the keys " +
    "from buatDraftResume (e.g. jalannya_penyakit, edukasi, kontrol 'YYYY-MM-DD HH:MM', keadaan one of its choices). " +
    "Only what the user said or what is in the data; an empty string clears a field. The card on screen updates.",
  parameters: Schema.Struct({
    draftId: Schema.String,
    isian: Schema.Record(Schema.String, Schema.String),
  }),
  output: Schema.Struct({ draft: FormDraft }),
  handler: Effect.fn("isiDraft")(function* (params) {
    const store = yield* ResultStore;
    const current = yield* store.getDraft(params.draftId);
    if (!current) return yield* new ToolError({ tool: "isiDraft", message: `Draf ${params.draftId} tidak ditemukan.` });
    const values = Object.fromEntries(Object.entries(params.isian).map(([k, v]) => [k, v.trim()]));
    const problems = formProblems(current.form, values);
    if (problems.length > 0) return yield* new ToolError({ tool: "isiDraft", message: problems.join(" ") });
    const source: FieldSource = "ai";
    const draft = yield* store.updateDraft(params.draftId, values, source, yield* CurrentActor);
    if (!draft) return yield* new ToolError({ tool: "isiDraft", message: `Draf ${params.draftId} tidak ditemukan.` });
    return { draft };
  }),
  forModel: ({ draft }) => ({
    ...draftForModel(draft),
    catatan: "Kartu draf sudah diperbarui. Tanyakan sisa field yang penting, atau minta pengguna memeriksa lalu klik 'Isi di Khanza'.",
  }),
});
