/**
 * HTTP API contracts shared by the server and the web UI.
 */
import { Schema } from "effect";
import { Permissions } from "./permissions.ts";

const NonEmpty = Schema.String.check(Schema.isNonEmpty());

// --- Agent modes -------------------------------------------------------------

/**
 * What the AI should do with the question:
 * - tanya: a question about hospital data (Tanya Data);
 * - investigasi: a nurse's complaint to investigate, answered with Yang dicek /
 *   Diagnosis / Saran perbaikan and (when needed) a proposed fix.
 */
export const AgentMode = Schema.Literals(["tanya", "investigasi"]);
export type AgentMode = typeof AgentMode.Type;

// --- Tanya Data -------------------------------------------------------------

/** Body of POST /ask. Pass the `conversationId` from `run_started` to ask a follow-up in the same context. */
export const AskRequest = Schema.Struct({
  question: NonEmpty.check(Schema.isMaxLength(5_000)),
  conversationId: Schema.optionalKey(Schema.String),
  /** Defaults to tanya. Investigasi asks the AI for a diagnosis and a fix proposal. */
  mode: Schema.optionalKey(AgentMode),
});
export type AskRequest = typeof AskRequest.Type;

// --- Render blocks (Tanya Data answers) ----------------------------------------

export const RenderType = Schema.Literals(["table", "bar", "line", "pie", "stat", "list"]);
export type RenderType = typeof RenderType.Type;

/**
 * One result shown in the chat. The rows always come from a query the server
 * ran (never typed by the AI), and `sql` is that query, for "Query yang dipakai".
 *
 * - table: `kolom` in order, all `baris`.
 * - bar / line: `x` is the category or time column, `y` the value columns (series).
 * - pie: `x` labels, one `y` value column.
 * - stat: one number, `baris[0][y[0]]`, with `x` as an optional label column.
 * - list: `baris[i][x]` as text.
 */
export const RenderBlock = Schema.Struct({
  id: Schema.String,
  tipe: RenderType,
  judul: Schema.String,
  /** One-line assumptions, e.g. "bulan ini = 1–21 Okt 2026, hanya rawat jalan". */
  asumsi: Schema.NullOr(Schema.String),
  queryId: Schema.String,
  sql: Schema.String,
  kolom: Schema.Array(Schema.String),
  baris: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  x: Schema.NullOr(Schema.String),
  y: Schema.Array(Schema.String),
  satuan: Schema.NullOr(Schema.String),
  /** The query returned more rows than the 500-row limit; only the first 500 are here. */
  terpotong: Schema.Boolean,
});
export type RenderBlock = typeof RenderBlock.Type;

// --- Patient documents ------------------------------------------------------------

export const DocumentKind = Schema.Literals(["riwayat", "cppt", "resume"]);
export type DocumentKind = typeof DocumentKind.Type;

/**
 * A printable patient document (riwayat pasien, CPPT/SOAP, resume medis).
 * The HTML is built by the server from Khanza data with a fixed template,
 * never written by the AI. Fetch it from GET /api/documents/:id.
 */
export const DocumentInfo = Schema.Struct({
  id: Schema.String,
  jenis: DocumentKind,
  judul: Schema.String,
  /** Who or what it is about, e.g. "RM 000002 · SITI AMINAH · 2026/10/21/000002". */
  subjek: Schema.String,
  /** One line about the contents, e.g. "3 catatan CPPT, 2 diagnosis, 2 hasil lab". */
  ringkas: Schema.String,
  dibuatOleh: Schema.NullOr(Schema.String),
  dibuatPada: Schema.String,
});
export type DocumentInfo = typeof DocumentInfo.Type;

// --- Radiology images (Orthanc PACS) ---

/** One DICOM series in a study; `instances` are Orthanc instance IDs (images). */
export const PacsSeries = Schema.Struct({
  id: Schema.String,
  modality: Schema.String,
  description: Schema.String,
  bodyPart: Schema.String,
  number: Schema.Number,
  instances: Schema.Array(Schema.String),
});
export type PacsSeries = typeof PacsSeries.Type;

