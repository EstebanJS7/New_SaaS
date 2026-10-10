# FISC-015 — the document assembly

## Goal

Make the tenant's rows sufficient to build a legally valid DE, so the worker's
document stage — which [[FISC-012]] left failing closed behind a seam — can
produce one. The outcome: a confirmed invoice plus a declared fiscal identity
produces a document whose fiscal statements come from the tenant's own data and
from cited protocol tables, never from a default an agent chose.

## The decisions, and where they are

- **[[DEC-056]]** (accepted 2026-10-08) stopped FISC-012's stage, created this
  Story, and moved the fiscal number's allocation to **invoice confirmation**.
- **[[DEC-057]]** (accepted 2026-10-10) makes the four product decisions, from a
  retrieval that read the Manual v150, the Notas Técnicas that amend it, the
  official XSDs and the DNIT's own guides.

The retrieval's own findings, worth keeping:

- **The Manual is not the current rule set.** NT 023 reworded the receptor's
  identity fields, NT 010 and NT 023 added the innominado constraints, NT 020
  the state-entity rule, NT 021 a threshold, and **NT 013 replaced the IVA
  formulas** and added `E737`.
- **The Manual does not distinguish _exento_ from _exonerado_**: it labels both
  and gives both rate `0`. That is why the affectation is the tenant's
  declaration.
- **The catalogues are the protocol's own**: `Monedas_v150.xsd` carries
  `PYG → Guarani` and `Unidades_Medida_v141.xsd` `77 → Unidad - UNI`. Neither is
  tenant data; _which_ unit an item is, is.
- **`SIFEN-BASELINE.md` §22.3 had `iTiOpe`'s pairing wrong** (`D202 = 4` as
  B2C). The Manual's own table and NT 010's `D202`/1300 both say `2 = B2C`,
  `4 = B2F`. Corrected, and the schema stores the four **names** so a re-reading
  cannot reintroduce it.

## Work units

- [x] **WU-A — the decisions** ([[DEC-056]] + [[DEC-057]]), docs-only.
- [x] **WU-B — the number's authorisation**. Landed — see the Evidence. The
      counter **stays** for the non-fiscal path, and the two are not two truths:
      a tenant uses exactly one of them and which one is a property of its
      declaration, not of the code path.
- [x] **WU-C — the fiscal data** (the schema delta and the reads). Landed — see
      the Evidence.
- [ ] **WU-D — the assembly**: the mapping from the tenant's rows to
      `DteMappingInput`, plugged into FISC-012's seam, proven against the
      official XSD. **It also owns two protocol tables that do not exist
      anywhere in the repository**: the units of measure and the currencies,
      both of which the official XSDs carry with their descriptions.
- [ ] **WU-E — the homologation of one real document**: handed to [[FISC-013]].

## Evidence

```text
branch   feat/epic-16-fisc-015-document-assembly   from main = 4b9281b
WU-A     ffc536b  docs(FISC-013): the four decisions FISC-015 needs, and what the
                  sources pin for the homologation — 5 files, 498 insertions
                  ([[DEC-057]] proposed at that point, accepted in the next commit)
WU-C     4156d22  feat(FISC-015): the fiscal identity a DE needs — the schema
                  delta and the reads — 17 files, 2,568 insertions
         review-9ddfb96df63fba50  tier `high` (the live-PG process boundary),
                  **FOUR lenses run as ONE group**, closed `approved` with six
                  advisories (two `WARNING`, four `SUGGESTION`), none opening a
                  correction; the acknowledgement burned the authority
gates    format-check green; lint 20/20, typecheck 20/20, test 21/21, build 12/12;
         database 461, fiscal-persistence 56, fiscal 577, worker 140, api 1143
         (+237 live-PG skipped); and the live-PostgreSQL suite at **237/237**
         on the disposable UTC cluster, fifteen of them for this delta
```

WU-B b382108 feat(FISC-015): the number's authorisation at confirmation — 13
files, 2,545 insertions review-582d2ef98bf0938f tier `high`, four lenses as one
group: the refuter **corroborated** a CRITICAL claim (`R3-001`), the bounded
correction **widened the candidate's scope**, and the review was **recovered**
into a successor lineage review-935a71a795da88ed the recovered review: tier
`high`, four lenses as one group, closed **`approved`** with eight advisories at
`WARNING`/`SUGGESTION`, none opening a correction

## Review record

**WU-C — `review-9ddfb96df63fba50`, `approved` with four lenses (2026-10-10).**
Tier `high`, four lenses, 17 files and 2,581 changed lines. It closed `approved`
with **six advisories**, none opening a correction:

