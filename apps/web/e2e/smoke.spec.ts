/**
 * The main flows through the real UI, in order (one shared server):
 * first-run setup, a complaint from investigation to approved fix and
 * rollback, Tanya Data with a chart and a favorite, settings and audit log, a
 * narrow window, and logout.
 */
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const ADMIN = { name: "Budi Santika", username: "it-budi", password: "rahasia-uji-123" };
let page: Page;

/**
 * The card panel starts closed (new chat, reload, app start). When a thread
 * already has cards, the small card button reopens it.
 */
const openClosedCardPanel = async () => {
  const button = page.getByRole("button", { name: "Buka panel kartu" });
  await expect(button).toBeVisible();
  await button.click();
};

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

test("first run asks for an admin account and logs in", async () => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Buat akun admin" })).toBeVisible();
  await page.getByLabel("Nama lengkap").fill(ADMIN.name);
  await page.getByRole("textbox", { name: /^Username/ }).fill(ADMIN.username);
  await page.getByRole("textbox", { name: /^Password/ }).fill(ADMIN.password);
  await page.getByLabel("Ulangi password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Buat akun dan masuk" }).click();

  await expect(page).toHaveURL(/\/tanya$/);
  await expect(page.getByRole("heading", { name: "Mau cek data apa hari ini?" })).toBeVisible();
  await expect(page.getByText("Khanza DB terhubung · read-only")).toBeVisible();
  await expect(page.getByTestId("user-menu")).toContainText(ADMIN.name);
});