/** One study (exam) of a patient. Patients are matched by No. RM = DICOM PatientID. */
export const PacsStudy = Schema.Struct({
  id: Schema.String,
  studyInstanceUid: Schema.String,
  /** YYYY-MM-DD, or "" when Orthanc has no StudyDate. */
  date: Schema.String,
  /** HH:MM, or "". */
  time: Schema.String,
  description: Schema.String,
  accession: Schema.String,
  institution: Schema.String,
  series: Schema.Array(PacsSeries),
});
export type PacsStudy = typeof PacsStudy.Type;

/** GET /api/patients/:rm/radiologi. `configured` is false when ORTHANC_URL is empty. */
export const PacsStudies = Schema.Struct({
  configured: Schema.Boolean,
  /** Orthanc's own Stone Web Viewer, for "open in Stone Viewer" links (reachable on the hospital network only). */
  viewerBase: Schema.NullOr(Schema.String),
  studies: Schema.Array(PacsStudy),
});
export type PacsStudies = typeof PacsStudies.Type;

/** One radiology exam in Khanza (periksa_radiologi) with its reading (hasil_radiologi). */
export const RadiologyExam = Schema.Struct({
  noRawat: Schema.String,
  /** YYYY-MM-DD */
  tanggal: Schema.String,
  /** HH:MM */
  jam: Schema.String,
  /** Exam names, e.g. "Thorax PA"; null when only a reading exists. */
  nama: Schema.NullOr(Schema.String),
  /** Radiologist. */
  dokter: Schema.NullOr(Schema.String),
  /** The reading text; null when not written yet. */
  hasil: Schema.NullOr(Schema.String),
});
export type RadiologyExam = typeof RadiologyExam.Type;

/**
 * Radiology of a visit (or a patient), shown as one card in the chat by the
 * `hasilRadiologi` tool: Khanza's exams and readings with the PACS images of
 * the same day. Images load from /api/pacs/instances/...
 */
export const RadiologyGallery = Schema.Struct({
  /** Exams and readings from Khanza, newest first. */
  pemeriksaan: Schema.Array(RadiologyExam),
  /** Why there are no images: PACS not set up or not reachable. Null when PACS answered. */
  pacsCatatan: Schema.NullOr(Schema.String),
  noRkmMedis: Schema.String,
  noRawat: Schema.NullOr(Schema.String),
  /** Dates of the visit the studies were matched to (YYYY-MM-DD), when noRawat is set. */
  rentang: Schema.NullOr(Schema.Struct({ dari: Schema.String, sampai: Schema.String })),
  /** False when noRawat was given but no study fell in the visit dates, so all of the patient's studies are shown. */
  cocokKunjungan: Schema.Boolean,
  viewerBase: Schema.NullOr(Schema.String),
  studies: Schema.Array(PacsStudy),
});
export type RadiologyGallery = typeof RadiologyGallery.Type;

// --- Digital patient files (berkas digital) -----------------------------------------

/** What a digital file is: a picture, a PDF, or something to download. */
export const BerkasFileKind = Schema.Literals(["gambar", "pdf", "lainnya"]);
export type BerkasFileKind = typeof BerkasFileKind.Type;

/**
 * One file from Khanza's berkas_digital_perawatan (scanned lab result, photo,
 * consent PDF, ...). `ada` is false when the server cannot see the file on
 * disk (KHANZA_BERKAS_DIR not set, or the file is missing). The bytes are
 * served by GET /api/berkas?noRawat=...&kode=...; the path stays on the server.
 */
export const BerkasDigitalFile = Schema.Struct({
  noRawat: Schema.String,
  /** master_berkas_digital.kode. */
  kode: Schema.String,
  /** master_berkas_digital.nama, e.g. "Hasil Laboratorium". */
  nama: Schema.String,
  /** File name only, e.g. "2026-10-21-lab.pdf". */
  namaFile: Schema.String,
  jenis: BerkasFileKind,
  /** Size in bytes, when the server can read it. */
  ukuran: Schema.NullOr(Schema.Number),
  ada: Schema.Boolean,
});
export type BerkasDigitalFile = typeof BerkasDigitalFile.Type;

