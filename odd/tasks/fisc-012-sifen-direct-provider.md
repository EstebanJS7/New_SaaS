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
- [ ] **WU-C — the QR**: a pure `buildQrContent(...)` in `packages/fiscal` (the
      URL, the parameters, the hex conversions, the SHA-256 hash, the escaping)
      plus the builder's QR placeholder and the fill step, table-driven against
      §13.8.4's own worked example.
- [ ] **WU-D — the worker's document stage**: the `QUEUED -> SIGNING -> SENDING`
      claim, the build → sign → QR → fill chain, the persistence of the signed
      XML (`xml_storage_key`, a new fiscal storage prefix), and the credential
      read that serves both the signature and mutual TLS.
- [ ] **WU-E — `SifenDirectFiscalProvider`**: the port implementation over the
      facade (the sync/batch strategy, `query`, `cancel`), the provider
      selection (`FISCAL_PROVIDER=SIFEN_DIRECT` with the production refusal
      kept), and the `null` credential → `CONFIGURATION_ERROR` mapping.
- [ ] **WU-F — the reconciliation**: the TD-028 sweep extended to `SUBMITTED`,
      calling `query`, applying a terminal resolution and leaving `PROCESSING`
      alone, with the `0360` decision recorded.

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
gates    format-check green; lint 20/20, typecheck 20/20, test 21/21, build 12/12;
         the new package 27 tests, fiscal 532 (25 new), api 1138 (+220 live-PG
         skipped), database 445, web 1087, worker 79, secret-store 50, ui 36,
         shared 16; and the live-PostgreSQL suite at 220/220
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