test("the sidebar collapses to an icon rail and back", async () => {
  const sidebar = page.getByRole("complementary", { name: "Sidebar" }).first();
  await page.getByRole("button", { name: "Tutup sidebar" }).click();
  await expect(page.getByRole("button", { name: "Buka sidebar" })).toBeVisible();
  await expect(sidebar.getByText("Percakapan", { exact: true })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+S");
  await expect(sidebar.getByRole("button", { name: "Percakapan baru" })).toBeVisible();
});

test("a complaint is investigated, the fix approved and rolled back", async () => {
  await page.getByRole("button", { name: "Percakapan baru" }).first().click();
  await page.getByRole("button", { name: "Investigasi" }).click();
  await page.getByLabel("Pertanyaan").fill("Pasien RM 000002 tidak bisa dipindah ke kamar MAW-03");
  await page.getByLabel("Pertanyaan").press("Enter");

  const steps = page.getByTestId("step");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(1)).toHaveAttribute("data-mark", "warn");
  await expect(page.getByText("Khanza menolak pindah kamar baru")).toHaveCount(1);

  const turn = page.getByTestId("tanya-turn").last();
  await turn.getByRole("button", { name: "Kartu pasien" }).click();
  const patient = page.getByRole("dialog").last().getByTestId("patient-card");
  await expect(patient).toContainText("SITI AMINAH");
  await expect(patient).toContainText("dr. Andi Fiktif");
  await page.keyboard.press("Escape");

  const fix = page.getByTestId("fix-card");
  await expect(fix).toHaveAttribute("data-status", "pending");
  await expect(fix).toContainText("akan mengubah 1 baris");

  await fix.getByRole("button", { name: "Setujui" }).click();
  await page.getByTestId("confirm-approve").click();
  await expect(fix).toHaveAttribute("data-status", "applied");
  await expect(fix).toContainText("it-budi menyetujui");

  await fix.getByRole("button", { name: "Rollback" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Ya, rollback" }).click();
  await expect(fix).toHaveAttribute("data-status", "rolled_back");

  // After a reload the investigation is rebuilt from the audit DB.
  await page.reload();
  await expect(page.getByTestId("step")).toHaveCount(3);
  await expect(page.getByTestId("fix-card")).toHaveAttribute("data-status", "rolled_back");
});

test("Tanya Data shows a chart with its SQL and saves a favorite", async () => {
  await page.getByRole("button", { name: "Percakapan baru" }).first().click();
  await page.getByLabel("Pertanyaan").fill("Jumlah kunjungan per poli");
  await page.getByLabel("Pertanyaan").press("Enter");

  const block = page.getByTestId("render-block");
  await expect(block).toContainText("Kunjungan per poli");
  await expect(block).toContainText("Asumsi: semua tanggal di data uji");
  await expect(block.getByRole("img", { name: "Kunjungan per poli" }).locator("svg")).toBeVisible();
  await block.getByRole("button", { name: "Query yang dipakai" }).click();
  await expect(block).toContainText("FROM reg_periksa r JOIN poliklinik p");
  await expect(block).toContainText("LIMIT 501");

  await block.getByRole("button", { name: "Jawaban ini benar" }).click();
  await expect(block.getByText(/Terima kasih/)).toBeVisible();

  await block.getByRole("button", { name: "Simpan ke favorit" }).click();
  await expect(block.getByRole("button", { name: "Tersimpan" })).toBeDisabled();

  // The thread is listed in the sidebar.
  await expect(page.getByTestId("conversations").getByRole("link", { name: "Jumlah kunjungan per poli" })).toBeVisible();

  await page.getByRole("button", { name: "Percakapan baru" }).first().click();
  await page.getByTestId("favorites").getByRole("button", { name: "Kunjungan per poli", exact: true }).click();
  await expect(page.getByText("★ Jumlah kunjungan per poli")).toBeVisible();
  await openClosedCardPanel();
  await expect(page.getByTestId("render-block")).toHaveCount(1);
});

test("a thread can be pinned, archived and removed from the sidebar", async () => {
  const label = "Jumlah kunjungan per poli";
  const item = () => page.getByTestId("conversations").locator("li").filter({ hasText: label });
  await expect(item()).toHaveCount(1);

  await item().hover();
  await item().getByRole("button", { name: /^Aksi percakapan/ }).click();
  await page.getByRole("menuitem", { name: "Pin percakapan" }).click();
  await expect(page.getByTestId("conversations").locator("li").first()).toContainText(label);

  await item().hover();
  await item().getByRole("button", { name: /^Aksi percakapan/ }).click();
  await page.getByRole("menuitem", { name: "Arsipkan" }).click();
  await expect(page.getByTestId("conversations").getByText(label)).toHaveCount(0);
  await page.getByRole("button", { name: /^Arsip/ }).click();
  const archived = page.getByTestId("archived-conversations").locator("li").filter({ hasText: label });
  await expect(archived).toHaveCount(1);

  await archived.hover();
  await archived.getByRole("button", { name: /^Aksi percakapan/ }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("menuitem", { name: "Hapus percakapan" }).click();
  await expect(page.getByTestId("conversations").getByText(label)).toHaveCount(0);
  await expect(page.getByTestId("archived-conversations")).toHaveCount(0);
});

test("the knowledge page shows what the AI learned and accepts a note", async () => {
  await page.getByRole("link", { name: /Pengetahuan AI/ }).click();
  await expect(page.getByRole("heading", { name: "Pengetahuan AI" })).toBeVisible();
  // The chart result was saved automatically and verified with the thumbs-up.
  await expect(page.getByText("Terverifikasi").first()).toBeVisible();
  await page.getByLabel("Aturan atau fakta umum").fill("Kode uji: poli gigi memakai U0010.");
  await page.getByRole("button", { name: "Simpan catatan" }).click();
  await expect(page.getByText("Kode uji: poli gigi memakai U0010.")).toBeVisible();
  await page.goto("/tanya");
});

test("a text-only answer also takes feedback", async () => {
  await page.getByRole("button", { name: "Percakapan baru" }).first().click();
  await page.getByLabel("Pertanyaan").fill("Halo, apa kabar?");
  await page.getByLabel("Pertanyaan").press("Enter");
  const turn = page.getByTestId("tanya-turn").last();
  const up = turn.getByRole("button", { name: "Jawaban ini benar" });
  await expect(up).toBeVisible();
  await up.click();
  await expect(turn.getByText("Tersimpan")).toBeVisible();
});

test("a number answer is shown as a stat card", async () => {
  await page.getByLabel("Pertanyaan").fill("Berapa pasien yang daftar hari ini?");
  await page.getByLabel("Pertanyaan").press("Enter");
  const stat = page.getByTestId("render-block").filter({ hasText: "Pasien daftar hari ini" });
  await expect(stat).toContainText("1");
  await expect(stat).toContainText("pasien");
});

test("the agent makes a patient history document that can be printed", async () => {
  await page.getByLabel("Pertanyaan").fill("Buatkan riwayat pasien RM 000002");
  await page.getByLabel("Pertanyaan").press("Enter");
  const card = page.getByTestId("document-card");
  await expect(card).toContainText("Riwayat pasien");
  await expect(card).toContainText("RM 000002 · SITI AMINAH");
  const doc = card.frameLocator("iframe");
  await expect(doc.getByRole("heading", { name: "Riwayat Pasien" })).toBeVisible();
  await expect(doc.getByText("A09 – Diare dan gastroenteritis")).toBeVisible();
  await expect(card.getByRole("button", { name: "Cetak / PDF" })).toBeEnabled();
});

test("asking for a radiology result shows the reading and the images in one card", async () => {
  await page.getByLabel("Pertanyaan").fill("hasil baca radiologi 2026/10/21/000002");
  await page.getByLabel("Pertanyaan").press("Enter");
  const card = page.getByTestId("radiology-card");
  await expect(card).toContainText("RM 000002 · 2026/10/21/000002");
  const exam = card.getByTestId("radiology-exam");
  await expect(exam).toContainText("Thorax PA");
  await expect(exam).toContainText("drg. Sari Fiktif");
  await expect(exam).toContainText("Kesan: normal.");
  await exam.getByRole("button", { name: /Seri 2/ }).click();
  await expect(page.getByTestId("pacs-viewer")).toContainText("3 / 3");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Berikut hasil radiologi kunjungan")).toBeVisible();
  // No separate table for the same data.
  await expect(page.getByTestId("tanya-turn").last().getByTestId("render-block")).toHaveCount(0);

  // Kept when the conversation is reopened; the panel starts closed and reopens from the card button.
  await page.reload();
  await openClosedCardPanel();
  await expect(page.getByTestId("radiology-exam")).toContainText("Thorax PA");
});

test("digital files show image previews and a PDF link", async () => {
  await page.getByRole("button", { name: "Percakapan baru" }).first().click();
  await page.getByLabel("Pertanyaan").fill("Tampilkan berkas digital 2026/10/21/000002");
  await page.getByLabel("Pertanyaan").press("Enter");

  const card = page.getByTestId("berkas-card");
  await expect(card).toContainText("Berkas digital");
  await expect(card).toContainText("Hasil Laboratorium");
  await expect(card).toContainText("Foto Thorax");

  const photo = card.getByRole("img", { name: "Foto Thorax" });
  await expect(photo).toHaveJSProperty("complete", true);
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  const pdf = card.getByRole("link", { name: "Buka PDF" });
  await expect(pdf).toHaveAttribute("href", /\/api\/berkas\?noRawat=.*&kode=DL001/);

  // The thumbnail opens the full image and logs the view.
  await card.getByRole("button", { name: /Foto Thorax/ }).click();
  await expect(page.getByTestId("berkas-viewer").getByRole("img", { name: "Foto Thorax" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("berkas-viewer")).toHaveCount(0);
});

test("the patient card makes CPPT / SOAP without the AI", async () => {
  await page.getByRole("button", { name: "Percakapan baru" }).first().click();
  await page.getByLabel("Pertanyaan").fill("Riwayat pasien RM 000002");
  await page.getByLabel("Pertanyaan").press("Enter");

  const turn = page.getByTestId("tanya-turn").last();
  await turn.getByRole("button", { name: "Kartu pasien" }).click();
  const patient = page.getByRole("dialog").last().getByTestId("patient-card");
  await patient.getByRole("button", { name: "CPPT / SOAP" }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toContainText("2026/10/21/000002");
  const doc = dialog.frameLocator("iframe");
  await expect(doc.getByText("BAB cair 6x sejak kemarin, mual, lemas.")).toBeVisible();
  await expect(doc.getByText("Ns. Rina Fiktif")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

test("the patient card shows radiology images from PACS", async () => {
  await page.getByRole("button", { name: "Percakapan baru" }).first().click();
  await page.getByLabel("Pertanyaan").fill("Radiologi pasien RM 000002");
  await page.getByLabel("Pertanyaan").press("Enter");

  const turn = page.getByTestId("tanya-turn").last();
  await turn.getByRole("button", { name: "Kartu pasien" }).click();
  const patient = page.getByRole("dialog").last().getByTestId("patient-card");
  await patient.getByRole("button", { name: "Radiologi" }).click();
  const study = page.getByTestId("pacs-study");
  await expect(study).toContainText("THORAX PA");
  await expect(study).toContainText("2 seri · 3 gambar");
  const thumb = study.getByRole("img", { name: /Seri 1 PA/ });
  await expect(thumb).toHaveJSProperty("complete", true);
  expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await study.getByRole("button", { name: /Seri 2/ }).click();
  const viewer = page.getByTestId("pacs-viewer");
  await expect(viewer).toContainText("3 / 3");
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toContainText("1 / 3");
  await expect(viewer.getByRole("link", { name: /Unduh DICOM/ })).toHaveAttribute("href", /\/api\/pacs\/instances\/.+\/file$/);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(study).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

test("settings test the AI connection and show the audit log", async () => {
  await page.getByTestId("user-menu").first().click();
  await page.getByRole("menuitem", { name: /Pengaturan/ }).click();
  await page.getByRole("button", { name: "Tes koneksi" }).click();
  await expect(page.getByText(/Terhubung \(\d+ ms\)/)).toBeVisible();

  await page.getByRole("tab", { name: "Audit log" }).click();
  await expect(page.getByRole("cell", { name: "Jumlah kunjungan per poli" }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Perbaikan" }).click();
  await expect(page.getByRole("cell", { name: "rolled_back" }).first()).toBeVisible();
});

test("works in a narrow window without sideways scrolling", async () => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.getByRole("button", { name: "Buka menu" }).click();
  await page.getByRole("button", { name: "Tutup menu" }).click();
  await page.getByRole("button", { name: "Percakapan baru" }).first().click();
  await page.getByRole("button", { name: "Investigasi" }).click();
  await page.getByLabel("Pertanyaan").fill("Pasien RM 000002 tidak bisa dipindah ke kamar MAW-03");
  await page.getByLabel("Pertanyaan").press("Enter");
  await expect(page.getByTestId("fix-card")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("the AI drafts a resume medis that the user edits, and the draft is kept", async () => {
  await page.getByRole("button", { name: "Percakapan baru" }).first().click();
  await page.getByLabel("Pertanyaan").fill("Buat resume untuk 2026/10/21/000002");
  await page.getByLabel("Pertanyaan").press("Enter");

  const card = page.getByTestId("draft-card");
  await expect(card).toContainText("Resume medis rawat inap");
  await expect(card).toContainText("RM 000002 · SITI AMINAH · 2026/10/21/000002");
  await expect(card).toContainText("wajib belum: Jalannya penyakit selama perawatan");
  await expect(card.locator('[data-field="keluhan_utama"] textarea')).toHaveValue("BAB cair 6x sejak kemarin, mual, lemas.");
  await expect(card.locator('[data-field="keluhan_utama"]')).toContainText("dari data Khanza");
  await expect(page.getByRole("listitem").filter({ hasText: "Jalannya penyakit (wajib)" })).toBeVisible();
  // Outside the desktop app there is no Khanza to fill.
  await expect(card).toContainText("aplikasi desktop");

  // The user edits a field in the card (saved on blur).
  const allergy = card.locator('[data-field="alergi"] input');
  await allergy.fill("Udang");
  const saved = page.waitForResponse((r) => r.url().includes("/api/drafts/") && r.request().method() === "PATCH");
  await allergy.press("Tab");
  expect((await saved).ok()).toBe(true);

  // Answers in the chat go into the same card.
  await page.getByLabel("Pertanyaan").fill("Jalannya penyakit: rehidrasi IV dua hari, diare berkurang. Pulang membaik, kontrol 28 Oktober jam 9.");
  await page.getByLabel("Pertanyaan").press("Enter");
  await expect(page.getByText("Sudah saya masukkan ke draf.")).toBeVisible();
  await expect(page.getByTestId("draft-card")).toHaveCount(1);
  await expect(card.locator('[data-field="jalannya_penyakit"] textarea')).toHaveValue("Rehidrasi IV dua hari, diare berkurang.");
  await expect(card.locator('[data-field="keadaan"] select')).toHaveValue("Membaik");
  await expect(card.locator('[data-field="jalannya_penyakit"]')).toContainText("dari jawaban di chat");
  await expect(card).not.toContainText("wajib belum");

  // Reopening the conversation shows the draft as it is now; open its card again.
  await page.reload();
  await openClosedCardPanel();
  await expect(page.getByTestId("draft-card")).toHaveCount(1);
  await expect(card.locator('[data-field="alergi"] input')).toHaveValue("Udang");
  await expect(card.locator('[data-field="kontrol"] input')).toHaveValue("2026-10-28T09:00");
});

test("logout returns to the login page", async () => {
  await page.getByTestId("user-menu").first().click();
  await page.getByRole("menuitem", { name: "Keluar" }).click();
  await expect(page.getByRole("heading", { name: "Masuk" })).toBeVisible();
  await page.goto("/tanya");
  await expect(page.getByRole("heading", { name: "Masuk" })).toBeVisible();
});
