---
feature: epic-16-fiscal-third-party-adapter
epic: EPIC-16
status: in-progress
created: 2026-10-03
updated: 2026-10-03
branch: (not created yet)
---

# EPIC-16 Fiscal Third-party Adapter — ODD task tracker

## Goal

Deliver the second step of `docs/06-fiscal/SIFEN.md`'s sequence
(`FakeFiscalProvider → ThirdPartyFiscalProvider → SifenDirectFiscalProvider`): a
real third-party fiscal provider behind the boundary EPIC-15 built, with tenant
credentials handled as secret references, XML/KuDE artifacts persisted through
the existing storage port, fiscal provider configuration typed and audited, and
the manual re-drive `SIFEN.md` requires.

EPIC-15 delivered the boundary and deliberately stopped before any real
provider. EPIC-16 is where the boundary meets a real one.

## TDD resolution

- Mode: **off**. Authoritative source: `openspec/config.yaml` sets
  `strict_tdd: false` and `rules.apply.tdd: false`.

## Governance constraints that bind this epic

Read before any code: `AGENTS.md`, `docs/99-governance/ENGINEERING-RULES.md`,
`docs/99-governance/DOCUMENTATION-RULES.md`.

- **PRD §23 and `SIFEN.md` forbid implementing protocol details from memory.**
  Direct SIFEN work requires revalidating the current official DNIT baseline
  (Manual Técnico, XSDs, XML structures, Notas Técnicas, test guide,
  environment/certification requirements) at that time.
- **`DOCUMENTATION-RULES.md` names "change Fiscal Provider boundary" as an
  explicit ADR case**, not a Decision. Anything that changes that boundary needs
  an ADR.
- **"Secrets never live in Git or plaintext application records"**
  (`ENGINEERING-RULES.md`, Security) and **"General settings do not contain
  secrets"** (Tenant Settings).
- **"Never hold a database transaction open while waiting on fiscal providers"**
  (External calls). EPIC-15 already honors this; EPIC-16 must not regress it.
- **Complexity budget**: no new runtime, database, queue, ORM, auth provider or
  data store without an accepted ADR. A production secret store is an external
  dependency, so it needs the same treatment as any other boundary.

## What exists already (verified on merged `main` `4c02473`)

- `packages/fiscal`: the provider port with `issue` and `cancel`, the
  deterministic fake, the fail-closed snapshot sanitizer, the queue contract and
  the composition root that refuses a fake in production.
- `apps/api/src/fiscal`: the issue, cancel and read commands, the read contract,
  `fiscal.read`, the staff surface at `/app/fiscal`, and the `DEC-051` Billing
  hand-off.
- `apps/worker/src/fiscal-submission`: the consumer, the handler with its claim
  lease, and the TD-028 recovery sweep.
- `packages/storage`: `StoragePort`, an S3 driver, an in-memory driver, opaque
  key helpers and a module. Reusable as-is for XML/KuDE.
- `fiscal_document.xml_storage_key` and `kude_storage_key`: columns that exist
  and are written by nothing.
- `apps/api/src/settings/registry.ts`: three namespaces (`sales`, `scheduling`,
  `portal`). No fiscal namespace exists (`D6` of FISC-005b decided not to ship
  one).

## What does not exist

- **No tenant fiscal credential mechanism at all.** This is the epic's first
  blocker and the reason ADR-005 is required.
- **No real provider adapter.** `FISCAL_PROVIDER` only accepts `fake`, and a
  production boot refuses to start.
- **No XML/KuDE persistence**, no fiscal configuration surface, no configuration
  audit, and no manual re-drive ([[TD-029]]).

## Decisions taken by the maintainer (2026-10-03)

### D1 — Credentials through a new `SecretStore` port, with an ADR (accepted)

