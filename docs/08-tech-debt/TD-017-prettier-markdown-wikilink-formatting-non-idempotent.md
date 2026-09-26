---
id: TD-017
type: tech-debt
title: Prettier markdown formatting is not idempotent for a wrapped wikilink
status: open
severity: medium
related_epics:
  - EPIC-11
related_stories: []
created: 2026-09-26
updated: 2026-09-26
---

# TD-017 — Prettier markdown formatting is not idempotent for a wrapped wikilink

## Context

Markdown in this repository is formatted through the shared Prettier
configuration (`packages/prettier-config/index.js`), which sets
`proseWrap: "always"` and `printWidth: 80` for `*.md`, and `pnpm format-check`
(`prettier --check .`) is a repository gate.

The printer is not idempotent for one construct: a wikilink `[[...]]` whose text
spans a line break inside a list item. Every `prettier --write` pass adds two
more spaces of continuation indentation, so the file never converges and
`pnpm format-check` fails permanently.

The minimal reproduction, isolated from the repository. It is shown in a `text`
fence rather than a `markdown` fence because Prettier embedded-formats the
contents of a `markdown` fence and reproduces this same non-idempotence inside
it, which would leave this record itself unable to converge:

```text
- [[DEC-012 Purchase aggregate shape and the draft-versus-receive validation
  gate]] fixes the shape.
```

Each `prettier --write` pass rewrites the continuation line two spaces deeper,
with no fixed point:

```text
after pass 1: "    gate]] fixes the shape."
after pass 2: "      gate]] fixes the shape."
after pass 3: "        gate]] fixes the shape."
```

An ordinary wrapped list item is unaffected: the same shape with plain prose
instead of a wikilink reaches a fixed point on the first pass. A long wikilink
kept on a single line is stable too, because Prettier treats `[[...]]` as one
unbreakable token and overflows the line rather than splitting it. The trigger
is therefore specifically a wikilink split across lines inside a list item, not
list wrapping in general — which is why the defect appears only once a split
exists.

A single run does not reveal it: after a `--write`, `--check` can still report
style issues for the same file, so the failure reads as an ordinary formatting
miss rather than non-convergence.

The inflation was first observed in
`docs/07-decisions/DEC-018-purchase-numbering.md`, where repeated `--write` runs
drove a list-item continuation to 18 spaces. The affected set at the time of
writing is the five EPIC-11 documents:

- `docs/01-roadmap/EPIC-11-Suppliers-Purchases.md`
- `docs/02-stories/PUR-001-purchase-draft.md`
- `docs/02-stories/PUR-002-purchase-receiving.md`
- `docs/02-stories/PUR-003-staff-purchases-surface.md`
- `docs/07-decisions/DEC-018-purchase-numbering.md`

## Debt

`pnpm format-check` is a repository gate, so any contributor or agent who
authors a wikilink that wraps inside a list item enters a failure loop whose
cause is invisible from the error output: `prettier --check` reports only that
the file has style issues, never that the printer is not converging. Running
`--write` again does not clear it, and instead silently inflates the indentation
in the working tree, so each attempt leaves the file further from formatted.

The severity is medium: the hazard corrupts no runtime behavior, data or schema,
but it blocks the formatter gate for whoever hits the construct and rewrites
their working tree while they try to clear it.

## Why It Is Safe to Defer

- The five EPIC-11 documents are formatted and stable now; the workaround below
  removed the trigger from every occurrence that existed.
- No acceptance criterion, migration, endpoint or test depends on Prettier's
  markdown list indentation, so the practical effect today is confined to the
  formatter gate and to diff noise.
- The non-convergence needs a specific authoring shape (a wikilink split across
  lines inside a list item), and the repository contains no occurrence of it
  after the EPIC-11 fix.

## Risk

- A wrapped wikilink can be reintroduced by any contributor or agent, because
  nothing detects it: the error output names a style problem, not the
  non-convergence, and no lint rule requires the short-anchor convention that
  avoids it.
- Repeated `--write` runs mutate the working tree silently, so an agent that
  retries formatting can commit inflated indentation without noticing.
- `pnpm format-check` cannot go green while an occurrence exists, so an
  unrelated change can be blocked by a formatting failure in another file.

## Proposed Resolution

The workaround in force is an authoring convention:

- author wikilinks with the short anchor form (`[[DEC-012]]`, `[[PUR-001]]`,
  `[[EPIC-14]]`, `[[TD-016]]`) and never let `[[...]]` wrap; keep the
  descriptive title as ordinary prose next to the link when the reader needs it;
- treat a file as fixed only when two consecutive `prettier --write` runs
  produce identical bytes, rather than trusting a single passing `--check`.

The real fix is unaddressed. Either of these closes it:

1. A Prettier or `@newsaas/prettier-config` upgrade that stabilizes markdown
   list indentation for a wrapped wikilink, verified with a repeated-write
   idempotence check (write twice, compare bytes) on a fixture holding the
   minimal reproduction; or
2. An automated guard that detects non-convergence — format a fixture or the
   tree twice and fail when the second pass changes bytes — so the failure
   surfaces the real cause instead of a generic style error.

The expedient workaround leaves no lint rule enforcing the short-anchor
convention, so that convention stays unverified until the upgrade or the guard
exists.

## Trigger / Target

The next Prettier or `@newsaas/prettier-config` upgrade, or the next occurrence
of a wrapped wikilink inside a list item in a documentation change.

## Verification After Resolution

- [ ] The minimal reproduction reaches a fixed point: two consecutive
      `prettier --write` runs produce byte-identical output.
- [ ] `pnpm format-check` stays green with a wikilink-bearing wrapped list item
      present.
- [ ] The upgraded printer or the non-convergence guard is exercised by a test,
      or by a manual reproduction recorded here.
- [ ] The short-anchor convention is either enforced mechanically or dropped
      from the guidance because it is no longer needed.
