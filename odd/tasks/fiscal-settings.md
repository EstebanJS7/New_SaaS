# Fiscal settings (DEC-095 option A)

Objective: let a clinic configure its fiscal setup in the app, in three
deliveries. Branch: `docs/dec-095-fiscal-issuance-point` (stacked on #156's
tip). Delivery: ask-on-risk. Runners: vitest (`pnpm test`, `test:live-pg`),
Playwright lane.

## Specs

- S1 — User: "si, hagamos la A" (in reply to: "¿Actualizo DEC-095 para
  recomendar la opción A por etapas?"; stages: 1 issuance-point route, 2 fiscal
  settings screen part one, 3 signing certificate on its own).
- S2 — Delivery 1: Story FISC-017, every acceptance criterion in
  `docs/02-stories/FISC-017-issuance-point-declaration.md`.
- S3 — Delivery 2: «Configuración fiscal» screen: profile, establishments,
  timbrado ranges (create, retire) and issuance point over the existing routes;
  the web proxy adds only those routes; `CREDIT_NOTE_NO_RANGE_MESSAGE` points to
  a real screen; NCE-001 browser criterion. (Story to be written before T2.)
- S4 — Delivery 3: signing certificate upload and retire, own delivery and
  review (high risk, item 2). (Story to be written before T3.)

## Tasks

| ID  | Specs | Route                        | Status  | Evidence                                                                         |
| --- | ----- | ---------------------------- | ------- | -------------------------------------------------------------------------------- |
| T1  | S2    | delegated (context backstop) | done    | 9/9 criteria; RED 19 → GREEN; api 2091 pass; live-pg 281/281; FISC-017 block 5/5 |
| T2  | S3    | tbd                          | pending |                                                                                  |
| T3  | S4    | tbd                          | pending |                                                                                  |

## Log

- L1 (2026-11-09, user): "si, hagamos la A"
- L2: DEC-095 accepted (9d1d2a7).
