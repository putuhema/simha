# Simha brand

## Name

**Simha** (read: *sim-ha*). Long form: **Simha — SIMRS Harness**.

Why this name:

- *siṃha* is Sanskrit for lion (Indonesian *singa*): guardian, vigilance, watching the ward. That is the promise of the safety model — read-only by default, writes need approval, every action is audited.
- The letters are **SIM**(RS) + **HA**(rness), so the name is the product, not a decoration.
- Two syllables, five letters, no spelling ambiguity for Indonesian speakers. It works as `@simha/*`, `simha.id`, `Simha.app` and a Windows shortcut.

Write it **Simha** in prose and UI. Use all-caps `SIMHA` only where the surrounding design already uses caps (an eyebrow label, a legal line); never as the main lockup next to SIMRS, where it reads like another government acronym.

## Tagline

- Full (Indonesian): **Asisten IT untuk SIMRS Khanza. Tidak ada yang berubah tanpa persetujuan.**
- Short descriptor: **Asisten SIMRS Khanza**

The name does not say what it does, so never introduce it alone on a new surface. Pair it with the short descriptor.

## Identifiers

| Thing | Value |
|---|---|
| npm scope | `@simha/*` |
| Desktop app id | `id.simha.app` |
| Windows installer | `Simha-Setup-<version>.exe` |
| macOS app | `Simha.app` |
| Data folder | `%APPDATA%\Simha`, `~/.simha/` |
| Domains | `simha.id` and `simha.co.id` were unregistered in Oct 2026; `simha.app` is taken |

## Look

The current mark is the ECG pulse in a rounded square: deep teal `#12302c`, mint `#5eead4`, paper `#fffdf8`. It says "hospital data and diagnostics", which is still true. A lion mark is an open design task, not a blocker.

## Legacy names

Before the rebrand: `SIMRS Harness`, `@simrs/*`, `id.simrs.harness`, `%APPDATA%\SIMRS Harness`, `~/.simrs-harness/`, test DB `simrs_harness_test`.

For compatibility:

- the desktop app moves the old data folder once on first start (settings, `.env`, audit DB, logs);
- the bridge writes both `~/.simha/…` and `~/.simrs-harness/…`, and the desktop reads both, so mixed old/new installs keep working;
- `SIMRS_DESKTOP_DATA_DIR` and `SIMRS_API` still work next to the new `SIMHA_*` variables.

## Trademark

Check DJKI PDKI classes 9 (software) and 42 (SaaS) before registering. Simha Group is an Indonesian F&B company in a different class, but the name is in use in Indonesia.
