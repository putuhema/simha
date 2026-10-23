```json meta
{
  "id": "kasir-billing",
  "title": "Kasir dan billing rawat jalan / rawat inap",
  "keywords": ["kasir", "billing", "nota", "tagihan", "pembayaran", "deposit", "piutang", "klaim"],
  "menus": ["A/Rawat Jalan", "A/Rawat Inap", "A/Deposit Pasien", "K/Deposit Pasien", "K/Piutang Pasien", "K/Rincian Piutang Pasien", "K/Bayar Piutang", "K/Pengembalian Deposit Pasien"],
  "forms": ["DlgKasirRalan", "DlgKamarInap", "DlgDeposit", "DlgLhtPiutang", "DlgBayarPiutang", "DlgPengembalianDepositPasien"]
}
```

# Kasir dan billing rawat jalan / rawat inap

Closing a visit's bill happens in two different screens: **A/Rawat Jalan** (`DlgKasirRalan`) for
outpatient, **A/Rawat Inap** (`DlgKamarInap`) for inpatient. Neither screen is the bill itself: the
actual billing dialog (`DlgBilingRalan`, `DlgBilingRanap`, in `src/keuangan`) opens from a right-click
menu inside them, so it has no menu button of its own and is not in `index.json`. The result is one
`nota_jalan` or `nota_inap` row per `no_rawat`, which is what "sudah billing" means everywhere else.

## Steps

### 1. Find the visit at the cashier
- **Menu:** `A/Rawat Jalan` (form `DlgKasirRalan`)
- **Who:** `kasir_ralan` **or** `billing_ralan` makes the button appear (`frmUtama` checks both); the billing menu inside the form needs `billing_ralan`.
- **Does:** searches visits by registration date range, filtered to `reg_periksa.status_lanjut = 'Ralan'` — an admitted patient does not appear here at all — and shows whether the visit already has a bill.
- **Tabel:** reads `reg_periksa`, `pasien`, `penjab`, `poliklinik`, `dokter`, `setting`.

### 2. Check the charges that feed the bill
- **Menu:** `A/Rawat Jalan`, plus the units that post charges: `A/Tindakan Ralan`, `A/Beri Obat/BHP`, `A/No. Resep`, `A/Periksa Lab PK`, `A/Periksa Radiologi`.
- **Who:** the cashier only reviews; entry rights belong to the units (`tindakan_ralan`, `beri_obat`, `resep_obat`, `periksa_lab`, `periksa_radiologi`).
- **Does:** the bill sums tindakan (doctor / paramedic / both), drugs, lab, radiology, operations, registration, plus `tambahan_biaya` and minus `pengurangan_biaya`.
- **Tabel:** reads `rawat_jl_dr`, `rawat_jl_pr`, `rawat_jl_drpr`, `detail_pemberian_obat`, `detail_periksa_lab`, `periksa_radiologi`, `operasi`, `tambahan_biaya`, `pengurangan_biaya`.

### 3. Open "Billing/Pembayaran Pasien"
- **Menu:** right-click menu inside `A/Rawat Jalan` → `Billing/Pembayaran Pasien` (dialog `DlgBilingRalan`; not in `index.json`)
- **Who:** `billing_ralan`.
- **Does:** three tabs — **Data Tagihan**, **Pembayaran**, **Status Permintaan**. Before it opens, an older unpaid bill (`piutang_pasien.status = 'Belum Lunas'`) triggers "Masih ada tunggakan pembayaran, apa mau bayar sekarang ?" and offers `K/Piutang Pasien` first. Saving writes the nota with number `YYYY/MM/DD/RJ0001` (last four digits from the highest number for that bill date) and stamps `nota_jalan` — that row is the "bill exists" marker.
- **Tabel:** writes `nota_jalan`, `billing`, `tampjurnal`; read side is every charge table above.

### 4. Take the payment, split it, or leave a receivable
- **Menu:** same dialog, tab `Pembayaran`
- **Who:** `kasir_ralan` for the cash entry, `billing_ralan` to change the bill.
- **Does:** one line per payer account (`akun_bayar`) with amount and PPN; whatever is not paid becomes piutang per `akun_piutang` with a due date (`tgltempo`).
- **Tabel:** writes `detail_nota_jalan`, `detail_piutang_pasien`; reads `akun_bayar`, `akun_piutang`.

### 5. Inpatient: room, stay, and the ranap bill
- **Menu:** `A/Rawat Inap` (form `DlgKamarInap`)
- **Who:** `kamar_inap` (or `billing_ranap` / `tindakan_ranap`) shows the screen; `BtnSimpan` needs `kamar_inap`; the billing menu needs `billing_ranap`.
- **Does:** the room row goes to `kamar_inap`; a room move closes the old row with `stts_pulang = 'Pindah Kamar'` and adds a new one; discharge sets `stts_pulang`. Right-click → `Billing/Pembayaran Pasien` opens `DlgBilingRanap`, same three tabs, nota number `YYYY/MM/DD/RI0001`.
- **Tabel:** writes `kamar_inap`; the billing dialog writes `nota_inap`, `detail_nota_inap`, `billing`, `tampjurnal` and reads the ranap charge tables below.

