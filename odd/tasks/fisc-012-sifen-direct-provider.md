---
feature: fisc-012-sifen-direct-provider
epic: EPIC-16
story: FISC-012
status: in-progress
created: 2026-10-08
branch: feat/epic-16-fisc-012-sifen-direct-provider
---

# FISC-012 — `SifenDirectFiscalProvider` and the worker's real submission

Feature record for **T8** of [[EPIC-16]]. Story (not written yet):
`docs/02-stories/FISC-012-sifen-direct-provider.md`.

## Goal

Replace the fake with the real provider: `SifenDirectFiscalProvider` behind the
existing port, the **worker** building, signing and submitting a real DE, the
credential read, the signed document persisted, and the reconciliation stage
that walks `SUBMITTED`.

Base: **`ff8954e`** (`main`, with FISC-010 merged). Unlike FISC-010 this branch
starts from `main` directly — nothing is stacked on it.

## The reconnaissance (2026-10-08, two read-only scouts + one retrieval)

### The QR is NOT blocked — and the baseline was wrong about it

`SIFEN-BASELINE.md` §14 grades the QR as **[O] open**: _"The QR's exact
composition and the CSC's per-environment value were not extracted in detail."_
**That was a tooling gap, not a source gap.** The Manual's **§13.8** (pages
205–209) pins it completely, and the earlier `pypdf`/`fetch_content` extraction
dropped it — the same failure §22.1 documented for the tables and images, and
the third time this vault has recorded it.

Retrieved 2026-10-08 from the already-local PDF (`/tmp/manual-v150.pdf`,
5,204,470 bytes — the artifact §22.1 recorded) with **PyMuPDF**, which extracts
what `pypdf` dropped:

```text
§13.8.1  the printed image is >= 25 mm wide (22 mm content + 3 mm quiet zone),
         ISO/IEC 18004; the content is the DE's field J002
         the CSC is 32 alphanumeric digits, issued by SIFEN, up to two active
§13.8.2  the QR carries the consultation URL plus the DE's parameters:
           Production  https://ekuatia.set.gov.py/consultas/qr?
           Test        https://ekuatia.set.gov.py/consultas-test/qr?
         and a SHA-256 hash of those parameters
§13.8.3  dFeEmiDE and DigestValue are converted to their HEXADECIMAL equivalent
         (the hex of the string's bytes); everything is concatenated and SHA-256'd
§13.8.4  five steps: concatenate -> append the CSC -> SHA-256 -> build the URL
         with &cHashQR=<hash> -> escape every & as &amp; before it enters the XML
§13.8.5  the messages the consultation page shows
```

The parameter table (§13.8.2, verbatim values):

```text
nVersion            AA002   3   hash yes  URL yes
Id (the CDC)        A002   44   hash yes  URL yes
dFeEmiDE            D002   19   hash yes  URL yes
dRucRec/dNumIDRec   D206/  20   hash yes  URL yes (*)
                    D210
dTotGralOpe         F014   23   hash yes  URL yes (*)
dTotIVA             F017   23   hash yes  URL yes (*)
cItems (count of E701)      3   hash yes  URL yes (*)
DigestValue         XS17    -   hash yes  URL yes
IdCSC               -       4   hash yes  URL yes
cHashQR             -       -   hash no   URL yes
(*) a field with no value is filled with "0"
```

**Two consequences the Story must carry:**

1. **The QR is built AFTER signing.** Its `DigestValue` is the signature's
   digest and its `Id` is the CDC, so the DE XML cannot contain the final QR
   when it is signed. That is _why_ `gCamFuFD` sits **outside** the signed `DE`
   subtree (baseline §4) — the schema's own layout makes room for it. The build
   therefore needs a **QR placeholder** the signer's output fills, exactly as
   `SIGNATURE_PLACEHOLDER` already works.
2. **The CSC never enters the URL.** §13.8.4.2 appends it only to compute the
   hash, and §13.8.3/4 say so twice: _"Por ningún motivo el contribuyente debe
   compartir su código de seguridad, ni enviar concatenado como parte de la
   URL"_. So the CSC is per-tenant secret material, not a constant.

### The other reconnaissance findings that shape the plan

- **The worker's `FiscalProviderModule.forRoot()` passes no `credentialPort`**,
  so it runs the fail-closed null port today; the worker has no
  `@newsaas/secret-store` dependency and **no `SECRET_STORE_*` env entries at
  all**.
- **`apps/api` and `apps/worker` share no code beyond workspace packages**
  (ADR-008), and the API's `createTimbradoRangeStore` (153 lines) and its
  profile/establishment reads live in `apps/api`, coupled to
  `RequestContextService`. The worker needs its own read path from a `tenantId`
  argument.
