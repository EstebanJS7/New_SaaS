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
  a real screen; NCE-001 browser criterion. Story:
  `docs/02-stories/FISC-018-fiscal-settings-screen.md`, every acceptance
  criterion.
- S4 — Delivery 3: signing certificate upload and retire, own delivery and
  review (high risk, item 2), plus the CSC (L4). Story:
  `docs/02-stories/FISC-019-signing-certificate-and-csc.md`, every acceptance
  criterion.

## Tasks

| ID  | Specs | Route                        | Status  | Evidence                                                                                                                                          |
| --- | ----- | ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | S2    | delegated (context backstop) | done    | 9/9 criteria; RED 19 → GREEN; api 2091 pass; live-pg 281/281; FISC-017 block 5/5                                                                  |
| T2  | S3    | delegated (context backstop) | partial | FISC-018 8/9; proxy allowlist verified independently (no blockers); web 2295, lane 30/30. Open: NCE-001 browser (needs signing certificate + CSC) |
| T3  | S4    | tbd                          | pending |                                                                                                                                                   |

## Log

- L1 (2026-11-09, user): "si, hagamos la A"
- L2: DEC-095 accepted (9d1d2a7).
- L3: Delivery 2: proxy keeps 404 for refused paths (story wording corrected
  from 400). NCE-001 browser blocked: an APPROVED FE needs the signing
  certificate (API only) and the CSC, which no API route writes.
- L4 (2026-11-09, user): "hazlo y soluciona las observaciones" — CSC added to
  delivery 3; fix the delivery-2 review observations.
