---
id: DEC-062
type: decision
title:
  Report access — no feature code, a reports permission family, one aggregation
  path
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-18"
related_decisions:
  - "DEC-058"
  - "DEC-026"
  - "DEC-040"
related_stories:
  - "REP-002"
  - "REP-008"
prd_change_required: false
---

# DEC-062 — Report access: ungated by feature code, guarded by `reports.*`

## Context

PRD §9 lists `reporting` among the Core **domains**. PRD §9.1 fixes the twelve
initial **feature codes**, and `reporting` is not among them:

```text
veterinary  inventory  purchases  sales  cash  billing
fiscal  portal  whatsapp  multi_branch  advanced_reports  custom_branding
```

All twelve are seeded in `packages/database/src/reference-seed.ts`
(`FEATURE_CODE_SEEDS`), `advanced_reports` among them. There is no `reporting`
entry, and there is no entitlement, permission, route, module or CSV code
anywhere in `apps/api`, `apps/web`, `apps/worker` or `packages/*` today.

The exploration also established that `PERMISSION_SEEDS` has sixteen families
(`sales`, `cash`, `inventory`, `purchases`, `catalog`, `customers`, `patients`,
`vet`, `scheduling`, `billing`, `fiscal`, `notifications`, `portal`,
`suppliers`, `users`, `branding`) and **no** reports/analytics/dashboard/export
key.

[[DEC-058]] set the precedent for exactly this shape of question: it refused a
thirteenth feature code for WhatsApp and left email ungated, on the grounds that
PRD §10's twelve are a product decision.

## Question

Are the reports gated by a feature code, and if so which one? What guards them,
and does the dashboard get its own aggregation path?

## Options

### Option A — No feature-code gate; a `reports.*` RBAC family; one aggregation path (accepted)

Reports read data the tenant already owns: it can already see its own sales,
cash and stock through the domain surfaces, each behind its own permission. A
feature code would add a commercial lever whose meaning is undefined — there is
no basic/advanced split to express, because this epic ships all eleven reports
at once and nothing above them.

Access is guarded the way every other read in the system is guarded: two new
permission keys, `reports.read` and `reports.export`, in `PERMISSION_SEEDS`,
mapped to the roles that already see the underlying domains.

The dashboard is **not** a second aggregation path. A dashboard card and its
report call the same service method with the same period argument; there is one
SQL statement per report in the repository and both surfaces consume it.

### Option B — Gate everything behind the existing `advanced_reports`

Rejected. The code exists and is already mapped, so the cost is zero — but it
would gate the _basic_ reports behind a code named "advanced", which leaves no
name for the thing the code was reserved for. It also makes a tenant that can
see its sales and its cash lose its reports entirely, which is a surprising
regression from a code nobody is granted today.

### Option C — Add a thirteenth `reporting` feature code

Rejected, on [[DEC-058]]'s reasoning verbatim. PRD §10 fixes the twelve, so a
thirteenth is a PRD change and therefore a product-scope decision. Conflating
the `reporting` **domain** in PRD §9 with a `reporting` feature **code** is the
specific error to avoid: a domain is a module boundary, a feature code is a
commercial entitlement.

### Option D — No gate and no permission family

Rejected. `ENGINEERING-RULES.md` makes backend authorization mandatory, and a
report aggregates across customers, patients and clinical counts, so it is not
the same exposure as the single-row read it is derived from. `reports.read` is
the smallest honest guard.

## Decision

Accepted by the maintainer on 2026-10-19.

**Reports are not gated by any feature code.** `advanced_reports` stays unspent
and is reserved for a genuinely advanced capability — multi-branch aggregation,
scheduled delivery, or asynchronous export — none of which this epic ships. No
thirteenth code is added and the PRD is unchanged.

**`reports.read` and `reports.export` are added to `PERMISSION_SEEDS`**,
enforced server-side on every report route and its export route. Frontend
permission checks remain UX only.

**The dashboard consumes the report service, never a second query.** A card and
its report share one repository method; [[REP-008]] asserts that with a test
rather than a convention.

## Consequences

### Product

Every tenant with `reports.read` sees all eleven reports. There is no partial
report catalogue and no "advanced" tier in the MVP. PRD §9.1 is unchanged.

### Architecture

One new read-only module, `apps/api/src/reporting`, with a service, a repository
and a controller per report family. No cache, no materialized view, no query
builder, no charting dependency.

### Database/API

No feature-code migration. `reports.read` and `reports.export` are seeded and
mapped to roles, and every route is pinned in the RBAC route-contract probe as
the other route families are.

### Delivery

[[REP-002]] seeds the permissions and establishes the contract;
[[REP-003]]–[[REP-006]] add the reports behind them; [[REP-007]] adds
`reports.export`; [[REP-008]] builds both surfaces on the same service.

## PRD Update

No PRD change. PRD §9.1's twelve codes are preserved and PRD §31 is implemented
as written.