/** Digital files of one visit, or of a patient's visits, shown as one card. */
export const BerkasDigital = Schema.Struct({
  noRkmMedis: Schema.String,
  /** The visit asked about; null when the list spans a patient's visits. */
  noRawat: Schema.NullOr(Schema.String),
  /** "RM 000002 · SITI AMINAH · 2026/10/21/000002" */
  subjek: Schema.String,
  berkas: Schema.Array(BerkasDigitalFile),
  /** Why some files cannot be opened (folder not configured, file missing, ...). */
  catatan: Schema.NullOr(Schema.String),
});
export type BerkasDigital = typeof BerkasDigital.Type;

// --- Form drafts (filled in Khanza by the desktop app) ---------------------------------

/** Where a field's value came from: Khanza data, an existing Khanza entry, the AI (from the chat), or typed by the user. */
export const FieldSource = Schema.Literals(["data", "khanza", "ai", "user"]);
export type FieldSource = typeof FieldSource.Type;

/**
 * A draft of a Khanza form (e.g. resume medis rawat inap) for one visit.
 * The server fills what Khanza data shows; the AI adds what the user tells it;
 * the user edits it. It is never saved to Khanza by the harness: the desktop
 * app opens Khanza's own form filled with it, and the user clicks Simpan there.
 */
export const FormDraft = Schema.Struct({
  id: Schema.String,
  form: Schema.Literals(["resume_ranap"]),
  noRawat: Schema.String,
  /** "RM 018412 · TN.WARNI · 2024/02/21/000213" */
  subjek: Schema.String,
  /** A resume already exists in Khanza: filling it means Khanza's Ganti, not Simpan. */
  existing: Schema.Boolean,
  fields: Schema.Record(Schema.String, Schema.String),
  sources: Schema.Record(Schema.String, FieldSource),
  createdBy: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export type FormDraft = typeof FormDraft.Type;

/** PATCH /api/drafts/:id: fields the user changed in the draft card. */
export const UpdateDraftRequest = Schema.Struct({ fields: Schema.Record(Schema.String, Schema.String) });
export type UpdateDraftRequest = typeof UpdateDraftRequest.Type;

/** POST /api/documents: make a document without the AI (buttons on the patient card). */
export const CreateDocumentRequest = Schema.Struct({
  jenis: DocumentKind,
  noRkmMedis: Schema.optionalKey(NonEmpty.check(Schema.isMaxLength(15))),
  noRawat: Schema.optionalKey(NonEmpty.check(Schema.isMaxLength(17))),
});
export type CreateDocumentRequest = typeof CreateDocumentRequest.Type;

// --- Favorite questions --------------------------------------------------------

/** A saved question with its SQL and how to show it; re-run without the AI. */
export const Favorite = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  judul: Schema.String,
  sql: Schema.String,
  tipe: RenderType,
  opsi: Schema.Struct({
    x: Schema.optionalKey(Schema.String),
    y: Schema.optionalKey(Schema.Array(Schema.String)),
    kolom: Schema.optionalKey(Schema.Array(Schema.String)),
    satuan: Schema.optionalKey(Schema.String),
  }),
  asumsi: Schema.NullOr(Schema.String),
  createdBy: Schema.String,
  createdAt: Schema.String,
});
export type Favorite = typeof Favorite.Type;

/** POST /favorites: save the question and query behind a render block ("Simpan ke favorit"). */
export const CreateFavoriteRequest = Schema.Struct({
  blockId: NonEmpty,
  /** Defaults to the question that produced the block. */
  question: Schema.optionalKey(NonEmpty.check(Schema.isMaxLength(1_000))),
});
export type CreateFavoriteRequest = typeof CreateFavoriteRequest.Type;

// --- AI knowledge (what the AI learned about this hospital) --------------------

/**
 * - example: a question with the SQL that answered it, reused for similar questions.
 * - note: a fact about the schema, local codes or how staff want answers.
 */
