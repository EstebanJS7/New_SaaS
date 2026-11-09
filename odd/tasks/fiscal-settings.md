# Fiscal settings (DEC-095 option A)

Objective: let a clinic configure its fiscal setup in the app, in three
deliveries. Branch: `docs/dec-095-fiscal-issuance-point` (stacked on #156's
tip). Delivery: single-pr (user choice; no publishing authorization). Runners: vitest (`pnpm test`, `test:live-pg`),
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
- S5 — Resume request: "ahora quiero continuar con gentle shell, podemos continuar". Preserve interrupted edits and complete the already approved delivery scope. Handoff constraints: "El CSC usa el mismo permiso que el certificado (fiscal.signing_material.manage)"; "El valor del CSC se guarda solo cifrado en el almacén de secretos: nunca vuelve en una respuesta, no va a los logs ni a la auditoría."; "la API y el worker tienen que compartir la misma clave maestra del almacén de secretos."

- S6 — User selected: "A — Completar las declaraciones faltantes (recomendada)": "Agregar API, proxy y formularios mínimos para declarar el tipo de operación fiscal del cliente y la clasificación tributaria del IVA del tenant, con permisos, aislamiento y pruebas. Después ejecutar NCE-001 sin SQL ni aprobaciones fabricadas." Approved DEC-096; acceptance criteria in `docs/02-stories/FISC-020-fiscal-declarations.md`.

- S7 — User: "conytinuemos", accepting: "¿Autorizas agregar ese campo opcional al catálogo —API, formulario y pruebas— sin migraciones ni valores predeterminados?" DEC-097 accepted; catalog unit declaration authorized, preserving existing records and omission semantics.

## Tasks

| ID  | Specs | Route                        | Status  | Evidence                                                                                                                                          |
| --- | ----- | ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | S2    | delegated (context backstop) | done    | 9/9 criteria; RED 19 → GREEN; api 2091 pass; live-pg 281/281; FISC-017 block 5/5                                                                  |
| T2  | S3    | delegated (context backstop) | partial | FISC-018 8/9; proxy allowlist verified independently (no blockers); web 2295, lane 30/30. Open: NCE-001 browser (needs signing certificate + CSC) |
| T3  | S4    | inline after T3A             | pending | Certificate/CSC metadata/form/retirement sections and multipart passthrough implemented; secrets cleared before await and never kept in mutation state. Combined web 51 tests pass. Browser gate waits on DEC-097; full/browser/independent verification and review pending. |
| T2R | S3    | inline (writer admission denied) | pending | Focused checks pass: API 86/86, web 41/41, API/web typecheck exit 0. Lint, differential, final verification and commit pending; prior RED unavailable. |
| T3A | S4    | inline (writer admission denied) | pending | GREEN: 10 CSC + 27 probe tests; encrypted HTTP/worker-reader/concurrency regression passes. API gate job-4 exit 0: unit 2384, live-pg 282, lint/types/build pass at that snapshot. Independent verification and commit pending. |
| T4 | S4/S5 | user delivery-shape decision | done | User selected single-pr; complete pending delivery in one PR, with reviewable local commits; no push/PR authorization. |
| T5 | S4/S6 | user scope decision | done | User selected A; DEC-096 accepted and FISC-020 created. |
| T6 | S6 | delegated (parallel independent units) | pending | Writer returned partial only for missing differential: customer package 18, API 58, web 62 pass; API/web types and focused lint/format pass. API/proxy/form preserves omission vs null. Differential, independent verification and commit pending. |
| T7 | S6 | inline (parallel writer admission denied) | pending | Tax service/controller + proxy/settings section implemented; RED missing module → GREEN 6 API tests. Combined settings/proxy 51 pass; focused lint and API/web typecheck pass. HTTP/live-pg proof, full current suite, differential and independent verification pending. |
| T8 | S4/S6/S7 | user scope decision | done | User accepted optional catalog unit API/form/tests; DEC-097 accepted. |
| T9 | S7 | inline after ownership reconciliation | pending | Add explicit optional catalog unit declaration, preserve omission/null and validate existing SIFEN units; no migrations/defaults. |
| T10 | S4/S6/S7 | incident reconciliation | blocked | Await user stopping/pausing other Claude writers and confirming exclusive write ownership. New unowned edits appeared after the last verified candidate. |

## Log

- L1 (2026-11-09, user): "si, hagamos la A"
- L2: DEC-095 accepted (9d1d2a7).
- L3: Delivery 2: proxy keeps 404 for refused paths (story wording corrected
  from 400). NCE-001 browser blocked: an APPROVED FE needs the signing
  certificate (API only) and the CSC, which no API route writes.
- L4 (2026-11-09, user): "hazlo y soluciona las observaciones" — CSC added to
  delivery 3; fix the delivery-2 review observations.
