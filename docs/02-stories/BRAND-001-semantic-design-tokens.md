---
id: BRAND-001
type: story
title: Semantic design tokens
epic: EPIC-03
status: planned
priority: high
depends_on: []
prd_sections:
  - "10.1"
permissions: []
branch:
created: 2026-08-13
updated: 2026-08-13
---

# BRAND-001 — Semantic design tokens

## Objective

Create the theme contract and semantic token infrastructure used by all reusable
UI components.

## In Scope

- strict BrandTheme schema;
- CoreDesignDefaults;
- token-to-CSS-variable mapping;
- theme resolution function;
- light/dark/system handling;
- shadcn/Tailwind integration;
- unit tests.

## Out of Scope

- tenant persistence;
- uploads;
- settings UI;
- custom domains.

## Acceptance Criteria

- [ ] A strict versioned BrandTheme schema exists.
- [ ] CoreDesignDefaults resolve to a complete usable theme.
- [ ] Missing override values fall back correctly.
- [ ] Invalid theme values are rejected.
- [ ] Shared Button/Card/Input/Shell examples use semantic tokens only.
- [ ] No Veterinary brand literal is required inside shared components.
- [ ] Light/dark/system appearance is supported.
- [ ] Unit tests cover resolution precedence and fallback.
- [ ] Lint/typecheck/tests/build pass.

## Domain Invariants

- No arbitrary CSS or JS is represented by BrandTheme.
- Product identity is config/data, not component forks.

## Implementation Summary

_Not implemented._

## Verification

```text
Not run.
```