export const KnowledgeKind = Schema.Literals(["example", "note"]);
export type KnowledgeKind = typeof KnowledgeKind.Type;

/**
 * - auto: saved by the server after an answer was shown (not checked by anyone).
 * - feedback: an answer a staff member marked as correct (👍), or their correction (👎).
 * - ai: a note the AI saved while working.
 * - staff: written by staff on the knowledge page.
 */
export const KnowledgeSource = Schema.Literals(["auto", "feedback", "ai", "staff"]);
export type KnowledgeSource = typeof KnowledgeSource.Type;

export const Knowledge = Schema.Struct({
  id: Schema.String,
  kind: KnowledgeKind,
  source: KnowledgeSource,
  /** The question (example) or the note. */
  text: Schema.String,
  /** Example only: the SELECT that answered the question. */
  sql: Schema.NullOr(Schema.String),
  /** Example only: how it was shown (table, bar, ...). */
  renderType: Schema.NullOr(RenderType),
  /** Example only: the title of the result. */
  title: Schema.NullOr(Schema.String),
  /** Checked by a person (👍, written or approved by staff). Verified items are preferred. */
  verified: Schema.Boolean,
  /** Inactive items are never given to the AI (👎, or turned off on the knowledge page). */
  active: Schema.Boolean,
  createdBy: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  /** How many questions it was given to the AI for. */
  uses: Schema.Number,
  lastUsedAt: Schema.NullOr(Schema.String),
});
export type Knowledge = typeof Knowledge.Type;

/** POST /knowledge: a note written by staff. */
export const CreateKnowledgeRequest = Schema.Struct({
  text: NonEmpty.check(Schema.isMaxLength(1_000)),
});
export type CreateKnowledgeRequest = typeof CreateKnowledgeRequest.Type;

/** PATCH /knowledge/:id (admin). */
export const UpdateKnowledgeRequest = Schema.Struct({
  text: Schema.optionalKey(NonEmpty.check(Schema.isMaxLength(1_000))),
  verified: Schema.optionalKey(Schema.Boolean),
  active: Schema.optionalKey(Schema.Boolean),
});
export type UpdateKnowledgeRequest = typeof UpdateKnowledgeRequest.Type;

/** POST /knowledge/feedback: 👍 or 👎 on a result, or on a text answer by run. */
export const KnowledgeFeedbackRequest = Schema.Struct({
  /** The result block (table/chart/number) being rated. Use this or `runId`. */
  blockId: Schema.optionalKey(NonEmpty),
  /** The whole answer, for text-only answers with no render block. Use this or `blockId`. */
  runId: Schema.optionalKey(NonEmpty),
  rating: Schema.Literals(["up", "down"]),
  /** For 👎: what was wrong, saved as a note for the AI. */
  comment: Schema.optionalKey(NonEmpty.check(Schema.isMaxLength(1_000))),
});
export type KnowledgeFeedbackRequest = typeof KnowledgeFeedbackRequest.Type;

// --- Agent stream (Server-Sent Events) ---------------------------------------

/** First event: which run, conversation and AI model this is. */
export const RunStarted = Schema.TaggedStruct("run_started", {
  runId: Schema.String,
  conversationId: Schema.String,
  provider: Schema.String,
  model: Schema.String,
});

/** A piece of the AI's answer text. */
export const TextDelta = Schema.TaggedStruct("text_delta", { text: Schema.String });

/** A piece of the AI's thinking, shown live while it works out its next step. */
export const ReasoningDelta = Schema.TaggedStruct("reasoning_delta", { text: Schema.String });

/**
 * The AI is still writing a tool call: `delta` is the next piece of its JSON
 * arguments (e.g. the SQL as it is typed). `draftId` links it to the later
 * `tool_started`.
 */
export const ToolInputDelta = Schema.TaggedStruct("tool_input_delta", {
  draftId: Schema.String,
  name: Schema.String,
  delta: Schema.String,
});