### 6. Deposit / uang muka
- **Menu:** `A/Deposit Pasien`, `I/Deposit Pasien` or `K/Deposit Pasien` (all form `DlgDeposit`)
- **Who:** `deposit_pasien`.
- **Does:** records money paid up front for a `no_rawat`. In the ranap bill it shows as **Deposit** and is deducted as uang muka. Refunds go through `K/Pengembalian Deposit Pasien` (`DlgPengembalianDepositPasien`).
- **Tabel:** writes `deposit`, `tagihan_sadewa`, `tampjurnal`; refund reads `pengembalian_deposit`.

### 7. Receivables (piutang)
- **Menu:** `K/Piutang Pasien` (form `DlgLhtPiutang`; `I/Piutang Pasien` is the same form)
- **Who:** `piutang_pasien`; `K/Rincian Piutang Pasien` needs `rincian_piutang_pasien`; `K/Bayar Piutang` needs `bayar_piutang`.
- **Does:** lists nota with an outstanding balance and reopens the bill for review. `K/Bayar Piutang` (`DlgBayarPiutang`) records installments (cicilan, diskon, tidak terbayar), lowers `detail_piutang_pasien.sisapiutang`, and sets `piutang_pasien.status = 'Lunas'` for the whole nota.
- **Tabel:** writes `bayar_piutang`, `tampjurnal`; reads `piutang_pasien`, `detail_piutang_pasien`, `reg_periksa`, `pasien`, `penjab`.

### 8. Check the day's billing
- **Menu:** `I/Pembayaran Ralan` (form `DlgPembayaranRalan`), `I/Pembayaran Ranap` (`DlgPembayaranRanap`), `I/Rekap Pembayaran Ralan`
- **Who:** `pembayaran_ralan`, `pembayaran_ranap`, `rekap_pembayaran_ralan`.
- **Does:** lists nota with paid and piutang amounts; read-only, writes only `temporary`. Use it to confirm a payment really landed before correcting anything in the bill.
- **Tabel:** reads `nota_jalan` / `nota_inap`, `billing`, `piutang_pasien`, `reg_periksa`; writes `temporary`.

## Where it usually goes wrong

- **Re-saving the nota deletes it first.** The billing dialog runs `delete from nota_jalan`, `detail_nota_jalan`, `piutang_pasien`, `detail_piutang_pasien` for that `no_rawat` and re-inserts them. A payment entered before the final save is rebuilt away; take the money after the bill is final, and re-check the Pembayaran tab after any re-save.
- **The deposit freezes into the nota.** Before the first save the dialog reads uang muka from `sum(deposit.besar_deposit)`; afterwards it reads `nota_inap.Uang_Muka`. A deposit added later does not lower the printed bill until the bill is saved again.
- **Wrong screen for an admitted patient.** Ralan billing refuses a visit that already has a `kamar_inap` row with "Pasien sudah masuk Kamar Inap. Gunakan billing Ranap..!!!". The ralan list only shows `status_lanjut = 'Ralan'`, so once a visit turns ranap it never comes back to the cashier screen, even after discharge — check `kamar_inap` before deciding which flow to use.
- **Looks like a missing feature, is a right or setting.** The form opens with `kasir_ralan` alone, but the Billing menu stays disabled without `billing_ralan`; from the cashier, `A/Rawat Inap` only appears for non-admin when `set_jam_minimal.kamar_inap_kasir_ralan = 'Yes'`. Auto-print on save and the ranap service charge come from `T/Set Billing` (`set_nota`, `set_service_ranap`), not from the bill screen.

## Tables touched

| Table | Step | Read/write |
|---|---|---|
| `reg_periksa` | 1, 2, 5, 7 | read |
| `pasien`, `penjab`, `poliklinik`, `dokter` | 1 | read |
| `rawat_jl_dr`, `rawat_jl_pr`, `rawat_jl_drpr` | 2 | read |
| `detail_pemberian_obat`, `detail_periksa_lab`, `periksa_radiologi`, `operasi` | 2, 5 | read |
| `rawat_inap_dr`, `rawat_inap_pr`, `rawat_inap_drpr` | 5 | read |
| `kamar_inap` | 3, 5 | 5 write; 3 read to block ralan billing |
| `kamar`, `bangsal` | 5 | read |
| `nota_jalan` | 3 | write |
| `detail_nota_jalan` | 4 | write (one row per payer account) |
| `nota_inap` | 5 | write (`Uang_Muka` holds uang muka after first save) |
| `detail_nota_inap` | 5 | write |
| `billing` | 3, 5 | write; item rows used by the kasir screens — exact columns perlu dicek di form |
| `piutang_pasien` | 3, 5, 7 | write (`status`) |
| `detail_piutang_pasien` | 3, 4, 5, 7 | write (`totalpiutang`, `sisapiutang`, `tgltempo`) |
| `deposit` | 6 | write |
| `pengembalian_deposit` | 6 | read |
| `bayar_piutang` | 7 | write |
| `tampjurnal` | 3, 5, 6, 7 | write; one row per account touched by the transaction |
| `akun_bayar`, `akun_piutang` | 3, 4, 6, 7 | read |
| `set_nota`, `set_service_ranap` | 3, 5 | read |
