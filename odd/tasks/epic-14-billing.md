# EPIC-14 Billing — scope preparation and tracking

## Objective

Prepare EPIC-14 Billing as a docs-only kickoff before implementation: the epic
record, planned BILL stories and proposed Decision records for the unresolved
product/architecture choices.

## Constraints

- Do not change PRD scope.
- Do not write implementation code in this pass.
- Keep module docs for implemented behavior only; `docs/05-modules/Billing.md`
  is created by BILL-005 after implementation.
- Keep generated repository artifacts in English with YAML frontmatter.
- Keep EPIC-14 and the BILL stories in `planned` until implementation starts.
- Record an EPIC-14 decision as `accepted` only by an explicit maintainer act,
  never by inference from a kickoff approval.

## Tasks

- [x] Verify the repository facts EPIC-14 will cite (permission seeds, feature
      codes, the typed `sales` setting, the frozen `SaleLine` snapshot,
      `IdempotencyRecord`, the unwired event dispatcher, absent invoice code).
- [x] Create proposed Decision records DEC-038 through DEC-045.
- [x] Create `docs/01-roadmap/EPIC-14-Billing.md` aligned to PRD §18-22 and the
      epic boundaries already recorded by EPIC-08, EPIC-12 and EPIC-13.
- [x] Create planned BILL-001 through BILL-005 story records (delegated to
      `gentle-ai-worker`, then reconciled by the parent).
- [x] Apply the three maintainer-approved polish items: the atomic numbering
      allocation in DEC-039, the EPIC-15 cancellation hand-off in DEC-043 and
      the named [[TD-022]] deferral in DEC-044.
- [x] Create [[TD-022]] for the still-deferred portal invoice and document
      surface, with its owner and its re-evaluation point, and reconcile every
      reference to it across the epic and the BILL stories.
- [x] Run the docs-only formatting and whitespace checks and record results.
- [x] Maintainer review (2026-10-01): DEC-038 through DEC-045 accepted as
      proposed with the three polish items applied.
- [x] Convert DEC-038 through DEC-045 to `status: accepted` with the acceptance
      text in each `## Decision` section, and reconcile every downstream claim
      in the epic and the BILL stories.

## Evidence

- Created: 2026-10-01.
- Branch at start: `main` tracking `origin/main`.
- Working branch: `docs/epic-14-billing-kickoff`.
- Kickoff commit: `df2feaa` —
  `docs(EPIC-14): add billing scope, planned stories and proposed decisions` (16
  new files; not pushed, no PR opened).
- Read-only exploration: `gentle-ai-explore` confirmed that no EPIC-14 artifact,
  no `Invoice`/`InvoiceLine`/`InvoiceStatus` model, no `billing/` or `fiscal/`
  API module and no numbering infrastructure existed before this pass, and that
  `fiscal.invoice.issue` is seeded but consumed by no route.
- Artifacts created (16 files, all new):
  - `docs/01-roadmap/EPIC-14-Billing.md`
  - `docs/02-stories/BILL-001-invoice-data-foundation.md`
  - `docs/02-stories/BILL-002-invoice-creation-and-read-api.md`
  - `docs/02-stories/BILL-003-invoice-confirmation-and-cancellation-commands.md`
  - `docs/02-stories/BILL-004-staff-billing-surface.md`
  - `docs/02-stories/BILL-005-epic-closure-and-evidence.md`
  - `docs/07-decisions/DEC-038` … `DEC-045` (eight proposed decisions)
  - `docs/08-tech-debt/TD-022-portal-invoice-document-surfaces-deferred.md`
  - this task file
- Story authoring was delegated to `gentle-ai-worker` with an explicit allowed
  edit surface of the five BILL story paths only; the parent authored the epic
  and the decisions. The parent then reconciled the story cross-references (BILL
  numbering in `related_stories`, the `series`/`number` nullability rule in
  DEC-039 and BILL-001, and the [[TD-022]] references after the debt record was
  created).
- Maintainer review outcome (2026-10-01): the eight decisions were accepted as
  proposed, with the three polish items below applied. The kickoff landed as
  `673cfb7` while the decisions were still `proposed`.
- Acceptance commit (2026-10-01, the second commit on
  `docs/epic-14-billing-kickoff`,
  `docs(EPIC-14): accept the billing decisions`): `DEC-038` through `DEC-045`
  moved to `status: accepted`, each `## Decision` section now carries the
  accepted option and its terms (following the EPIC-13/DEC-026 precedent), and
  every downstream claim was reconciled: the epic's `## Decisions / ADRs`
  section and its dependency list, the `proposed, not accepted` bullets in
  BILL-001 through BILL-004, and BILL-005's three references. The acceptance is
  a separate, auditable commit rather than an amend of the kickoff.
- Polish items applied:
  1. DEC-039 now prescribes **one atomic statement** for the number allocation
     (`UPDATE invoice_number_sequence SET next_value = next_value + 1 … RETURNING next_value - 1`)
     instead of a `SELECT ... FOR UPDATE` followed by a write, and says the
     statement's row lock is held until the `confirm` transaction commits.
  2. DEC-043 gained a `## Hand-off to EPIC-15` section: once a `FiscalDocument`
     exists, cancelling a `CONFIRMED` invoice must request fiscal cancellation
     through the Fiscal application interface or [[EPIC-15]] must record why it
     does not, because otherwise a `CANCELLED` invoice can coexist with an
     approved fiscal document.
  3. DEC-044 now names [[TD-022]] instead of "a debt record to be created", and
     the re-evaluation point is justified: the document a customer wants to open
     is the authorised fiscal document (the KuDE), which does not exist before
     [[EPIC-15]]/[[EPIC-16]].
- Checks run (2026-10-01):
  - `npx prettier --check` over the 16 files: passed.
  - Formatter idempotency (the [[TD-017]] hazard): a second `prettier --write`
    produced byte-identical files (`md5sum` diff empty).
  - Wikilink line-wrap guard: no unterminated wikilink at a line end.
  - `pnpm format-check` (repo-wide):
    `All matched files use Prettier code style!`
  - `git diff --check` over the new files: clean.
  - Not run on purpose: `lint`, `typecheck`, `test`, `build`, `test:live-pg`.
    This pass changed documentation only and touched no source, schema, seed or
    test file, so those suites are unaffected. They become required again at
    BILL-001.
- Open limitations of this pass:
  - `openspec/config.yaml` still carries a stale context line naming EPIC-09 as
    the next planned epic. It was deliberately not edited: it is an OpenSpec
    artifact and any refresh is the maintainer's call.
  - `FILE-MANIFEST.md` already does not list EPIC-09 through EPIC-13 docs and
    was left alone rather than diverging further.