- **`signDteXml` and the mutual-TLS client credential are the same certificate**
  (baseline §6: _"The same certificate is used for two distinct purposes:
  signing data messages, and mutual authentication"_), so one credential read
  serves both.
- **`FiscalIssueRequest` carries invoice data, not a document**: no emitter
  profile, no timbrado, no CDC, no QR, no XML. Its only production builder is
  `fiscal-submission.handler.ts:221`, and the API never builds one.
- **The XSD gate is dev-only**: `libxmljs2` is a devDependency and
  `validateDeAgainstOfficialXsd` is exported only from
  `@newsaas/fiscal/testing`, never the production barrel. A runtime XSD step in
  the worker is not possible without promoting the export and the dependency.
- **`xml_storage_key` has no writer and no reader anywhere**, and
  `STORAGE_KEY_PREFIXES` has only `brand` — the fiscal prefix is ours to add.
- **The handler claims straight to `SENDING`** in one `updateMany`; `SIGNING` is
  admitted by the DB guard and mirrored in five TypeScript unions but **claimed
  by nothing**. The sweep walks only `QUEUED` and `ERROR`, injects only
  `PrismaService` and has no `FISCAL_PROVIDER` and no `SUBMITTED` path.
- **`dTotGralOpe`/`dTotIVA` default to `0`**, `cItems` counts `E701`
  occurrences, and `dRucRec` is `D206`/`D210` — all from §13.8.2's own table.
- **The Manual contradicts itself on the host**: §13.8.2 writes
  `https://ekuatia.set.gov.py/consultas/qr?`, §13.8.4.4's "Donde" writes
  `https://www.ekuatia.set.gov.py/...`, and the worked example uses **no
  `www.`**. The example and §13.8.2 agree, so the client emits no `www.` and the
  divergence is recorded.

## The WU-D reconnaissance (2026-10-08): what a DE needs that the data does not model

One read-only scout over `main` + WU-A..WU-C, with the decisive claim verified
independently. It **stopped WU-D**, and its output is [[DEC-056]].

**The six inputs the assembly needs and the tenant's rows do not supply:**

| need                                       | source today                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the fiscal number, and its link to a range | `allocateDocumentNumber` has **no production caller**; `Invoice.number` comes from Billing's `invoice_number_sequence` (`apps/api/src/billing/billing.service.ts:612`, `billing.repository.ts:402-419`) |
| the range's key (establishment/point/type) | **nothing persists it** on `Invoice` (`schema.prisma:2342-2387`) or `FiscalDocument` (`:2547-2605`)                                                                                                     |
| the receptor                               | `DteReceptor` has 24 fields (`dte.types.ts:213-248`), `Customer` has 8 (`schema.prisma:666-680`), **nothing maps them**; `Invoice.customerId` is nullable (`:2350`)                                     |
| `E731 iAfecIVA` and `E734 ivaRate`         | only `InvoiceLine.rateCode` (`schema.prisma:2433`); the mapper refuses to invent them (`dte.mapper.ts:27-30`)                                                                                           |
| `cUniMed`/`dDesUniMed`                     | **no column**: `CatalogItem` has no unit (`schema.prisma:1305-1367`)                                                                                                                                    |
| `dDesMoneOpe`                              | nothing; only a fixture literal (`dte.fixture.ts:116`) — the cheapest to close, since it is a protocol table                                                                                            |
| the CSC and its `IdCSC`                    | **unmodelled**: no column, no secret reference, no setting; DEC-055 Q2 said it _should_ be per-tenant secret material                                                                                   |

**Three wiring gaps that are WU-D's own and implementable today:**
`SIFEN_ENVIRONMENT` is never parsed
(`apps/worker/src/config/worker-env.schema.ts:10-37` has neither it nor
`DTE_XSD_DIR`); no fiscal storage prefix exists
(`packages/storage/src/storage-keys.ts:18-21` defines only `brand`) and
`xml_storage_key` (`schema.prisma:2568`) has **no writer and no reader**; the
XSD gate **compiles per call** (`xsd-validator.ts:63-84`) while the criterion
requires once per process, and `libxmljs2` is still a **devDependency** although
imported at runtime — ADR-010's promotion was never made.

**The risk, in the scout's words:** a guessed range key emits a `dEst`/`dPunExp`
the emitter is not authorised for; a number allocated at issuance while the
invoice keeps its Billing number gives one invoice two CDCs, which is the
duplicate-send case `0360` punishes; and an invented receptor fallback hides a
missing RUC behind a document that looks valid.

**What this means for the plan**: WU-D's criteria split in two — four of them
(the claim, the credential, the custody and the gate) are properties of the
_stage_ and are satisfiable today; the assembly is where the product decisions
are, and it does not get improvised.

## The decisions this feature needs

1. **ADR-009 — the port's request carries the signed document.** For SIFEN the
   adapter must submit a _signed DE_, and the request carries invoice data. The
   provider cannot build the DE: that needs Prisma (the profile, the timbrado,
   the allocation) and `packages/fiscal` must depend on neither. So the
   **worker** builds and signs the document and the request carries it. This is
   a change to the Fiscal Provider boundary, which `DOCUMENTATION-RULES.md`
   names as an ADR case.
2. **DEC-055 — where the worker's Prisma adapters live.** The worker needs a
   `TimbradoRangeStore` implementation and a profile/establishment read, and the
   API already has both. The store is the allocation's **compare-and-swap**, so
   two copies could drift and only the API's copy is covered by the
   live-PostgreSQL suite — which argues for **one shared implementation** in a
   new workspace package (`@newsaas/fiscal-persistence`, mirroring how
   `packages/storage` holds a port's driver), consumed by both apps. The
   alternative — a worker-local copy — is smaller now and riskier later, and it
   is recorded as the rejected option with its reason.
3. **DEC-055 also records**: the QR is FISC-012's to build from §13.8 (now
   pinned), the CSC is per-tenant secret material (a `SecretStore` entry, never
   a constant), the reconciliation walks `SUBMITTED` with the TD-028 sweep, and
   the `0360` re-drive question FISC-010 left open is answered here.

## Work units

- [x] **WU-A — the decisions, the Story and the baseline §24** (docs-only):
      [[ADR-009]], [[ADR-010]], DEC-055, the FISC-012 Story, `SIFEN-BASELINE.md`
      **§24** (the QR composition from §13.8 with the retrieval record, the
      sign-then-QR ordering, the three Manual defects and the DE-build chain),
      and the tracker's T8. **Landed 2026-10-08** — see the Evidence below.
- [ ] **WU-B — the shared fiscal persistence package** (or the worker-local
      adapters, per DEC-055): the Prisma `TimbradoRangeStore`, the
      emitter-profile read and the credential read, moved or written once and
      consumed by both apps, with the live-PostgreSQL proof where it belongs.
      **Landed** — see the Evidence.
- [ ] **WU-C — the QR**: a pure `buildQrContent(...)` in `packages/fiscal` (the
      URL, the parameters, the hex conversions, the SHA-256 hash, the escaping)
      plus the builder's QR placeholder and the fill step, table-driven against
      §13.8.4's own worked example. **Landed** — see the Evidence.
- [ ] **WU-D — the worker's document stage**: the `QUEUED -> SIGNING -> SENDING`
      claim, the build → sign → QR → fill chain, the persistence of the signed
      XML (`xml_storage_key`, a new fiscal storage prefix), and the credential
      read that serves both the signature and mutual TLS. **Narrowed by DEC-056
      and split into two reviewable slices**:
  - **WU-D1 — the port surface and the credential boundary** (the port's
    `document` field and `requiresSignedDocument`, the worker's own secret-store
    composition root, the credential-port provider, the env entries, `libxmljs2`
    as a runtime dependency). **Landed** — see the Evidence.
  - **WU-D2 — the stage and the custody**: the claim transitions, the document
    seam that fails closed, store-then-validate, the `xml_storage_key` writer,
    the fiscal storage prefix and the XSD gate's per-process compile.
- [ ] **WU-E — `SifenDirectFiscalProvider`**: the port implementation over the
      facade (the sync/batch strategy, `query`, `cancel`), the provider
      selection (`FISCAL_PROVIDER=SIFEN_DIRECT` with the production refusal
      kept), and the `null` credential → `CONFIGURATION_ERROR` mapping.
- [ ] **WU-F — the reconciliation**: the TD-028 sweep extended to `SUBMITTED`,
      calling `query`, applying a terminal resolution and leaving `PROCESSING`
      alone, with the `0360` decision recorded. **Landed** — see the Evidence.

## Out of scope

- **Contingency and the homologation run** — [[FISC-013]]. The QR and the CSC
  can be built and tested here, but only a real habilitación proves them.
- **The signed v150 query family** — still blocked on the consultation request's
  signature profile ([[FISC-010]] §23.6/§23.8).
- **KuDE rendering** and the portal surface.
- **Per-tenant `SIFEN_ENVIRONMENT`** — deployment-level until a product decision
  changes it ([[ADR-008]] §3).

## Evidence

```text
branch   feat/epic-16-fisc-012-sifen-direct-provider   from ff8954e
WU-A     7949f04  docs(FISC-012): the decisions, the Story and the QR's retrieval
                  record — 8 files, 1,533 insertions, 38 deletions
         review-27456c2f386bd5f9  closed `approved`, tier `medium`, lens
                  `review-reliability`, five advisories at
                  `WARNING`/`SUGGESTION`, none opening a correction; the
                  acknowledgement burned the authority
WU-B     e20fc6b  feat(FISC-012): the fiscal persistence package and the moved
                  range store — 13 files, 911 insertions (the two store files
                  recorded as 100% renames)
         review-fb085a14b38e2ae8  closed `approved`, tier `high` (a process
                  boundary in the live-PG spec), FOUR lenses, three advisories
                  at `WARNING`, none opening a correction; the acknowledgement
                  burned the authority
WU-C     f968843  feat(FISC-012): the QR, its placeholder and the one fill —
                  3 files, 577 insertions (222 the module, 340 its suite)
         review-5eeef34d2f4685c2  closed `approved`, tier `medium`, one lens
                  (`review-reliability`), two advisories at `SUGGESTION`, neither
                  opening a correction; the acknowledgement burned the authority
WU-D1    0ca390a  feat(FISC-012): the port's document surface and the worker's
                  credential boundary — 15 files, 441 insertions (2 new files)
         review-eed5d94fb24e9e54  closed `approved`, tier `medium`, one lens
                  (`review-reliability`), three advisories (two `WARNING`, one
                  `SUGGESTION`), none opening a correction; the acknowledgement
                  burned the authority
WU-D2    8224825  feat(FISC-012): the document stage and its custody — 9 files,
                  890 insertions (the seam 78, its test 37, the handler +288 and
                  its suite +368)
         review-736ec8a3be9b5e21  closed `approved`, tier `medium`, one lens
                  (`review-reliability`), three advisories (one `WARNING`, two
                  `SUGGESTION`), none opening a correction; the acknowledgement
                  burned the authority
WU-E1    5bdd61b  feat(FISC-012): SifenDirectFiscalProvider over the facade —
                  5 files, 1,267 insertions (the provider 586, its suite 617)
         review-ca72a76b131d66e4  closed `approved`, tier `medium`, one lens
                  (`review-reliability`), two advisories at `SUGGESTION`, neither
                  opening a correction; the acknowledgement burned the authority
WU-E2    9295769  feat(FISC-012): the provider selection, and the production hole
                  it opened — 8 files, 521 insertions
         review-661aab129f50b6f9  tier `medium`, one lens, **one CRITICAL
                  finding** (`R3-SIFEN-PRODUCTION-DEFAULT`, `introduced`):
                  refuted → **corroborated** by a read-only refuter → bounded
                  correction (plan 60 diff lines) → targeted validator **passed
                  both checks** → closed `approved`; the acknowledgement burned
                  the authority
WU-F     0bdedac  feat(FISC-012): the reconciliation sweep, and the poisoned row
                  it could not survive — 8 files, 1,456 insertions
         review-025e631ba1a38a1b  tier `high` (the live-PG process boundary),
                  **FOUR lenses**, **one CRITICAL finding**
                  (`R4-001`, deterministic, `introduced`): corrected over THREE
                  rounds — the first was reverted (a sweep-level catch that hid
                  failures), the second was over the frozen budget (228 > 200),
                  the third passed both checks — closed `approved`; the
                  acknowledgement burned the authority
gates    format-check green; lint 20/20, typecheck 20/20, test 21/21, build 12/12;
         fiscal 577, worker 140, api 1143 (+223 live-PG), database 445, web 1087,
         secret-store 50, fiscal-persistence 27, ui 36, shared 16; and the
         live-PostgreSQL suite at **223/223** on a disposable PG16.13 (UTC)
```

## Review record

**WU-A — `review-27456c2f386bd5f9`, `approved` with one lens (2026-10-08).**
Tier `medium`, lens `review-reliability`, 8 files and 1,571 changed lines. It
closed `approved` with **five advisories**, all `WARNING`/`SUGGESTION` and none
opening a correction. **The reviewer's full text is not retained** by this
facade, so what follows is the coordinates plus _this session's reading_ of
each, marked as an inference, and what was done about it:

| id     | location             | our reading of the location                                                                                          | action    |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- |
| R3-001 | `FISC-012-…:230-231` | The reconciliation ACs pin the cadence but not the mechanism: which clock and which comparison bound the next query. | WU-F's    |
| R3-002 | `ADR-010-…:214-217`  | The ADR names the re-drive loop a permanent failure would create and does not bound it.                              | **fixed** |
| R3-003 | `FISC-012-…:175-179` | The credential AC's wrapped line made the returned shape hard to read.                                               | **fixed** |
| R3-004 | `ADR-010-…:146-148`  | The store/validate order was left as "either order is acceptable", which is two implementations.                     | **fixed** |
| R3-005 | `FISC-012-…:164`     | The AC said "the two Manual defects" while §24 records **three**.                                                    | **fixed** |

**Three fixes landed in the same follow-up commit as this record**, because they
were one-line corrections in documents the review had just read: the WU-F
criteria gained **"a permanent failure does not loop"** and the Story's
Technical Debt names it, the WU-D criteria now pin **store-then-validate** (so a
refused document is inspectable and `xml_storage_key` is never written for a
document that was not stored), and the count is three. R3-001 stays where it
belongs — WU-F's, whose mechanism it is — and is recorded rather than guessed at
now.

`inspect` ran before the commit, with `untrackedScope: select` adopting the five
new files; the first START returned an empty result, STATUS re-offered the
selection, and the retry created the lineage. The acknowledgement burned the
authority.

**WU-B — `review-fb085a14b38e2ae8`, `approved` with four lenses (2026-10-08).**
Tier `high` (the process boundary in the live-PG spec), four lenses, 15 files
and 1,696 changed lines. It closed `approved` with **three advisories**, all
`WARNING` and none opening a correction — reported by coordinate with the same
caveat, so the reading is ours:

| id     | location                            | our reading of the location                                                                                           | action          |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------- |
| R2-001 | `fiscal-credential.reader.ts:19-20` | The reader's header states the three states it distinguishes; a reader of the file has to hold them against the code. | recorded        |
| R3-001 | `live-pg-isolation.e2e-spec.ts:36`  | The suite's import now crosses a package boundary, so the live proof depends on the new package being built first.    | **noted below** |
| R4-001 | `emitter-profile.read.ts:117-126`   | Two statements instead of the API's one `include`: the activities read is a second round trip, not a join.            | recorded        |

**And a formatting fix that the same advisory kept pointing at.** R3-003 of WU-A
was a wrapped line inside an inline code span, and the "fix" landed a line break
inside the span, which prettier renders as stray spaces. It is now one unbroken
span — recorded because it took two attempts and the second one only looked like
a fix.

**WU-B's notes.**

- **The live-PostgreSQL gate ran against a locally provisioned PostgreSQL
  16.13**, not the `fisc009-pg` container: Docker's WSL integration is gone from
  this distro (it worked earlier the same day). The worker followed the repo's
  own recorded practice (EPIC-06's disposable cluster) and ran the exact
  authorized command. Same major version, same migrations, UTC.
- **The suite is UTC-sensitive, and that is a finding.** A non-UTC server fails
  the FISC-011 date-boundary case by constraint-name matching (219/220) because
  `'2018-04-30'::timestamptz` lands at 04:00 UTC; the container was UTC. Worth
  knowing for any future environment change.
- **The package's consumers**: the API imports the moved store from it (the
  live-PG suite). The worker's wiring is WU-D's, and that is where the Story's
  "consumed by both apps" closes.
- **The store's move is provable**: `git show HEAD:<old path> | diff` is clean,
  and the commit records both files as **100% renames**.
- **The profile read is two statements, not one `include`**: an
  `include`-dependent return type does not fit the structural client that the
  tests pin at compile time, and the two-statement form keeps each query's
  result shape explicit.

**WU-C — `review-5eeef34d2f4685c2`, `approved` with one lens (2026-10-08).**
Tier `medium` (an executable change in the new test file), one lens, three files
and 577 changed lines. It closed `approved` with **two advisories**, both
`SUGGESTION`, neither opening a correction:

| id     | location            | our reading of the location                                                                                                                         | action   |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R3-001 | `dte.qr.ts:125-126` | The `"0"` defaults for `dTotGralOpe`/`dTotIVA`. §13.8.2's footnote nominally also covers `dRucRec`/`dNumIDRec`, which this contract types non-null. | recorded |
| R3-002 | `dte.qr.ts:221`     | The three-line `escapeXmlText` mirroring the builder's, which is not exported.                                                                      | recorded |

Both were the coordinates the worker had already raised as judgement calls, and
the second is the one the delegation itself created: the brief forbade editing
`dte.builder.ts`, whose escaper is private, so the alternative to duplicating
three lines was touching a file the previous work unit's review had read.

**WU-D1 — `review-eed5d94fb24e9e54`, `approved` with one lens (2026-10-08).**
Tier `medium` (an executable change in the API's boot harness), one lens, 15
files and 451 changed lines. It closed `approved` with **three advisories**,
none opening a correction:

| id     | location                             | our reading of the location                                                                                                     | action   |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R3-001 | `fiscal-provider.port.ts:258-267`    | The flag's contract is documented on the port while its enforcement is WU-E's, so nothing in this candidate proves the refusal. | recorded |
| R3-002 | `worker.module.ts:25-30`             | The credential port is a process singleton whose `read` is per call — the property ADR-008 §2 asks for, stated in prose only.   | recorded |
| R3-003 | `secret-store/secrets.test.ts:49-53` | The version test asserts the driver's class rather than the behaviour (that new writes use the rotated version).                | recorded |

**WU-D1's notes.**

- **A required port member reaches farther than the port.** `FiscalProviderPort`
  has three in-repo implementations, and the two doubles needed the flag; the
  API's boot harness is outside the worker's surfaces, so the worker **stopped
  and asked** instead of editing it. The extension was approved and the change
  is one line — the same shape FISC-010 hit when `query` was added, and that
  file's own comment records it.
- **`fiscal-provider.port.ts` is source-scanned for protocol vocabulary**
  (`fiscal-provider.port.test.ts` forbids `sifen`, `lote`, `consulta`, `0360`…
  in that file, doc comments included). The worker's first draft named SIFEN in
  a comment and the _test_ caught it — `tsc` was silent.
- **zod 3's `superRefine` sees `.default()`-applied values**, so a field-level
  default makes "absent" indistinguishable from "explicitly `TEST`". The
  production presence gate is therefore optional field + presence check +
  trailing transform. A fact worth reusing wherever this schema pattern appears.
- **The reader's real argument shape is `{ client, secretStore }`**, not
  `{ prisma, secretStore }` as the delegation sketched: `PrismaService`
  satisfies the narrow `FiscalCredentialReadClient` structurally, so no adapter
  and no cast.
- **The identifier drift was mine, and the ADR won.** I first told the worker to
  use `SignedFiscalDocument` and then that ADR-009 was stale; the ADR is the
  accepted decision and the code was the deviation, so the type is
  `FiscalIssueDocument` and the ADR needed no edit. Reversing my own instruction
  was cheaper than rewriting an accepted decision to match my mistake.
- **The consent envelope expired once.** The first START for this candidate
  returned `consent-binding-stale` with `lineage_created: false` — so nothing
  was created and nothing mutated, and a fresh START was the documented recovery
  rather than a retry of the same binding. Worth knowing: the envelope's clock
  is real, and a long gate run before a START can outlive it.
- **`SIFEN_ENVIRONMENT` is validated and unconsumed until WU-E**, and
  `DTE_XSD_DIR` until WU-D2. The boot refusal is the deliverable here: a
  production process without the environment variable does not start.

**WU-D2 — `review-736ec8a3be9b5e21`, `approved` with one lens (2026-10-08).**
Tier `medium` (an executable change in the new seam's test), one lens, 9 files
and 957 changed lines. It closed `approved` with **three advisories**, none
opening a correction:

| id                        | location                               | our reading of the location                                                                                                                                                                                  | action        |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| R3-SIGNING-EXIT           | `fiscal-submission.handler.ts:313-315` | A re-claimed `SENDING` row resends the stored bytes **without re-running the gate**. ADR-010 §3 says the gate runs "before every submission", and the schema is cached now, so re-validating costs one call. | **follow-up** |
| R3-STORAGE-FAIL-UNCOVERED | `fiscal-submission.handler.ts:341-349` | The `storage.put` failure branch (`DOCUMENT_STORAGE_WRITE_FAILED`) has **no test**: the double's `put` only succeeds.                                                                                        | recorded      |
| R3-ORPHANED-OBJECT        | `fiscal-submission.handler.ts:359-363` | A lost claim after a successful `put` leaves an orphaned object; nothing deletes it. The worker flagged this itself.                                                                                         | recorded      |

R3-SIGNING-EXIT is the one worth acting on: it is a contract sentence from an
accepted ADR rather than a style point, and the fix is three lines in the resume
path. It is recorded as a follow-up for **WU-F**, which already owns the resend
and sweep surface, rather than reopening a review that closed without a
correction.

**WU-D2's notes.**

- **The guard's asymmetry forced the design.** `SENDING -> SIGNING` is not an
  admitted edge, so a re-claim cannot write a status: it is a timestamp CAS that
  keeps the observed status. The worker verified this against the migration and
  said so, and no migration was needed.
- **That asymmetry is also why the custody writes the `cdc`**: a `SENDING` row
  re-claimed must resend the stored bytes, and ADR-007 §2's reconciliation needs
  the document's identity on the row even when the hand-over answer never
  arrived.
- **The `SENDING` recovery path was the worker's own addition**, beyond the
  delegation's forward-only custody sentence, and it flagged it as such. It is
  what makes the status-keeping re-claim functional for a requiring provider.
- **The cache test had to count compiles without a test-only export**: it wraps
  `parseXml` with `vi.mock` + `vi.hoisted`, and uses a directory unique to the
  test because `defaultDteSchemaDirectory()` would inherit an earlier test's
  cache.
- **ADR-010's promotion was half-done in WU-D1** — the dependency moved, the
  exports did not — and this slice closed it. The same class of finding as the
  barrel: a decision's _second_ sentence is easy to leave behind.
- **Two subagent sessions were cross-wired**: I sent the WU-D2 approval to the
  WU-D1 session by task id, and the barrel promotion landed from the wrong
  session before the right one was resumed. The outcome was sound — one file,
  validated, kept by the session that owned it — but the lesson is to **re-read
  the task list before continuing a session**, not to trust a remembered id.

**WU-E1 — `review-ca72a76b131d66e4`, `approved` with one lens (2026-10-08).**
Tier `medium`, one lens, 5 files and 1,267 changed lines. It closed `approved`
with **two advisories**, both `SUGGESTION` and both in the new suite's leak
assertions:

| id     | location                                | our reading of the location                                                                                                                                                    | action   |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| R3-001 | `sifen-direct.provider.test.ts:422-427` | The leak assertion runs on `JSON.stringify(result)` rather than on the sanitized snapshot itself, so a leak through another field or a transformed encoding would not fail it. | recorded |
| R3-002 | `sifen-direct.provider.test.ts:569-572` | The serializer-refusal test asserts the _reason_ carries no document fragment, while the message that does quote the document is the serializer's own.                         | recorded |

I verified the production path by hand instead, and it is leak-safe by
construction: the transport's and the facade's messages are **fixed sentences
per member** (their own tables), and the two classes whose messages can quote
document bytes map to fixed reason sentences instead of `error.message`.

**WU-E2 — `review-661aab129f50b6f9`, `approved` with one lens and one CRITICAL
(2026-10-08).** Tier `medium`, one lens, 8 files and 503 changed lines. This is
the first candidate in the epic that the review **did not** let through, and the
arc is the record worth keeping:

| stage      | what happened                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| finding    | `R3-SIFEN-PRODUCTION-DEFAULT`, `CRITICAL`, `introduced`: `resolveSifenEnvironment` defaulted an absent `SIFEN_ENVIRONMENT` to `TEST` for **every** environment, and this slice made the API accept `sifen-direct` in production — a production API could have built the real adapter against the **DNIT test host** ([[ADR-008]] §3). The API's own new test asserted the broken behaviour. |
| refuter    | The provider required a refuter because the finding was **inferential**. It was told to refute first; it searched for a production gate in the package, the API's schema, `main.ts` and the fiscal module, found none, and answered **corroborated**.                                                                                                                                       |
| correction | Plan submitted **before** any edit: 60 diff lines against a frozen budget of 200. The fix closes the hole at **both** construction points — the package's factory (the single place every deployable passes through) and the API's schema at boot, scoped to the provider that has an environment.                                                                                          |
| validator  | The targeted validator passed **both** checks: every original criterion met in the corrected candidate, and no regression — it looked specifically for a non-production path that now refuses, a weakened expectation and a stale caller. One follow-up: the corrected test asserts the same production object twice.                                                                       |
| closure    | `approved` on the validator's admission; the acknowledgement burned the authority.                                                                                                                                                                                                                                                                                                          |

**WU-E1's notes.**

- **The batch answer identifies an operation, never a document**, so
  `mapBatchReceptionOutcome` nulls `cdc` on every row — the adapter must overlay
  the request's own CDC or the lost-hand-over reconciliation loses its only
  identity. Overlaying it is not re-deriving the table: the outcome, the
  reference and the reason still come from the mapper.
- **The serializer's `UNEXPECTED_DOCUMENT_ROOT` message prints the first 48
  characters of the document**, which is why parse and serialization failures
  map to fixed reason sentences rather than `error.message`. A reader who
  assumes the failure tables make every message safe would be wrong for exactly
  two classes.
- **The control number** is 15 digits from `node:crypto` with a non-zero leading
  digit (the pattern's own not-all-zero rule), injected so a test is
  deterministic. §9.2.1 calls `dId` a sequential emitter responsibility and no
  persisted counter exists here: the enforced properties are kept and the
  monotonicity question is carried to [[FISC-013]].
- **`Record<SifenTransportFailure, …>` buys compile-time exhaustiveness**: a new
  member breaks the build rather than silently defaulting, and the test table
  pins the values.

**WU-E2's notes.**

- **The review route for non-lens roles is the CLI, not the capture tool**: the
  refuter (`review.capture-refuter`), the correction plan
  (`review.capture-correction-plan`) and the validator
  (`review.capture-validation`) are provider-owned operations the facade does
  not carry. Each rejected the facade's binding with "unknown, expired, or
  belongs to a different session route" — which is the honest answer, not a
  stale binding.
- **`capture-refuter --execute` is refused for the `pi` agent** — "it is
  host-mediated" — so the route is `--materialize` (which prints the exact task,
  the input and the output schema), run the role read-only over the **frozen**
  trees, then `--input=<file>`. The same shape as the validator.
- **A zod trap that the test caught**: the first attempt added only the
  `superRefine` rule and not the field, and `z.object` **strips undeclared
  keys**, so the rule fired even when the operator had set the variable. The
  field's comment now records it — a rule reading a key the object schema does
  not declare reads `undefined` forever.
- **The consent envelope expires on a clock, and a fresh START is the
  recovery**: two candidates in a row returned `consent-binding-stale` with
  `lineage_created: false`, so nothing was created and nothing mutated, and the
  documented recovery is a new START rather than a resend of the same binding.
- **A CRITICAL finding is the review working, not the process failing.** The
  finding was true, the API's own test encoded the bug, and the correction was
  cheap — because the finding arrived before the commit rather than after a
  production incident.

**WU-F — `review-025e631ba1a38a1b`, `approved` with four lenses and one CRITICAL
(2026-10-08).** Tier `high` (the process boundary in the live-PG spec), four
lenses, 8 files and 1,410 changed lines. The finding is the most valuable one
the epic produced, and the correction took **three rounds** — two of which were
wrong, which is why they are recorded:

| stage   | what happened                                                                                                                                                                                                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| finding | `R4-001`, `CRITICAL`, deterministic, `introduced`: the query loop wrapped only the **provider call** in try/catch. Applying the answer was unguarded, so a malformed instant or a refused write threw out of the loop with that row's marker unadvanced — the row was re-selected on every sweep and blocked every other due document, and the sweep's own failure was invisible. |
| refuter | **Not needed**: the finding was `deterministic`, and the contract sends only inferential blockers to a refuter.                                                                                                                                                                                                                                                                   |
| round 1 | I added a guard around the loop **and** a sweep-level catch. The validator called it: a bare catch returning counters identical to an idle sweep **hides a real failure**, and it was outside the finding's scope. Reverted.                                                                                                                                                      |
| round 2 | The rewritten candidate was **228 changed lines against a frozen budget of 200** — wrapping the switch re-indented it — and the provider rejected the validation outright. Rewritten smaller: the guard sits where the failure happens, and the diff came to 176.                                                                                                                 |
| round 3 | The validator passed **both** checks: every original criterion met, no regression. It checked specifically that the guard is scoped to the application, that the counters mean what they say, that nothing surfaces less than before, and that no expectation was weakened.                                                                                                       |

**WU-F's notes.**

- **The sweep's clock and the provider's cadence are different things**, and one
  nullable marker decouples them: 60 seconds of sweep against §23.7's ten
  minutes. `null` means "never queried", which is also the migration's
  compatibility bridge.
- **The handler must write the first marker**, or the backfill formula would
  exist only for legacy rows and every new hand-over would be polled a minute
  later.
- **A cap is a one-way door.** `attempt_count` counts submissions and the
  database forbids lowering it, so a capped row cannot be revived — by the sweep
  or by hand. That is why [[TD-029]] moved from optional to urgent in this
  commit, and why the cap's consequence is written into the debt item rather
  than only into a comment.
- **Leaving `PROCESSING` alone is structural, not a guard**: the query phase has
  no queue, so it cannot resubmit even if someone wrote the code to try.
- **`0360` is detected by meaning, not by string**:
  `describeBatchQuery(reasonCode) .outcome === "unknownLot"` keeps the protocol
  table in one place.
- **The live-PG suite is timezone-sensitive**: a non-UTC server fails a
  pre-existing FISC-011 date-boundary case by constraint-name matching. CI is
  UTC, and the disposable cluster was started with `-c timezone=UTC` for the
  same reason.
- **A frozen budget is a real constraint, not a formality.** The provider
  rejected a validation whose correction exceeded it, and that rejection is what
  forced a smaller and better-shaped correction.
- **Three review rounds is the mechanism working.** The first correction was
  plausible and wrong; the validator said so, and the second was wrong in a
  different way. Neither wrongness reached a commit.

**WU-C's notes.**

- **The worked example was verified before it was specified.** `node:crypto`
  reproduced both hex conversions and the hash `97ddbb3c…74ed` from §13.8.4's
  own inputs, so the delegation could demand byte-exactness instead of hoping
  for it. The example's URL is 360 characters, comfortably inside the XSD's
  100..600.
- **The escaping lives in the fill, and that is forced, not chosen**: the QR is
  built after the signature (its `Id` is the CDC and its `DigestValue` is the
  signature's digest), and by then the document is already a serialized string.
- **The XSD round trip ran, it did not skip**: the official schemas are present
  at `defaultDteSchemaDirectory()` (`/tmp/newsaas-dte-xsd`), and the round trip
  proves the property that makes the whole design work — filling the QR after
  signing leaves the signature valid, because `gCamFuFD` sits outside the signed
  `DE` subtree.
- **`dRucRec` is typed non-null and §24 does not pin the choice** for a receptor
  with no RUC: the caller decides what identity value goes in. Carried into
  WU-D.
- **The QR's environment vocabulary is `DocumentIdentity`'s** (`test` /
  `production`), not the transport's `TEST`/`PRODUCTION`. The mapping is WU-D's.
- **Nothing is proven against SIFEN**: the CSC is a stand-in and whether SIFEN
  rejects a wrong `cHashQR` is a live question (§24.6.3).

## Notes

- **The retrieval tool matters, and it is now on record three times.** `pypdf`
  and `fetch_content` drop tables and images; **PyMuPDF** extracts them. Before
  declaring a source silent, read it with a second tool — §22.1's lesson,
  applied to §13.8.
- The QR's worked example in §13.8.4.4 uses `nVersion=142` in its "Datos del
  Paso 1" while the final URL uses `nVersion=150`: a defect inside the Manual's
  own example. The _version_ is `AA002`, so the client emits `150` and the
  divergence is recorded.
- `dFeEmiDE` in the example is `2017-01-25T09:35:17` — 19 characters, matching
  `D002`'s length — and its hex is the hex of those bytes, not a decoded date.