| id                   | location                            | our reading of the location                                                                                                    | action   |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `R3-CSC-RACE`        | the migration, the counting trigger | The at-most-two-active bound is per statement, not serializable: two concurrent inserts can both count one and commit.         | recorded |
| `R4-002`             | the same trigger                    | The same window, from the resilience lens.                                                                                     | recorded |
| `R3-PG-GLOBAL-COUNT` | the live-PG spec                    | A global count in the spec — the same class of hard-coded inventory that this unit had to update in `schema-clinical.test.ts`. | recorded |
| `R4-001`             | `fiscal-csc.reader.ts`              | The reader's fail-closed path and its ordering when two ACTIVE codes exist.                                                    | recorded |
| `R2-001`, `R2-002`   | `fiscal-csc.reader.ts`              | Two readability points on the same file.                                                                                       | recorded |

**The group tool works, and the earlier note that said otherwise was wrong.**
Four bindings went to `gentle_review_capture_group` in one call: one forecast
for the four runs, four reviewers admitted in provider order, and the closure
came back on the last one. The previous sessions' "slot by slot" habit cost
three extra round-trips for nothing.

**WU-B — one CRITICAL, a guard nobody knew about, and a recovery (2026-10-10).**

| stage               | what happened                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| finding             | `R3-001`, CRITICAL: the confirmation took the invoice's number from the fiscal allocator **while leaving the invoice's Billing series untouched**, but the allocator restarts at 1 on a series rollover — so the first fiscal number of a successor range **collided** with a confirmed invoice under `(tenant_id, series, number)`, the confirmation failed with an untranslated 500, and **the tenant could not confirm any further invoice**. |
| refuter             | Corroborated it after an adversarial search.                                                                                                                                                                                                                                                                                                                                                                                                     |
| correction, round 1 | The invoice's series becomes the fiscal one — and the **live-PostgreSQL suite refused it**: `a permitted transition cannot change the invoice series`, a **Billing header guard** making the series immutable.                                                                                                                                                                                                                                   |
| the design finding  | DEC-056's "the fiscal number IS the invoice's number" **collides with two pre-existing Billing invariants** (the series' immutability and the `(tenant, series, number)` uniqueness). Not a bug in WU-B: a decision that did not know about an invariant.                                                                                                                                                                                        |
| correction, round 2 | **Two identities, deliberately**: the invoice's own `number`/`series` stay Billing's and the **fiscal** number is the allocation's `document_number`, with its own unique index per range. No collision is possible, no guard is touched, and the DE and the KuDE carry the fiscal number — DEC-056's intent for the document the customer sees.                                                                                                 |
| recovery            | The correction widened the scope by one file (`billing.repository.ts`), so the provider required a **recovery authorization**: the maintainer approved it, the predecessor lineage is preserved with the reason recorded, and the corrected candidate was reviewed fresh.                                                                                                                                                                        |

**Eight advisories** are recorded with their coordinates, none opening a
correction: the allocation's race window (`R3-ALLOC-RACE`, `R4-001`), the
live-PG spec's own count (`R4-002`), the counter's documentation
(`R3-COUNTER-DOC`) and four readability points. The reviewers' full text is
never retained, so each reading above is ours.

## Notes

- **`tax_rate` is global**, so the tenant's affectation could not live on it
  without imposing one tenant's declaration on all of them. The classification
  is a new tenant-scoped table keyed `(tenantId, rateCode)`, which is also what
  makes "not declared" a representable state.
- **The consistency rule spans two tables**, so it takes two triggers: a
  classification whose rate disagrees is refused, and a rate a classification
  depends on cannot change under it. One direction alone would have left
  `UPDATE tax_rate SET rate = 5` able to invalidate every declaration silently.
- **A hard-coded inventory breaks on any new aggregate**:
  `schema-clinical.test.ts` counted the `(tenantId, id)` ownership keys, so the
  two new aggregates made it stale. Same class as the API's port double in
  FISC-012.
- **The reader's boundary must match the column's**: `emitter-profile.read.ts`
  first declared the three new fields optional to avoid touching its test, which
  would let a reader compile against a row shape the database cannot produce.
  The test was the fix, not the tolerance.
- **`prisma generate` output is gitignored**, so a schema delta needs
  `pnpm --filter @newsaas/database build` before any downstream package can
  typecheck against the new columns.
- **A rejected statement aborts its transaction**: every expected-failure probe
  in the live-PG suite needs its own rolled-back transaction, or the next
  assertion reports `25P02` instead of the constraint under test.
- **The units of measure and the currencies have no table anywhere in the
  repository**, and neither does `cMonedas` — the next unit **adds** two tables
  from the official XSDs rather than completing one.

## Out of scope

- **The provider, the stage, the credential and the gate**: [[FISC-012]]'s.
- **Contingency and the homologation run**: [[FISC-013]].
- **Re-deriving money**: the invoice's own `taxableBase`/`taxAmount` remain the
  single source, for the reason the mapper's own comment records.