/** The AI called a tool (one step in "Yang dicek AI"). */
export const ToolStarted = Schema.TaggedStruct("tool_started", {
  callId: Schema.String,
  name: Schema.String,
  args: Schema.Unknown,
  /** The `tool_input_delta` draft this call replaces, if it was streamed. */
  draftId: Schema.optionalKey(Schema.String),
});

/** Tool finished. `result` is the full (unmasked) result, for the UI only. */
export const ToolFinished = Schema.TaggedStruct("tool_finished", {
  callId: Schema.String,
  name: Schema.String,
  ok: Schema.Boolean,
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
  durationMs: Schema.Number,
});

/** A table, chart, number or list to show in the chat (from the `tampilkan` tool). */
export const RenderEvent = Schema.TaggedStruct("render", {
  callId: Schema.String,
  block: RenderBlock,
});

/** A patient document was made (from the `dokumenPasien` tool). */
export const DocumentEvent = Schema.TaggedStruct("document", { callId: Schema.String, document: DocumentInfo });

/** A form draft was made or changed (buatDraftResume / isiDraft); replaces an earlier draft with the same id. */
export const DraftEvent = Schema.TaggedStruct("draft", { callId: Schema.String, draft: FormDraft });

/** Radiology images to show in the chat (from the `gambarRadiologi` tool). */
export const RadiologyEvent = Schema.TaggedStruct("radiology", { callId: Schema.String, gallery: RadiologyGallery });

/** Digital patient files to show in the chat (from the `berkasDigital` tool). */
export const BerkasEvent = Schema.TaggedStruct("berkas", { callId: Schema.String, berkas: BerkasDigital });

/** Last event of a successful run. */
export const RunDone = Schema.TaggedStruct("done", {
  runId: Schema.String,
  text: Schema.String,
  stopReason: Schema.String,
  steps: Schema.Number,
});

/** Last event of a failed run. */
export const RunError = Schema.TaggedStruct("error", { message: Schema.String });

export const AgentEvent = Schema.Union([
  RunStarted,
  TextDelta,
  ReasoningDelta,
  ToolInputDelta,
  ToolStarted,
  ToolFinished,
  RenderEvent,
  DocumentEvent,
  DraftEvent,
  RadiologyEvent,
  BerkasEvent,
  RunDone,
  RunError,
]);
export type AgentEvent = typeof AgentEvent.Type;

// --- Errors -------------------------------------------------------------------

/** JSON body of every 4xx/5xx response. */
export const ApiErrorBody = Schema.Struct({ error: Schema.String });
export type ApiErrorBody = typeof ApiErrorBody.Type;

// --- Fixes (proposal -> approval -> apply -> rollback) ------------------------

export const FixStatus = Schema.Literals(["pending", "approved", "applied", "failed", "rejected", "rolled_back"]);
export type FixStatus = typeof FixStatus.Type;

const DataRow = Schema.Record(Schema.String, Schema.Unknown);
const FixParam = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);