- L5 (2026-11-09, resume): User asks to continue interrupted Claude Code work after both writers hit a provider rate limit. HEAD is 830f74d; existing edits recover delivery-2 metadata prefill, strict nested payload validation, and proxy method parity. No CSC API exists yet. Unrelated `opencode.json` and `.gentle-ai-default-agent.json` are preserved and excluded. Prior RED evidence is unavailable; do not invent it. Existing T1 commit: 14bf0ed; delivery-2 implementation: c1e11d5; FISC-019 Story: 830f74d. Parallel routing is justified by independent review-fix and new CSC API behavior with disjoint allowed edit surfaces. Forecast exceeds 400 authored lines; delivery shape must be resolved before the next commit, without publishing authority.
- L6: Runtime denied writer admission for the alphanumeric T2R/T3A task identifiers; no worker started and no source was changed by these attempts. Do not retry or bypass admission. These units will run inline. Recovery exploration completed; required implementation and functional/security checks have not run in this session. Delivery-shape choice was requested under the existing ask-on-risk policy.
- L7 (user selection): "Un solo PR — menos recomendado" (`single-pr`). Do not ask about chaining again. No publishing authorized.
- L8: Recovered FISC-018 tests: API 86/86, web 41/41, both typechecks exit 0. New CSC unit RED observed as missing service import; GREEN 10/10 lifecycle/schema tests and 27/27 permission probes. Initial probe inventory omission and transaction audit type mismatch corrected; final targeted ESLint/API typecheck/diff check exit 0. Live-pg runner failed on absent DATABASE_URL_TEST (not on a tested invariant). The documented disposable postgres at 127.0.0.1:55432 accepts SELECT 1. Migration 20261010000001 explicitly admits its two-active cap race under READ COMMITTED; API load uses SERIALIZABLE, but real concurrency proof is still pending. Safety policy denied reading apps/api/src/secrets/secrets.module.ts and explicitly requires a safer user-approved plan; no alternate read or guard bypass attempted. Stop for that decision; pending HTTP/encrypted-store integration, web/browser work, full suites/builds, differential check, independent verifier, native review and commits. Risk: item 2 (taxpayer secrets/authorization), item 4 (concurrent CSC cap).
- L9: User authorized the module read, but runtime still denied it. User then pasted the module source directly: createSecretStoreFromEnv selects EnvelopeSecretStore when a valid key ring is present, using the application Prisma record client. This safe supplied-code path resolves the setup uncertainty without bypassing the file guard. Resume T3A with generated test-only keys, never production keys.
- L10: Added route-driven encrypted-store/worker-reader/live-pg regression with dedicated tenants and concurrent loads: 1 passed, 275 deselected; no SQL approval or direct CSC seeding. API full unit/live-pg/lint/typecheck/build gate launched as job-4 (notification resumes recording results). Explorer found another browser prerequisite: no public write routes for customer.fiscalOperationType or tenant_tax_classification; receptor refusal spot-checked at receptor.read.ts:252. Proposed DEC-096 (not accepted) records options A/B. Do not invent fiscal declarations or silently expand scope. Existing certificate fixture is 80012345-6, while current browser profile is -0; align test fixture/profile without weakening validation.
- L11 (user selection): "A — Completar las declaraciones faltantes (recomendada)". DEC-096 accepted, FISC-020 in-progress. New independent units T6/T7 each span backend/proxy/form/tests and several minutes of work, so launch writers together with disjoint edit surfaces. Earlier T2R/T3A denied admissions remain inline and are not retried. Single-PR delivery choice remains unchanged.
- L12: T6 writer finished; all listed checks pass, but its required base differential was not run (partial, not waived). T7 launch was rejected by runtime overlapping-surface admission; no T7 worker started, so parent implemented T7 inline without retrying. T7 tests RED missing file → GREEN 6 API tests; proxy RED 404 → GREEN additions; secret forms RED missing component → GREEN immediate secret clearing even on pending/error. Combined fiscal settings/proxy 51 tests pass, API/web typechecks and focused ESLint pass. No source API exists to declare catalog.unitOfMeasureCode: the initial preflight missed ITEM_UNIT_NOT_DECLARED. A complete bounded assembly preflight now identifies this as the last missing declaration surface. DEC-097 proposed; do not silently broaden DEC-096's two explicit surfaces. Stop for its A/B scope decision. No commits/push/PR yet; full current suite/browser proof/differentials/independent verifier/native review remain pending.
- L13 (user): "conytinuemos" — accepts DEC-097 optional catalog unit API/form/tests, no migrations/defaults. Before source edits, Git showed new changes not authored by this Pi session: fiscal.permissions.ts, secret-keys.ts/test, Fiscal.md/FISC-018 docs and CSC files. Process list (names only) shows Claude PID 270 still active. CSC service mtime is 16:49, secret-keys 16:43 and permissions 16:44 (-0300), after the previously verified 16:37 snapshot. Another writer's identity/intent is not proven merely by the process list; concurrent ownership must be resolved. Preserve all edits, do not kill the user's process, do not adopt external RED/GREEN claims or apply source changes until the user stops/pauses other writers and confirms exclusive ownership. Reconcile current diff and rerun applicable candidate checks afterward; previous results are historical, not proof of this new candidate.
