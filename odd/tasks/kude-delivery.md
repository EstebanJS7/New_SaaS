# KuDE delivery (FISC-021)

Objective: generate, store and deliver the KuDE to staff and by email (DEC-098).
Branch `feat/kude-delivery` from `main` `f32b716`. Delivery strategy:
`ask-on-risk`. Runners: Vitest (fiscal, worker, api, notifications, web),
Playwright lane. Forecast: ~900 authored lines.

## Specs

- S1: "El worker genera el KuDE al firmar y lo guarda." Writes
  `fiscal_document.kude_storage_key`; a provider that does not sign stores
  nothing (assumption: no KuDE is reconstructed for older documents).
- S2: "El staff lo ve e imprime (o guarda como PDF desde el navegador) con «Ver
  KuDE» en el detalle fiscal, también el de la nota de crédito." API
  `GET /fiscal-documents/:id/kude` with `fiscal.read` (assumption: existing
  permission), cross-tenant/missing/no-KuDE `404`; BFF relay; web button.
- S3: "Suma una dependencia chica para dibujar el QR escaneable que exige la
  homologación." `qrcode-generator`, imported by one file.
- S4: "además adjunta el KuDE al mail automático que ya sale al aprobarse."
  In-memory attachment only; ADR-011 guardrails unchanged; without a readable
  KuDE the notice still goes, without attachment.
- S5: Tests first per rule; story/module docs with the code; no portal (TD-022),
  no ticket format, no server PDF, no manual resend.

## Tasks

| ID  | Specs    | Route                        | Status | Commit / evidence |
| --- | -------- | ---------------------------- | ------ | ----------------- |
| T1  | S1,S3,S5 | delegated (context backstop) | done   | see L4            |
| T2  | S2,S5    | delegated (context backstop) | done   | see L5            |
| T3  | S4,S5    | delegated (context backstop) | done   | see L6            |
| T4  | S1-S5    | delegated (context backstop) | done   | see L7            |

Risk: item 5 (new dependency, T1), item 2 (new route on CONFIDENTIAL data, T2;
email channel contract, T3). Independent verifier at feature end.

## Log

- L1 (2026-11-09): "ok hazlo creo que ya dio verde el ultimo pr, y tirame lo que
  falte de desarrollo para que quede como puesto en prod el sistema"
- L2 (2026-11-10): Asked "¿Arranco con el KuDE?" — user: "si". Scope question;
  user selected "Staff + QR + mail". Recorded as DEC-098 (accepted).
- L3 (2026-11-10): Map: DteRequest not persisted (worker
  fiscal-document-assembly.ts ~650-694 returns cdc+signedXml); kudeStorageKey
  never written; email channel text-only (email.channel.ts:198-208); BFF fiscal
  proxy drops content-disposition; reports export proxy is the precedent.
  ADR-011 guardrail 3 blocks file/URL access, not in-memory buffers, so no ADR
  change.
- L4 (2026-11-10): T1 done by delegated writer. RED→GREEN per rule: QR SVG
  helper 4/4; render with QR image; assembly passes signed request with real
  dCarQR; handler stores KuDE (`fiscal-kude_` prefix, text/html) and writes
  kudeStorageKey in the SIGNING-guarded update; renderer refusal/throw → no
  KuDE, submission proceeds; KuDE put failure → submission proceeds, key null,
  nothing recorded (known limitation: silent, no metric); non-signing provider
  writes no key; one-importer boundary test. Fiscal 829/829, worker 308/308,
  builds/lint/typecheck/prettier pass; parent rerun handler 48/48. Lockfile adds
  only qrcode-generator@2.0.4. Risk: item 5.
- L5 (2026-11-10): T2 done by delegated writer. `GET /fiscal-documents/:id/kude`
  (fiscal.read): 200 stored bytes as text/html, no-store, inline filename
  kude-<cdc|id>.html; 403 without permission; unknown/cross-tenant same 404;
  own-tenant without KuDE 404 "This fiscal document has no KuDE."; storage read
  failure 500 INTERNAL without driver text; 400 invalid id; no audit row.
  `hasKude` added to list/detail (key never exposed). Route probe updated. BFF
  relays disposition/cache-control for this route only; other routes pinned
  unchanged. «Ver KuDE» link (new tab) shown iff hasKude, invoices and credit
  notes. API 2148 pass/277 skipped, web 2391 pass/1 unrelated timing flake
  (clinical recovery test, 67/67 alone); typecheck/lint/prettier pass; parent
  rerun fiscal integration + probe 57/57. Risk: items 2 and 3.
- L6 (2026-11-10): T3 done by delegated writer. Port `attachments` (max 1,
  text/html only, 1 B–512 KiB, strict filename, exact keys); SMTP passes only
  {filename, content Buffer, contentType}, file/URL access still disabled,
  no-attachment options pinned identical; violations → FAILED non-retryable
  CHANNEL_ATTACHMENT_REJECTED; WhatsApp refuses attachments; fake records
  metadata only. Builder selects kudeStorageKey in its tenant-scoped approved
  read (reference only); handler reads storage at send time each attempt; null
  key/read failure/oversize/bad filename → sent without attachment, SENT; no
  bytes/key in payload, delivery or attempt rows; subject/body unchanged.
  Notifications 95, worker 319 green; parent rerun email channel 20/20. Known
  limitation: a notice sent without the KuDE leaves no record (DEC-098 wording
  corrected). Risk: items 2 and 3.
- L7 (2026-11-10): T4 done by delegated writer. New
  apps/e2e/specs/kude-delivery.spec.ts: APPROVED invoice → hasKude; «Ver KuDE»
  href/target; route 200 html/no-store/inline kude-_.html with grouped CDC and
  SVG QR data URL, no text fallback; new tab renders KuDE; approval email at
  SMTP sink with exactly one text/html kude-_.html attachment byte-identical to
  the route. Shared setup moved to support/fiscal-issuance.ts (ECN spec rerun
  green); mime.ts reader; mail-worker stop waits for exit. Spec alone 2/2; full
  lane 34/35 (branches.spec.ts:210 navigation flake, green alone). Parent rerun
  kude-delivery + branches 2/2. QR verified structurally only (no decoder
  available) — that box stays unticked. Docs: Fiscal.md, runbook rows 11-12
  runnable/not executed, TD-022 progress note, story verification.
- L8 (2026-11-10): Independent verifier: S2-S5 PASS, S1 FAIL on blocker B1 —
  handler spread `kudeStorageKey` only when stored, so a document re-claimed
  from ERROR (new CDC) whose rebuilt KuDE was not stored kept the OLD KuDE
  (wrong CDC) for staff and email. Fix: always write kudeStorageKey (null
  included). RED: 3 handler tests failed (two pinned assertions inverted + new
  ERROR re-claim regression); GREEN handler 49/49, worker 320/320,
  typecheck/lint/prettier pass. Advisories (not fixed, user decision): KuDE
  stored/served for ERROR/REJECTED documents too; no CSP/nosniff header on the
  inline HTML; silent failures (known); orphan object on stolen claim
  (pre-existing pattern). Suites run by verifier: fiscal 829, notifications 95,
  worker 319, api fiscal+probe 253, web fiscal 72.
