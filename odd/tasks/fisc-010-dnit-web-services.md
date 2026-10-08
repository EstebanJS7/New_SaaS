---
feature: fisc-010-dnit-web-services
epic: EPIC-16
story: FISC-010
status: done
created: 2026-10-08
branch: feat/epic-16-fisc-010-dnit-web-services
---

# FISC-010 — DNIT web services

Feature record for **T6** of [[EPIC-16]]. Story:
`docs/02-stories/FISC-010-dnit-web-services.md`.

## Goal

Deliver the SIFEN web-service layer: the SOAP 1.2 Document/Literal transport
over TLS 1.2 with mutual authentication using the tenant's certificate, the
message shapes of the services DNIT publishes, and the asynchronous outcome
model SIFEN produces — plus the two ADRs that gate it ([[ADR-007]],
[[ADR-008]]).

It does **not** deliver `SifenDirectFiscalProvider`, provider selection, the
worker's signing stage, or the real credential wiring. Those are [[FISC-012]],
per the boundary decided with the maintainer on 2026-10-08.

## Authorization

Authorized by the maintainer on 2026-10-08 as **WU-A, docs-only**: ADR-007,
ADR-008, the Story, `SIFEN-BASELINE.md` §23 and the tracker. No source write in
WU-A. **And authorized again the same day as the WU-A correction** ("haz lo
recomendable para abordar ese caso"): resolve the consultation-services blocker
by looking for the source instead of accepting the deferral — still docs-only,
same files.

Base: **`68b3c74`** — `main` (`ffd08a1`) plus `docs/epic-16-bookkeeping`
(`4907e65`) and `feat/epic-16-fisc-011-completion` (`68b3c74`), which are not
yet merged. The maintainer chose this base on 2026-10-08 rather than `ffd08a1`,
because both pending branches touch the two bookkeeping files WU-A edits, and
`4907e65` is the commit that corrected ADR-007's position in the epic.

## Decisions taken by the maintainer (2026-10-08)

1. **The credential boundary is FISC-010's to define, not to wire.** FISC-010
   defines the per-call credential port and proves it with a double; FISC-012
   wires the worker (the `SecretStore` module, its env keys and the read path)
   together with the signing stage. Reason: the worker has no `SecretStore`
   today, and the read-the-private-key path does not exist anywhere.
2. **A parser without a DOM.** Prefer `fast-xml-parser` over declaring
   `@xmldom/xmldom`, whose `/// <reference lib="dom" />` already broke an
   unrelated typecheck in [[FISC-009]] (recorded in [[ADR-006]]).

## Work units

- [x] **WU-A — the decisions, the Story and the baseline retrieval record.**
      [[ADR-007]] (the port's asynchronous outcome capability), [[ADR-008]] (the
      transport, the credential port and the parser), the FISC-010 Story,
      `SIFEN-BASELINE.md` §23 (the service-schema retrieval record and the WSDL
      block), and the tracker. Docs-only: the content commit plus the record of
      its commit, its review and the branch's gates. **Landed 2026-10-08 —
      `3779569`, plus the record commit that carries this line.**
- [x] **WU-B — the message layer (pure).** The request and response shapes of
      the **six** services — reception, batch reception, batch query, event
      reception, the **CDC query** (`rEnviConsDeRequest`) and the **RUC status
      query** (`rEnviConsRUC`) — as types plus serializers and parsers, with the
      result-code tables. No I/O: fixtures come from the official schemas and
      from the Guide's own examples. **Landed 2026-10-08**: four modules under
      `packages/fiscal/src/sifen/` (`codes`, `messages`, `serializer`,
      `parser`), 121 new cases, and the two ADR-008 dependencies added to
      `packages/fiscal`. Two document corrections came out of it: an unlisted
      result code is **carried, not refused**, and the ZIP is **write-only** in
      this Story.
- [x] **WU-C — the transport.** The SOAP 1.2 Document/Literal client over
      `node:https` with a per-call mutual-TLS agent built from the tenant's
      certificate, the `FiscalCredentialPort`, and the guardrails ADR-008
      decides (response size cap, DOCTYPE refusal, no value coercion, no
      cross-tenant socket reuse). Proven against a local TLS double that
      verifies the client certificate. **Landed 2026-10-08**: commit `9f92642`,
      33 new cases (fiscal 24 files / 421 tests),
      `FiscalProviderModule.forRoot()` wired in both deployables, and the
      live-PostgreSQL gate re-run at 218/218 because the API's composition root
      moved. Two ADR-008 gaps closed by the work: the per-call trust anchor, and
      the two criteria re-pointed to [[FISC-012]]. Its review required the
      feature's first bounded correction.
- [ ] **WU-D — the port's asynchronous capability and the schema.** The outcome
      vocabulary, the `query` capability, the migration that gives the
      asynchronous reference a column and `submitted_at` its writer, and the
      live-PostgreSQL proof of the new edges.
- [ ] **WU-E — the service facade.** One typed method per published service
      (**six**, including the two consultations), each bound to its endpoint
      from baseline §8, composing WU-B and WU-C, and the mapping from SIFEN's
      result codes to the port's outcomes — including `0420`/`0421`/`0422` and
      `0500`/`0501`/`0502`, which is what closes the post-window path.

## Out of scope for this feature record

- `SifenDirectFiscalProvider`, `FISCAL_PROVIDER` selection and the worker's
  signing stage — [[FISC-012]].
- Persisting the signed DE and the submission path's logging — [[FISC-012]],
  which owns the stage that has the signed document. The acceptance criterion
  [[FISC-009]] pointed at FISC-010 is re-pointed there, with the reason recorded
  in the Story.
- Contingency and homologation evidence — [[FISC-013]].

## Evidence

```text
branch   feat/epic-16-fisc-010-dnit-web-services   from 68b3c74
WU-A     3779569  docs(FISC-010): the DNIT web-service decisions, the Story and
                  the baseline §23 — 8 files, 2,116 insertions, 49 deletions
         review-fe256d67a4d60ed5  closed `approved`, tier `low`,
                  `non_executable_only`, zero lenses required; the
                  acknowledgement burned the authority
correction
         f71871c  docs(FISC-010): correct the consultation blocker — the source
                  was there  — 6 files, 364 insertions, 186 deletions
         review-7e0ebabc11a3a00c  closed `approved`, tier `low`,
                  `non_executable_only`, zero lenses required; the
                  acknowledgement burned the authority
WU-B     5bdf676  feat(FISC-010): the SIFEN message layer — 16 files, 3,830
                  insertions (121 new cases in four suites), plus
                  `fast-xml-parser@^5.11.2` and `fflate@^0.8.3`
         review-f16dff5e521484d2  closed `approved`, tier `medium`, lens
                  `review-reliability`, four advisories at
                  `WARNING`/`informational` (`R3-001`..`R3-004` in
                  `sifen.parser.ts`), none opening a correction; the
                  acknowledgement burned the authority
WU-C     9f92642  feat(FISC-010): the SIFEN transport and the per-call credential
                  port — 15 files, 2,085 insertions (33 new cases), the TLS
                  double, `forRoot()`, and the trust-anchor gap ADR-008 closed
         review-ac6687061a6f8f5d  closed `approved`, tier `medium`, lens
                  `review-reliability`, **one CRITICAL corrected** (refuter ->
                  correction plan of 40 diff lines -> targeted validation), then
                  two advisories at `WARNING`/`informational`; the
                  acknowledgement burned the authority
WU-D     a1ce736  feat(FISC-010): the port's asynchronous capability and the
                  provider reference — 18 files, 1,052 insertions (the port, the
                  migration, the writer, the fake, the five-mirror drift fix)
         review-535e9a45a5624196  **ESCALATED**, tier `high`, four lenses, one
                  CRITICAL corrected then rejected by the targeted validator
                  (`state: escalated`, `native_stop_required`); nothing committed
         review-68028f3d442967b0  closed `approved`, tier `high`, four lenses,
                  one CRITICAL corrected (refuter -> correction plan of 30 diff
                  lines -> targeted validation passed), then four advisories at
                  `WARNING`/`SUGGESTION`; the acknowledgement burned the authority
WU-E     b567265  feat(FISC-010): the service facade and the outcome mapping —
                  5 files, 2,195 insertions (61 new cases)
         review-4548d852efe5ee3a  closed `approved` on the FIRST pass, tier
                  `medium`, lens `review-reliability`, one advisory at
                  `WARNING`/`informational` (`R3-0362-REASON-EMPTY`), no
                  correction; the acknowledgement burned the authority
gates    format-check green; lint 18/18, typecheck 18/18, test 19/19 and build
         11/11 forced; fiscal 507 tests (26 files), worker 79, database 445,
         api 1149 (+220 live-PG skipped), web 1087; live-PostgreSQL 220/220; and
         `db:live-verify` green on a freshly created database
closure  2026-10-08: 12/12 package gates for fiscal/database/api, the four root
         gates, `format-check`, `db:deploy` + `db:live-verify` on a fresh
         database, and `test:live-pg` at 220/220. The Story is `done`; every
         criterion is checked or explicitly re-pointed to FISC-012, 215 new
         cases across ten suites, and eleven advisories are recorded as accepted
         debt.
```

## Review record

**WU-A — `review-fe256d67a4d60ed5`, `approved`, no lenses (2026-10-08).** The
provider classified the candidate `non_executable_only` at `low` tier with
`lenses_required: false`, so the four-lens review never ran and the closure came
from the provider's own risk evaluation. Inspected **before** committing, per
the lesson that a clean tree turns the candidate into a committed range the
facade cannot express as a base ref; the intended-untracked selection was
resolved with `select-intended-untracked`, which adopted the four new files and
closed the lineage. The acknowledgement was called with the lineage alone, and
the burn returned `native-approved-acknowledgement-completed`.

**WU-B — `review-f16dff5e521484d2`, `approved` with one lens (2026-10-08).** The
provider classified the candidate **`medium`** for a `configuration_change` on
`packages/fiscal/package.json` and selected **one** lens, `review-reliability`;
the single materialize slot forecast one model run and then ran it over the
`pi_host_relay` transport. The closure is `approved` with **four advisories**,
all `WARNING`/`informational` and none opening a correction; they are recorded
in the Story's Technical Debt, with the coordinates the closure gave and an
explicitly-labelled reading, because **the reviewer's full text is not
retained** by this facade. `inspect` ran before the commit, the
intended-untracked selection adopted the eight new files, and the
acknowledgement burned the authority.

**WU-D — two lineages, and the first one escalated (2026-10-08).**
`review-535e9a45a5624196` (tier `high`, four lenses, 18 files) found one
CRITICAL and its **targeted validator rejected the correction** — the fake
echoed the request's CDC on answers that resolve nothing, contradicting the
contract the same correction had just documented. The provider declared
`escalated` / `native_stop_required` / horizon terminal, so **the maintainer
chose a fresh transaction** over the corrected candidate.
`review-68028f3d442967b0` then found the same defect class one level deeper: the
handler wrote `providerReference` unconditionally while the same expression
already guarded `cdc` and `externalId`, so a null hand-over handle became a
clearing write the guard refuses — an aborted transaction on the retry path,
which is a resubmitted document. The refuter corroborated it, the bounded
correction (30 diff lines, submitted before the edit) made all three columns
conditional, the targeted validator passed both checks, and the lineage closed
**`approved`** with four non-blocking advisories. **The lesson is in the
Story**: "absent, never null" is a rule about the whole expression, not about
the columns you happened to be looking at.

**WU-C — `review-ac6687061a6f8f5d`, `approved` after one bounded correction
(2026-10-08).** Tier `medium`, one lens (`review-reliability`), 15 files and
2,093 changed lines. The lens raised one **CRITICAL** in the transport's
response lifecycle; STATUS demanded a **refuter**, which corroborated it as
candidate-caused; `correction_required` followed and STATUS demanded a
**correction plan**, submitted as 40 diff lines **before** the edit; the
correction added a `close`-without-`complete` failure path plus a test for the
aggregate property; STATUS then demanded a **targeted validation**, which passed
`original_criteria` and `correction_regression`; and the acknowledgement burned
the authority. Two advisories survive at `WARNING`/`informational` and the
validator's follow-up is recorded in the Story's Technical Debt. **The
validation route is not `gentle_review_capture`**: the vector is
`gentle-ai review capture-validation --materialize`, the host relay runs the
role independently over the frozen trees, and the verdict is submitted with
`--input`.

**WU-A's correction — `review-7e0ebabc11a3a00c`, `approved`, no lenses
(2026-10-08).** The same classification over the six corrected files: tier
`low`, `non_executable_only`, `lenses_required: false`, so no lens, refuter or
validator ran and the closure came from the provider's risk evaluation.
Inspected **before** committing, started with the offered route and a fresh
idempotency key, and the acknowledgement burned the authority with the same
outcome.

## Notes

- **Correction, 2026-10-08: the two consultation services are NOT blocked.** The
  first §23 recorded them as blocked on a request signature no source pins. That
  was a misreading: the published v150 consultation schemas (`siConsultaDTE`,
  `siConsultaArchivoRuc`) are **different services** (by protocol, by range, and
  the RUC archive, all signed, all returning ZIPs), while the Manual's §9.4 and
  §9.6 pin the two the endpoint list names as **unsigned** — and the published
  v141 artifacts (`WS_SiConsDE_v141.xsd`, `WS_SiConsRUC_v141.xsd`, zero
  `xmldsig` occurrences) and the Guide's example agree. The blocker was a search
  not yet run (baseline §22.1's lesson). §23.6/§23.8, the Story, the epic and
  the tracker were rewritten; the **signed family** keeps its own open question
  and stays out of scope.
- **The review never ran its lenses, and that is the provider's call, not a
  skip.** WU-A came back `non_executable_only` at `low` tier with
  `lenses_required: false`; nothing was captured because nothing was required. A
  code work unit will not be classified that way.
- **The v150 async batch schemas are not published.**
  `WS_SiRecepLoteDE_v150.xsd`, `WS_SiConsLote_v150.xsd` and the Manual's own
  `SiRecepLoteDE_v150.xsd` family return **HTTP 404**; the batch shapes are
  published only as **v141** files. §23 records this and the Story scopes around
  it.
- The WSDL is unreachable on **both** hosts (302 → `/vdesk/hangup.php3`), and a
  bogus path and the host root return the same redirect, so the probe says
  nothing about the paths themselves.