A `SecretStore` port with a dev/test driver, mirroring the `StoragePort`
precedent: the port and its drivers live in a package, selection happens in the
app, and the production requirement is documented rather than assumed. Fiscal
configuration stores only an opaque `credentialRef`; the secret material never
reaches a tenant setting, an application record, a log or the repository.

**ADR-005 is required** because this changes the Fiscal provider boundary, which
`DOCUMENTATION-RULES.md` names as an ADR case.

### D2 — The adapter targets one concrete third-party provider (accepted)

Not a generic configurable mapping: a named provider, implemented against its
published API, with a research story that validates that documentation before
the adapter is written. A vendor-neutral "configurable mapping" would be the
low-code/EAV pattern `AGENTS.md` forbids.

**OPEN — the maintainer must name the provider.** Still needed:

1. the provider's name;
2. a link or PDF for its API documentation, or explicit authorization to
   research it;
3. sandbox access details, if a sandbox exists.

The epic doc, the ADR and the provider-independent stories can be written now;
the adapter story cannot be pinned until the provider is known.

## Proposed story plan (to be pinned in the kickoff)

| Story    | Scope                                                                                               | Depends on                   |
| -------- | --------------------------------------------------------------------------------------------------- | ---------------------------- |
| FISC-006 | Fiscal third-party scope and decisions (docs-only kickoff)                                          | —                            |
| FISC-007 | Tenant fiscal credential boundary: `SecretStore` port + ADR-005                                     | FISC-006                     |
| FISC-008 | Fiscal provider configuration (typed, non-secret) + XML/KuDE persistence through `StoragePort`      | FISC-007                     |
| FISC-009 | The concrete third-party adapter, against validated provider documentation                          | FISC-008 + the provider name |
| FISC-010 | Manual fiscal re-drive and fiscal configuration audit (closes [[TD-029]])                           | FISC-008                     |
| FISC-011 | DNIT revalidation research: the official baseline, cited, as input for the future SIFEN Direct work | — (independent, docs-only)   |
| FISC-012 | Epic closure: module docs, CI evidence, changelog, roadmap, advisory triage                         | all                          |

FISC-011 is deliberately independent and docs-only: `SIFEN.md` requires the
official baseline to be revalidated _before_ SIFEN Direct work starts, and doing
it during EPIC-16 means the next epic starts from verified sources rather than
from memory.

## Explicitly out of scope

- **`SifenDirectFiscalProvider`.** PRD §22 marks `SIFEN_DIRECT` as future and
  PRD §23 defers it behind a DNIT revalidation. EPIC-16 ships the _research_ for
  it (FISC-011), never the implementation.
- **XAdES signing and the `SIGNING` state.** A third-party provider signs; the
  internal lifecycle deliberately omits `SIGNING` ([[DEC-047]]).
- **KuDE rendering as a document layout.** EPIC-16 may persist whatever the
  provider returns; it does not design a printable document.
- **The portal fiscal document surface** — still [[TD-022]].
- **Reports and dashboards** — [[EPIC-18]]. **Notification delivery** —
  [[EPIC-17]].

## Tasks

- [ ] T1 — Get the provider name, then pin the kickoff: epic doc,
      `FISC-006`..`FISC-012`, ADR-005 and the proposed decisions.
- [ ] T2 — FISC-007: `SecretStore` port, dev driver, ADR-005, fiscal credential
      reference.
- [ ] T3 — FISC-008: fiscal configuration namespace + XML/KuDE persistence.
- [ ] T4 — FISC-009: the concrete third-party adapter.
- [ ] T5 — FISC-010: manual re-drive + configuration audit (closes TD-029).
- [ ] T6 — FISC-011: DNIT revalidation research.
- [ ] T7 — FISC-012: epic closure.

## Notes

- Base: merged `main` `4c02473` (EPIC-15 closed; PRs #102 and #103 merged).
- EPIC-15's open review advisories ([[TD-030]]) and the operator re-drive
  ([[TD-029]]) are EPIC-16's inherited debt; FISC-010 closes the latter.
