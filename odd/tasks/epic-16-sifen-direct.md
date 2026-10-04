---
feature: epic-16-sifen-direct
epic: EPIC-16
status: in-progress
created: 2026-10-03
updated: 2026-10-04
branch: feat/epic-16-fisc-007-signing-material
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
      FISC-008 must implement. **Still open**: `Tabla 1 – Tipo de Régimen`
      (`D104`) and `Tabla 3 – Actividades Económicas` (`D131`), which the Manual
      references but does not contain. **And a correction**: the Nota Técnica
      set is **001-027, not 23-27**. **All 27 were retrieved and profiled**
      (baseline §22.10): eighteen touch DE fields and ten amend validations, and
      **nine amend the receptor block alone** (`D200`/`D201`/`D202`/`D208`/
      `D210`), which §22.3 pins from the 2019 Manual. So the receptor rules are
      **provisional** — a correctness risk, not a completeness one — while the
      structural contract (`rDE`/`tDE`, order, patterns, money scales) is
      unaffected because the notes amend observations and validations, not the
      schemas.
- [ ] T5 — FISC-009: XAdES signing + `SIGNING` + ADR.
- [ ] T6 — FISC-010: DNIT web services.
- [ ] T7 — FISC-011: timbrado and numbering ranges.
- [ ] T8 — FISC-012: `SifenDirectFiscalProvider` + port extension + ADR.
- [ ] T9 — FISC-013: contingency + certification evidence.
- [ ] T10 — FISC-014: epic closure.

## Notes

- Base: merged `main` `b05d411` (PR #104 merged; FISC-006 landed). The "What
  exists already" section below was verified on `4c02473` and remains accurate
  for every item it lists.
- The rename leaves ~20 older Story references to "EPIC-16 the provider" intact
  in substance; the one that became factually wrong (`FISC-003`'s
  `FISCAL_PROVIDER` closed set) is corrected.
- Inherited debt: [[TD-029]] (operator re-drive, closed by FISC-012 against a
  real primitive), [[TD-030]] (EPIC-15 review advisories), [[TD-026]] (unbounded
  lists), [[TD-022]] (portal surface).