export const Fix = Schema.Struct({
  id: Schema.String,
  runId: Schema.NullOr(Schema.String),
  toolCallId: Schema.NullOr(Schema.String),
  ticketId: Schema.NullOr(Schema.String),
  title: Schema.String,
  reason: Schema.String,
  kind: Schema.Literals(["update", "insert", "delete"]),
  table: Schema.String,
  sqlOriginal: Schema.String,
  params: Schema.Array(FixParam),
  /** The exact statement that runs on approval. */
  sql: Schema.String,
  /** "akan mengubah N baris". */
  expectedRows: Schema.Number,
  primaryKey: Schema.Array(Schema.String),
  /** Rows that will change (UPDATE/DELETE), read when the fix was proposed. */
  preview: Schema.Array(DataRow),
  status: FixStatus,
  /** Rows just before the fix ran; the rollback source. */
  before: Schema.NullOr(Schema.Array(DataRow)),
  /** Rows as the fix left them. */
  after: Schema.NullOr(Schema.Array(DataRow)),
  error: Schema.NullOr(Schema.String),
  createdBy: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Fix = typeof Fix.Type;

export const FixEvent = Schema.Struct({
  id: Schema.Number,
  action: Schema.Literals([
    "proposed",
    "approved",
    "rejected",
    "applied",
    "apply_failed",
    "rollback_requested",
    "rolled_back",
    "rollback_failed",
  ]),
  actor: Schema.String,
  detail: Schema.NullOr(Schema.String),
  at: Schema.String,
});

/** GET /fixes/:id */
export const FixDetail = Schema.Struct({ fix: Fix, events: Schema.Array(FixEvent) });
export type FixDetail = typeof FixDetail.Type;

/** Body of reject. Approve and rollback have no body; who did it comes from the login session. */
export const RejectFixRequest = Schema.Struct({
  reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type RejectFixRequest = typeof RejectFixRequest.Type;

/** POST /fixes: an IT person proposes (or edits) a fix by hand. Same checks as the AI tool. */
export const CreateFixRequest = Schema.Struct({
  title: NonEmpty.check(Schema.isMaxLength(200)),
  reason: NonEmpty.check(Schema.isMaxLength(2_000)),
  sql: NonEmpty.check(Schema.isMaxLength(5_000)),
  params: Schema.optionalKey(Schema.Array(FixParam)),
  ticketId: Schema.optionalKey(Schema.String),
  /** Set when this edits an AI proposal: the old one is rejected and replaced. */
  replaces: Schema.optionalKey(Schema.String),
});
export type CreateFixRequest = typeof CreateFixRequest.Type;

// --- Login and users -------------------------------------------------------------

export const Role = Schema.Literals(["admin", "staff"]);
export type Role = typeof Role.Type;

/**
 * A logged-in SIMRS user. The account itself lives in Khanza; Simha keeps only
 * a local row for sessions and the audit log. `permissions` is a snapshot of
 * the Khanza rights read at login (or at POST /api/auth/refresh).
 */
export const User = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  displayName: Schema.String,
  /** admin: a Khanza Admin Utama (all rights, AI settings). staff: every other SIMRS user. */
  role: Role,
  active: Schema.Boolean,
  createdAt: Schema.String,
  /** True when the username matches a row in Khanza's `admin` table. */
  khanzaAdmin: Schema.Boolean,
  permissions: Permissions,
  /** The granted Khanza right columns. Empty for an Admin Utama, who has every right. */
  rights: Schema.Array(Schema.String),
  /** Names linked to the SIMRS username; null when that master table has no matching row. */
  employeeName: Schema.NullOr(Schema.String),
  doctorName: Schema.NullOr(Schema.String),
  staffName: Schema.NullOr(Schema.String),
});
export type User = typeof User.Type;

/** GET /api/auth/state: who is logged in, or null. */
export const AuthState = Schema.Struct({ user: Schema.NullOr(User) });
export type AuthState = typeof AuthState.Type;

/** POST /api/auth/login: the same username and password as the Khanza desktop app. */
export const LoginRequest = Schema.Struct({
  username: NonEmpty.check(Schema.isMaxLength(64)),
  password: NonEmpty.check(Schema.isMaxLength(200)),
});
export type LoginRequest = typeof LoginRequest.Type;


// --- Dashboard ------------------------------------------------------------------------

/** GET /api/stats: the stat row. Khanza numbers are null when the database could not be read. */
export const Stats = Schema.Struct({
  registrasiHariIni: Schema.NullOr(Schema.Number),
  pasienRawatInap: Schema.NullOr(Schema.Number),
  perbaikanMenunggu: Schema.Number,
  khanzaError: Schema.NullOr(Schema.String),
});
export type Stats = typeof Stats.Type;

// --- Conversation history ---------------------------------------------------------------

/** One tool call of a past run ("Yang dicek AI"). */
export const ToolStep = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.String,
  input: Schema.Unknown,
  ok: Schema.Boolean,
  /** Full result, or null when it was too large to keep in the audit log. */
  output: Schema.Unknown,
  error: Schema.NullOr(Schema.String),
  durationMs: Schema.NullOr(Schema.Number),
  startedAt: Schema.String,
});
export type ToolStep = typeof ToolStep.Type;

