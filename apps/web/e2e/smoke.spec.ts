/**
 * The main flows through the real UI, in order (one shared server):
 * first-run setup, a ticket from complaint to approved fix and rollback,
 * Tanya Data with a chart and a favorite, settings and audit log, a narrow
 * window, and logout.
 */
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const ADMIN = { name: "Budi Santika", username: "it-budi", password: "rahasia-uji-123" };
let page: Page;

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

  await expect(page).toHaveURL(/\/tiket$/);
  await expect(page.getByText("Khanza DB terhubung · read-only")).toBeVisible();
  await expect(page.getByTestId("user-menu")).toContainText(ADMIN.name);
});

test("a ticket is investigated, the fix approved and rolled back", async () => {
  await page.getByRole("button", { name: "Tiket baru" }).click();
  await page.getByLabel("Nama perawat").fill("Ns. Ayu");
  await page.getByLabel("Unit / bangsal").fill("Mawar");
  await page.getByLabel("Keluhan").fill("Pasien RM 000002 tidak bisa dipindah ke kamar MAW-03");
  await page.getByRole("button", { name: "Buat & selidiki" }).click();

  const steps = page.getByTestId("step");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(1)).toHaveAttribute("data-mark", "warn");
  await expect(page.getByText("Khanza menolak pindah kamar baru")).toHaveCount(2); // diagnosis + AI summary
  await expect(page.getByTestId("patient-card")).toContainText("SITI AMINAH");
  await expect(page.getByTestId("patient-card")).toContainText("dr. Andi Fiktif");

  const fix = page.getByTestId("fix-card");
  await expect(fix).toHaveAttribute("data-status", "pending");
  await expect(fix).toContainText("akan mengubah 1 baris");
  await expect(page.getByText("Perbaikan menunggu persetujuan").locator("..")).toContainText("1");

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
  await page.getByRole("link", { name: "Tanya Data" }).click();
  await page.getByLabel("Pertanyaan").fill("Jumlah kunjungan per poli");
  await page.getByLabel("Pertanyaan").press("Enter");

  const block = page.getByTestId("render-block");
  await expect(block).toContainText("Kunjungan per poli");
  await expect(block).toContainText("Asumsi: semua tanggal di data uji");
  await expect(block.getByRole("img", { name: "Kunjungan per poli" }).locator("svg")).toBeVisible();
  await block.getByRole("button", { name: "Query yang dipakai" }).click();
  await expect(block).toContainText("FROM reg_periksa r JOIN poliklinik p");
  await expect(block).toContainText("LIMIT 501");

  await block.getByRole("button", { name: "Simpan ke favorit" }).click();
  await expect(block.getByRole("button", { name: "Tersimpan" })).toBeDisabled();

  await page.getByRole("button", { name: "Percakapan baru" }).click();
  await page.getByTestId("favorites").getByRole("button", { name: "Jalankan" }).click();
  await expect(page.getByText("★ Jumlah kunjungan per poli")).toBeVisible();
  await expect(page.getByTestId("render-block")).toHaveCount(1);
});

test("a number answer is shown as a stat card", async () => {
  await page.getByLabel("Pertanyaan").fill("Berapa pasien yang daftar hari ini?");
  await page.getByLabel("Pertanyaan").press("Enter");
  const stat = page.getByTestId("render-block").filter({ hasText: "Pasien daftar hari ini" });
  await expect(stat).toContainText("1");
  await expect(stat).toContainText("pasien");
});

test("settings test the AI connection and show the audit log", async () => {
  await page.getByRole("link", { name: "Pengaturan" }).click();
  await page.getByRole("button", { name: "Tes koneksi" }).click();
  await expect(page.getByText(/Terhubung \(\d+ ms\)/)).toBeVisible();

  await page.getByRole("tab", { name: "Audit log" }).click();
  await expect(page.getByRole("cell", { name: "Jumlah kunjungan per poli" }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Perbaikan" }).click();
  await expect(page.getByRole("cell", { name: "rolled_back" }).first()).toBeVisible();
});

test("works in a narrow window without sideways scrolling", async () => {
  await page.setViewportSize({ width: 400, height: 800 });
  await page.getByRole("link", { name: "Tiket" }).click();
  await page.getByRole("button", { name: /Ns. Ayu/ }).click();
  await expect(page.getByTestId("fix-card")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("logout returns to the login page", async () => {
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Keluar" }).click();
  await expect(page.getByRole("heading", { name: "Masuk" })).toBeVisible();
  await page.goto("/tanya");
  await expect(page.getByRole("heading", { name: "Masuk" })).toBeVisible();
});
