---
feature: epic-16-sifen-direct
epic: EPIC-16
status: in-progress
created: 2026-10-03
updated: 2026-10-05
branch: feat/epic-16-fisc-008-dte-xml
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
   be logged or returned. → before FISC-007.
2. **The XAdES signing dependency.** Which library, its provenance, its update
   story and how it is pinned. → before FISC-009.
3. **An asynchronous status capability on the provider port.** SIFEN answers
   asynchronously, so `issue` alone is insufficient; the port needs a status
   query and the worker needs reconciliation. → before FISC-012.

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
- [ ] T4 — **FISC-008: DTE XML + XSD validation — contract pinned 2026-10-04.**
      Story at `docs/02-stories/FISC-008-dte-xml.md`. **The retrieval FISC-006
      left open is done**: `DE_Types_v150.xsd` was fetched from the official
      directory (66,452 bytes, HTTP 200) together with `DE_v150.xsd` (66,190)
      and `xmldsig-core-schema.xsd` (10,339), and its facts are recorded in
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
- [~] T4 — **FISC-008: DTE XML + XSD validation — contract pinned 2026-10-04;
  WU-A implemented 2026-10-05.** Story at `docs/02-stories/FISC-008-dte-xml.md`.
  **The retrieval FISC-006 left open is done**: `DE_Types_v150.xsd` was fetched
  from the official directory (66,452 bytes, HTTP 200) together with
  `DE_v150.xsd` (66,190) and `xmldsig-core-schema.xsd` (10,339), and its facts
  are recorded in `docs/06-fiscal/SIFEN-BASELINE.md` §21 — 140 `simpleType`s
  with their enumerations, the scalar patterns for
  CDC/RUC/timbrado/series/document number/dates/money, and the `rDE` (4
  children) and `tDE` (11 children) structures. **One decision blocks the
  acceptance criterion, not the implementation**: the schemas are copyrighted
  and must not be vendored. **Decided 2026-10-04**: a dedicated CI job fetches
  the three schemas, asserts each fetch, and runs the validation with the skip
  disabled, so a green run cannot come from having validated nothing.
  **Retrieval completed 2026-10-04**: baseline §22 carries the Manual's
  field-level rules (73 `D`-codes; the receptor block's conditional structure;
  the test-environment literal for `dNomEmi`; the cross-field invariants), four
  companion tables were fetched as official XSDs. **Geography closed**: the
  official `CÓDIGO DE REFERENCIA GEOGRAFICA_NOVIEMBRE_2025` spreadsheet gives
  `D111`/`D113`/`D115` (18 departamentos, 272 distritos unique nationally, 6,766
  ciudades). NT 26 excludes four B2G validation rules and NT 27 amends the
  nomination _event_ format, so neither changes a DE rule FISC-008 must
  implement. **Still open**: `Tabla 3 – Actividades Económicas` (`D131`), whose
  Manual link now returns an HTML portal shell. `D104` closed 2026-10-05 (TABLA
  1 is inline in the Manual; see baseline §22.6). The CDC's **composition** also
  closed 2026-10-05 — it is a picture of a table on page 56 and the Manual's
  worked example matches the KuDE specimen byte for byte; only the check-digit
  algorithm remains open. **And a correction**: the Nota Técnica set is
  **001-027, not 23-27**. **All 27 were retrieved and profiled** (baseline
  §22.10): eighteen touch DE fields and ten amend validations, and **nine amend
  the receptor block alone** (`D200`/`D201`/`D202`/`D208`/ `D210`), which §22.3
  pins from the 2019 Manual. **The receptor block's rule text is now transcribed
  and consolidated** (baseline §22.11): NT 023 removed the `o D202=4` half of
  `D208`'s `No informar` clause, NT 024 lowered the `D208c`/1321 threshold from
  NT 021's 35,000,000 to **7,000,000**, and NT 003 excluded the `D219`/`D223`
  validations in favour of field conditions. The generator implements §22.11 and
  must never read §22.3 for a receptor condition. The remaining provisional
  areas are the non-receptor ones — currency/exchange, emitter
  activity/imputation, items and titles — while the structural contract
  (`rDE`/`tDE`, order, patterns, money scales) is unaffected because the notes
  amend observations and validations, not the schemas.

      **WU-A, the builder — done 2026-10-05.** `packages/fiscal/src/dte/**`
      (`dte.types.ts`, `dte.rules.ts`, `dte.builder.ts`, `dte.builder.test.ts`)
      plus the re-export from `packages/fiscal/src/index.ts`: a pure
      `typed request -> XML string` function with no clock, randomness or I/O,
      `rDE`'s four children and `tDE`'s eleven in schema order, `dVerFor` = 150,
      the CDC as a **validated input** never composed (§22.9), `dCodSeg`
      validated per §10.3, the per-field money scales, and the **receptor block
      from §22.11** with its seven validations (`1300`, `1332`, `1319`, `1321`,
      `1331`, `1333`, `1314`) rather than from §22.3. **A wrong first pass was
      caught and corrected**: the initial builder placed `iTipTra`, `iTImp`,
      `cMoneOpe`, `dTiCam` and `iCondOpe` inside `gOpeDE` — a group membership
      inferred rather than read. `DE_v150.xsd` (already retrieved, cached in
      `/tmp`, never vendored) was re-read and **baseline §21.6 now transcribes
      `tDE`'s internal groups** (`gOpeDE`, `gTimb`, `gDatGralOpe`, `gOpeCom`,
      `gEmis`, `gDatRec`, `gCamFuFD`), so no emitted structure rests on an
      assumption; the members of `gDtipDE`, `gTotSub`, `gCamGen` and
      `gCamDEAsoc` stay untranscribed and are carried as caller-supplied ordered
      elements. **Tests**: 22 new cases in `dte.builder.test.ts` — child order,
      CDC, `dCodSeg`, widths, timestamps, money scales per type, currency,
      the receptor conditions including the B2C case §22.3's old clause would
      have rejected, the B2G `gCompPub` non-rule, the test-environment literal,
      enum bounds, cardinality, determinism and escaping. **Gates**: fiscal
      lint/typecheck/test (84 passed) /build green; root `format-check`, lint
      (18/18), typecheck (18/18), test (19/19; API 1107 passed) and build
      (11/11) green; live PostgreSQL **213/213**. **Two gaps recorded rather
      than hidden**: `dCodSeg` is validated but not generated (randomness would
      break the determinism criterion, so the generator belongs where a random
      source exists), and the converse of `D206` — refusing a RUC on a
      non-contributor — comes from §22.3's clause that §22.11 does not restate
      and NT 020's untranscribed text, so it is not encoded.

      **WU-B, the CI validation job — done 2026-10-05.** A dedicated
      `xsd-validation` job in `.github/workflows/ci.yml` fetches the official
      schemas into `${{ runner.temp }}/dte-xsd`, asserts each artifact, and runs
      the schema-validation suite with the skip **disabled**. The tooling lives
      in `packages/fiscal/src/dte/xsd-artifacts.ts` (the artifact list, the
      assertions, the include rewrite), `xsd-validator.ts` (the entry schema and
      the libxml2 validation), `dte.fixture.ts` (the schema-valid request and
      the structural signature), `scripts/fetch-dte-schemas.mjs` (the CLI) and
      the two suites (`xsd-artifacts.test.ts` 9 cases without a network,
      `xsd-validation.test.ts` 7 cases), exported from
      `@newsaas/fiscal/testing` rather than the package index. **Two claims in
      the Story's own wording were wrong and were corrected with the
      maintainer's approval**: it is **seven schemas, not three**
      (`DE_v150.xsd` `xs:include`s four companion tables and `DE_Types_v150.xsd`),
      and **an unsigned DE cannot validate at all**, because `ds:SignatureType`
      requires `SignedInfo` — so the gate validates a structurally complete
      signature with placeholder contents, and the real signature is FISC-009's.
      Both corrections are recorded in baseline **§21.7** together with the third
      operational fact that made the naive job wrong: five of those includes are
      **absolute HTTPS URLs**, so a co-located file is ignored and the validator
      reaches DNIT at validation time — proven by a compile failure with the
      network blocked. The job therefore rewrites them, and refuses a directory
      that still resolves anything over HTTP. `libxmljs2` was added as a
      **devDependency** (`allowBuilds: true` in `pnpm-workspace.yaml`, because
      its prebuilt binding arrives through a postinstall) with the maintainer's
      approval, chosen over a system `xmllint` so the suite has exactly one
      reason to skip: the schemas being absent. **Evidence**: `pnpm
      fetch:dte-schemas /tmp/dte-xsd-live` prepared 7 artifacts whose sizes match
      the 2026-10-04 retrieval exactly, with 0 absolute URLs left; the suite at
      **100 passed / 100** with `DTE_XSD_REQUIRED=1`, the same 100 with the
      network blocked, 93 + 7 explicit skips with no schema directory, and a
      hard failure naming all seven artifacts when required without them.
      Recorded in `docs/10-qa/CI-EVIDENCE.md`; the CI run id follows the push and
      the PR, which the maintainer owns. **Review**: native review
      `review-7a00fe71a5c544dd`, tier **high**, four lenses.
      `R2-control-flow` (`CRITICAL`) needed one bounded correction — its premise
      did not reproduce, but the misreadable construct was removed in `580de4a`
      (32 diff lines) and the targeted validator admitted it; the review then
      closed **approved** and its authority is burned. The eight non-blocking
      advisories are **[[TD-032]]**, one of which caught a false case count in
      the Story's own CI record, now fixed. **WU-C, the invoice -> request
      mapping**: **blocked**, but the blocker list was corrected on 2026-10-05
      after a read-only investigation. It is **not** `D104` any more (TABLA 1 is
      inline in the Manual; the earlier claim was wrong) and it is **not** the
      CDC's composition any more (it is a picture of a table on page 56, and the
      Manual's worked example matches the KuDE specimen byte for byte). What is
      still open: (1) ~~the rule text of the non-receptor notes~~ — **CLOSED
      2026-10-05**: the four areas are transcribed in baseline §22.12 (currency
      and exchange, with NT 008's `F023` formulas and NT 012's `D022`/1213),
      §22.13 (titles/transaction type, and NT 018's affected-obligations
      subgroup with its new TABLA 12 catalogue plus `D031`/1220, `D032`/1221 and
      NT 022's `D031a`/1222) and §22.14 (items, with NT 013's per-item IVA
      formulas and their six validations). What remains is *code*, not
      retrieval; (2) `D131`'s activity catalogue, whose Manual link now returns
      an HTML portal shell; (3) ~~the CDC's **check digit**~~ — **CLOSED
      2026-10-06**: the document §10.2 cites was found on the DNIT domain and
      pins `Pa_Calcular_Dv_11_A` (weights 2..11 from the right, `resto > 1 ?
      11 - resto : 0`, letters by ASCII), reproducing the Manual's worked CDC and
      the RUC digit in all four example documents. **Composing it is now a scope
      decision, not a gap** — the block is FISC-008's own acceptance criterion,
      recorded in DEC-054 with a recommendation to compose it; and (4) the
      emitter fiscal profile and
      timbrado, which **no model and no story currently hold** — that is FISC-011
      plus a decision. An exploration of the invoice side found that a confirmed
      invoice supplies lines, currency, `confirmedAt` and the customer, and
      supplies none of the emitter identity, timbrado, coded geography, unit of
      measure, currency descriptions or exchange rate; `buildDteXml`/`DteRequest`
      have no production consumer yet (FISC-012's provider is the intended one).

- [ ] T4b — **FISC-008 WU-C: the invoice -> request mapper — re-scoped and
      proposed 2026-10-05, awaiting [[DEC-054]].** Two decisions are the
      maintainer's: where the emitter fiscal profile and the timbrado live
      (recommendation: FISC-011 owns storage, WU-C takes the profile as an
      input) and whether the CDC is composed now (recommendation: not until a
      second specimen or the verifier document arrives; the next attempt is to
      render chapter 13's KuDE pages, which are graphics too — **that search was
      run and it found THREE more — two in the Guía de Mejores Prácticas and one
      in DNIT's `Estructura xml_DE.rar` example — taking the corpus to four
      specimens, which **eliminated** the naive weighting family instead of
      confirming a variant; four specimens cannot pin a longer period either, so
      the verifier document or FISC-013's homologation run are what remain).
      **The `D208c` correction is DONE** (2026-10-05): the request carries
      `totalOperacion` (`F014`) and `totalGuaranies` (`F023`), the builder
      selects by currency as §22.12 records, and it refuses `F023` for a PYG
      document per NT 008.
- [ ] T5 — FISC-009: XAdES signing + `SIGNING` + ADR.
- [ ] T6 — FISC-010: DNIT web services.
- [ ] T7 — FISC-011: timbrado and numbering ranges.
- [ ] T8 — FISC-012: `SifenDirectFiscalProvider` + port extension + ADR.
- [ ] T9 — FISC-013: contingency + certification evidence.
- [ ] T10 — FISC-014: epic closure.

## Review coverage

**FISC-008 review coverage, recorded 2026-10-06.** PR **#106**, head `f0cf14b`,
`MERGEABLE/CLEAN`, all three checks green (the new `DTE XSD validation` job
among them, now a required check on `main`).

**The coverage claim, stated precisely because it is checkable.** From `0479e67`
to `f0cf14b` the branch is tiled by **18 closed ranges covering all 24
commits**, each with its own lineage and every one closed `approved`: WU-A
`review-5f02ddd057fd6758`, WU-B `review-7a00fe71a5c544dd` (one bounded
correction), the `D208c` correction `review-8d9b7cf45e039c2b`, the fetch timeout
`review-2d607ead610b3633`, the TD-032 resolution `review-3d99274120684773`, its
close `review-050847fbb8ae40c9`, and ten docs-only ranges that closed on the
`START` call itself (`review-c77f287fe241b1b3`, `review-df0c5fb76056a959`,
`review-5d015917b6866a9c`, `review-976a645a0e4beb8d`, `review-45e9783a54fbbaae`,
`review-931b6ca48ff1f749`, `review-39b47f8a4dd53004`, `review-b4fee44aa678c49d`,
`review-d81ec937ce380c03`, `review-81e01e2568c1ca79`, `review-d32a3cd1bc89bbe0`,
`review-ca69f1e07a93b788`).

**Before `0479e67` there are 11 commits — the contract-pin and retrieval phase —
and their coverage is recorded less well, which is stated rather than smoothed
over.** They are `34588d4`, `02b28bb`, `4ae17a3`, `75253ea`, `902cce4`,
`a3a6665`, `7892eef`, `33f982b`, `c866c9a`, `8e39b79` and `0479e67`, all
docs-only. They were reviewed as docs-only candidates in the earlier session,
whose record names seven lineages — `review-8a6b94a896127f08`,
`review-1a4ef19151b70257`, `review-4d05cbbfec00788e`, `review-2fba8ef90d9e4e77`,
`review-229a93e0dbec3610`, `review-bf483d1599370639`, `review-f814dc0d957abcf3`
— for eight candidates, and the review store holds all of them. **The eighth
lineage's identity is not recoverable from the repository**: the provider's
per-lineage `target` is an opaque `sha256:` identity, not a git tree, so the
records cannot be matched back to commits programmatically. That is a gap in
this tracker's _record_, not evidence that a review is missing, and the
distinction is written down instead of being resolved by guessing an id.

## Notes

- Base: merged `main` `b05d411` (PR #104 merged; FISC-006 landed). The "What
  exists already" section below was verified on `4c02473` and remains accurate
  for every item it lists.
- The rename leaves ~20 older Story references to "EPIC-16 the provider" intact
  in substance; the one that became factually wrong (`FISC-003`'s
  `FISCAL_PROVIDER` closed set) is corrected.
- Inherited debt: [[TD-032]] (**resolved** — every advisory fixed or accepted
  with a reason), [[TD-029]] (operator re-drive, closed by FISC-012 against a
  real primitive), [[TD-030]] (EPIC-15 review advisories), [[TD-026]] (unbounded
  lists), [[TD-022]] (portal surface).
