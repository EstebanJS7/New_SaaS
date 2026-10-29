---
id: DEC-080
type: decision
title: Default locale and exact display rules for the staff application
status: accepted
date: 2026-10-26
updated: 2026-10-27
related_epics: [EPIC-03, EPIC-06, EPIC-07, EPIC-12]
related_stories: [UX-002]
prd_change_required: false
---

# DEC-080 — Default locale and exact display rules for the staff application

## Editable Decimal boundary — 2026-10-27 clarification

Read-only grouping and editable text have separate formatters. API Decimal
strings enter inputs with a comma decimal separator while preserving digits and
scale. Editable values accept optional dot grouping and comma decimals:
`120.000` means `120000`, `1,500` means `1.500`, and `1.234,50` means `1234.50`.
Malformed grouping or dot-decimal input is rejected instead of guessed.
Normalization uses string operations only; backend money/quantity validation,
calculation and currency contracts remain authoritative. UX-002 records the
catalog-price and initial-payment round-trip regression found during review.

## Context

The maintainer requested Spanish terminology and Paraguay number/date
presentation for the staff UI. The approved MVP has tenant time-zone rules and
Decimal financial contracts but no tenant UI-locale setting or i18n runtime.
Adding storage or a second language framework would expand the frozen MVP.

## Question

Which locale should staff see by default, and how may formatting present API
Decimal strings without changing their value?

## Options

### A — `es-PY` as the current staff default; format only at the display boundary (recommended)

Translate staff labels into Spanish and use `es-PY` presentation. Date-only
values retain their written calendar day; instants use the already resolved
tenant time zone. PYG grouping and separators change visually, while the full
wire scale remains visible whenever it is non-zero. Preserve API strings and
avoid `Number`, currency conversion, rounding and new stored settings.

### B — Persist a locale per tenant now

This would need a typed setting namespace, server-side validation, product
fallback, tenant administration and a migration/rollout story. No approved
requirement currently defines those behaviors.

### C — Use browser locale and time zone

This can differ from the clinic's business context and can move instants across
the clinic's calendar date.

## Recommendation and status

Recommend A for the current Paraguay deployment. Keep the language decision
separate from tenant branding and do not persist arbitrary locale preferences.
Do not make the layout or formatter architecture depend on a third-party i18n
framework. Revisit tenant-selectable language only when a concrete tenant need
and rollout contract are approved.

Status: **accepted** for the current staff experience, following the
maintainer's request to prioritize Spanish and Paraguay formats. This does not
add a tenant setting, change the Portal language, or alter persistence and
external contracts.

## Consequences

- Staff labels and money/date presentation need a deliberate coverage list;
  untouched Portal and operational modules must not be claimed as translated.
- Tenant time zone remains authoritative for persisted instants.
- PYG display preserves exact digits; it never mutates the amount or computes
  totals.
