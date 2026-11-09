# Remaining staff UI localization (UX-036)

Objective: localize the last English staff modules to es-PY. Branch:
`feat/ux-036-remaining-localization` from `main` @ `40d687c`. Delivery: one PR.
Runner: vitest (apps/web), Playwright lane for the seam check.

## Specs

- S1 — User: "ok traduzcamoslo" (in reply to the recommendation to translate the
  modules still in English).
- S2 — Story `docs/02-stories/UX-036-remaining-module-localization.md`, every
  acceptance criterion; units A (purchases, suppliers), B (billing, fiscal
  documents), C (reports, branding), D (imports, notifications, English
  fallbacks in agenda/clinical/sales/branches).

## Tasks

| ID  | Specs  | Route                                | Status | Evidence                                                         |
| --- | ------ | ------------------------------------ | ------ | ---------------------------------------------------------------- |
| T1  | S2 (A) | delegated (parallel units, disjoint) | done   | A: 125 tests                                                     |
| T2  | S2 (B) | delegated (parallel units, disjoint) | done   | B: 117 tests                                                     |
| T3  | S2 (C) | delegated (parallel units, disjoint) | done   | C: 80 tests; CSV unchanged                                       |
| T4  | S2 (D) | delegated (parallel units, disjoint) | done   | D: 782 tests in its folders; 6 page tests updated with approval  |
| T5  | S2     | inline seam check (web suite + lane) | done   | lint/format/typecheck clean; web 2370/2370; build OK; lane 31/31 |

## Log

- L1 (2026-11-09, user): "ok traduzcamoslo"
- L2: Inventory: ~570 English strings in 8 modules, ~520 test assertions; none
  of the 8 modules imports `lib/es-py-format.ts`.