export const RunTranscript = Schema.Struct({
  id: Schema.String,
  /** tanya or investigasi; older runs were migrated to investigasi. */
  mode: AgentMode,
  question: Schema.String,
  askedBy: Schema.NullOr(Schema.String),
  provider: Schema.String,
  model: Schema.String,
  status: Schema.String,
  finalText: Schema.NullOr(Schema.String),
  /** end_turn, tool_use, max_steps or time_budget; null for runs without a stop reason. */
  stopReason: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  steps: Schema.Array(ToolStep),
  blocks: Schema.Array(RenderBlock),
  documents: Schema.Array(DocumentInfo),
  /** Drafts made in this run, in their latest state. */
  drafts: Schema.Array(FormDraft),
  /** Radiology images shown in this run. */
  radiology: Schema.Array(RadiologyGallery),
  /** Digital patient files shown in this run. */
  berkas: Schema.Array(BerkasDigital),
  fixIds: Schema.Array(Schema.String),
});
export type RunTranscript = typeof RunTranscript.Type;

/** GET /api/conversations/:id. */
export const Transcript = Schema.Struct({
  conversationId: Schema.NullOr(Schema.String),
  runs: Schema.Array(RunTranscript),
});
export type Transcript = typeof Transcript.Type;

/** GET /api/conversations: recent Tanya Data threads. */
export const ConversationSummary = Schema.Struct({
  id: Schema.String,
  firstQuestion: Schema.String,
  askedBy: Schema.NullOr(Schema.String),
  runCount: Schema.Number,
  lastAt: Schema.String,
  /** Kept at the top of the list. */
  pinned: Schema.Boolean,
  /** Hidden under "Arsip" until unarchived. */
  archived: Schema.Boolean,
});
export type ConversationSummary = typeof ConversationSummary.Type;

/** PATCH /api/conversations/:id. Omitted fields keep their value. */
export const UpdateConversationRequest = Schema.Struct({
  pinned: Schema.optionalKey(Schema.Boolean),
  archived: Schema.optionalKey(Schema.Boolean),
});
export type UpdateConversationRequest = typeof UpdateConversationRequest.Type;

// --- AI provider settings ---------------------------------------------------------------------

/** GET /api/settings/llm. The API key itself is never sent back. */
export const LlmSettingsView = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  baseUrl: Schema.NullOr(Schema.String),
  maskPii: Schema.Boolean,
  apiKeySet: Schema.Boolean,
  /** "env": from .env; "app": changed on the settings page (overrides .env). */
  source: Schema.Literals(["env", "app"]),
  updatedBy: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
});
export type LlmSettingsView = typeof LlmSettingsView.Type;

/** PUT /api/settings/llm and POST /api/settings/llm/test. */
export const UpdateLlmSettingsRequest = Schema.Struct({
  provider: NonEmpty.check(Schema.isMaxLength(50)),
  model: Schema.String.check(Schema.isMaxLength(200)),
  baseUrl: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  /** Absent: keep the current key. Empty string: remove it. */
  apiKey: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
  maskPii: Schema.Boolean,
});
export type UpdateLlmSettingsRequest = typeof UpdateLlmSettingsRequest.Type;

export const LlmTestResult = Schema.Struct({
  ok: Schema.Boolean,
  reply: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  durationMs: Schema.Number,
});
export type LlmTestResult = typeof LlmTestResult.Type;

// --- Audit log ------------------------------------------------------------------------------

export const AuditKind = Schema.Literals(["runs", "tools", "queries", "fixes", "events"]);
export type AuditKind = typeof AuditKind.Type;

/** GET /api/audit?kind=&q=&from=&to=&limit=&offset= */
export const AuditPage = Schema.Struct({
  kind: AuditKind,
  rows: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  total: Schema.Number,
});
export type AuditPage = typeof AuditPage.Type;

// --- AI usage & cost -------------------------------------------------------------------------

