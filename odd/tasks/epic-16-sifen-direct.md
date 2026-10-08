---
feature: epic-16-sifen-direct
epic: EPIC-16
status: in-progress
created: 2026-10-03
updated: 2026-10-08
branch: main
---

# EPIC-16 SIFEN Direct — ODD task tracker

## Goal

Implement `SifenDirectFiscalProvider`: the third and final step of
`docs/06-fiscal/SIFEN.md`'s sequence. This system generates, signs and submits
Paraguayan electronic tax documents (DTE) to SIFEN **directly**, with no
commercial intermediary.

The epic was planned as _Fiscal Third-party Adapter_ and **was renamed on
2026-10-03** when the maintainer chose to own the integration instead of routing
it through a vendor API. The vendor research is retained as historical evidence
in `docs/06-fiscal/PROVIDER-CANDIDATES.md` and is no longer the plan of record.

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`.

## The precondition that governs every other task

**PRD §23 forbids writing SIFEN implementation code before the official DNIT
baseline is revalidated**, and `docs/06-fiscal/SIFEN.md` adds that this vault's
notes go stale. Therefore:

- **FISC-006 is documentation-only and comes first.**
- Every technical detail in the stories after it — XSD versions, endpoint list,
  state mapping, signature profile, certificate requirements, contingency
  windows, numbering rules — **comes from FISC-006 and must not be written from
  memory.**
- If FISC-006 cannot retrieve an official source for something, that gap is
  recorded as an open question rather than filled with an assumption.

Regulatory driver, cited: DNIT _Resolución General N.° 41/25_ (Asunción, 24
December 2025) requires taxpayers contracting as state providers from **2
January 2026** onward to adhere to SIFEN; its article 3 points at _Decreto n.°
872/2023_ and the SIFEN technical documentation.

## Governance constraints that bind this epic

- `DOCUMENTATION-RULES.md` names **"change Fiscal Provider boundary"** as an
  explicit ADR case. Three foreseeable changes need one (below).
- `ENGINEERING-RULES.md`: "Secrets never live in Git or plaintext application
  records"; "Private files use signed URLs"; "Never hold a database transaction
  open while waiting on fiscal providers".
- `AGENTS.md`: a new dependency needs a concrete requirement; a new runtime,
  database, queue or data store needs an ADR. SIFEN Direct needs **no new
  deployable**.
- Data classification: the tenant's private key and its password are
  **RESTRICTED**; a DTE's fiscal content is at least CONFIDENTIAL.

## Decisions taken by the maintainer (2026-10-04) — FISC-007

Recorded in [[DEC-053]] and [[ADR-005]]:

1. **Envelope encryption in PostgreSQL.** A platform master key from environment
   wraps a per-secret data key; AES-256-GCM; ciphertext in our own
   `tenant_secret` table. No new deployable, no external custody dependency. The
   cost is recorded, not hidden: we own the key, and losing it loses the ability
   to sign.
2. **The operator uploads a PKCS#12 plus its password.** Verified constraint:
   Node's `crypto.createPrivateKey` cannot open a PKCS#12 in any form, so the
   container needs a parser.
3. **The material enters through audited staff API routes** behind one new
   permission.
4. **Parser dependency: `pkijs` + `asn1js`** (BSD-3-Clause, npm provenance
   published, runs on Node's built-in WebCrypto). Rejected: `node-forge` (a
   November 2025 ASN.1 advisory in its 1.4.0 line, and a library the FISC-009
   signing path does not use) and deferring the parse to FISC-009 (which would
   leave the password alive for the material's lifetime and let an operator
   upload an unvalidated container).

**Derived consequences the maintainer accepted explicitly**: the password is
never persisted (one secret per material, not two); retirement destroys the
stored key in the same transaction while the row survives as the record;
rotation is an upload that retires the previous material; `tenant_secret` rows
are tenant-scoped at the database level; the master key is a versioned key ring
so a KEK rotation does not need a data migration.

## Decisions taken by the maintainer (2026-10-03)

### D1 — Own the integration (accepted)

`SIFEN_DIRECT` is implemented by us. The `THIRD_PARTY` path is not built; the
enum value stays in the schema unused, and the vendor research stays as
evidence.

### D2 — Revalidate before implementing (accepted, and it is PRD §23's own rule)

FISC-006 delivers the cited DNIT baseline first. It is a gate, not a formality:
no story after it may encode a protocol constant that FISC-006 did not cite.

### D3 — The certificate is ours to hold (consequence, not a choice)

Because there is no vendor, the tenant's signing private key and password live
inside our boundary. The third-party plan's "the vendor holds the certificate"
option is gone. This is the epic's single largest risk and the reason ADR
candidate 1 exists.

## ADR candidates (each needs an ADR before the story that requires it)

1. **Holding the tenant's signing material.** Changes what the Fiscal boundary
   is responsible for: RESTRICTED storage, rotation, removal, and what may never
   be logged or returned. → before FISC-007. **Resolved: [[ADR-005]] `accepted`
   2026-10-04.**
2. **The signing dependency.** Which library, its provenance, its update story
   and how it is pinned. → before FISC-009. **Resolved: [[ADR-006]] `accepted`
   2026-10-07** — `xml-crypto` 6.3.3, and the target is **XMLDSig**, which is
   what SIFEN v150 asks for; the vault's "XAdES" wording traces to PRD §23 and
   is recorded, not edited.
3. **An asynchronous outcome capability on the provider port.** SIFEN answers
   asynchronously, so `issue` alone is insufficient; the port needs a status
   query and the worker needs reconciliation. → **before FISC-010**, not
   FISC-012: FISC-010 is the story that produces the asynchronous result, so the
   port has to expose it before FISC-012 consumes it. Becomes **ADR-007**.
   **Resolved: [[ADR-007]] `accepted` 2026-10-08** — `SUBMITTED` as a
   non-terminal **and non-retryable** issue outcome, `providerReference` on the
   result, a `query` capability, a nullable `fiscal_document.provider_reference`
   for SIFEN's batch number, `submitted_at`'s writer, and the TD-028 sweep
   extended to `SUBMITTED` as the reconciliation path.
4. **The SIFEN transport: SOAP over mutual TLS with the tenant's certificate,
   and the client/parser dependency.** The adapter runs in the worker and must
   authenticate as the tenant, so the boundary gains a per-call credential read
   on a process-singleton provider, and an XML parser `packages/fiscal` does not
   have today. → before FISC-010. Becomes **ADR-008**. **Resolved: [[ADR-008]]
   `accepted` 2026-10-08** — `node:https` with a per-call mutual-TLS
   configuration and `agent: false` (no pooled socket, so no authenticated
   connection is reused across tenants),
   `FiscalCredentialPort.read({ tenantId, environment })` with a null-returning
   default behind a `forRoot()`-able module, the deployment-level
   `SIFEN_ENVIRONMENT` with the material's `environment` column as a **guard**,
   and two MIT dependencies (`fast-xml-parser`, `fflate`) with their advisory
   record and the parser's guardrails.

## Story plan

| Story    | Scope                                                                                  | Depends on         |
| -------- | -------------------------------------------------------------------------------------- | ------------------ |
| FISC-006 | SIFEN Direct scope and the DNIT baseline revalidation (docs-only)                      | —                  |
| FISC-007 | Tenant signing material in the `SecretStore` (RESTRICTED, rotation, removal) + **ADR** | FISC-006           |
| FISC-008 | DTE XML generation validated against the official XSDs                                 | FISC-006           |
| FISC-009 | XAdES signing and the return of the `SIGNING` state + **ADR**                          | FISC-007, FISC-008 |
| FISC-010 | DNIT web services: reception, query, events                                            | FISC-008, FISC-009 |
| FISC-011 | Timbrado and numbering ranges per establishment, point and type                        | FISC-006           |
| FISC-012 | `SifenDirectFiscalProvider` + the port's async-status extension + **ADR**              | FISC-010, FISC-011 |
| FISC-013 | Contingency handling and the certification/homologation evidence run                   | FISC-012           |
| FISC-014 | Epic closure: module docs, CI evidence, changelog, roadmap, advisory triage            | all                |

## What exists already (verified on merged `main` `4c02473`)

- `packages/fiscal`: the port with `issue` and `cancel`, the deterministic fake,
  the fail-closed snapshot sanitizer, the queue contract, and a composition root
  that refuses a fake in production.
- `apps/api/src/fiscal`: the issue, cancel and read commands, `fiscal.read`, the
  staff surface at `/app/fiscal`, and the `DEC-051` Billing hand-off.
- `apps/worker/src/fiscal-submission`: the consumer, the handler with its
  five-minute claim lease, and the TD-028 recovery sweep.
- `fiscal_document`: the full lifecycle, the transition guard, the sanitized
  snapshot columns, and `xml_storage_key` / `kude_storage_key` written by
  nothing.
- `packages/storage`: `StoragePort`, an S3 driver, an in-memory driver, opaque
  key helpers and a module — reusable for XML/KuDE.
- `packages/fiscal/src/fiscal-snapshot.sanitizer.ts`: already fail-closed, which
  matters more now that real provider payloads and XML exist.

## What does not exist

- No `SIGNING` state: [[DEC-047]] omitted it while a fake stood in for the
  provider. It returns with FISC-009.
- No XML generation, no XSD validation, no signing, no certificate handling.
- No tenant secret material of any kind: no `SecretStore`, no private-key path.
- No DNIT web service client.
- No timbrado or numbering-range model.
- `FISCAL_PROVIDER` accepts only `"fake"`.

## Explicitly out of scope

- Any commercial fiscal API (the vendor research is evidence, not a plan).
- KuDE as a printable document layout.
- The portal fiscal document surface ([[TD-022]]).
- Reports ([[EPIC-18]]), notifications ([[EPIC-17]]), production hardening
  ([[EPIC-20]]).
- New deployables.

## Tasks

- [~] T1 — Write FISC-006..FISC-014 as Story files and register the epic in the
  roadmap and the module README. FISC-006 and **FISC-007** exist; the epic doc
  and the roadmap row are updated to `in-progress`. FISC-008..FISC-014 are
  written as each one is approached, so their contracts are pinned against the
  baseline rather than invented ahead of time. The module README gains its
  EPIC-16 section when FISC-007's module doc lands.
- [x] T2 — FISC-006: the DNIT baseline revalidation (docs-only, cited sources).
      Evidence: this work unit's commit. `docs/06-fiscal/SIFEN-BASELINE.md` plus
      the `FISC-006` Story. Nine official artifacts retrieved 2026-10-03: the
      **Manual Técnico v150** (217 pages), the **Guía de Pruebas e-kuatia** (12
      pages), **Notas Técnicas 23/24/25**, the **XSD directory**, `DE_v150.xsd`
      and `xmldsig-core-schema.xsd`, and the documentation/tables indexes. That
      pins the full signature profile, the certificate standard (F1/F2), the
      transport stack, every service endpoint, the three-state result model, the
      deadlines, the CDC-reuse rule and the timbrado/series model. Open and
      recorded: Notas Técnicas 26/27, `DE_Types_v150.xsd`, the WSDLs, the
      `dCodRes` catalogue, the tables and the QR/CSC details. **Contingency is
      answered, not missing**: the manual removed its own contingency section as
      "en etapa de definición". Correction kept in the record: a first pass
      concluded the manual and the Notas Técnicas "were not retrieved" because
      the inline fetch returned only a title, when the PDFs had in fact been
      extracted in full; the baseline and the Story were rewritten, and the
      retrieval sizes are recorded in the Story's verification block so the
      claim is checkable.

- [x] T3 — **FISC-007: tenant signing material + ADR — done 2026-10-04.**
      Authorized by [[ADR-005]] and [[DEC-053]], both `accepted`. Six work
      units: `bc2d010` (contract pin), `a06033e` (`packages/secret-store`),
      `27b48b2` (persistence + composition root + env gate), `cd6fd87` (PKCS#12
      boundary + fixture), `295cba3` (aggregate + permission + seed) and
      `0c99af1` (HTTP surface + route pins). Root gates green: lint 18/18,
      typecheck 18/18, test 19/19, build 11/11; secret-store 50, fiscal 60,
      database 416, API 1105, live PostgreSQL 213/213; 33 migrations. **Three
      defects were found by reading and by the tests, not by a gate:**
      `as never` casts that discarded the port's structural verification;
      rotation that retired a material without destroying its stored key
      (contradicting D5); and a production refusal that the null-key-ring
      short-circuit skipped entirely, so a production boot would have used the
      in-memory driver. **A recorded plan had to change:** the PKCS#12 fixture
      cannot be built purely in the test — pkijs writes an invalid certificate
      `signatureAlgorithm`, and `.p12`/`.pem` files are blocked by the harness
      path guard — so the maintainer chose base64 DER material plus in-test
      assembly. **CI receipt:** PR **#105**, run `37171089838` — both required
      checks green (migrations 1m06s, quality 5m07s) at head `4e77aba`. The
      first run (`37170701222`) failed `prettier --check .` on the ADR-005 and
      DEC-053 files and is recorded rather than smoothed over. **Review:** a
      chain of seven approved candidates, one per work unit, all approved; the
      thirteen non-blocking advisories are [[TD-031]].
- [x] T4 — **FISC-008: DTE XML + XSD validation — DONE 2026-10-06.** Story
      `status: done`. Three work units (WU-A builder, WU-B XSD gate, WU-C
      mapper), plus the CDC composition, the security-code generator and the two
      corrections the reviews made due. PR **#106**. The two unclosed lineages
      and the open `R3-CDC-DATE` finding are recorded in the Story's Completion
      Notes and in [[TD-032]]. Contract pinned 2026-10-04. Story at
      `docs/02-stories/FISC-008-dte-xml.md`. **The retrieval FISC-006 left open
      is done**: `DE_Types_v150.xsd` was fetched from the official directory
      (66,452 bytes, HTTP 200) together with `DE_v150.xsd` (66,190) and
      `xmldsig-core-schema.xsd` (10,339), and its facts are recorded in
      `docs/06-fiscal/SIFEN-BASELINE.md` §21 — 140 `simpleType`s with their
      enumerations, the scalar patterns for CDC/RUC/timbrado/series/document
      number/dates/money, and the `rDE` (4 children) and `tDE` (11 children)
      structures. **One decision blocks the acceptance criterion, not the
      implementation**: the schemas are copyrighted and must not be vendored.
      **Decided 2026-10-04**: a dedicated CI job fetches the three schemas,
      asserts each fetch, and runs the validation with the skip disabled, so a
      green run cannot come from having validated nothing. **Retrieval completed
      2026-10-04**: baseline §22 carries the Manual's field-level rules (73
      `D`-codes; the receptor block's conditional structure; the
      test-environment literal for `dNomEmi`; the cross-field invariants), four
      companion tables were fetched as official XSDs. **Geography closed**: the
      official `CÓDIGO DE REFERENCIA GEOGRAFICA_NOVIEMBRE_2025` spreadsheet
      gives `D111`/`D113`/`D115` (18 departamentos, 272 distritos unique
      nationally, 6,766 ciudades). NT 26 excludes four B2G validation rules and
      NT 27 amends the nomination _event_ format, so neither changes a DE rule
      FISC-008 must implement. **Still open**:
      `Tabla 3 – Actividades Económicas` (`D131`), whose Manual link now returns
      an HTML portal shell. **`D104` is CLOSED**: the Manual's TABLA 1 prints
      all eight régimenes inline, and the earlier "references but does not
      contain" claim was wrong — chapter 15 was invisible because the PDF
      extractor dropped its tables (baseline §22.6). **And a correction**: the
      Nota Técnica set is **001-027, not 23-27**. **All 27 were retrieved and
      profiled** (baseline §22.10): eighteen touch DE fields and ten amend
      validations, and **nine amend the receptor block alone**
      (`D200`/`D201`/`D202`/`D208`/ `D210`), which §22.3 pins from the 2019
      Manual. **The receptor block's rule text is now transcribed and
      consolidated** (baseline §22.11): NT 023 removed the `o D202=4` half of
      `D208`'s `No informar` clause, NT 024 lowered the `D208c`/1321 threshold
      from NT 021's 35,000,000 to **7,000,000**, and NT 003 excluded the
      `D219`/`D223` validations in favour of field conditions. The generator
      implements §22.11 and must never read §22.3 for a receptor condition. The
      remaining provisional areas are the non-receptor ones — currency/exchange,
      emitter activity/imputation, items and titles — while the structural
      contract (`rDE`/`tDE`, order, patterns, money scales) is unaffected
      because the notes amend observations and validations, not the schemas.
      **Work units for the implementation**, in order. **WU-A, the builder**
      (`packages/fiscal/src/dte/**`): a pure `typed request -> XML string`
      function, with `rDE`'s four children and `tDE`'s eleven in schema order,
      `dVerFor` pinned to 150, the CDC as a **validated input** and never
      composed (per §22.9), `dCodSeg` per §10.3, the per-field money scales, and
      the **receptor block from §22.11** with its seven validations rather than
      from §22.3. **WU-B, the CI validation job**: fetches the three official
      schemas into a job-local directory, asserts each by HTTP status **and** a
      minimum byte size, runs the schema-validation suite with the skip
      **disabled**, and records the run in `docs/10-qa/CI-EVIDENCE.md` with the
      artifact sizes and the case count; a fetch that does not produce all three
      fails the job. **WU-C, the invoice -> request mapping**: **blocked** on
      the rule text of the non-receptor notes (§22.10) and on `D104`/`D131`,
      whose tables the Manual references but does not contain.
- [x] T4b — **FISC-008 WU-C: the invoice -> request mapper — DONE 2026-10-06.**
      See **WU-C: the mapper** below.
- [x] T5 — **FISC-009: XMLDSig signing + `SIGNING` + ADR-006 — DONE
      2026-10-07.** Merged as PR **#107**, merge commit **`e1a29d7`** (branch
      `feat/epic-16-fisc-009-xmldsig-signing`); the Story is `status: done`.
      Story at `docs/02-stories/FISC-009-xmldsig-signing.md`, contract pinned
      from baseline §5. **ADR-006 is ACCEPTED (2026-10-07): `xml-crypto` 6.3.3
      (MIT)**, a dependency of `packages/fiscal` only; its four packages are all
      permissive and none is native. **The finding that changes the
      vocabulary**: SIFEN v150 does **not** ask for XAdES. `XAdES`,
      `QualifyingProperties` and `SignedProperties` occur **zero times** in the
      three official schemas, and the Manual's §7.9 synthesis reads "Firma XML
      Digital Signature, Enveloped". The vault's "XAdES" wording traces to PRD
      §23's own text, which is **not edited**: the ADR and the Story record that
      the implementation target is the §5 profile. **The other half of the
      question the epic asked is answered**: `pkijs`/`asn1js` stay what ADR-005
      added them for (parsing PKCS#12) because **they cannot sign XML** — the
      installed `pkijs@3.4.1` has zero `xmldsig` occurrences. **Work units for
      the implementation**, in order. **WU-A, the ADR and the Story** (this
      commit). **WU-B, the pure signer**
      (`packages/fiscal/src/dte/dte.signing.ts`): the §5 profile element by
      element, the eight forbidden elements **refused** rather than omitted, the
      signature placed between `</DE>` and `<gCamFuFD>`, and a sign-then-verify
      round trip. **WU-C, the `SIGNING` state**: the enum value, the migration,
      the transition guard and the worker stage —
      `QUEUED ->     SIGNING -> SENDING`, `SIGNING -> ERROR`, and
      `SIGNING -> CANCELLED` still excluded because a worker holds that claim.
      **WU-D, verification**: the signed document through the XSD gate WU-B of
      FISC-008 built, plus the live-PostgreSQL coverage of the new enum value
      and the new edges. **WU-A and WU-B are DONE (2026-10-07).** WU-B is
      `packages/fiscal/src/dte/dte.signing.ts` plus 25 cases in
      `dte.signing.test.ts` and one new case in `xsd-validation.test.ts` (the
      really signed document, deliberately separate from the structural
      fixture's — structure is not a signature). Two findings it produced, both
      recorded: **the signature is a SIBLING of `DE`**, because the schema's
      `rDE` carries `DE` and then `ref="ds:Signature"` while `tDE` holds no
      signature, so the enveloped transform removes nothing here; and
      **`@xmldom/xmldom` is deliberately NOT declared**, because its
      `index.d.ts` opens with `/// <reference lib="dom" />` and declaring it
      re-typed an unrelated WebCrypto union in the PKCS#12 fixture, breaking
      `typecheck` in a file this Story does not touch. Gates green: fiscal
      lint/typecheck/test/build, the suite run with `DTE_XSD_REQUIRED=1`, root
      18/18, 18/18, 19/19, 11/11, and `format-check`. The live-PostgreSQL gate
      belongs to WU-C. **WU-C1 is DONE (2026-10-07): the `SIGNING` state.** The
      enum value, the migration `20261007000001_fiscal_document_signing_state`,
      and the guard body — `QUEUED -> SIGNING`, `SIGNING -> SENDING`,
      `SIGNING -> ERROR`, with `SIGNING -> CANCELLED` still excluded because
      `SIGNING` is a claim like `SENDING` and a worker holds it. `SIGNING` is
      declared **last** in the Prisma enum on purpose:
      `ALTER TYPE ... ADD VALUE` appends, so declaring it between `QUEUED` and
      `SENDING` would describe an order the database cannot have without
      recreating the type; the lifecycle's real order lives in the guard.
      **Proven against a live PostgreSQL 16**, not only asserted: the migration
      applies inside the transaction `prisma migrate deploy` wraps it in, the
      value lands last in `pg_enum`, and the edges were exercised on a real row
      in a transaction that was rolled back. 8 new cases in
      `packages/database/src/schema-fiscal-signing-state.test.ts`. **WU-C2 — the
      worker's signing stage — MOVED TO T8 / [[FISC-012]].** The worker cannot
      build a DE yet and the reason is not missing work: there is no emitter
      profile and no timbrado anywhere in `apps/worker` or `apps/api`
      ([[FISC-011]] owns that storage, DEC-054 Q1-B), no `identity`/CDC without
      them, and `qrContent` is [[FISC-012]]'s by the mapper's own note. The
      worker also does not build a DE at all today — it hands invoice data to
      the port and the fake provides. Recorded in the Story under "Why this
      acceptance criterion moved" and in the epic's FISC-012 row.
- [~] T6 — **FISC-010: DNIT web services — in progress 2026-10-08.** Branch
  `feat/epic-16-fisc-010-dnit-web-services` from **`68b3c74`** (chosen by the
  maintainer over `ffd08a1`, because `4907e65` — the epic's ADR-order correction
  — and the FISC-011 completion commits are not yet in `main`, and both touch
  the bookkeeping files this work unit edits). Feature record:
  `odd/tasks/fisc-010-dnit-web-services.md`. Story:
  `docs/02-stories/FISC-010-dnit-web-services.md`. **WU-A, docs-only, is this
  commit**: [[ADR-007]] and [[ADR-008]] accepted 2026-10-08, the Story,
  `SIFEN-BASELINE.md` **§23** (the service-schema retrieval record, the WSDL
  block and the outcome model), the epic's ADR list and rows, and this tracker
  entry. **Three findings from §23 shape the rest of the Story**: **(1)** the
  v150 **batch** schemas do not exist — `SiRecepLoteDE_v150.xsd`,
  `ProtProcesLoteDE_v150.xsd`, `resRecepLoteDE_v150.xsd`,
  `SiResultLoteDE_v150.xsd`, `resResultLoteDE_v150.xsd` and
  `WS_SiRecepLoteDE_v150.xsd` all return **HTTP 404**, and the batch shapes are
  published only at **v141**, which is also what the Guide documents; **(2)**
  the two **consultation** services were first recorded as **blocked** — that
  was **wrong, and it is corrected here**: the published v150 consultation
  schemas (`siConsultaDTE.xsd`, `siConsultaArchivoRuc.xsd`) are **different
  services** (by authorization protocol, by date range, and the RUC archive, all
  signed and all returning ZIPs), while the Manual's **§9.4 and §9.6** pin the
  two services the endpoint list names as **unsigned**
  (`rEnviConsDe { dId, dCDC }`, `rEnviConsRUC { dId, dRUCCons }`) and the
  published v141 artifacts (`WS_SiConsDE_v141.xsd`, `WS_SiConsRUC_v141.xsd`,
  **zero `xmldsig` occurrences**) and the Guide's example confirm them — the
  blocker was a search not yet run (baseline §22.1's lesson), and §23.6/§23.8
  were rewritten with it; **(3)** the WSDL is unreadable on both hosts
  (`HTTP 302 → /vdesk/hangup.php3`, and a **bogus path and the host root answer
  the same**, so the gate is host-wide and the probe says nothing about the
  paths), which leaves SOAPAction and bindings open and makes "never follow a
  redirect" a requirement rather than a preference. **Remaining WUs**: WU-B the
  message layer, WU-C the transport and the credential port, WU-D the port's
  asynchronous capability and the schema, WU-E the service facade and the pure
  outcome mapping. **The maintainer's boundary of 2026-10-08**: FISC-010 defines
  the credential port and proves it with a **double**; [[FISC-012]] wires the
  worker together with the signing stage. **One criterion moved a second time**:
  FISC-009 pointed "no secret in a log or a stored snapshot" at FISC-010;
  ADR-008 put the transport in `packages/fiscal` and the wiring in FISC-012, and
  FISC-010 persists no document and logs no submission, so it re-points to
  FISC-012 with the reason recorded in the Story. **WU-A landed as commit
  `3779569`** — 8 files, 2,116 insertions, 49 deletions — and its review is
  `review-fe256d67a4d60ed5`, closed **`approved`** with **no lenses**: the
  provider classified the candidate `non_executable_only` at `low` tier and set
  `lenses_required: false`, so the four-lens review never ran. Inspected
  **before** committing, and the intended-untracked selection adopted the four
  new files.
- [x] T7 — **FISC-011: timbrado and numbering ranges — DONE 2026-10-07.** Merged
      as PR **#108**, merge commit **`ffd08a1`**, CI run `37679607152` green on
      all three checks (branch `feat/epic-16-fisc-011-timbrado-numbering`).
      **`story-finish` was never run, and two acceptance criteria are
      unimplemented rather than merely unchecked** — verified against the merged
      tree: **(1)** `series_started_at` is set once from the caller's signature
      timestamp: the column exists and every write sets it `NULL`, and none of
      `TimbradoRangeStore`'s four operations sets a series start; **(2)** the
      profile's RUC must be the certificate's RUC (baseline §22.4, `D101`):
      nothing compares the two, and the assembler emits `profile.ruc`. **Both
      are now implemented** on branch `feat/epic-16-fisc-011-completion`:
      `d61bad4` (the set-once series start) and `53e8bd2` (the RUC obligation,
      both write paths), review-approved as lineage `review-5c088696cf985684` —
      high tier, four lenses, a refuter and a targeted validator, closed
      `approved` with the authority burned. The refuter confirmed `R4-001`, a
      real defect of mine: the SAN parse took the first RUC-shaped token, so the
      employing entity's RUC could win. The correction is in. **Closed
      2026-10-07**: the live-PostgreSQL gate ran clean once Docker came up —
      `218/218` against PostgreSQL 16 on the `fisc009-pg` container, and the new
      set-once case alone with 1 passed — so the Story's `status` is `done` and
      every gate is green. Feature record: `odd/tasks/fisc-011-completion.md`.
      Story at `docs/02-stories/FISC-011-timbrado-and-numbering.md`. **No ADR
      needed**: the epic's ADR list carries only ADR-006 and ADR-007, and three
      tenant-scoped tables plus a counter are a domain model, not an
      architecture change. **The Manual's §10.5 was extracted in full (p. 59-60)
      and it is richer than the baseline's summary** — three rules the baseline
      did not carry, now recorded in `SIFEN-BASELINE.md` §13 verbatim: the
      series order is **lexicographic** (`AA, AB, … AZ, BA, … ZZ`) and _"El
      sistema validará la secuencialidad del uso de la serie"_; **the initial
      range carries no series** until the whole `0000001`-`9999999` range is
      consumed **per document type**; and **the series' start date is the DE's
      digital-signature date-time**, which SIFEN takes on receipt — so the
      allocation cannot know it, because the number is part of the CDC and the
      CDC is signed afterwards. SIFEN approves only the previous, the same, or
      the next series, which makes an out-of-order series a rejection rather
      than a cosmetic difference. **The invariant that governs the allocation**:
      §6.5 lets a rejected DE reuse the **same CDC**, and the number is part of
      the CDC, so **a consumed number is never reused** — monotonic, like the
      stock and cash ledgers. **Decided with the maintainer 2026-10-07**: three
      tables (`fiscal_emitter_profile` + `fiscal_establishment` +
      `fiscal_timbrado_range`), **automatic and audited** series advancement,
      and HTTP routes behind a new `fiscal.profile.manage` permission with the
      allocation as an **internal service**, not a route. **Work units**, in
      order. **WU-A, the Story and the baseline correction** (this commit).
      **WU-B, the pure series progression** (`packages/fiscal/src/timbrado/**`):
      `null -> AA`, `AZ -> BA`, `ZZ -> terminal`, no `Ñ`, no skipping. **WU-C,
      the schema**: the three tables, the two enums, the migration, the static
      migration tests and the live-PostgreSQL proof. **WU-D, the allocation**:
      the transactional compare-and-swap counter with the series rollover.
      **WU-E, the surface**: the profile/establishment/range routes, the
      permission, the audit and tenant isolation.
- [ ] T8 — FISC-012: `SifenDirectFiscalProvider` + the asynchronous capability's
      implementation + provider selection. **Inherits from FISC-009 the worker's
      signing stage** (claim `SIGNING`, sign the DE with `signDteXml`, then
      `SIGNING -> SENDING`; a signing failure goes to `SIGNING -> ERROR`), and
      **from FISC-010 three more things**, per ADR-007 and ADR-008: **(a)** the
      real `FiscalCredentialPort` in the worker — `@newsaas/secret-store` in
      `apps/worker/package.json`, `SecretsModule`, `SECRET_STORE_MASTER_KEYS`
      and the `secretStore.get` path, **none of which exists today**; **(b)**
      the **reconciliation stage** — the TD-028 sweep extended to `SUBMITTED`,
      calling `query` and applying the terminal result, with `retryAfterMs`
      bounding the next attempt; **(c)** **persisting the signed DE**
      (`xml_storage_key`, still written by nothing) and the submission path's
      logging, which is where FISC-009's "no secret in a log or a stored
      snapshot" criterion now lives. **The two consultation services are IN
      scope**: the Manual's §9.4 CDC query is what resolves a document after the
      Guide's 48-hour batch window, and §9.6's RUC status query is the sixth
      service of the endpoint list. **What stays blocked and out of scope is the
      signed v150 query family** — by protocol, by range, and the RUC archive —
      whose request signature profile no source pins (FISC-013, against a real
      service). **Note on this Story's row in the epic**: FISC-010 **adds** the
      port's asynchronous capability; FISC-012 **implements** it. The epic's
      earlier wording ("the port's asynchronous-status extension") was corrected
      on 2026-10-08.
- [ ] T9 — FISC-013: contingency + certification evidence.
- [ ] T10 — FISC-014: epic closure.

## Two lineages are NOT closed, and the second one is why the fixes rest on argument

The mapper's work needed **two review lineages**, and neither closed. Both are
recorded here because an escalated or stuck authority is a state the maintainer
has to see, not a green tick.

```text
review-d1934d6b6a6db4b0   the mapper            ESCALATED  (terminal stop)
  reviewer   admitted a result
  refuter    confirmed R3-DTOTOPE (inferential)
  correction 65 lines, committed 6e4fe02
  validator  native-operation-failed -- NO VERDICT
  authority  ESCALATED, cause targeted_validator_rejected
  transition stop / native_stop_required

review-83755a14a6eda333   the correction, re-reviewed on its own
  reviewer   found R3-001 (deterministic): affectation 4 double-counted its
             exempt half because the rate subtotal took lineTotal instead of
             E735 + E736, and F003 (dSubExo) was not emitted at all
  correction 80 of 81 allowed diff lines, committed 0463066
  validator  capture-binding-rejected TWICE, after a STATUS that reoffered the
             identical slot -- the host relay cannot deliver it
  authority  correction_required, awaiting a validation that will not run
```

**Both findings were real and both fixes are in.** The first (`dTotOpe` wired to
the taxed base, so an exempt line vanished from the operation total) and the
second (the rate subtotal taking `lineTotal` for a partially taxed item,
double-counting its exempt half, plus `dSubExo` never being emitted). The
routing is now by **affectation**, which is what NT 013 defines:

```text
F002 dSubExe  E731 = 3 -> EA008      E731 = 4 -> E737 (the exempt base)
F003 dSubExo  E731 = 2 -> EA008
F004 dSub5    E731 = 1 -> EA008      E731 = 4 -> E735 + E736
F005 dSub10   E731 = 1 -> EA008      E731 = 4 -> E735 + E736
dTotOpe       the sum of the subtotals, before adjustments
```

**And then the second correction DID get its verdict.** Because the workspace
was clean and the provider offered a committed range, the correction was
re-reviewed on its own as `82d484f..576c830` — a fresh lineage,
`review-ba6218e187d42859`, medium tier, one lens — and **closed `approved`**
with two non-blocking `WARNING`s and no correction required. So the subtotal fix
and the record around it have a receipt.

The two lineages above stay as they are. **The first correction (`dTotOpe`)
still has no verdict of its own** — it was inside the escalated range, and the
escalated lineage is terminal.

**What the fixes rest on, stated plainly.** The subtotal fix has a review
verdict now. The `dTotOpe` fix does not: its lineage's validator failed. So that
one rests on an argument I can check and on tests I can run — the schema's own
ordering for `dTotOpe`, NT 013's field-by-field rule for the subt otals, and
arithmetic that adds up by hand (106 = 60 + 6 + 40). The gates are green and CI
is green, which is evidence about behaviour and not about review.

**The maintainer's options**, per the provider's own continuation: inspect the
lineages' authority, or disable the review switch for this clone
(`gentle-ai review mode disable --scope clone`), after which ordinary repository
policy decides delivery. Nothing is reset or recovered here: `RESET` and
`RECOVER` are destructive and need an explicit decision with exact native
inputs.

## WU-C: the mapper

**DONE 2026-10-06.** `packages/fiscal/src/dte/dte.mapper.ts` holds
`buildDteRequestFromInvoice({ invoice, profile, identity }) -> DteRequest`,
pure: no I/O, no ambient clock, no tenant context. Authorized by [[DEC-054]]
(accepted), whose option B gives the emitter fiscal profile's storage to
FISC-011 — so the profile is an **input**, and the mapper is callable and
testable today even though nothing in production supplies one yet.

**The XSD case is the proof that mattered.** Putting the mapper's output through
the schema-validation suite caught two real invalidities that no shape test
could see: `totalsElement` emitted six of `tgTotSub`'s **ten** required members,
in the wrong order, and `gValorItem` was missing its required `gValorRestaItem`.
Both are fixed, and the case now runs in the same suite as the fixture's.

**Two things it deliberately does not do**, both recorded in the module and in
baseline §22.14: it does not re-derive tax (NT 013's formulas state no rounding
rule, so the invoice's own `taxableBase`/`taxAmount` are carried rather than
giving money a second source of truth), and it does not derive `F023` (NT 008
defines it as `F014 * D018` with the same unpinned rounding, so a foreign
currency supplies it). It always supplies the `D208c` total the currency names,
which is the obligation `R3-D208C-OPTIN` placed on it.

## WU-C's review is ESCALATED, not closed (2026-10-06)

The mapper's candidate did **not** close. The chain, recorded because an
escalated lineage is a state the maintainer has to see rather than a green tick:

```text
review-d1934d6b6a6db4b0   medium tier, review-reliability, 9 files / 883 lines
  reviewer      admitted a result
  refuter       provider_refuter_required -> CONFIRMED a CRITICAL
  finding       R3-DTOTOPE (inferential, introduced)
  correction    submitted as a 65-line plan, committed as 6e4fe02
  validator     native-operation-failed -- NO VERDICT, nothing mutated
  authority     ESCALATED, cause targeted_validator_rejected
  transition    stop / native_stop_required   (terminal)
```

**The finding was right and the fix is in.** `totalsElement` wired `dTotOpe` to
the sum of the lines' `taxableBase`, so an exempt line vanished from the
operation total: the emitted `dTotOpe` was 100.00000000 while `dTotGralOpe` was
160.50000000, with every adjustment member zero. `dTotOpe` is now the sum of the
subtotals and `dTotGralOpe` derives from the same value. The same finding
exposed that **NT 013's `F002` rule was half implemented**: for a partially
taxed item (`E731 = 4`) it takes `E737`, the exempt base, and the mapper added
nothing.

**The validator produced no verdict for THAT lineage, and that is stated, not
papered over.** I re-derived the fix against the schema's own structure as the
only available check: in `tgTotSub`, `dTotOpe` sits after the subtotals and
**before** `dTotDesc`/`dTotAnt`/`dDescTotal`, while `dTotGralOpe` sits after
them — so the operation total is the pre-adjustment total, and with zero
adjustments the two must agree. That was a structural argument, not a review.

**And then the content got its receipt anyway — twice over.** Because the
workspace was clean, the provider resolved a fresh committed range and two later
lineages closed **`approved`**:

```text
review-ba6218e187d42859   the subtotal correction        approved
review-d348e4bdb5bcd5b0   the mapper's current state      approved
```

The second one is the one that matters here: the provider resolved its base to
the escalated lineage's own correction tree, so it reviewed the mapper's
**current** content — `dte.mapper.ts` and `dte.mapper.test.ts` among the changed
files — and closed `approved` with two non-blocking `WARNING`s. One of them,
`R3-EPIC-DUP`, found **three duplicated sections in this very file**, which were
a real defect from repeated scripted insertions and are now removed.

**What that does and does not settle.** The mapper's content has a receipt; the
escalated lineage's own authority is still terminal and untouched, and three
commits (`e8677fe`, `6e4fe02`, `5897628`) remain outside any closed _range_
although their content was reviewed. **The maintainer's options are unchanged**:
inspect the lineage's authority, or disable the review switch for this clone
(`gentle-ai review mode disable --scope clone`), after which ordinary repository
policy decides delivery. Nothing is reset or recovered here: `RESET` and
`RECOVER` are destructive and need an explicit decision with exact native
inputs.

## Review coverage

**FISC-010 WU-A — `review-fe256d67a4d60ed5`, `approved`, zero lenses
(2026-10-08).** A docs-only candidate over 8 files and 2,165 changed lines. The
provider classified it **`non_executable_only`** at **`low`** tier with
`lenses_required: false`, so no lens, refuter or validator ran: the closure came
from the provider's own risk evaluation, not from a capture. `inspect` ran
**before** the commit (a clean tree would have made the candidate a committed
range whose base ref the facade cannot express), `select-intended-untracked`
adopted the four new files, and `acknowledge-approved` burned the authority with
`native-approved-acknowledgement-completed`. **Recorded because a code work unit
will not be classified this way**: the WUs that follow are executable and will
require the four lenses.

**FISC-010 WU-A's correction — `review-7e0ebabc11a3a00c`, `approved`, zero
lenses (2026-10-08).** The same classification over the six corrected files
(`low`, `non_executable_only`, `lenses_required: false`), the same closure
without a capture, and the same burn. The correction's substance is in the
Story's "naming collision" section and in `SIFEN-BASELINE.md` §23.6: the
consultation services were recorded as blocked and are not.

**FISC-008 review coverage, verified 2026-10-06.** PR **#106**, head `5d09015`,
`MERGEABLE/CLEAN`, all three checks green (`DTE XSD validation` among them, now
a required check on `main`).

**30 of the 33 commits from `0479e67` to HEAD are inside a closed range. The
three that are not are named, not glossed:**

```text
e8677fe  feat(FISC-008): map a confirmed invoice to a DteRequest
6e4fe02  fix(FISC-008): dTotOpe is the operation total, not the taxed base
5897628  docs(FISC-008): record that WU-C's review is escalated, not closed
```

Those three are exactly the escalated range `a06e7b7..5897628`. **Their content
was not left unexamined**: the subtotal correction that followed them was
re-reviewed on its own as `82d484f..576c830` and **closed `approved`**, and the
schema suite proves the mapper's output is valid. What is missing is a _closure_
for that specific range, and the escalated lineage is where that lives —
terminal, awaiting the maintainer.

Every other range closed, and the lineages are named in the section above.

## Notes

- Base: merged `main` `b05d411` (PR #104 merged; FISC-006 landed). The "What
  exists already" section below was verified on `4c02473` and remains accurate
  for every item it lists.
- **FISC-010's base is `68b3c74`, not `ffd08a1`** (2026-10-08): `main` does not
  contain `4907e65` (the epic's ADR-order correction), the FISC-011 completion
  commits or `68b3c74`, and both pending branches touch the files WU-A edits.
  Chosen by the maintainer when the discrepancy was reported.
- The rename leaves ~20 older Story references to "EPIC-16 the provider" intact
  in substance; the one that became factually wrong (`FISC-003`'s
  `FISCAL_PROVIDER` closed set) is corrected.
- Inherited debt: [[TD-032]] (**resolved** — every advisory fixed or accepted
  with a reason), [[TD-029]] (operator re-drive, closed by FISC-012 against a
  real primitive), [[TD-030]] (EPIC-15 review advisories), [[TD-026]] (unbounded
  lists), [[TD-022]] (portal surface).