/** USD per 1 million tokens for one provider/model. */
export const ModelPrice = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  /** Uncached input tokens. */
  input: Schema.Number,
  output: Schema.Number,
  /** Input tokens read from the prompt cache (cheaper, or free). */
  cachedInput: Schema.Number,
  /** Input tokens written into the prompt cache (Anthropic charges extra). */
  cacheWrite: Schema.Number,
});
export type ModelPrice = typeof ModelPrice.Type;

/**
 * Prices saved in the app, plus the USD→IDR rate. `usdIdr: 0` means USD only.
 * PUT /api/usage/prices (admin) upserts these; saved rows for other models stay.
 */
export const PriceBook = Schema.Struct({ usdIdr: Schema.Number, models: Schema.Array(ModelPrice) });
export type PriceBook = typeof PriceBook.Type;

export const UsageTotals = Schema.Struct({
  runs: Schema.Number,
  /** Finished without an error. Interrupted runs are not counted as ok. */
  ok: Schema.Number,
  /** error + interrupted. */
  failed: Schema.Number,
  steps: Schema.Number,
  inputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  outputTokens: Schema.Number,
  /** cached_input_tokens / input_tokens (0–1); null when no input tokens were recorded. */
  cacheHitRate: Schema.NullOr(Schema.Number),
  /** Summed duration of finished runs, in milliseconds. */
  durationMs: Schema.Number,
  /** At list prices from the saved book or the built-in table. */
  costUsd: Schema.Number,
  /** Runs whose model has no price (their cost is not in costUsd). */
  unpricedRuns: Schema.Number,
  /** Runs without token data: made before usage recording, or by a provider that did not report it. */
  noTokenRuns: Schema.Number,
  /** Distinct SIMRS users who asked; null accounts are not counted. */
  users: Schema.Number,
});
export type UsageTotals = typeof UsageTotals.Type;

/** One calendar day (server local time); days without runs are included with zeros. */
export const UsageDay = Schema.Struct({
  day: Schema.String,
  runs: Schema.Number,
  failed: Schema.Number,
  inputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  outputTokens: Schema.Number,
  costUsd: Schema.Number,
});
export type UsageDay = typeof UsageDay.Type;

export const UsageModel = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  runs: Schema.Number,
  failed: Schema.Number,
  steps: Schema.Number,
  inputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheHitRate: Schema.NullOr(Schema.Number),
  costUsd: Schema.Number,
  unpricedRuns: Schema.Number,
  noTokenRuns: Schema.Number,
});
export type UsageModel = typeof UsageModel.Type;

export const UsageUser = Schema.Struct({
  user: Schema.NullOr(Schema.String),
  runs: Schema.Number,
  failed: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  costUsd: Schema.Number,
  unpricedRuns: Schema.Number,
});
export type UsageUser = typeof UsageUser.Type;

/** One of the slowest questions of the period, for "why is it slow?". */
export const UsageQuestion = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  askedBy: Schema.NullOr(Schema.String),
  provider: Schema.String,
  model: Schema.String,
  status: Schema.String,
  steps: Schema.Number,
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  costUsd: Schema.NullOr(Schema.Number),
  durationMs: Schema.Number,
  startedAt: Schema.String,
});
export type UsageQuestion = typeof UsageQuestion.Type;

/** Why runs failed, per provider and model, with the most recent error. */
export const UsageFailure = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  errors: Schema.Number,
  interrupted: Schema.Number,
  lastError: Schema.NullOr(Schema.String),
  lastAt: Schema.NullOr(Schema.String),
});
export type UsageFailure = typeof UsageFailure.Type;

/** GET /api/usage?from=&to= (admin). Dates are inclusive calendar days; the default range is 30 days. */
export const UsageReport = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  totals: UsageTotals,
  days: Schema.Array(UsageDay),
  models: Schema.Array(UsageModel),
  users: Schema.Array(UsageUser),
  slowest: Schema.Array(UsageQuestion),
  failures: Schema.Array(UsageFailure),
  /** The prices applied to this report (built-ins plus the saved book). */
  prices: PriceBook,
});
export type UsageReport = typeof UsageReport.Type;

